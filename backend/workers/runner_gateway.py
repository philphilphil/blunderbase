"""The runner gateway: who is dialled in, what they hold, and what to hand them next.

This is the remote half of the analysis queue. `workers/analysis_queue.py` drains the runs
whose engine is a binary on this host; the gateway drains the runs whose engine lives on a
machine that dialled in. Both take their work through the same `claim_next_run`, so there
is one queue, one claim and one set of rules — only two kinds of worker reading them.

Three things shape the module:

- **It knows nothing about HTTP.** A connection reaches it as a `RunnerLink`: something
  that can be sent a frame and closed. `WebsocketLink` wraps a live socket and `PollLink`
  buffers frames for the next `POST /runner/poll`, which is the whole of the difference
  between the two transports. `api/routes/runner_gateway.py` is then a decode-and-delegate
  loop with no scheduling in it.
- **Every database call goes out to a thread.** A `Session` belongs to one thread and must
  not be held across an `await`, so each `_`-prefixed helper here is a synchronous unit of
  work handed to `asyncio.to_thread` whole.
- **A result is only ever accepted under its attempt token.** The dispatcher hands one out
  with every run; a runner that reconnected twice and finally answers for a run the stale
  sweep took away is told `run_ack{accepted: false}` and the payload is dropped. That is
  what makes a remote completion idempotent rather than merely unlikely to collide.

Dispatch is event-driven: `analysis.queued` wakes the pump, and so does a completion, an
attach and a new advertisement. The periodic sweep is the safety net rather than the
engine — it is here rather than only at worker startup because the gateway is what creates
orphans (a socket that dropped mid-run) that no local process would ever notice.
"""

from __future__ import annotations

import asyncio
import contextlib
import hmac
import logging
import time
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Protocol

from sqlalchemy.orm import Session, sessionmaker

from backend import __version__
from backend.config import Settings, get_settings
from backend.db.enums import EngineKind, RunStatus
from backend.db.models import Engine, Runner
from backend.db.session import get_sessionmaker
from backend.db.types import utcnow
from backend.runners import protocol
from backend.services import analysis
from backend.services import engines as engines_service
from backend.services import events as events_service
from backend.services import runners as runners_service

if TYPE_CHECKING:  # pragma: no cover - typing only
    from starlette.websockets import WebSocket

    from backend.services.analysis import RunPlan

logger = logging.getLogger(__name__)

# Pings without an answer before the link is treated as dead.
MISSED_PINGS = 3
# The same judgement for a poller, which has no ping to answer: what it owes is another
# poll, and this many missed ones is a machine that has gone.
MISSED_POLLS = 3
# What a link dropped for going quiet is closed with. Deliberately an ordinary "going
# away" and not one of the protocol's 4000-range codes: a runner whose socket stopped
# answering has done nothing wrong and should dial straight back in, and the 4000s are the
# ones it treats as final.
WS_CLOSE_GOING_AWAY = 1001
# The shortest gap between two dispatch rounds. A round that has to hand a run back wakes
# the pump again through `analysis.queued`, and this is what keeps that from being a spin.
PUMP_FLOOR_SECONDS = 0.2

WEBSOCKET = "websocket"
POLL = "poll"

# Why a run was taken off the runner holding it.
CANCEL_STOLEN = "stolen"
CANCEL_REQUEUED = "requeued"
CANCEL_PREEMPTED = "preempted"
CANCEL_REVOKED = "revoked"

# Why a link ended, as `runner.disconnected` reports it.
REASON_CLOSED = "socket_closed"
REASON_TIMEOUT = "timeout"
REASON_REPLACED = "replaced"
REASON_REVOKED = "revoked"
REASON_SHUTDOWN = "shutdown"

# A handler registered from outside — the stream backends' seam. Called after whatever
# built-in handler the type has, and never instead of it.
Handler = Callable[[int, Mapping[str, Any]], Awaitable[None]]


class GatewayError(RuntimeError):
    """Something the gateway refuses, phrased for the runner that caused it."""


class ProtoMismatchError(GatewayError):
    """The runner speaks a protocol version this server does not."""

    def __init__(self, presented: Any) -> None:
        super().__init__(
            f"this server speaks runner protocol {protocol.PROTO_VERSION}, not {presented!r}"
        )
        self.presented = presented


# --- links -----------------------------------------------------------------


class RunnerLink(Protocol):
    """One connection to a runner, whichever direction the frames actually travel in."""

    runner_id: int
    name: str
    transport: str

    async def send(self, frame: Mapping[str, Any]) -> None: ...

    async def close(self, code: int, reason: str) -> None: ...


class WebsocketLink:
    """A live socket. Frames are pushed the moment there is one to push."""

    transport = WEBSOCKET

    def __init__(self, websocket: WebSocket, runner_id: int, name: str) -> None:
        self.websocket = websocket
        self.runner_id = runner_id
        self.name = name
        self.closed = False

    async def send(self, frame: Mapping[str, Any]) -> None:
        if self.closed:
            raise ConnectionError(f"the link to {self.name!r} is closed")
        await self.websocket.send_text(protocol.encode(frame))

    async def close(self, code: int, reason: str) -> None:
        self.closed = True
        with contextlib.suppress(Exception):
            await self.websocket.close(code=code, reason=reason)


class PollLink:
    """A runner that comes back for its frames rather than being pushed them.

    Everything the gateway would have sent is buffered until the next poll answers with
    it, which is why the poll fallback needs no second dispatcher: the same `pump` writes
    the same `run_dispatch` frames into a list instead of onto a socket.
    """

    transport = POLL

    def __init__(self, runner_id: int, name: str) -> None:
        self.runner_id = runner_id
        self.name = name
        self.pending: list[dict[str, Any]] = []

    async def send(self, frame: Mapping[str, Any]) -> None:
        self.pending.append(dict(frame))

    async def close(self, code: int, reason: str) -> None:
        self.pending.clear()

    def drain(self) -> list[dict[str, Any]]:
        """Everything buffered since the last poll, and an empty buffer behind it."""
        frames, self.pending = self.pending, []
        return frames


# --- what a connection holds ------------------------------------------------


@dataclass(slots=True)
class RemoteRun:
    """One run a runner is executing for us, and the token that says it is still theirs."""

    run_id: int
    attempt_token: str
    # Kept so a remote run's `analysis.progress` event is the very same shape a local
    # one's is. A UI cannot tell where a run executed, and does not need to.
    plan: RunPlan | None = None
    started: float = 0.0


@dataclass(frozen=True, slots=True)
class Dispatch:
    """A claimed run, read off the database once, ready to be handed over."""

    run_id: int
    attempt_token: str
    engine: str
    maia_engine: str | None
    plan: RunPlan

    def frame(self) -> dict[str, Any]:
        return protocol.run_dispatch(
            run_id=self.run_id,
            attempt_token=self.attempt_token,
            engine=self.engine,
            maia_engine=self.maia_engine,
            plan=protocol.encode_plan(self.plan),
        )


@dataclass(frozen=True, slots=True)
class Registration:
    """What the database said when a link announced itself."""

    name: str
    slots: int
    engines: tuple[dict[str, Any], ...]
    engine_ids: tuple[int, ...]


@dataclass(slots=True)
class RunnerState:
    """One attached runner: its link, its engines, and what is on its slots right now."""

    runner_id: int
    name: str
    slots: int
    version: str | None
    link: RunnerLink
    engine_ids: tuple[int, ...] = ()
    # The accepted-engine entries exactly as the runner was told them, so a poll can
    # answer with the same list it was given at its first one.
    engines: tuple[dict[str, Any], ...] = ()
    # What the machine itself said it can hold. Kept because the cap is the lower of the
    # two, and the owner may raise the row's number while this link is up.
    reported_slots: int | None = None
    runs: dict[int, RemoteRun] = field(default_factory=dict)
    streams: set[str] = field(default_factory=set)
    # A link is given work only once its welcome has actually gone out.
    ready: bool = False
    missed_pings: int = 0
    # When this link last said anything. A websocket says it with a pong; a poller says it
    # by coming back, and that is the only thing there is to time it out on.
    last_seen: float = field(default_factory=time.monotonic)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    @property
    def transport(self) -> str:
        return self.link.transport

    def retune(self, name: str, cap: int) -> None:
        """The owner renamed or resized the row. The claim the runner made still counts.

        `attach` holds a link to the lower of the two numbers; a cap raised past what the
        machine says it can do must not be honoured just because it was raised later.
        """
        self.name = name
        self.slots = cap if self.reported_slots is None else max(0, min(cap, self.reported_slots))

    @property
    def busy(self) -> int:
        return len(self.runs)

    @property
    def free_slots(self) -> int:
        return max(0, self.slots - len(self.runs) - len(self.streams))

    def live(self) -> dict[str, Any]:
        """The half of a runner's status only the gateway knows."""
        return {
            "runner_id": self.runner_id,
            "name": self.name,
            "connected": True,
            "transport": self.transport,
            "slots": self.slots,
            "version": self.version,
            "busy": self.busy,
            "streams": len(self.streams),
            "free_slots": self.free_slots,
        }


# --- the gateway -------------------------------------------------------------


class RunnerGateway:
    """Every attached runner, the work they are given and the results they hand back."""

    def __init__(
        self,
        *,
        settings: Settings | None = None,
        sessions: sessionmaker[Session] | None = None,
        sweep_seconds: float | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.sweep_seconds = float(
            sweep_seconds
            if sweep_seconds is not None
            else self.settings.runner_stale_sweep_seconds
        )
        self._sessions = sessions
        self._states: dict[int, RunnerState] = {}
        self._handlers: dict[str, list[Handler]] = {}
        self._tasks: list[asyncio.Task[None]] = []
        self._background: set[asyncio.Task[None]] = set()
        self._wake = asyncio.Event()
        self._stopping = asyncio.Event()
        self._unsubscribe: Callable[[], None] | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

    # --- lifecycle --------------------------------------------------------

    @property
    def running(self) -> bool:
        return bool(self._tasks)

    @property
    def sessions(self) -> sessionmaker[Session]:
        if self._sessions is None:
            self._sessions = get_sessionmaker(self.settings)
        return self._sessions

    async def start(self) -> None:
        """Begin dispatching, sweeping and pinging. Called from the app's lifespan."""
        if self._tasks:
            return
        self._stopping.clear()
        self._loop = asyncio.get_running_loop()
        self._unsubscribe = analysis.subscribe(self._on_run_event)
        self._tasks = [
            asyncio.create_task(self._pump_loop(), name="runner-dispatch"),
            asyncio.create_task(self._sweep_loop(), name="runner-sweep"),
            asyncio.create_task(self._beat_loop(), name="runner-heartbeat"),
        ]

    async def stop(self) -> None:
        """Stop the loops and hand every run in flight back to the queue."""
        self._stopping.set()
        self._wake.set()
        if self._unsubscribe is not None:
            self._unsubscribe()
            self._unsubscribe = None
        running = [*self._tasks, *self._background]
        self._tasks = []
        self._background.clear()
        for task in running:
            task.cancel()
        for task in running:
            with contextlib.suppress(BaseException):
                await task
        # After the loops, so nothing claims a run while the runs are being handed back.
        for runner_id in list(self._states):
            await self.detach(runner_id, reason=REASON_SHUTDOWN)
        self._loop = None

    def notify(self) -> None:
        """Something was enqueued. Safe to call from any thread, including none."""
        loop = self._loop
        if loop is None:
            return
        with contextlib.suppress(RuntimeError):
            loop.call_soon_threadsafe(self._wake.set)

    def _on_run_event(self, event: Mapping[str, Any]) -> None:
        """A subscriber must never be able to fail a run, so this does almost nothing."""
        if event.get("event") == analysis.EVENT_RUN_QUEUED:
            self.notify()

    # --- connections ------------------------------------------------------

    def state(self, runner_id: int) -> RunnerState | None:
        return self._states.get(runner_id)

    def status(self) -> list[dict[str, Any]]:
        """The live picture of every attached runner, for `/runners` to merge with the rows."""
        return [state.live() for state in self._states.values()]

    def live(self, runner_id: int) -> dict[str, Any] | None:
        state = self._states.get(runner_id)
        return None if state is None else state.live()

    async def attach(
        self, runner: Runner, link: RunnerLink, hello: Mapping[str, Any]
    ) -> dict[str, Any]:
        """Take a runner's announcement, answer it, and hand the answer back to the caller.

        The welcome is sent from here rather than by the route, so that it is the first
        frame this link ever carries by construction: `ready` is set on the far side of
        that send, and until it is, no dispatch can be claimed for the link at all.
        """
        presented = hello.get("proto")
        if presented != protocol.PROTO_VERSION:
            raise ProtoMismatchError(presented)
        # Decoded before the old link is touched: a re-hello nobody can read must not be
        # what takes a working connection down.
        ads = None if hello.get("engines") is None else protocol.decode_ads(hello["engines"])
        reported = _active_runs(hello.get("active_runs") or ())

        inherited: dict[int, RemoteRun] = {}
        previous = self._states.pop(runner.id, None)
        if previous is not None:
            # D8: the newer link is the live one. A reconnect behind a half-open socket is
            # the common case, so the old one is closed rather than the new one refused —
            # and its runs are not handed back yet, because this hello is about to say
            # which of them the machine is still executing.
            inherited = dict(previous.runs)
            await previous.link.close(
                protocol.WS_CLOSE_DUPLICATE, protocol.ERROR_DUPLICATE_CONNECTION
            )
            self._emit_disconnected(previous, REASON_REPLACED)

        registration = await asyncio.to_thread(
            self._register, runner.id, ads, hello.get("slots"), hello.get("version"),
            link.transport,
        )
        resumed, cancelled = await asyncio.to_thread(
            self._reconcile, reported, inherited
        )
        link.runner_id = runner.id
        link.name = registration.name
        state = RunnerState(
            runner_id=runner.id,
            name=registration.name,
            slots=registration.slots,
            version=None if hello.get("version") is None else str(hello["version"]),
            link=link,
            engine_ids=registration.engine_ids,
            engines=registration.engines,
            reported_slots=None if hello.get("slots") is None else int(hello["slots"]),
            runs=resumed,
        )
        self._states[runner.id] = state
        logger.info(
            "runner %r attached over %s with %s slot(s) and %s engine(s)",
            state.name,
            state.transport,
            state.slots,
            len(state.engine_ids),
        )
        welcome = protocol.welcome(
            runner_id=runner.id,
            runner=state.name,
            server_version=__version__,
            slots=state.slots,
            heartbeat_seconds=self.settings.runner_heartbeat_seconds,
            engines=list(state.engines),
            cancelled_runs=cancelled,
        )
        try:
            await link.send(welcome)
        except Exception:
            await self.detach(runner.id, link=link)
            raise
        state.ready = True
        return welcome

    async def detach(
        self,
        runner_id: int,
        *,
        reason: str = REASON_CLOSED,
        link: RunnerLink | None = None,
        close_code: int | None = None,
    ) -> None:
        """Drop a link, give its runs back, and say the runner is gone.

        `link` is what the socket's own `finally` passes: a newer connection having taken
        the runner over is not this one's disconnection to announce.

        Handing the runs back and recording the disconnection are one unit of work on a
        task of its own, **shielded**. This normally runs in the `finally` of a task the
        server is cancelling, and an `await` there is not guaranteed a turn at all: awaited
        directly, the handback simply would not happen, and the runs would sit `running`
        with the row still claiming the runner is connected. Shielded, this coroutine may
        be cancelled and the work still finishes.
        """
        state = self._states.get(runner_id)
        if state is None or (link is not None and state.link is not link):
            return
        self._states.pop(runner_id, None)
        if close_code is not None:
            await state.link.close(close_code, reason)
        held = {run.run_id: run.attempt_token for run in state.runs.values()}
        # Immediately rather than at the 60s sweep: the gateway knows this runner is gone,
        # and a backlog does not need to wait a minute to find out.
        release = self._spawn(asyncio.to_thread(self._release_link, runner_id, reason, held))
        logger.info("runner %r detached: %s", state.name, reason)
        await asyncio.shield(release)

    # --- messages ---------------------------------------------------------

    def register_handler(self, message_type: str, handler: Handler) -> Callable[[], None]:
        """Also call `handler` for this message type. Returns the callable that removes it.

        The seam the stream backends plug into: `stream_snapshot` and `stream_closed` are
        theirs to interpret, and the gateway stays the thing that owns the connection.
        """
        self._handlers.setdefault(message_type, []).append(handler)

        def cancel() -> None:
            handlers = self._handlers.get(message_type) or []
            if handler in handlers:
                handlers.remove(handler)

        return cancel

    async def send(self, runner_id: int, frame: Mapping[str, Any]) -> bool:
        """One frame to one runner. False means the link would not take it."""
        state = self._states.get(runner_id)
        return False if state is None else await self._send(state, frame)

    async def _send(self, state: RunnerState, frame: Mapping[str, Any]) -> bool:
        """One frame down *this* link, whether or not it is still the runner's current one.

        What `pump` uses: a claim that landed across a reconnect must go to the link it was
        claimed for, so that a link that has gone refuses it and the run goes back to the
        queue — rather than being handed to a new link whose slot accounting knows nothing
        about it.
        """
        try:
            await state.link.send(frame)
        except Exception:
            logger.info("runner %r did not take a %s", state.name, frame.get("type"))
            return False
        return True

    async def handle(self, runner_id: int, frame: Mapping[str, Any]) -> None:
        """One decoded frame from a runner. Nothing raised here reaches the socket loop."""
        try:
            kind = protocol.message_type(frame)
        except protocol.ProtocolError as exc:
            await self._refuse(runner_id, protocol.ERROR_BAD_PAYLOAD, str(exc))
            return
        builtin = _BUILTIN.get(kind)
        extra = self._handlers.get(kind) or []
        if builtin is None and not extra:
            await self._refuse(
                runner_id, protocol.ERROR_UNKNOWN_MESSAGE, f"{kind!r} is not a message I know"
            )
            return
        try:
            checked = protocol.validate(frame)
        except protocol.ProtocolError as exc:
            await self._refuse(runner_id, protocol.ERROR_BAD_PAYLOAD, str(exc))
            return
        if builtin is not None:
            try:
                await builtin(self, runner_id, checked)
            except Exception:
                logger.exception("runner %s: a %s could not be handled", runner_id, kind)
        for handler in list(extra):
            try:
                await handler(runner_id, checked)
            except Exception:
                logger.exception("runner %s: a registered %s handler failed", runner_id, kind)

    async def _refuse(self, runner_id: int, code: str, message: str) -> None:
        logger.info("runner %s sent something unusable (%s): %s", runner_id, code, message)
        await self.send(runner_id, protocol.error(code, message))

    # --- the built-in handlers --------------------------------------------

    async def _on_ping(self, runner_id: int, frame: Mapping[str, Any]) -> None:
        await self.send(runner_id, protocol.pong(_stamp(frame.get("t"))))

    async def _on_pong(self, runner_id: int, _frame: Mapping[str, Any]) -> None:
        state = self._states.get(runner_id)
        if state is None:
            return
        state.missed_pings = 0
        state.last_seen = time.monotonic()
        await asyncio.to_thread(self._touch, runner_id)

    async def _on_advertise(self, runner_id: int, frame: Mapping[str, Any]) -> None:
        state = self._states.get(runner_id)
        if state is None:
            return
        ads = protocol.decode_ads(frame["engines"])
        registration = await asyncio.to_thread(
            self._register_engines, runner_id, ads, state.transport
        )
        state.engines = registration.engines
        state.engine_ids = registration.engine_ids
        await self.send(runner_id, protocol.engines_accepted(list(state.engines)))
        self._announce(state)
        await self.pump(runner_id)

    async def _on_run_progress(self, runner_id: int, frame: Mapping[str, Any]) -> None:
        run_id = int(frame["run_id"])
        token = str(frame["attempt_token"])
        alive = await asyncio.to_thread(self._heartbeat, run_id, token)
        if not alive:
            # The sweep, or a revoke, took it away while the runner was searching. Telling
            # it now is the difference between one wasted position and one wasted pass.
            await self._release(self._states.get(runner_id), run_id, CANCEL_STOLEN, token)
            return
        self._progressed(
            runner_id, run_id, int(frame.get("done") or 0), int(frame.get("total") or 0)
        )

    async def _on_run_complete(self, runner_id: int, frame: Mapping[str, Any]) -> None:
        run_id = int(frame["run_id"])
        token = str(frame["attempt_token"])
        try:
            evals = protocol.decode_evals(frame["evals"])
        except protocol.ProtocolError as exc:
            await self._refuse(runner_id, protocol.ERROR_BAD_PAYLOAD, str(exc))
            return
        accepted, reason = await asyncio.to_thread(
            self._complete, run_id, token, evals, frame.get("note")
        )
        self._forget(runner_id, run_id, token)
        await self.send(
            runner_id, protocol.run_ack(run_id=run_id, accepted=accepted, reason=reason)
        )
        await self.pump(runner_id)

    async def _on_run_failed(self, runner_id: int, frame: Mapping[str, Any]) -> None:
        run_id = int(frame["run_id"])
        token = str(frame["attempt_token"])
        accepted, reason = await asyncio.to_thread(
            self._fail,
            run_id,
            token,
            str(frame["error"]),
            frame.get("stderr"),
            bool(frame.get("retry", True)),
        )
        self._forget(runner_id, run_id, token)
        await self.send(
            runner_id, protocol.run_ack(run_id=run_id, accepted=accepted, reason=reason)
        )
        await self.pump(runner_id)

    async def _on_run_cancelled(self, runner_id: int, _frame: Mapping[str, Any]) -> None:
        """A runner confirming it stopped. The slot was freed when the cancel went out.

        Nothing is forgotten here, and deliberately: the confirmation names a run and not
        an attempt, and by the time it arrives the run may have been claimed again — by
        this same runner, whose engine may be the only one that can serve it. Every path
        that sends a `run_cancel` takes the run off the slot first, so there is never
        anything left for this to free and always the risk of freeing the wrong thing.
        What is worth doing is looking for something to put on the slot that was freed.
        """
        await self.pump(runner_id)

    # --- dispatch ---------------------------------------------------------

    async def pump(
        self, runner_id: int, *, limit: int | None = None, polling: bool = False
    ) -> int:
        """Claim and hand over runs until the slots or the queue run out. How many went.

        A polling link is given work **only** in the answer to a poll, which is what
        `polling` says. Claiming into its buffer at any other moment would leave runs
        marked `running` that the runner has not been told about yet — and the very next
        poll, which cannot name what it has not been given, would hand them back.
        """
        state = self._states.get(runner_id)
        if state is None or not state.ready:
            return 0
        if state.transport == POLL and not polling:
            return 0
        dispatched = 0
        async with state.lock:
            while not self._stopping.is_set():
                room = state.free_slots
                if limit is not None:
                    room = min(room, limit - dispatched)
                if room <= 0:
                    break
                try:
                    claim = await asyncio.to_thread(self._claim, runner_id)
                except Exception:
                    logger.exception("the gateway could not claim a run for %r", state.name)
                    claim = None
                if claim is None:
                    break
                if state.free_slots <= 0 or self._states.get(runner_id) is not state:
                    # A stream took the slot while the claim was on its way back from the
                    # database, or the runner reconnected and this link is not the one any
                    # more. Streams have priority over queue work and a new link knows
                    # nothing of this claim, so either way the run goes back rather than
                    # the board waiting — its attempt refunded, because nobody ever
                    # started searching it.
                    await asyncio.to_thread(
                        self._abandon_held, {claim.run_id: claim.attempt_token}
                    )
                    break
                state.runs[claim.run_id] = RemoteRun(
                    run_id=claim.run_id,
                    attempt_token=claim.attempt_token,
                    plan=claim.plan,
                    started=time.monotonic(),
                )
                if not await self._send(state, claim.frame()):
                    # The link went while the claim was in flight, so nobody is searching:
                    # straight back to the queue rather than out to the stale sweep.
                    state.runs.pop(claim.run_id, None)
                    await asyncio.to_thread(self._abandon_held, {claim.run_id: claim.attempt_token})
                    break
                dispatched += 1
        if dispatched:
            self._announce(state)
        return dispatched

    async def _pump_all(self) -> int:
        total = 0
        for runner_id in list(self._states):
            total += await self.pump(runner_id)
        return total

    async def _pump_loop(self) -> None:
        while not self._stopping.is_set():
            await self._wake.wait()
            if self._stopping.is_set():
                return
            self._wake.clear()
            try:
                await self._pump_all()
            except Exception:
                logger.exception("a dispatch round failed")
            await asyncio.sleep(PUMP_FLOOR_SECONDS)

    async def _sweep_loop(self) -> None:
        while not self._stopping.is_set():
            await asyncio.sleep(self.sweep_seconds)
            if self._stopping.is_set():
                return
            try:
                await self.sweep()
            except Exception:
                logger.exception("the stale-run sweep failed")

    async def sweep(self) -> list[int]:
        """Collect what a vanished runner left `running`, then look for work to give out."""
        # Read before the sweep rather than after it: requeueing emits `analysis.queued`,
        # which wakes the pump, which can have handed the very same run back out under a
        # new attempt by the time the loop below runs. What that loop has to cancel is the
        # attempt the sweep collected, and this is the only moment it can be named.
        held = {
            run.run_id: (state, run.attempt_token)
            for state in list(self._states.values())
            for run in state.runs.values()
        }
        stale = await asyncio.to_thread(self._requeue_stale)
        for run_id in stale:
            collected = held.get(run_id)
            if collected is not None:
                await self._release(collected[0], run_id, CANCEL_REQUEUED, collected[1])
        await self._pump_all()
        return stale

    async def _beat_loop(self) -> None:
        while not self._stopping.is_set():
            await asyncio.sleep(self.settings.runner_heartbeat_seconds)
            if self._stopping.is_set():
                return
            try:
                await self.beat()
            except Exception:
                logger.exception("a keepalive round failed")

    async def beat(self) -> None:
        """One keepalive round: ping the sockets, and drop whichever links went quiet."""
        now = time.monotonic()
        silence = self._poll_deadline()
        for state in list(self._states.values()):
            # A poller says it is alive by coming back, so there is nothing to ping — only
            # a deadline to hold it to. Without one, a machine switched off between two
            # polls stays `connected` for the life of the process: its engines stay
            # enabled, `tier_status` keeps calling its tier available, and the runs
            # enqueued onto it are work no host can drain.
            if state.transport != WEBSOCKET:
                if now - state.last_seen >= silence:
                    await self.detach(state.runner_id, reason=REASON_TIMEOUT)
                continue
            if state.missed_pings >= MISSED_PINGS:
                # Closed as well as dropped. The runner is sitting on a socket this server
                # has stopped believing in, and only a close frame sends it round to
                # reconnect — otherwise a healthy machine is out of the deployment, its
                # engines disabled, until somebody restarts it by hand.
                await self.detach(
                    state.runner_id, reason=REASON_TIMEOUT, close_code=WS_CLOSE_GOING_AWAY
                )
                continue
            state.missed_pings += 1
            await self.send(state.runner_id, protocol.ping(time.time()))

    def _poll_deadline(self) -> float:
        """How long a poller may say nothing before its link is treated as gone."""
        return max(
            self.settings.runner_poll_seconds * MISSED_POLLS,
            self.settings.runner_heartbeat_seconds,
        )

    # --- slots (the seam the stream backends plug into) --------------------

    def reserve_slot(self, runner_id: int, key: str) -> bool:
        """Hold one slot for something that is not a queue run. Was there one to hold?

        D6: a stream is a person waiting at a board, so it takes the slot of the most
        recently started run rather than queueing behind a deep pass. That run goes back
        with its attempt refunded — it was taken away, it did not fail.
        """
        state = self._states.get(runner_id)
        if state is None or not state.ready:
            return False
        if key in state.streams:
            return True
        if state.free_slots <= 0:
            victim = max(state.runs.values(), key=lambda run: run.started, default=None)
            if victim is None:
                return False
            state.runs.pop(victim.run_id, None)
            self._spawn(self._preempt(runner_id, victim.run_id, victim.attempt_token))
        state.streams.add(key)
        self._announce(state)
        return True

    def release_slot(self, runner_id: int, key: str) -> None:
        state = self._states.get(runner_id)
        if state is None or key not in state.streams:
            return
        state.streams.discard(key)
        self._announce(state)
        self.notify()

    async def _preempt(self, runner_id: int, run_id: int, token: str) -> None:
        await asyncio.to_thread(self._abandon_held, {run_id: token})
        await self.send(runner_id, protocol.run_cancel(run_id=run_id, reason=CANCEL_PREEMPTED))

    # --- the poll fallback -------------------------------------------------

    async def poll(self, runner: Runner, request: Mapping[str, Any]) -> dict[str, Any]:
        """One `POST /runner/poll`: announce, reconcile, and take away what there is.

        A poller is a link like any other — the same `attach` and the same `pump` — so the
        fallback is a different buffer rather than a second dispatcher.
        """
        presented = request.get("proto")
        if presented != protocol.PROTO_VERSION:
            raise ProtoMismatchError(presented)

        state = self._states.get(runner.id)
        cancel: list[int] = []
        if state is None or state.transport != POLL:
            link = PollLink(runner.id, runner.name)
            welcome = await self.attach(runner, link, request)
            # The welcome went into the buffer; this response carries the same answer in
            # its own shape, so the buffer starts empty for the dispatches below.
            link.drain()
            state = self._states[runner.id]
            cancel = list(welcome["cancelled_runs"])
        else:
            if request.get("engines") is not None:
                ads = protocol.decode_ads(request["engines"])
                registration = await asyncio.to_thread(
                    self._register_engines, runner.id, ads, POLL
                )
                state.engines = registration.engines
                state.engine_ids = registration.engine_ids
            resumed, cancel = await asyncio.to_thread(
                self._reconcile, _active_runs(request.get("active_runs") or ()), dict(state.runs)
            )
            state.runs = resumed
            await asyncio.to_thread(self._touch, runner.id)

        # Coming back is the whole of what a poller does to say it is alive.
        state.last_seen = time.monotonic()
        room = request.get("free_slots")
        await self.pump(
            runner.id, limit=None if room is None else max(0, int(room)), polling=True
        )

        link = state.link
        frames = link.drain() if isinstance(link, PollLink) else []
        dispatch = [
            {key: value for key, value in frame.items() if key != "type"}
            for frame in frames
            if frame.get("type") == protocol.RUN_DISPATCH
        ]
        cancel += [
            int(frame["run_id"]) for frame in frames if frame.get("type") == protocol.RUN_CANCEL
        ]
        return {
            "runner_id": runner.id,
            "proto": protocol.PROTO_VERSION,
            "runner": state.name,
            "poll_seconds": self.settings.runner_poll_seconds,
            "engines": list(state.engines),
            "dispatch": dispatch,
            "cancel": sorted(set(cancel)),
        }

    async def heartbeat(
        self, runner_id: int, run_id: int, attempt_token: str, *, done: int = 0, total: int = 0
    ) -> bool:
        """`POST /runner/runs/{id}/heartbeat`. False means the run is not theirs any more.

        The beat carries how far the pass has got, and it is emitted here for the same
        reason `run_progress` emits it over the socket: a run is the same run wherever it
        executed, and a progress bar must not freeze because the machine working it fell
        back to polling.
        """
        alive = await asyncio.to_thread(self._heartbeat, run_id, attempt_token)
        if not alive:
            self._forget(runner_id, run_id, attempt_token)
            return False
        self._progressed(runner_id, run_id, done, total)
        return True

    async def report(
        self,
        runner_id: int,
        run_id: int,
        attempt_token: str,
        *,
        evals: Sequence[Mapping[str, Any]] | None = None,
        note: str | None = None,
        error: str | None = None,
        stderr: str | None = None,
        retry: bool = True,
    ) -> tuple[bool, str | None]:
        """`POST /runner/runs/{id}/complete`, carrying either a success or a failure."""
        if error is None:
            accepted, reason = await asyncio.to_thread(
                self._complete, run_id, attempt_token, protocol.decode_evals(evals or []), note
            )
        else:
            accepted, reason = await asyncio.to_thread(
                self._fail, run_id, attempt_token, error, stderr, retry
            )
        self._forget(runner_id, run_id, attempt_token)
        await self.pump(runner_id)
        return accepted, reason

    # --- bookkeeping --------------------------------------------------------

    def _forget(self, runner_id: int, run_id: int, attempt_token: str | None = None) -> None:
        """This attempt is no longer on a slot, whatever became of it.

        The token matters: a run that was taken away and handed straight back out is on
        this runner's slot again under a *new* attempt, and a late answer for the old one
        must not free the slot the new one is holding.
        """
        state = self._states.get(runner_id)
        if state is None:
            return
        held = state.runs.get(run_id)
        if held is None:
            return
        if attempt_token is not None and not hmac.compare_digest(
            held.attempt_token, attempt_token
        ):
            return
        del state.runs[run_id]
        self._announce(state)

    async def _release(
        self, state: RunnerState | None, run_id: int, reason: str, attempt_token: str
    ) -> None:
        """Take one *attempt* off the runner holding it and tell it so.

        The token is not decoration. A `run_cancel` carries a run id and nothing else, so a
        run that was taken away and handed straight back out — to this very runner, under a
        new attempt — would be stopped by a cancel meant for the old one, and the row would
        sit `running` with nobody searching it. A newer attempt on the slot means the older
        one is already over: there is nothing left to release and nothing to say about it.
        """
        if state is None:
            return
        current = state.runs.get(run_id)
        if current is not None and not hmac.compare_digest(current.attempt_token, attempt_token):
            return
        self._forget(state.runner_id, run_id, attempt_token)
        await self._send(state, protocol.run_cancel(run_id=run_id, reason=reason))

    def _progressed(self, runner_id: int, run_id: int, done: int, total: int) -> None:
        """`analysis.progress` for a remote run, in the shape a local one's has.

        The plan is kept on the state for exactly this. Both transports come through here,
        so a UI cannot tell where a run executed — or over what — and does not need to.
        """
        state = self._states.get(runner_id)
        held = None if state is None else state.runs.get(run_id)
        if held is not None and held.plan is not None:
            analysis.emit_run_event(analysis.progress_event(held.plan, done, total))

    def _announce(self, state: RunnerState) -> None:
        """A state change worth telling the UI about — never a heartbeat, never a snapshot."""
        events_service.emit(
            {
                "event": runners_service.EVENT_RUNNER_UPDATED,
                "runner_id": state.runner_id,
                "name": state.name,
                "slots": state.slots,
                "connected": True,
                "busy": state.busy,
                "streams": len(state.streams),
                "free_slots": state.free_slots,
                "at": utcnow().isoformat(),
            }
        )

    def _emit_disconnected(self, state: RunnerState, reason: str) -> None:
        """A link that ended without the runner having gone: no row is touched."""
        events_service.emit(
            {
                "event": runners_service.EVENT_RUNNER_DISCONNECTED,
                "runner_id": state.runner_id,
                "name": state.name,
                "reason": reason,
                "at": utcnow().isoformat(),
            }
        )

    def _spawn(self, coroutine: Any) -> asyncio.Task[Any]:
        """Run something on its own task, so the caller's cancellation is not its own."""
        task = asyncio.ensure_future(coroutine)
        self._background.add(task)
        task.add_done_callback(self._background.discard)
        return task

    # --- the database side (always on a thread) ---------------------------

    def _register(
        self,
        runner_id: int,
        ads: Sequence[protocol.EngineAd] | None,
        slots: Any,
        version: Any,
        transport: str,
    ) -> Registration:
        with self.sessions() as session:
            runner = runners_service.require_runner(session, runner_id)
            engines = self._accept(session, runner, ads, transport)
            runners_service.mark_connected(
                session,
                runner,
                transport=transport,
                version=None if version is None else str(version),
                slots=None if slots is None else int(slots),
            )
            return Registration(
                name=runner.name,
                slots=runners_service.effective_slots(
                    runner, None if slots is None else int(slots)
                ),
                engines=engines,
                engine_ids=tuple(engines_service.runner_engine_ids(session, runner_id)),
            )

    def _register_engines(
        self, runner_id: int, ads: Sequence[protocol.EngineAd], transport: str
    ) -> Registration:
        with self.sessions() as session:
            runner = runners_service.require_runner(session, runner_id)
            engines = self._accept(session, runner, ads, transport)
            return Registration(
                name=runner.name,
                slots=runner.slots,
                engines=engines,
                engine_ids=tuple(engines_service.runner_engine_ids(session, runner_id)),
            )

    def _accept(
        self,
        session: Session,
        runner: Runner,
        ads: Sequence[protocol.EngineAd] | None,
        transport: str,
    ) -> tuple[dict[str, Any], ...]:
        """Write the advertisement into the engine table and say what was taken.

        `streams` rides along on every entry because it is the runner's answer to "can this
        engine drive the analysis board": a Maia never can, and neither can anything on a
        polling link, which has nowhere for a snapshot to travel.
        """
        if ads is None:
            # A poll that re-announces nothing keeps whatever it advertised last.
            return tuple(
                {
                    **engines_service.AcceptedEngine(
                        name=engine.name, engine_id=engine.id, accepted=True
                    ).as_dict(),
                    "streams": _streams(engine.kind is EngineKind.UCI, transport),
                }
                for engine in engines_service.engines_of_runner(session, runner.id)
                if engine.enabled
            )
        offered = {ad.name: ad.streams for ad in ads}
        return tuple(
            {
                **accepted.as_dict(),
                "streams": accepted.accepted
                and _streams(bool(offered.get(accepted.name)), transport),
            }
            for accepted in engines_service.sync_runner_engines(session, runner, ads)
        )

    def _reconcile(
        self, reported: dict[int, str], known: dict[int, RemoteRun]
    ) -> tuple[dict[int, RemoteRun], list[int]]:
        """Line up what the runner says it is executing with what the database believes.

        A run it still holds under the token we handed out resumes untouched. One it names
        that has moved on is cancelled by id, so the runner stops rather than searching for
        a result nobody will accept. One *we* thought it held and it does not name is being
        worked on by nobody at all, so it goes straight back to the queue — with its
        attempt refunded, because a dropped socket is not a failed pass.
        """
        resumed: dict[int, RemoteRun] = {}
        cancelled: list[int] = []
        with self.sessions() as session:
            for run_id, token in reported.items():
                run = analysis.get_run(session, run_id)
                if run is None or not _holds(run.status, run.attempt_token, token):
                    cancelled.append(run_id)
                    continue
                try:
                    plan = analysis.build_plan(session, run)
                except analysis.AnalysisError:
                    # The run is still ours on paper but nothing here can describe it any
                    # more — the game was deleted under it. Cancelling is kinder than
                    # letting the runner finish a pass with nowhere to put it.
                    cancelled.append(run_id)
                    continue
                resumed[run_id] = RemoteRun(
                    run_id=run_id, attempt_token=token, plan=plan, started=time.monotonic()
                )
            for run_id, held in known.items():
                if run_id in resumed:
                    continue
                run = analysis.get_run(session, run_id)
                if run is not None and _holds(run.status, run.attempt_token, held.attempt_token):
                    analysis.abandon_run(session, run)
        return resumed, sorted(cancelled)

    def _claim(self, runner_id: int) -> Dispatch | None:
        with self.sessions() as session:
            engine_ids = engines_service.runner_engine_ids(session, runner_id)
            run = analysis.claim_next_run(session, engine_ids=engine_ids)
            if run is None:
                return None
            engine = session.get(Engine, run.engine_id) if run.engine_id else None
            if engine is None or engine.runner_id != runner_id or not engine.enabled:
                # The engine was switched off between the candidate query and the claim.
                # Nobody has started anything, so the run goes back untouched.
                analysis.abandon_run(session, run)
                return None
            token = run.attempt_token
            if token is None:  # pragma: no cover - every claim writes one
                analysis.abandon_run(session, run)
                return None
            try:
                plan = analysis.build_plan(session, run)
            except analysis.AnalysisError as exc:
                # A run this database cannot describe. A second attempt on another machine
                # would hit exactly the same wall.
                analysis.fail_run(session, run, str(exc), retry=False, attempt_token=token)
                return None
            maia = engines_service.maia_engine_for_host(session, runner_id)
            return Dispatch(
                run_id=run.id,
                attempt_token=token,
                engine=engine.name,
                maia_engine=None if maia is None else maia.name,
                plan=plan,
            )

    def _heartbeat(self, run_id: int, attempt_token: str) -> bool:
        with self.sessions() as session:
            return analysis.heartbeat_run(session, run_id, attempt_token)

    def _complete(
        self, run_id: int, attempt_token: str, evals: Sequence[Any], note: Any
    ) -> tuple[bool, str | None]:
        with self.sessions() as session:
            try:
                run = analysis.guard_attempt(session, run_id, attempt_token)
            except analysis.UnknownRunError:
                return False, protocol.ERROR_UNKNOWN_RUN
            except analysis.StaleResultError:
                return False, protocol.ERROR_STALE_RESULT
            analysis.complete_run(session, run, list(evals), attempt_token=attempt_token)
            if note:
                analysis.note_run(session, run, str(note))
        return True, None

    def _fail(
        self, run_id: int, attempt_token: str, error: str, stderr: Any, retry: bool
    ) -> tuple[bool, str | None]:
        with self.sessions() as session:
            try:
                run = analysis.guard_attempt(session, run_id, attempt_token)
            except analysis.UnknownRunError:
                return False, protocol.ERROR_UNKNOWN_RUN
            except analysis.StaleResultError:
                return False, protocol.ERROR_STALE_RESULT
            analysis.fail_run(
                session,
                run,
                error,
                None if stderr is None else str(stderr),
                retry=retry,
                attempt_token=attempt_token,
            )
        return True, None

    def _release_link(self, runner_id: int, reason: str, held: Mapping[int, str]) -> None:
        """Everything a gone link owes the database, in one unit of work."""
        if held:
            self._abandon_held(held)
        self._disconnected(runner_id, reason)

    def _abandon_held(self, held: Mapping[int, str]) -> None:
        """Hand runs back, but only the ones still running under the token we handed out.

        The token is the whole guard: a run that has been claimed again since belongs to
        whoever claimed it, and taking it away would strand a search that is under way.
        """
        with self.sessions() as session:
            for run_id, token in held.items():
                run = analysis.get_run(session, run_id)
                if run is not None and _holds(run.status, run.attempt_token, token):
                    analysis.abandon_run(session, run)

    def _requeue_stale(self) -> list[int]:
        with self.sessions() as session:
            return [run.id for run in analysis.requeue_stale_runs(session)]

    def _touch(self, runner_id: int) -> None:
        with self.sessions() as session:
            runners_service.touch(session, runner_id)

    def _disconnected(self, runner_id: int, reason: str) -> None:
        with self.sessions() as session:
            runners_service.mark_disconnected(session, runner_id, reason=reason)


# One built-in handler per message type a runner may send. A type absent from here and
# from `register_handler` is answered with `unknown_message` rather than a silence.
_BUILTIN: dict[str, Callable[[RunnerGateway, int, Mapping[str, Any]], Awaitable[None]]] = {
    protocol.PING: RunnerGateway._on_ping,
    protocol.PONG: RunnerGateway._on_pong,
    protocol.ADVERTISE_ENGINES: RunnerGateway._on_advertise,
    protocol.RUN_PROGRESS: RunnerGateway._on_run_progress,
    protocol.RUN_COMPLETE: RunnerGateway._on_run_complete,
    protocol.RUN_FAILED: RunnerGateway._on_run_failed,
    protocol.RUN_CANCELLED: RunnerGateway._on_run_cancelled,
}


def _active_runs(entries: Sequence[Mapping[str, Any]]) -> dict[int, str]:
    """`[{run_id, attempt_token}]` as a lookup, ignoring an entry that carries neither."""
    active: dict[int, str] = {}
    for entry in entries or ():
        if not isinstance(entry, Mapping):
            continue
        run_id, token = entry.get("run_id"), entry.get("attempt_token")
        if run_id is None or not isinstance(token, str) or not token:
            continue
        active[int(run_id)] = token
    return active


def _holds(status: RunStatus, expected: str | None, presented: str) -> bool:
    """Whether this token is still the one that owns a running run."""
    if status is not RunStatus.RUNNING or not expected:
        return False
    return hmac.compare_digest(expected, presented)


def _streams(offered: bool, transport: str) -> bool:
    """A snapshot needs somewhere to travel, and a poll response is not that."""
    return bool(offered) and transport == WEBSOCKET


def _stamp(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return time.time()
