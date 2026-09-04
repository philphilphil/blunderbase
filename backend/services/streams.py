"""Infinite analysis: the sessions, the rules, and where their snapshots go.

A *stream session* is "analyse this FEN with engine E at multipv N until I stop you". It is
the analysis board on the game page and on the live board, and it is deliberately built the
same way `live.py` is: **nothing here is written to the database.** A session is a slot on
an engine and a place to send pictures to; a restart or a lost runner costs the owner a
click, not a row.

The module owns the rules and none of the machinery. Two backends do the work behind one
interface — `workers/local_streams.py` for a binary on this host and
`workers/runner_streams.py` for one on a runner — and the broker cannot tell them apart,
which is the whole point: a stream on a remote engine looks exactly like a local one to the
browser.

What the broker keeps for itself, because both backends would otherwise answer it
differently:

- **`seq`.** Assigned here, per session, so local and remote snapshots number alike and a
  consumer can drop a frame that arrived out of order.
- **The cap and the surfaces.** At most `stream_max_sessions` at once, and one per surface —
  the game page's board, the live board and the companion app's: opening a second board on
  the same surface closes the first with `replaced` rather than quietly running two searches
  nobody is watching.
- **The idle reaper.** A slot held by a browser that has gone away is a slot the queue
  cannot have. `stream_idle_seconds` after the last `/events` listener disconnects, every
  session ends with `idle`.

Throttling is *not* here: it belongs to whichever host is producing the snapshots, which is
what keeps a remote runner from putting a flood on the wire for this process to thin out.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import secrets
import threading
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from typing import TYPE_CHECKING, Any, Protocol

from sqlalchemy.orm import Session, sessionmaker

from backend.config import Settings, get_settings
from backend.db.enums import EngineKind, Tier
from backend.db.session import get_sessionmaker
from backend.db.types import utcnow
from backend.services import engines as engines_service
from backend.services import events as events_service
from backend.services import live as live_service
from backend.services import runners as runners_service

if TYPE_CHECKING:  # pragma: no cover - typing only
    from backend.adapters.pool import EngineSpec

logger = logging.getLogger(__name__)

EVENT_STREAM_STARTED = "stream.started"
EVENT_STREAM_SNAPSHOT = "stream.snapshot"
EVENT_STREAM_ENDED = "stream.ended"

# The two backends, named the way `/analysis/queue` names its destinations.
LOCAL = "local"
REMOTE = "runner"

# One session per surface: the game page's analysis board, the live board, and the
# companion app's. The phone has its own rather than sharing `game`, so switching the
# engine on there does not take the browser's board away.
SURFACES = ("game", "live", "companion")
MAX_MULTIPV = 5

STATE_STARTING = "starting"
STATE_RUNNING = "running"
STATE_ENDED = "ended"

REASON_CLOSED = "closed"
REASON_REPLACED = "replaced"
REASON_IDLE = "idle"
REASON_ENGINE_FAILED = "engine_failed"
REASON_RUNNER_GONE = "runner_gone"

SESSION_PREFIX = "str_"
SESSION_BYTES = 4

# How often the reaper looks at who is listening. Well under the idle window, so a session
# is never held much past it.
REAP_INTERVAL_SECONDS = 1.0


class StreamError(RuntimeError):
    """Anything the analysis board reports instead of a stack trace."""


class StreamRequestError(StreamError, ValueError):
    """The request itself is wrong: not a position, a multipv nobody offers, a Maia."""


class UnknownStreamError(StreamError, LookupError):
    """No session with that id — it was closed, or it never existed."""


class StreamUnavailableError(StreamError):
    """There is no engine for this, or no slot to be had on the one there is."""


class StreamLimitError(StreamError):
    """Every session this deployment allows at once is already open."""


class StreamBackend(Protocol):
    """What a host has to be able to do to serve a session. Two implement it."""

    name: str

    async def open(self, session: StreamSession) -> None:
        """Start searching `session.fen` and begin emitting, or refuse.

        Must have taken a slot before returning, and raise `StreamUnavailableError` when it
        cannot. Snapshots reach the broker through `snapshot`, from any thread.
        """

    async def restart(self, session: StreamSession) -> None:
        """Stop and go again at the session's current fen and multipv, on the same slot.

        Never releases the slot: a position change must not lose the board's engine to
        queue work in the gap.
        """

    async def close(self, session: StreamSession, reason: str) -> None:
        """Stop the search and give the slot back. Closing a closed session is not an error."""


@dataclass(slots=True)
class StreamSession:
    """One analysis board: what it is showing, on which engine, and how it is doing."""

    id: str
    surface: str
    fen: str
    multipv: int
    engine_id: int
    engine: str
    runner_id: int | None = None
    runner: str | None = None
    destination: str = LOCAL
    state: str = STATE_STARTING
    reason: str | None = None
    error: str | None = None
    seq: int = 0
    created_at: datetime = field(default_factory=utcnow)
    last_snapshot_at: datetime | None = None
    last_listener_at: datetime = field(default_factory=utcnow)
    # Echoed back untouched: the page says which board this session belongs to and the
    # server has no opinion about it.
    game_id: int | None = None
    ply: int | None = None
    # Not part of the payload: what the local backend starts, worked out on the database
    # thread so no backend has to open a Session of its own.
    spec: EngineSpec | None = None

    def payload(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "surface": self.surface,
            "fen": self.fen,
            "multipv": self.multipv,
            "engine_id": self.engine_id,
            "engine": self.engine,
            "runner_id": self.runner_id,
            "runner": self.runner,
            "state": self.state,
            "reason": self.reason,
            "seq": self.seq,
            "created_at": self.created_at.isoformat(),
            "last_snapshot_at": (
                None if self.last_snapshot_at is None else self.last_snapshot_at.isoformat()
            ),
            "game_id": self.game_id,
            "ply": self.ply,
        }


@dataclass(frozen=True, slots=True)
class Destination:
    """Which engine on which host a session resolved to, read off the database once."""

    engine_id: int
    engine: str
    destination: str = LOCAL
    runner_id: int | None = None
    runner: str | None = None
    spec: EngineSpec | None = None


class StreamBroker:
    """Every open analysis board: the rules, the numbering and the fan-out."""

    def __init__(
        self,
        *,
        settings: Settings | None = None,
        sessions: sessionmaker[Session] | None = None,
        backends: Mapping[str, StreamBackend] | None = None,
        listeners: Callable[[], int] | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self._sessions = sessions
        self._backends: dict[str, StreamBackend] = dict(backends or {})
        # How many browsers are following `/events`. The `/events` sockets are counted by
        # `live.py` already, so the reaper asks it rather than the socket route growing a
        # second hook that means the same thing.
        self._listeners = listeners or live_service.viewer_count
        self._open: dict[str, StreamSession] = {}
        # One writer at a time for open/restart/close: two boards opening at once must not
        # both decide there is room for one more.
        self._lock = asyncio.Lock()
        # Snapshots arrive from engine threads and from the socket loop alike, so the
        # numbering has a plain lock rather than the asyncio one.
        self._seq_lock = threading.RLock()
        self._reaper: asyncio.Task[None] | None = None
        self._background: set[asyncio.Task[Any]] = set()
        self._stopping = asyncio.Event()
        self._unsubscribe: Callable[[], None] | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

    # --- lifecycle ----------------------------------------------------------

    @property
    def sessions(self) -> sessionmaker[Session]:
        if self._sessions is None:
            self._sessions = get_sessionmaker(self.settings)
        return self._sessions

    @property
    def running(self) -> bool:
        return self._reaper is not None

    async def start(self) -> None:
        """Begin reaping idle sessions and watching for runners going away."""
        if self._reaper is not None:
            return
        self._stopping.clear()
        self._loop = asyncio.get_running_loop()
        self._unsubscribe = events_service.subscribe(self._on_event)
        self._reaper = asyncio.create_task(self._reap_loop(), name="stream-reaper")

    async def stop(self) -> None:
        self._stopping.set()
        if self._unsubscribe is not None:
            self._unsubscribe()
            self._unsubscribe = None
        reaper, self._reaper = self._reaper, None
        pending = [*self._background]
        self._background.clear()
        for task in (*pending, *(() if reaper is None else (reaper,))):
            task.cancel()
            with contextlib.suppress(BaseException):
                await task
        for session_id in list(self._open):
            with contextlib.suppress(Exception):
                await self.close(session_id, reason=REASON_CLOSED)
        self._loop = None

    def register_backend(self, name: str, backend: StreamBackend) -> None:
        self._backends[name] = backend

    # --- what is open --------------------------------------------------------

    def get(self, session_id: str) -> StreamSession:
        session = self._open.get(session_id)
        if session is None:
            raise UnknownStreamError(f"no stream session {session_id!r}")
        return session

    def list(self) -> list[StreamSession]:
        return sorted(self._open.values(), key=lambda session: session.created_at)

    # --- opening, moving and closing -----------------------------------------

    async def open(
        self,
        *,
        fen: str,
        engine_id: int | None = None,
        multipv: int = 1,
        surface: str = "game",
        game_id: int | None = None,
        ply: int | None = None,
    ) -> StreamSession:
        """Start an analysis board. The engine defaults to the deep tier's."""
        position = _position(fen)
        multipv = _multipv(multipv)
        surface = _surface(surface)
        async with self._lock:
            target = await asyncio.to_thread(self._resolve, engine_id)
            # A second board on the same surface is the same board having moved on; the
            # first one is closed rather than left searching a position nobody is looking at.
            for other in [s for s in self._open.values() if s.surface == surface]:
                await self._finish(other, REASON_REPLACED)
            if len(self._open) >= self.settings.stream_max_sessions:
                raise StreamLimitError(
                    f"{self.settings.stream_max_sessions} analysis board(s) can be open at "
                    f"once; close one first"
                )
            session = StreamSession(
                id=_session_id(),
                surface=surface,
                fen=position,
                multipv=multipv,
                engine_id=target.engine_id,
                engine=target.engine,
                runner_id=target.runner_id,
                runner=target.runner,
                destination=target.destination,
                game_id=game_id,
                ply=ply,
                spec=target.spec,
            )
            self._open[session.id] = session
        # Outside the lock on purpose. A backend can wait seconds for a slot to come free,
        # and the `close` that would free one takes this same lock: held across the open,
        # the wait would be the only thing standing between the board and the slot it is
        # waiting for. The session is already counted, so the cap holds either way.
        try:
            await self._backend(session).open(session)
        except StreamError:
            self._forget(session)
            raise
        except Exception as exc:
            self._forget(session)
            raise StreamUnavailableError(
                f"{session.engine!r} could not start an analysis: {_message(exc)}"
            ) from exc
        if self._open.get(session.id) is not session:
            # Closed or replaced while it was starting. Whoever did that has already
            # stopped the backend, so there is nothing here but a board to be honest with.
            raise StreamUnavailableError(
                f"the analysis board was closed while {session.engine!r} was starting"
            )
        events_service.emit(
            {
                "event": EVENT_STREAM_STARTED,
                "session_id": session.id,
                "surface": session.surface,
                "engine_id": session.engine_id,
                "engine": session.engine,
                "runner_id": session.runner_id,
                "runner": session.runner,
                "fen": session.fen,
                "multipv": session.multipv,
                "at": utcnow().isoformat(),
            }
        )
        logger.info(
            "stream %s opened on %r at multipv %s (%s)",
            session.id,
            session.engine,
            session.multipv,
            session.runner or LOCAL,
        )
        return session

    async def restart(
        self, session_id: str, *, fen: str | None = None, multipv: int | None = None
    ) -> StreamSession:
        """Move the board. Stop and go on the same slot, never a teardown."""
        async with self._lock:
            session = self.get(session_id)
            if session.state == STATE_ENDED:
                raise StreamUnavailableError(f"stream session {session_id!r} has ended")
            if fen is not None:
                session.fen = _position(fen)
            if multipv is not None:
                session.multipv = _multipv(multipv)
            session.state = STATE_STARTING
            session.error = None
            await self._backend(session).restart(session)
            return session

    async def close(self, session_id: str, *, reason: str = REASON_CLOSED) -> None:
        """Stop a board and free its slot. Closing one that has ended is not an error."""
        async with self._lock:
            session = self._open.get(session_id)
            if session is None:
                return
            await self._finish(session, reason)

    async def backend_ended(
        self, session_id: str, reason: str = REASON_ENGINE_FAILED, error: str | None = None
    ) -> None:
        """The far side says this session is over: the engine died, or the runner did.

        Separate from `close` because the backend has already stopped: there is nothing to
        ask it to stop, only a slot to release and a browser to tell.
        """
        async with self._lock:
            session = self._open.get(session_id)
            if session is None:
                return
            await self._finish(session, reason, error)

    async def runner_gone(self, runner_id: int, *, reason: str = REASON_RUNNER_GONE) -> None:
        """A runner has dropped. Everything it was searching ends, and says why."""
        async with self._lock:
            for session in [s for s in self._open.values() if s.runner_id == runner_id]:
                await self._finish(session, reason)

    def _forget(self, session: StreamSession) -> None:
        """Take a session off the books, but only if it is still the one on them."""
        if self._open.get(session.id) is session:
            del self._open[session.id]

    async def _finish(
        self, session: StreamSession, reason: str, error: str | None = None
    ) -> None:
        """End one session. Called under `_lock`; the event goes out after the backend has
        actually stopped, so nothing can arrive behind `stream.ended`."""
        self._open.pop(session.id, None)
        session.state = STATE_ENDED
        session.reason = reason
        session.error = error
        try:
            await self._backend(session).close(session, reason)
        except Exception:
            logger.exception("stream %s could not be closed cleanly", session.id)
        events_service.emit(
            {
                "event": EVENT_STREAM_ENDED,
                "session_id": session.id,
                "reason": reason,
                "error": error,
                "engine_id": session.engine_id,
                "runner_id": session.runner_id,
                "at": utcnow().isoformat(),
            }
        )
        logger.info("stream %s ended: %s", session.id, reason)

    # --- snapshots ------------------------------------------------------------

    def snapshot(self, session_id: str, frame: Mapping[str, Any]) -> None:
        """One picture of a running search. Safe to call from any thread.

        The sequence number is assigned here rather than by the producer, so a local
        session and a remote one number the same way and `/events` — which is lossy on
        purpose — can be read the same way for both.
        """
        with self._seq_lock:
            session = self._open.get(session_id)
            if session is None or session.state == STATE_ENDED:
                return
            session.seq += 1
            session.state = STATE_RUNNING
            session.last_snapshot_at = utcnow()
            event = {
                "event": EVENT_STREAM_SNAPSHOT,
                "session_id": session.id,
                "seq": session.seq,
                "engine_id": session.engine_id,
                "engine": session.engine,
                "runner_id": session.runner_id,
                "fen": session.fen,
                "multipv": session.multipv,
                "depth": frame.get("depth"),
                "nodes": frame.get("nodes"),
                "nps": frame.get("nps"),
                "time_ms": frame.get("time_ms"),
                "lines": [dict(entry) for entry in frame.get("lines") or ()],
                "at": session.last_snapshot_at.isoformat(),
            }
        events_service.emit(event)

    def mark_running(self, session_id: str) -> None:
        """The far side has the search going. Called before its first snapshot arrives."""
        with self._seq_lock:
            session = self._open.get(session_id)
            if session is not None and session.state == STATE_STARTING:
                session.state = STATE_RUNNING

    # --- who is watching --------------------------------------------------------

    def touch_listeners(self, count: int) -> None:
        """Say how many browsers are following `/events`. Any at all resets the idle clock."""
        if count <= 0:
            return
        now = utcnow()
        with self._seq_lock:
            for session in self._open.values():
                session.last_listener_at = now

    async def reap_idle(self) -> list[str]:
        """Close the sessions nobody has been listening to. The ids that were closed."""
        self.touch_listeners(self._listeners())
        cutoff = self.settings.stream_idle_seconds
        now = utcnow()
        stale = [
            session
            for session in list(self._open.values())
            if (now - session.last_listener_at).total_seconds() >= cutoff
        ]
        for session in stale:
            await self.close(session.id, reason=REASON_IDLE)
        return [session.id for session in stale]

    async def _reap_loop(self) -> None:
        while not self._stopping.is_set():
            await asyncio.sleep(REAP_INTERVAL_SECONDS)
            if self._stopping.is_set():
                return
            try:
                await self.reap_idle()
            except Exception:
                logger.exception("the idle-stream reaper failed")

    # --- reacting to the rest of the app -------------------------------------------

    def _on_event(self, event: Mapping[str, Any]) -> None:
        """A runner going away takes its analysis boards with it.

        A subscriber must never be able to fail what published, so this does nothing but
        post the work onto the loop that owns the sessions.
        """
        if event.get("event") != runners_service.EVENT_RUNNER_DISCONNECTED:
            return
        runner_id = event.get("runner_id")
        loop = self._loop
        if loop is None or runner_id is None:
            return
        with contextlib.suppress(RuntimeError):
            loop.call_soon_threadsafe(self._spawn, self.runner_gone(int(runner_id)))

    def _spawn(self, coroutine: Any) -> asyncio.Task[Any]:
        """Run something on its own task, held so nothing collects it mid-flight."""
        task = asyncio.ensure_future(coroutine)
        self._background.add(task)
        task.add_done_callback(self._background.discard)
        return task

    # --- the database side (always on a thread) ------------------------------------

    def _backend(self, session: StreamSession) -> StreamBackend:
        backend = self._backends.get(session.destination)
        if backend is None:
            raise StreamUnavailableError(
                f"nothing in this process serves a {session.destination} analysis board"
            )
        return backend

    def _resolve(self, engine_id: int | None) -> Destination:
        """Which engine, on which host — and whether it can actually be asked right now."""
        with self.sessions() as session:
            if engine_id is None:
                engine = engines_service.engine_for_tier(session, Tier.DEEP)
                if engine is None:
                    status = engines_service.tier_status(session, Tier.DEEP)
                    raise StreamUnavailableError(
                        status.reason or "no engine is available for an analysis board"
                    )
            else:
                engine = engines_service.require_engine(session, engine_id)
            if engine.kind is EngineKind.MAIA:
                raise StreamRequestError(
                    f"{engine.name!r} is a human-move model, which answers with a policy "
                    f"rather than a search; an analysis board needs a UCI engine"
                )
            if not engine.enabled:
                raise StreamUnavailableError(f"{engine.name!r} is switched off")
            if not engine.streams:
                # Its host's own word, from the advertisement. The picker already hides one
                # of these, but a coach or a script asking by id must get a sentence rather
                # than a session that waits forever for a `stream_started`.
                raise StreamUnavailableError(
                    f"{engine.name!r} is on a host that takes queue work but drives no "
                    f"analysis board"
                )
            if engine.runner_id is None:
                return Destination(
                    engine_id=engine.id,
                    engine=engine.name,
                    destination=LOCAL,
                    spec=engines_service.spec_for(engine),
                )
            runner = runners_service.get_runner(session, engine.runner_id)
            if runner is None or not runner.connected:
                where = "its runner" if runner is None else repr(runner.name)
                raise StreamUnavailableError(
                    f"{engine.name!r} runs on {where}, which is not connected"
                )
            return Destination(
                engine_id=engine.id,
                engine=engine.name,
                destination=REMOTE,
                runner_id=runner.id,
                runner=runner.name,
            )


# --- reading a request ---------------------------------------------------------


def _position(fen: str) -> str:
    """A caller's FEN as the board really is — the same spellings every surface takes."""
    from backend.services.explorer import read_fen

    text = (fen or "").strip()
    if not text:
        raise StreamRequestError("an analysis board needs a FEN")
    try:
        return read_fen(text).fen()
    except ValueError as exc:
        raise StreamRequestError(str(exc)) from None


def _multipv(value: int) -> int:
    number = int(value)
    if number < 1 or number > MAX_MULTIPV:
        raise StreamRequestError(f"multipv is 1 to {MAX_MULTIPV}, not {value}")
    return number


def _surface(value: str) -> str:
    name = str(value or "").strip().casefold()
    if name not in SURFACES:
        raise StreamRequestError(f"unknown surface {value!r}; it is one of {', '.join(SURFACES)}")
    return name


def _session_id() -> str:
    return f"{SESSION_PREFIX}{secrets.token_hex(SESSION_BYTES)}"


def _message(exc: BaseException) -> str:
    text = str(exc).strip()
    return f"{type(exc).__name__}: {text}" if text else type(exc).__name__
