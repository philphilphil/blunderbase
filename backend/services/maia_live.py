"""Maia on the analysis board: one warm process, asked about arbitrary positions.

The stored human-move data is a property of a *game* — the batch pass bakes it into
`MoveEval.maia_policy` and the game panel reads it back with no engine in sight. The
analysis board has no game: its positions are made up as someone explores, so the only way
to say "what would a human at this level play here" is to ask, now.

Three decisions shape this module:

- **The session is warm and it is a singleton.** Maia loads its weights before it answers
  `uciok`, which is the better part of a minute; a process started per query would make a
  debounced board unusable. So the first query opens one and every later one reuses it,
  a `threading.Lock` serialises them — a query is one node, so the wait is milliseconds —
  and an idle timer closes it again so an unused board does not hold a process forever.
- **Backend-local engines only.** A runner carries whole runs, not single positions, and a
  remote engine's `path` means nothing here. A deployment whose only Maia is on a runner
  gets `LiveMaiaUnavailableError` naming that, and the UI hides the live section rather
  than showing an error nobody can act on.
- **`policy_at` is the one policy call.** It is what the batch pass uses, so the entries
  the board shows and the entries a run stored are the same shape, level key and all —
  including the way a fixed-weights build answers for the single level it *is*. Every
  configured level is asked in one call, on the one warm process under the one lock, because
  the reading that teaches something is the comparison between them.

Nothing here writes to the database; the Session is only read from, on every query — which
engine to start and what level to ask it about — so changing either in Settings takes
effect on the next query rather than on the next restart.
"""

from __future__ import annotations

import logging
import re
import threading
from collections.abc import Sequence
from typing import TYPE_CHECKING, Any

from sqlalchemy.orm import Session

from backend.config import MAIA_MAX_RATING, MAIA_MIN_RATING
from backend.db.enums import EngineRole
from backend.services import app_settings as app_settings_service
from backend.services import engines as engines_service

if TYPE_CHECKING:  # pragma: no cover - typing only
    import chess

    from backend.adapters.maia import MaiaAdapter
    from backend.db.models import Engine

# How long the warm process survives with nobody asking it anything. Long enough that a
# session of exploring never pays the weight load twice, short enough that a board left
# open overnight is not a process left running overnight.
IDLE_SECONDS = 600.0

# A rollout asks for the single most likely move per ply; the fan-out is the policy column
# above it, not the line.
ROLLOUT_MULTIPV = 1
# What a rollout will not exceed however long a caller asks for. Each ply is its own engine
# query, and past a dozen the line is a fiction anyway.
MAX_ROLLOUT_PLIES = 20

# Where a fixed-weights build's own rating is written down: whatever names its weights.
# `maia-1500.pb.gz` is the whole convention — the released weights are named that way, and
# so are the engine rows and the lc0 command lines an owner registers for them.
FIXED_LEVEL_PATTERN = re.compile(r"maia[-_. ]?(\d{3,4})", re.IGNORECASE)

logger = logging.getLogger(__name__)


class LiveMaiaError(RuntimeError):
    """Anything the live Maia surface reports instead of a stack trace."""


class LiveMaiaUnavailableError(LiveMaiaError):
    """There is no human-move model on this host, or the one there is would not answer.

    The endpoint answers 409 with the reason, and the board hides its live section: a
    deployment with no Maia is a deployment with less to show, not a broken one.
    """


class LivePolicyRequestError(LiveMaiaError, ValueError):
    """The request itself is wrong — a FEN that is not a position."""


class LiveMaia:
    """A warm Maia session, opened on demand and closed when it goes quiet."""

    def __init__(self, *, idle_seconds: float = IDLE_SECONDS) -> None:
        self._idle_seconds = float(idle_seconds)
        # Held for the whole of a query: Maia is one process and two boards asking at once
        # would interleave `setoption` with somebody else's `go`.
        self._lock = threading.Lock()
        self._adapter: MaiaAdapter | None = None
        self._spec: Any = None
        self._timer: threading.Timer | None = None

    # --- the query ---------------------------------------------------------

    def policy(
        self,
        session: Session,
        *,
        fen: str,
        elo: int | None = None,
        elos: Sequence[int] | None = None,
        moves: int | None = None,
        rollout_plies: int = 0,
    ) -> dict[str, Any]:
        """One position's human-move policy per level, and optionally the lines they lead to.

        The levels default to the ones configured in Settings — all of them, in one call and
        on the one warm process under the one lock, because the board's whole question is
        "and what would a *weaker* human play here" and two round trips per position would
        double the cost of asking it. `elo` is the older way of naming a single one and still
        works.

        Every level is clamped to what this build declares it can answer for, and what comes
        *back* per level is the level the engine actually played as, which for a fixed-weights
        build is not the number that was asked for at all (`_reported_level`) — so the board
        never labels a column with a human this engine never imitated, and reports no number
        rather than a wrong one where the build's own level is nowhere written down. Such a
        build answers with one level however many were asked for: it is one rating, and
        showing the same policy in five columns would invent a comparison.

        The answer carries `levels` — one entry per level, keyed by it — plus the first
        level's own `elo`/`policy`/`rollout` at the top, which is the shape the board read
        before there was more than one.
        """
        board = read_board(fen)
        wanted = max(1, int(moves) if moves is not None else _policy_moves())
        plies = max(0, min(MAX_ROLLOUT_PLIES, int(rollout_plies)))
        engine = self._require_engine(session)

        with self._lock:
            adapter = self._open(engine)
            levels = self._levels(session, adapter, elo=elo, elos=elos)
            try:
                answers = self._answers(adapter, engine, board, levels, wanted, plies)
            except LiveMaiaUnavailableError:
                # The process is the suspect, not the position: drop it so the next query
                # starts a fresh one rather than talking to a corpse.
                self._close()
                raise
            self._arm_idle_timer()
        first = next(iter(answers.values()))
        return {
            "elo": first["elo"],
            "policy": first["policy"],
            "rollout": first["rollout"],
            "levels": answers,
        }

    def _answers(
        self,
        adapter: MaiaAdapter,
        engine: Engine,
        board: chess.Board,
        levels: Sequence[int],
        moves: int,
        plies: int,
    ) -> dict[str, dict[str, Any]]:
        """One entry per level the engine can honour, keyed by the level asked for.

        Keyed by the *request*, not by the reported level, so a caller that asked about 1500
        finds its answer where it put the question — the honest reading of what played is
        the entry's own `elo`. A fixed-weights build is the exception: it plays one rating,
        so it answers once, under the level its weights name where they name one.
        """
        if not adapter.supports_rating:
            reported = _reported_level(adapter, engine, levels[0])
            key = str(reported if reported is not None else levels[0])
            return {
                key: {
                    "elo": reported,
                    "policy": _policy_at(adapter, board, levels[0], moves),
                    "rollout": self._rollout(adapter, board, levels[0], plies),
                }
            }
        return {
            str(level): {
                "elo": _reported_level(adapter, engine, level),
                "policy": _policy_at(adapter, board, level, moves),
                "rollout": self._rollout(adapter, board, level, plies),
            }
            for level in levels
        }

    def _rollout(
        self, adapter: MaiaAdapter, board: chess.Board, level: int, plies: int
    ) -> list[dict[str, Any]]:
        """The most likely continuation, both sides conditioned at the same level.

        Stops early at a finished game or at a position the engine has no policy for; a
        line that ran out is shorter than asked for, never padded.
        """
        line: list[dict[str, Any]] = []
        if plies <= 0:
            return line
        work = board.copy()
        for _ in range(plies):
            if work.is_game_over():
                break
            entries = _policy_at(adapter, work, level, ROLLOUT_MULTIPV)
            if not entries:
                break
            top = entries[0]
            step: dict[str, Any] = {"uci": top["uci"], "san": top["san"]}
            if top.get("p") is not None:
                step["p"] = top["p"]
            line.append(step)
            try:
                work.push(work.parse_uci(str(top["uci"])))
            except ValueError:
                break
        return line

    # --- the process -------------------------------------------------------

    @property
    def is_open(self) -> bool:
        """Whether a Maia process is being held open right now."""
        return self._adapter is not None

    def close_if_idle(self) -> bool:
        """Shut the warm process down unless a query is holding it. Was it closed?

        Non-blocking on purpose: the timer that calls this must never queue up behind a
        query, because that query re-arms the timer on its way out anyway.
        """
        if not self._lock.acquire(blocking=False):
            return False
        try:
            closed = self._close()
        finally:
            self._lock.release()
        return closed

    def shutdown(self) -> None:
        """Close the process for good — what a stopping app calls."""
        self._cancel_timer()
        with self._lock:
            self._close()

    def _open(self, engine: Engine) -> MaiaAdapter:
        from backend.adapters.maia import HumanModelUnavailableError, MaiaAdapter

        spec = engines_service.spec_for(engine)
        if self._adapter is not None and self._spec != spec:
            # A different binary or different options is a different engine, and the warm
            # one is now the wrong answer to the question.
            self._close()
        if self._adapter is not None:
            return self._adapter
        try:
            adapter = MaiaAdapter(engine.path, options=engine.options or {})
        except HumanModelUnavailableError as exc:
            raise LiveMaiaUnavailableError(f"{engine.name!r} could not be started: {exc}") from exc
        self._adapter = adapter
        self._spec = spec
        logger.info("live Maia session opened on %s", engine.name)
        return adapter

    def _close(self) -> bool:
        adapter, self._adapter = self._adapter, None
        self._spec = None
        if adapter is None:
            return False
        try:
            adapter.close()
        except Exception:  # pragma: no cover - a dead process is already closed enough
            logger.debug("live Maia session did not close cleanly", exc_info=True)
        logger.info("live Maia session closed")
        return True

    def _arm_idle_timer(self) -> None:
        self._cancel_timer()
        timer = threading.Timer(self._idle_seconds, self.close_if_idle)
        timer.daemon = True
        self._timer = timer
        timer.start()

    def _cancel_timer(self) -> None:
        timer, self._timer = self._timer, None
        if timer is not None:
            timer.cancel()

    # --- what to start, and at what level ----------------------------------

    def _require_engine(self, session: Session) -> Engine:
        """The Maia on this host, or a named reason there is nothing to ask."""
        engine = engines_service.maia_engine_for_host(session, None)
        if engine is not None:
            return engine
        elsewhere = _any_maia(session)
        if elsewhere is not None:
            raise LiveMaiaUnavailableError(
                f"the model chosen for human moves, {elsewhere.name!r}, is on "
                f"{engines_service.engine_host(session, elsewhere)}, and a live query is "
                f"answered here; register a Maia on this host and choose it to use it on "
                f"the board"
            )
        raise LiveMaiaUnavailableError(
            "no human-move model is chosen, so there is nothing to ask what a human would "
            "play"
        )

    def _levels(
        self,
        session: Session,
        adapter: MaiaAdapter,
        *,
        elo: int | None = None,
        elos: Sequence[int] | None = None,
    ) -> list[int]:
        """The levels to *ask* for: what the caller asked for, else the configured ones.

        The configured levels are the deployment's own, so a board nobody has given a level
        speaks for the same humans the stored runs do; a caller that names some is exploring
        other ratings deliberately, and gets them.

        For a build that declares `SelfElo` these are the levels it is conditioned on. For a
        fixed-weights build they condition nothing — one of them survives as the key
        `policy_at` files the answer under, which is why what gets reported back is
        `_reported_level`, not these.

        Read out of the database on every query, the same way the engine to start is:
        changing them on the Settings page takes effect on the next thing the board asks,
        without restarting anything or dropping the warm process.
        """
        from backend.services.analysis import maia_bounds

        if elos:
            base = list(elos)
        elif elo is not None:
            base = [elo]
        else:
            base = app_settings_service.get_maia_elos(session)
        bounds = maia_bounds(adapter)
        low = int(bounds.get("low", MAIA_MIN_RATING))
        high = int(bounds.get("high", MAIA_MAX_RATING))
        # Cleaned first, so a caller cannot ask for fifty levels and hold the one warm
        # process for fifty policy queries; then pulled into what this build can answer.
        cleaned = app_settings_service.clean_maia_elos(base)
        return sorted({min(high, max(low, int(level))) for level in cleaned})


# --- module-level helpers --------------------------------------------------


def _reported_level(adapter: MaiaAdapter, engine: Engine, level: int) -> int | None:
    """The level to say was used — which is not always the level that was asked for.

    A build that declares `SelfElo` was conditioned on `level` and played as that human, so
    `level` is the honest answer. A fixed-weights build ignored the number entirely: it is
    one rating, the one baked into the weights it loaded, and echoing the request back
    would label the board "Maia 1700" over moves a 1500 model played. Its own level is only
    ever written down in whatever names those weights, so that is where it is read from;
    where nothing names them the answer carries no level at all and the panel drops the
    number from its header, which is the one reading that cannot be wrong.
    """
    if adapter.supports_rating:
        return level
    return fixed_weights_level(engine, adapter)


def fixed_weights_level(engine: Engine, adapter: MaiaAdapter) -> int | None:
    """The rating a one-rating Maia plays at, read off its weights file, else None.

    Truest source first: the command line loads a named weights file, an option may point
    at one, and the row's own name and the engine's UCI id are what an owner called it.
    """
    options = engine.options or {}
    for text in (
        engine.path or "",
        *(value for value in options.values() if isinstance(value, str)),
        engine.name or "",
        adapter.name or "",
    ):
        found = FIXED_LEVEL_PATTERN.search(text)
        if found is not None:
            return int(found.group(1))
    return None


def read_board(fen: str) -> chess.Board:
    """A caller's FEN as a board, through the one reader every surface shares."""
    from backend.services.explorer import read_fen

    text = (fen or "").strip()
    try:
        return read_fen(text)
    except ValueError as exc:
        raise LivePolicyRequestError(f"{text!r} is not a valid FEN: {exc}") from exc


def _policy_at(
    adapter: MaiaAdapter, board: chess.Board, level: int, multipv: int
) -> list[dict[str, Any]]:
    """One position at one level, in the shape `MoveEval.maia_policy` stores."""
    from backend.adapters.maia import HumanModelUnavailableError

    try:
        policy = adapter.policy_at(board, [level], multipv=multipv)
    except HumanModelUnavailableError as exc:
        raise LiveMaiaUnavailableError(f"the human-move model did not answer: {exc}") from exc
    return [move.as_dict() for move in policy.get(str(level), ())]


def _policy_moves() -> int:
    from backend.services.analysis import MAIA_POLICY_MOVES

    return MAIA_POLICY_MOVES


def _any_maia(session: Session) -> Engine | None:
    """The chosen human-move model wherever it lives — for the reason a refusal gives.

    The assignment rather than any Maia on the machine: an unchosen model is not what a
    board would have asked, so naming it would send the owner after the wrong engine.
    """
    return engines_service.engine_for_role(session, EngineRole.HUMAN)


# The process-wide session. One warm Maia per deployment, whichever board is asking.
_LIVE = LiveMaia()


def live_policy(
    session: Session,
    *,
    fen: str,
    elo: int | None = None,
    elos: Sequence[int] | None = None,
    moves: int | None = None,
    rollout_plies: int = 0,
) -> dict[str, Any]:
    """The endpoint's whole implementation, on the process-wide warm session."""
    return _LIVE.policy(
        session, fen=fen, elo=elo, elos=elos, moves=moves, rollout_plies=rollout_plies
    )


def shutdown() -> None:
    """Close the warm session. Called when the app stops; safe to call when there is none."""
    _LIVE.shutdown()
