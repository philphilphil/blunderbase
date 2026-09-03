"""`go infinite`: one search that never ends, reported as throttled snapshots.

The rest of `adapters/` answers a bounded question — search this board to N nodes and tell
me what you found. An analysis board asks the opposite: keep searching until I stop you,
and show me what you have as you go. That is a different shape, so it gets its own driver
rather than a flag on `StockfishAdapter.analyse`.

Three things shape it:

- **It is blocking, and a thread owns it.** Like every other module here, nothing knows the
  event loop exists. `run` is handed a `threading.Event` and returns when it is set; the
  caller is whichever backend put it on a thread.
- **Throttling happens here, at the producer.** A UCI engine emits several `info` lines per
  depth and a great many per second; a browser wants two pictures a second. `SnapshotBuffer`
  merges the per-multipv lines into one board-wide picture and hands it over no more often
  than `interval`. That is what keeps a remote runner from putting a megabyte a second on
  the wire, and it is the same code doing it locally.
- **A snapshot speaks `MoveEval.best_lines`' vocabulary.** `{"multipv","cp","mate","pv"}`,
  the same shape the database stores and the same one the engine-lines panel already
  renders — but from the *side to move's* point of view rather than White's, because an
  analysis board shows "who is better here" from the mover's chair. Raw UCI text never
  leaves this module.
"""

from __future__ import annotations

import contextlib
import threading
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from backend.adapters.stockfish import (
    PV_PLIES,
    START_ERRORS,
    EngineError,
    Score,
    line,
)

if TYPE_CHECKING:  # pragma: no cover - typing only
    import chess

    from backend.adapters.stockfish import StockfishAdapter

# Two pictures a second. Fast enough that the numbers look alive, slow enough that a deep
# multi-PV search is not a flood.
SNAPSHOT_INTERVAL = 0.5
# How long the loop waits on the stop event when the engine has said nothing new. Short
# enough that closing a session is instant, long enough that idling costs nothing.
IDLE_TICK = 0.05
# How long a stopped search is given to hand its `bestmove` back before the process is
# written off. An engine answers a `stop` in milliseconds; one that has not answered in
# this long never will, and a slot the pool never gets back costs more than a process.
QUIETEN_TIMEOUT = 5.0

Clock = Callable[[], float]


@dataclass(frozen=True, slots=True)
class Snapshot:
    """One picture of a running search, as the browser draws it."""

    depth: int | None = None
    nodes: int | None = None
    nps: int | None = None
    time_ms: int | None = None
    lines: tuple[dict[str, Any], ...] = ()

    def as_dict(self) -> dict[str, Any]:
        return {
            "depth": self.depth,
            "nodes": self.nodes,
            "nps": self.nps,
            "time_ms": self.time_ms,
            "lines": [dict(entry) for entry in self.lines],
        }


class SnapshotBuffer:
    """Merge an engine's `info` lines into one picture, and hand it over on a clock.

    The merge matters as much as the throttle: a multi-PV engine reports one line at a
    time, so the naive thing — one snapshot per `info` — would show a board whose second
    variation belongs to the previous depth. Lines are keyed by their own `multipv` rank
    and the whole set goes out together.
    """

    def __init__(
        self,
        board: chess.Board,
        *,
        multipv: int = 1,
        interval: float = SNAPSHOT_INTERVAL,
        clock: Clock = time.monotonic,
        pv_plies: int = PV_PLIES,
    ) -> None:
        self._board = board
        self._multipv = max(1, int(multipv))
        self._interval = max(0.0, float(interval))
        self._clock = clock
        self._pv_plies = pv_plies
        self._lines: dict[int, dict[str, Any]] = {}
        self._depth: int | None = None
        self._nodes: int | None = None
        self._nps: int | None = None
        self._time_ms: int | None = None
        self._dirty = False
        # None until the first snapshot: the first one goes out at once, so a board is
        # never blank for half a second before its first evaluation appears.
        self._last: float | None = None

    def offer(self, info: Mapping[str, Any]) -> Snapshot | None:
        """Fold one `info` in. A snapshot comes back only when one is due."""
        self._merge(info)
        return self.due()

    def due(self) -> Snapshot | None:
        """The merged picture, if something changed and the interval has passed.

        Called on its own by a caller whose engine has gone quiet: three `info` lines in a
        burst followed by a long think must still reach the board.
        """
        if not self._dirty:
            return None
        now = self._clock()
        if self._last is not None and now - self._last < self._interval:
            return None
        return self._emit(now)

    def flush(self) -> Snapshot | None:
        """The merged picture whatever the clock says, or None if nothing is pending."""
        if not self._dirty:
            return None
        return self._emit(self._clock())

    def _emit(self, now: float) -> Snapshot:
        self._last = now
        self._dirty = False
        return Snapshot(
            depth=self._depth,
            nodes=self._nodes,
            nps=self._nps,
            time_ms=self._time_ms,
            lines=tuple(dict(self._lines[rank]) for rank in sorted(self._lines)),
        )

    def _merge(self, info: Mapping[str, Any]) -> None:
        for key, field in (("depth", "_depth"), ("nodes", "_nodes"), ("nps", "_nps")):
            value = info.get(key)
            if isinstance(value, int):
                setattr(self, field, value)
                self._dirty = True
        elapsed = info.get("time")
        if isinstance(elapsed, int | float):
            self._time_ms = int(float(elapsed) * 1000)
            self._dirty = True
        self._merge_line(info)

    def _merge_line(self, info: Mapping[str, Any]) -> None:
        score = info.get("score")
        pv = info.get("pv")
        # A bounded score is the engine saying "at least this much" mid-window, not an
        # evaluation; showing one makes a board flicker between numbers it never meant.
        if score is None or not pv or info.get("lowerbound") or info.get("upperbound"):
            return
        rank = info.get("multipv")
        rank = 1 if not isinstance(rank, int) else rank
        if rank < 1 or rank > self._multipv:
            return
        ucis, _sans = line(self._board, pv, self._pv_plies)
        if not ucis:
            return
        relative = Score.from_pov(score).pov(self._board.turn)
        self._lines[rank] = {
            "multipv": rank,
            "cp": relative.stored_cp,
            "mate": relative.mate_in,
            "pv": ucis,
        }
        self._dirty = True


class InfiniteSearch:
    """`go infinite` on one warm process, until somebody sets the stop event."""

    def __init__(
        self,
        adapter: StockfishAdapter,
        *,
        interval: float = SNAPSHOT_INTERVAL,
        tick: float = IDLE_TICK,
        quieten_timeout: float = QUIETEN_TIMEOUT,
    ) -> None:
        self.adapter = adapter
        self.interval = interval
        self.tick = tick
        self.quieten_timeout = quieten_timeout

    def run(
        self,
        board: chess.Board,
        *,
        multipv: int = 1,
        on_snapshot: Callable[[Snapshot], None],
        stop: threading.Event,
    ) -> bool:
        """Search `board` until `stop` is set. True if the engine stopped by itself.

        The engine is left idle either way: the search is stopped and waited out before
        this returns, because the next thing the caller does with that process is start
        another search on it — a restart at a new position, on the same slot.

        A finished game is answered here rather than by the engine. There is nothing to
        search, and engines disagree about how to say so: Stockfish answers
        `bestmove (none)`, Leela answers `bestmove a1a1`, which python-chess refuses to
        parse — and refuses without ever finishing the analysis, so the wait below would
        never return and the slot would never come back. Scrolling to the last move of a
        won game is the ordinary way to reach one of these positions.
        """
        if board.is_game_over():
            on_snapshot(Snapshot())
            return True

        buffer = SnapshotBuffer(board, multipv=multipv, interval=self.interval)
        kwargs: dict[str, Any] = {"multipv": multipv} if multipv else {}
        try:
            search = self.adapter.engine.analysis(board, **kwargs)
        except START_ERRORS as exc:
            raise EngineError(f"infinite analysis could not start: {exc}") from exc

        finished = False
        try:
            while not stop.is_set():
                if search.would_block():
                    # Nothing pending: hand over whatever the last burst merged into, then
                    # wait a moment for the engine or for the caller, whichever comes first.
                    self._offer(buffer.due(), on_snapshot)
                    stop.wait(self.tick)
                    continue
                info = search.next()
                if info is None:
                    finished = True
                    break
                self._offer(buffer.offer(info), on_snapshot)
        except START_ERRORS as exc:
            raise EngineError(f"infinite analysis failed: {exc}") from exc
        finally:
            quiet = _quieten(search, self.quieten_timeout)

        if not quiet:
            # Reached only when the loop itself did not raise, so this is the whole story:
            # the process is stuck and the caller's `except` is what frees the slot.
            raise EngineError("the engine did not answer `stop`")
        if finished:
            # It answered and stopped by itself — an engine that will not search this
            # position. The last picture is still worth showing.
            self._offer(buffer.flush(), on_snapshot)
        return finished

    def _offer(self, snapshot: Snapshot | None, on_snapshot: Callable[[Snapshot], None]) -> None:
        if snapshot is not None:
            on_snapshot(snapshot)


def _quieten(search: Any, timeout: float) -> bool:
    """Stop the search and wait for the engine to answer. False if it never did.

    Both halves are suppressed: an engine that has already died cannot be stopped and has
    no `bestmove` left to give, and the caller learns that from the exception the loop
    raised rather than from a second one thrown out of a `finally`.

    The wait is bounded, and on a thread of its own because `search.wait()` has no timeout
    to give it. There is more than one way for that call never to return — a `bestmove`
    python-chess cannot parse leaves the analysis unfinished for good, with the engine
    itself sitting perfectly idle — and an unbounded wait here is a pool slot nobody ever
    gets back. Whoever is left holding the timed-out thread is the engine's shutdown: it
    ends the moment the process does.
    """
    with contextlib.suppress(Exception):
        search.stop()
    answered = threading.Event()

    def wait() -> None:
        with contextlib.suppress(Exception):
            search.wait()
        answered.set()

    threading.Thread(target=wait, name="engine-quieten", daemon=True).start()
    return answered.wait(timeout)
