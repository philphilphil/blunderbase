"""`blunderbase-runner`: the process on the other machine, and everything it does.

A runner is a worker, not a remote engine. It dials out, says what binaries it has, and is
handed whole jobs — a serialized `RunPlan` — which it computes with exactly the same
`analyse_plan` and the same adapters the server would have used locally. That reuse is the
point: there is one definition of what a blunder is, and it does not fork because the
search happened somewhere else.

Four things are worth knowing before reading the rest:

- **The link is expendable, the queue is not.** The server owns the queue and hands out an
  attempt token with every dispatch; a result this process fails to deliver is not lost
  work but a run the server will requeue. So a dropped socket is answered with a reconnect
  and an `active_runs` list, never with heroics to keep a payload alive.
- **The websocket is the transport, polling is the fallback.** After
  `reconnect.websocket_failures` consecutive failures *to connect* the runner starts
  polling instead, and keeps trying the socket every `reconnect.retry_websocket_seconds`.
  A session that was welcomed and later dropped resets that count — the socket plainly
  works, and polling costs this machine its analysis boards. The two modes
  execute a job identically — only where the frames go differs, which is the whole reason
  `Sink` exists.
- **Every blocking call goes out to a thread.** A UCI search is a blocking read on a pipe
  and starting an engine takes seconds, so the `EnginePool` here is the same asyncio-facing
  pool the server runs, sized to this machine's slot count.
- **Progress is also the heartbeat.** `analyse_plan` reports every few positions; a
  reporter task turns that into a `run_progress` at least once per heartbeat interval even
  when nothing has moved, because one very deep position must not look like a dead runner.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import random
import ssl
import threading
import time
from collections.abc import Awaitable, Callable, Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Protocol
from urllib.parse import urlsplit

from backend import __version__
from backend.adapters.pool import EnginePool, EngineSpec
from backend.db.enums import EngineKind
from backend.runners import protocol
from backend.runners.config import MAIA_KIND, EngineConfig, Reconnect, RunnerConfig
from backend.services import analysis
from backend.services import engines as engines_service

if TYPE_CHECKING:  # pragma: no cover - typing only
    from backend.adapters.pool import Adapter
    from backend.db.models import MoveEval
    from backend.services.analysis import RunPlan

logger = logging.getLogger(__name__)

# What the process exits with. A configuration or probe failure is the owner's to fix; a
# protocol refusal is a version skew, and the spec asks for those to be told apart.
EXIT_OK = 0
EXIT_CONFIG = 1
EXIT_REFUSED = 2

# Half of every reconnect delay is jitter, so a fleet restarting together does not dial in
# lockstep and knock the server over on the way back up.
JITTER = 0.5

CONNECT_TIMEOUT = 20.0
POLL_TIMEOUT = 30.0
# How long a close waits for a stream's task to notice and let go of its engine. Bounded
# because the wait happens on the receive loop, which owes the server its pongs.
CLOSE_TIMEOUT = 10.0
# A deep multi-PV pass over a long game is a big `run_complete`. Matches uvicorn's own
# websocket frame cap, so neither end is the one that refuses the payload.
MAX_FRAME = 16 * 1024 * 1024
# Until a `welcome` says otherwise.
DEFAULT_HEARTBEAT = 10.0

# A close code that is a policy rather than an accident, and what the process should exit
# with when it sees one. Everything else is worth reconnecting for.
FATAL_CLOSES = {
    protocol.WS_CLOSE_UNAUTHORIZED: EXIT_CONFIG,
    protocol.WS_CLOSE_REVOKED: EXIT_CONFIG,
    protocol.WS_CLOSE_PROTO_MISMATCH: EXIT_REFUSED,
}
# The same judgement for a fatal `error` frame, which arrives just before the close.
FATAL_CODES = {
    protocol.ERROR_UNAUTHORIZED: EXIT_CONFIG,
    protocol.ERROR_REVOKED: EXIT_CONFIG,
    protocol.ERROR_PROTO_MISMATCH: EXIT_REFUSED,
}
# A socket that closed for one of these was not a failure at all.
CLEAN_CLOSES = (1000, 1001)

STREAM_FRAMES = (protocol.STREAM_OPEN, protocol.STREAM_RESTART, protocol.STREAM_CLOSE)


class RunnerRefused(RuntimeError):
    """The server will not have this runner, for a reason it stated. The process exits."""

    def __init__(self, message: str, status: int = EXIT_REFUSED) -> None:
        super().__init__(message)
        self.status = status


class EngineFailure(Exception):
    """An engine call that failed, with whatever the process said on its way out."""

    def __init__(self, error: str, stderr: str | None = None) -> None:
        super().__init__(error)
        self.error = error
        self.stderr = stderr


# --- the socket -------------------------------------------------------------


class Socket(Protocol):
    """The little of a websocket this client uses. A test supplies its own."""

    async def send(self, text: str) -> None: ...

    async def recv(self) -> str: ...

    async def close(self) -> None: ...


Connect = Callable[[RunnerConfig], Awaitable[Socket]]
Http = Callable[[RunnerConfig], Any]


async def open_socket(config: RunnerConfig) -> Any:
    """Dial the server's `/runner/ws`, bearer token and all."""
    from websockets.asyncio.client import connect

    options: dict[str, Any] = {
        "additional_headers": bearer(config.token),
        "open_timeout": CONNECT_TIMEOUT,
        "max_size": MAX_FRAME,
    }
    # Only an *unverified* context is ever passed. An explicit `ssl=None` is not "use the
    # default" to websockets>=14 but "no TLS", which it refuses for a wss:// URI — the
    # ordinary verified case has to leave the argument out altogether.
    context = _ssl_context(config)
    if context is not None:
        options["ssl"] = context
    return await connect(config.ws_url, **options)


def open_http(config: RunnerConfig) -> Any:
    """The client the poll fallback posts through."""
    import httpx

    return httpx.AsyncClient(
        headers=bearer(config.token), verify=config.verify_tls, timeout=POLL_TIMEOUT
    )


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _ssl_context(config: RunnerConfig) -> ssl.SSLContext | None:
    """None — meaning don't pass one — except the unverified context, only if asked.

    `verify_tls: false` exists for a runner reaching a server behind a private certificate
    authority. It is a deliberate hole and the docs say so.
    """
    if urlsplit(config.server).scheme != "https" or config.verify_tls:
        return None
    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    return context


def backoff_delays(
    reconnect: Reconnect, *, rand: Callable[[], float] = random.random
) -> Iterator[float]:
    """How long to wait before each reconnect: exponential, with jitter.

    The jitter is half the delay rather than all of it — a runner that is genuinely alone
    should come back promptly, and a fleet should still spread out.
    """
    delay = float(reconnect.initial_seconds)
    while True:
        yield delay * (JITTER + (1.0 - JITTER) * rand())
        delay = min(delay * 2.0, float(reconnect.max_seconds))


# --- one job ----------------------------------------------------------------


@dataclass(slots=True)
class Job:
    """One dispatched run, from the runner's side of it."""

    run_id: int
    attempt_token: str
    plan: RunPlan
    engine: EngineConfig
    maia: EngineConfig | None = None
    done: int = 0
    total: int = 0
    # Set by the engine thread through the loop, waited on by the progress reporter.
    moved: asyncio.Event = field(default_factory=asyncio.Event)
    task: asyncio.Task[None] | None = None
    # Taken away: whatever this job computes must not be reported.
    abandoned: bool = False

    def mark(self, done: int, total: int) -> None:
        self.done, self.total = int(done), int(total)
        self.moved.set()

    @property
    def active(self) -> dict[str, Any]:
        """What a `hello` or a poll names to say "I am still executing this"."""
        return {"run_id": self.run_id, "attempt_token": self.attempt_token}


@dataclass(slots=True)
class Stream:
    """One analysis board this runner is serving, from its side of the socket.

    The mirror image of the server's own local backend: a task holding one pool slot, a
    driver on a thread, and two flags the loop reads between searches so a position change
    is a stop-and-go on the same engine rather than a teardown.
    """

    session_id: str
    engine: EngineConfig
    fen: str
    multipv: int = 1
    interval: float = 0.5
    seq: int = 0
    task: asyncio.Task[None] | None = None
    stop: threading.Event | None = None
    restart: bool = False
    closing: bool = False
    # Set once the pool has actually handed the task an engine. Until it is, the task is
    # parked on the pool's semaphore where neither `closing` nor `stop` reaches it, and
    # the only way to get it back is to cancel it.
    started: asyncio.Event = field(default_factory=asyncio.Event)


class Sink(Protocol):
    """Where a job's progress and its answer go. One implementation per transport."""

    async def progress(self, run_id: int, token: str, done: int, total: int) -> bool:
        """False means the run is not this runner's any more."""

    async def complete(
        self, run_id: int, token: str, evals: Sequence[MoveEval], note: str | None
    ) -> None: ...

    async def failed(
        self, run_id: int, token: str, error: str, stderr: str | None, retry: bool
    ) -> None: ...


class SocketSink:
    """Frames down the same socket the dispatch came up."""

    def __init__(self, client: RunnerClient) -> None:
        self._client = client

    async def progress(self, run_id: int, token: str, done: int, total: int) -> bool:
        await self._client.send(
            protocol.run_progress(run_id=run_id, attempt_token=token, done=done, total=total)
        )
        # A socket learns it has lost a run from the `run_cancel` that comes back, not from
        # the send, so as far as this answer is concerned the run is still ours.
        return True

    async def complete(
        self, run_id: int, token: str, evals: Sequence[MoveEval], note: str | None
    ) -> None:
        await self._client.send(
            protocol.run_complete(
                run_id=run_id,
                attempt_token=token,
                evals=protocol.encode_evals(list(evals)),
                note=note,
            )
        )

    async def failed(
        self, run_id: int, token: str, error: str, stderr: str | None, retry: bool
    ) -> None:
        await self._client.send(
            protocol.run_failed(
                run_id=run_id, attempt_token=token, error=error, stderr=stderr, retry=retry
            )
        )


class PollSink:
    """The same three answers as HTTP posts, for a runner that cannot hold a socket."""

    def __init__(self, client: RunnerClient, http: Any) -> None:
        self._client = client
        self._http = http

    async def progress(self, run_id: int, token: str, done: int, total: int) -> bool:
        answer = await self._post(
            run_id, "heartbeat", {"attempt_token": token, "done": done, "total": total}
        )
        # A poll that could not be delivered says nothing about whose run this is; the
        # server's stale sweep is what settles it.
        return True if answer is None else not answer.get("cancel")

    async def complete(
        self, run_id: int, token: str, evals: Sequence[MoveEval], note: str | None
    ) -> None:
        await self._post(
            run_id,
            "complete",
            {
                "attempt_token": token,
                "evals": protocol.encode_evals(list(evals)),
                "note": note,
            },
        )

    async def failed(
        self, run_id: int, token: str, error: str, stderr: str | None, retry: bool
    ) -> None:
        await self._post(
            run_id,
            "complete",
            {"attempt_token": token, "error": error, "stderr": stderr, "retry": retry},
        )

    async def _post(self, run_id: int, action: str, body: dict[str, Any]) -> dict[str, Any] | None:
        url = self._client.config.run_url(run_id, action)
        try:
            response = await self._http.post(url, json=body)
            response.raise_for_status()
            return dict(response.json())
        except Exception as exc:
            logger.warning("run %s: the %s post failed: %s", run_id, action, _message(exc))
            return None


# --- the client ---------------------------------------------------------------


class RunnerClient:
    """One runner process: its engines, its link and the jobs on its slots."""

    def __init__(
        self,
        config: RunnerConfig,
        *,
        pool: EnginePool | None = None,
        connect: Connect | None = None,
        http: Http | None = None,
    ) -> None:
        self.config = config
        self._pool = pool
        self._owns_pool = pool is None
        self._open = connect or open_socket
        self._http = http or open_http
        self._ads: tuple[protocol.EngineAd, ...] = ()
        self._unprobed: tuple[str, ...] = ()
        self._runs: dict[int, Job] = {}
        self._streams: dict[str, Stream] = {}
        self._background: set[asyncio.Task[Any]] = set()
        self._socket: Socket | None = None
        self._sink: Sink | None = None
        self._send_lock = asyncio.Lock()
        self._stopping = asyncio.Event()
        self._polling = False
        self._established = False
        self._heartbeat = DEFAULT_HEARTBEAT
        self._poll_seconds = config.poll_seconds
        self._runner_id: int | None = None

    # --- what this machine can run -----------------------------------------

    @property
    def pool(self) -> EnginePool:
        """This process's warm engines, capped at the slot count it advertises."""
        if self._pool is None:
            self._pool = EnginePool(concurrency=self.config.slots)
        return self._pool

    @property
    def ads(self) -> tuple[protocol.EngineAd, ...]:
        return self._ads

    @property
    def polling(self) -> bool:
        """Whether the runner has fallen back to the poll transport."""
        return self._polling

    @property
    def runs(self) -> dict[int, Job]:
        return self._runs

    @property
    def streams(self) -> dict[str, Stream]:
        return self._streams

    async def probe_engines(self) -> list[protocol.EngineAd]:
        """Start every configured binary once, read what it declares, and stop it again.

        This is what replaces the server-side probe for a remote engine: the options in the
        yaml are validated on the server against *this* answer, so a typo is a rejected
        engine with a reason rather than a run that fails on another machine an hour later.
        """
        ads: list[protocol.EngineAd] = []
        unprobed: list[str] = []
        for engine in self.config.engines:
            try:
                probed = await asyncio.to_thread(
                    engines_service.probe_engine, engine.path, EngineKind(engine.kind)
                )
            except engines_service.EngineProbeError as exc:
                logger.error("engine %r cannot be started: %s", engine.name, exc)
                unprobed.append(engine.name)
                continue
            ads.append(
                protocol.EngineAd(
                    name=engine.name,
                    kind=engine.kind,
                    path=engine.path,
                    version=probed.name,
                    tier=engine.tier,
                    options=dict(engine.options),
                    declared_options=tuple(protocol.encode_probe(probed)),
                    streams=engine.streams_enabled,
                )
            )
            logger.info(
                "engine %r is %s with %s declared option(s)",
                engine.name,
                probed.name or "an engine that did not name itself",
                len(probed.options),
            )
        self._ads = tuple(ads)
        self._unprobed = tuple(unprobed)
        return ads

    # --- the two ways to run -----------------------------------------------

    async def check(self) -> int:
        """`--check`: probe, connect once, say what the server accepted, and stop."""
        await self.probe_engines()
        if self._unprobed or not self._ads:
            print(f"blunderbase-runner: {self._probe_summary()}")
            return EXIT_CONFIG

        try:
            socket = await self._open(self.config)
        except Exception as exc:
            print(f"blunderbase-runner: could not reach {self.config.ws_url}: {_message(exc)}")
            return EXIT_CONFIG
        self._socket = socket
        try:
            await self._announce()
            welcome = await self._first_welcome(socket)
        except RunnerRefused as refusal:
            print(f"blunderbase-runner: {refusal}")
            return refusal.status
        except Exception as exc:
            print(f"blunderbase-runner: the handshake failed: {_message(exc)}")
            return EXIT_CONFIG
        finally:
            self._socket = None
            with contextlib.suppress(Exception):
                await socket.close()

        print(
            f"blunderbase-runner: {self.config.server} welcomed "
            f"{welcome.get('runner')!r} with {welcome.get('slots')} slot(s)"
        )
        for entry in welcome.get("engines") or ():
            if entry.get("accepted"):
                print(f"  {entry['name']}: accepted as engine {entry.get('engine_id')}")
            else:
                print(f"  {entry['name']}: refused — {entry.get('reason')}")
        return EXIT_OK

    async def run(self) -> int:
        """Stay connected and drain work until something asks this process to stop."""
        self._stopping.clear()
        await self.probe_engines()
        if not self._ads:
            logger.error("%s", self._probe_summary())
            return EXIT_CONFIG
        if self._unprobed:
            logger.warning("%s", self._probe_summary())
        logger.info(
            "runner %r starting: %s slot(s), %s engine(s), server %s",
            self.config.name,
            self.config.slots,
            len(self._ads),
            self.config.server,
        )

        delays = backoff_delays(self.config.reconnect)
        failures = 0
        status = EXIT_OK
        try:
            while not self._stopping.is_set():
                try:
                    if self._polling:
                        await self._poll_session()
                        self._upgrade()
                        continue
                    await self._websocket_session()
                except RunnerRefused as refusal:
                    logger.error("%s", refusal)
                    status = refusal.status
                    break
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    # A session that was welcomed and then dropped is not a *connection*
                    # failure, however abnormally it ended: a server restart closes with
                    # 1012 and a proxy with nothing at all, and a runner that worked for
                    # hours must not be pushed into a transport with no analysis boards on
                    # it because the deployment was redeployed three times in a week.
                    if self._established:
                        failures = 0
                        delays = backoff_delays(self.config.reconnect)
                        logger.warning(
                            "the link to %s dropped: %s", self.config.server, _message(exc)
                        )
                    else:
                        failures += 1
                        logger.warning(
                            "the link to %s failed (%s in a row): %s",
                            self.config.server,
                            failures,
                            _message(exc),
                        )
                else:
                    failures = 0
                    delays = backoff_delays(self.config.reconnect)
                if self._stopping.is_set():
                    break
                if failures >= self.config.reconnect.websocket_failures:
                    self._polling = True
                    logger.warning(
                        "falling back to polling after %s socket failure(s); "
                        "stream sessions are unavailable until the socket comes back",
                        failures,
                    )
                    continue
                await self._pause(next(delays))
        finally:
            await self._shutdown()
        return status

    async def stop(self) -> None:
        """Ask the loop to end. The socket is closed so a blocked receive comes back."""
        self._stopping.set()
        socket = self._socket
        if socket is not None:
            with contextlib.suppress(Exception):
                await socket.close()

    # --- the websocket session ---------------------------------------------

    async def _websocket_session(self) -> None:
        socket = await self._open(self.config)
        self._socket = socket
        self._sink = SocketSink(self)
        self._established = False
        try:
            await self._announce()
            while not self._stopping.is_set():
                text = await self._receive(socket)
                if text is None:
                    return
                try:
                    frame = protocol.decode(text)
                except protocol.ProtocolError as exc:
                    logger.warning("the server sent something unreadable: %s", exc)
                    continue
                await self._handle(frame)
        finally:
            # A board cannot outlive the link it was opened on: the server ends the
            # session the moment this runner drops, so holding the engine would be holding
            # a slot for nobody.
            await self._drop_streams()
            self._sink = None
            self._socket = None
            with contextlib.suppress(Exception):
                await socket.close()
            if self._runner_id is not None:
                logger.info("disconnected from %s", self.config.server)

    async def _receive(self, socket: Socket) -> str | None:
        """The next frame, None because the link ended, or a refusal that stops the process."""
        try:
            text = await socket.recv()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            code = _close_code(exc)
            status = FATAL_CLOSES.get(code) if code is not None else None
            if status is not None:
                named = protocol.CLOSE_REASONS.get(code, code)
                raise RunnerRefused(
                    f"{self.config.server} closed the link: {named}", status
                ) from exc
            if code in CLEAN_CLOSES:
                return None
            raise
        return text if isinstance(text, str) else bytes(text).decode("utf-8", "replace")

    async def _announce(self) -> None:
        """`hello`, carrying the engines and whatever this process is still executing."""
        await self.send(
            protocol.hello(
                runner=self.config.name,
                version=__version__,
                slots=self.config.slots,
                engines=[ad.as_dict() for ad in self._ads],
                active_runs=[job.active for job in self._runs.values()],
            )
        )

    async def _first_welcome(self, socket: Socket) -> dict[str, Any]:
        """Read until the server has welcomed this runner, or refused it."""
        while True:
            text = await self._receive(socket)
            if text is None:
                raise RunnerRefused(
                    f"{self.config.server} closed the link without a welcome", EXIT_CONFIG
                )
            frame = protocol.decode(text)
            kind = frame.get("type")
            if kind == protocol.WELCOME:
                return frame
            if kind == protocol.ERROR:
                self._on_error(frame)

    async def send(self, frame: Mapping[str, Any]) -> None:
        """One frame to the server. Serialized: several jobs share one socket."""
        socket = self._socket
        if socket is None:
            raise ConnectionError("there is no link to the server right now")
        async with self._send_lock:
            await socket.send(protocol.encode(frame))

    async def _send_quietly(self, frame: Mapping[str, Any]) -> None:
        try:
            await self.send(frame)
        except Exception as exc:
            logger.debug("a %s could not be sent: %s", frame.get("type"), _message(exc))

    # --- frames from the server ----------------------------------------------

    async def _handle(self, frame: Mapping[str, Any]) -> None:
        kind = frame.get("type")
        if kind == protocol.WELCOME:
            await self._welcomed(frame)
        elif kind == protocol.PING:
            await self._send_quietly(protocol.pong(_stamp(frame.get("t"))))
        elif kind == protocol.PONG:
            return
        elif kind == protocol.ENGINES_ACCEPTED:
            self._note_engines(frame.get("engines") or ())
        elif kind == protocol.ERROR:
            self._on_error(frame)
        elif kind == protocol.RUN_DISPATCH:
            await self._on_dispatch(frame)
        elif kind == protocol.RUN_CANCEL:
            await self._on_cancel(frame)
        elif kind == protocol.RUN_ACK:
            self._on_ack(frame)
        elif kind in STREAM_FRAMES:
            await self._on_stream(frame)
        else:
            logger.info("ignoring a %r, which this runner does not understand", kind)

    async def _welcomed(self, frame: Mapping[str, Any]) -> None:
        # The link works and this runner is on it: whatever ends the session from here is
        # a drop, not a failure to connect.
        self._established = True
        self._runner_id = frame.get("runner_id")
        self._heartbeat = float(frame.get("heartbeat_seconds") or DEFAULT_HEARTBEAT)
        named = frame.get("runner")
        if named and named != self.config.name:
            logger.info(
                "the server calls this runner %r rather than %r; the token is the identity",
                named,
                self.config.name,
            )
        slots = int(frame.get("slots") or self.config.slots)
        if slots != self.config.slots:
            logger.info(
                "the server will hold this runner to %s slot(s), not the %s in the yaml",
                slots,
                self.config.slots,
            )
        logger.info(
            "connected to %s as runner %s (%r) over the websocket",
            self.config.server,
            self._runner_id,
            named or self.config.name,
        )
        self._note_engines(frame.get("engines") or ())
        for run_id in frame.get("cancelled_runs") or ():
            await self._abandon(int(run_id), "the server no longer considers it ours")

    def _note_engines(self, entries: Sequence[Mapping[str, Any]]) -> None:
        taken = [str(entry.get("name")) for entry in entries if entry.get("accepted")]
        logger.info("the server accepted %s", ", ".join(taken) if taken else "no engines")
        for entry in entries:
            if not entry.get("accepted"):
                logger.warning(
                    "engine %r was refused: %s", entry.get("name"), entry.get("reason")
                )

    def _on_error(self, frame: Mapping[str, Any]) -> None:
        code = str(frame.get("code") or "error")
        message = str(frame.get("message") or "")
        if not frame.get("fatal"):
            logger.warning("the server refused something (%s): %s", code, message)
            return
        raise RunnerRefused(f"{code}: {message}", FATAL_CODES.get(code, EXIT_REFUSED))

    def _on_ack(self, frame: Mapping[str, Any]) -> None:
        if frame.get("accepted"):
            return
        logger.info(
            "run %s: the server dropped the answer (%s)",
            frame.get("run_id"),
            frame.get("reason"),
        )

    # --- analysis boards ----------------------------------------------------

    async def _on_stream(self, frame: Mapping[str, Any]) -> None:
        kind = frame.get("type")
        session_id = str(frame.get("session_id") or "")
        if not session_id:
            logger.warning("a %s arrived without a session to attach it to", kind)
            return
        if kind == protocol.STREAM_OPEN:
            await self._open_stream(session_id, frame)
        elif kind == protocol.STREAM_RESTART:
            await self._restart_stream(session_id, frame)
        else:
            await self._close_stream(session_id, str(frame.get("reason") or "closed"))

    async def _open_stream(self, session_id: str, frame: Mapping[str, Any]) -> None:
        """Take a slot and start searching, or say at once why this machine cannot.

        A refusal is a `stream_closed`, not a silence: the board on the other end is a
        person waiting, and the server can offer them another engine the moment it knows.
        """
        if session_id in self._streams:
            logger.info("stream %s is already open here; the request is ignored", session_id)
            return
        name = str(frame.get("engine") or "")
        engine = self.config.engines_by_name.get(name)
        if engine is None or engine.kind == MAIA_KIND or not engine.streams_enabled:
            await self._stream_ended(
                session_id, "engine_failed", f"{name!r} is not an engine this runner streams on"
            )
            return
        try:
            board = _board(str(frame.get("fen") or ""))
        except ValueError as exc:
            await self._stream_ended(session_id, "engine_failed", str(exc))
            return

        stream = Stream(
            session_id=session_id,
            engine=engine,
            fen=board.fen(),
            multipv=max(1, int(frame.get("multipv") or 1)),
            interval=max(0.0, float(frame.get("interval_ms") or 500) / 1000.0),
        )
        self._streams[session_id] = stream
        stream.task = asyncio.ensure_future(self._serve_stream(stream))
        logger.info(
            "stream %s: %r at multipv %s", session_id, engine.name, stream.multipv
        )

    async def _restart_stream(self, session_id: str, frame: Mapping[str, Any]) -> None:
        stream = self._streams.get(session_id)
        if stream is None:
            await self._stream_ended(session_id, "engine_failed", "no such session here")
            return
        fen = frame.get("fen")
        if fen is not None:
            try:
                stream.fen = _board(str(fen)).fen()
            except ValueError as exc:
                await self._stream_ended(session_id, "engine_failed", str(exc))
                await self._close_stream(session_id, "engine_failed", answer=False)
                return
        if frame.get("multipv") is not None:
            stream.multipv = max(1, int(frame["multipv"]))
        stream.restart = True
        if stream.stop is not None:
            stream.stop.set()

    async def _close_stream(self, session_id: str, reason: str, *, answer: bool = True) -> None:
        """Stop searching and give the slot back. Closing a closed session is not an error.

        This is awaited from the receive loop, so what it waits for has to be bounded: a
        task still queued behind the pool's semaphore reads neither flag and would hold the
        loop until some other job let go — no pongs, no dispatches, no cancels, and the
        server dropping a runner that was working perfectly well.
        """
        stream = self._streams.pop(session_id, None)
        if stream is None:
            return
        stream.closing = True
        if stream.stop is not None:
            stream.stop.set()
        task = stream.task
        if task is not None and task is not asyncio.current_task():
            if not stream.started.is_set():
                # Waiting for an engine nobody wants any more.
                task.cancel()
            try:
                await asyncio.wait_for(asyncio.shield(task), CLOSE_TIMEOUT)
            except TimeoutError:
                logger.warning("stream %s would not let go of its engine", session_id)
            except BaseException:
                pass
        if answer:
            await self._stream_ended(session_id, reason)

    async def _serve_stream(self, stream: Stream) -> None:
        """Hold one engine and search whatever the session is showing, until it is closed."""
        from backend.adapters.infinite import InfiniteSearch, Snapshot

        loop = asyncio.get_running_loop()
        error: str | None = None
        try:
            async with self.pool.acquire(_spec(stream.engine)) as adapter:
                # Past the semaphore: from here a close reaches the loop through the flags
                # and does not have to cancel the task out of the queue it was sitting in.
                stream.started.set()
                await self._send_quietly(
                    protocol.stream_started(session_id=stream.session_id, engine=stream.engine.name)
                )
                driver = InfiniteSearch(adapter, interval=stream.interval)  # type: ignore[arg-type]

                def emit(snapshot: Snapshot) -> None:
                    # On the engine thread: the socket belongs to the loop.
                    loop.call_soon_threadsafe(self._spawn, self._send_snapshot(stream, snapshot))

                while not stream.closing:
                    board = _board(stream.fen)
                    stream.restart = False
                    stream.stop = threading.Event()
                    finished = await asyncio.to_thread(
                        driver.run,
                        board,
                        multipv=stream.multipv,
                        on_snapshot=emit,
                        stop=stream.stop,
                    )
                    if stream.closing or not stream.restart:
                        if finished and not stream.closing:
                            error = "the engine stopped searching this position"
                        break
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            error = _message(exc)
        if stream.closing:
            return
        self._streams.pop(stream.session_id, None)
        logger.info("stream %s ended: %s", stream.session_id, error or "the engine stopped")
        self._spawn(self._stream_ended(stream.session_id, "engine_failed", error))

    async def _send_snapshot(self, stream: Stream, snapshot: Any) -> None:
        stream.seq += 1
        await self._send_quietly(
            protocol.snapshot_frame(stream.session_id, stream.seq, **snapshot.as_dict())
        )

    async def _stream_ended(
        self, session_id: str, reason: str, error: str | None = None
    ) -> None:
        await self._send_quietly(
            protocol.stream_closed(session_id=session_id, reason=reason, error=error)
        )

    async def _drop_streams(self) -> None:
        """Give every board up. The link is gone, or this process is."""
        for session_id in list(self._streams):
            await self._close_stream(session_id, "runner_gone", answer=False)

    # --- jobs -----------------------------------------------------------------

    async def _on_dispatch(self, frame: Mapping[str, Any]) -> None:
        """One run, onto a slot and into a task of its own."""
        try:
            run_id = int(frame["run_id"])
            token = str(frame["attempt_token"])
        except (KeyError, TypeError, ValueError):
            logger.warning("a dispatch arrived without a run to attach it to")
            return
        if run_id in self._runs:
            logger.info("run %s is already on a slot here; the dispatch is ignored", run_id)
            return

        name = str(frame.get("engine") or "")
        engine = self.config.engines_by_name.get(name)
        if engine is None or engine.kind == MAIA_KIND:
            await self._report_failure(
                run_id,
                token,
                f"{name!r} is not a search engine this runner has",
                retry=True,
            )
            return
        try:
            plan = protocol.decode_plan(frame["plan"])
        except (KeyError, protocol.ProtocolError) as exc:
            await self._report_failure(
                run_id, token, f"the plan did not decode: {exc}", retry=False
            )
            return

        maia = self.config.maia_named(frame.get("maia_engine"))
        job = Job(run_id=run_id, attempt_token=token, plan=plan, engine=engine, maia=maia)
        self._runs[run_id] = job
        job.task = asyncio.ensure_future(self._execute(job))
        logger.info(
            "run %s: %s position(s) on %r%s",
            run_id,
            len(plan.positions),
            engine.name,
            f" with {maia.name}" if maia is not None else "",
        )

    async def _on_cancel(self, frame: Mapping[str, Any]) -> None:
        await self._abandon(int(frame["run_id"]), str(frame.get("reason") or "cancelled"))

    async def _execute(self, job: Job) -> None:
        """Compute one run and answer for it. Nothing raised here reaches the loop."""
        reporter = asyncio.ensure_future(self._report_progress(job))
        try:
            try:
                evals = await self._analyse(job)
            except asyncio.CancelledError:
                raise
            except EngineFailure as failure:
                await self._answer_failure(job, failure.error, failure.stderr)
                return
            except Exception as exc:
                await self._answer_failure(job, _message(exc), None)
                return
            note = await self._add_maia(job, evals)
            await self._answer(job, evals, note)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("run %s died in its task", job.run_id)
        finally:
            reporter.cancel()
            with contextlib.suppress(BaseException):
                await reporter
            # By identity, not by id: a run that was taken away and dispatched again is on
            # the slot under a *new* job, and this one leaving must not evict it.
            if self._runs.get(job.run_id) is job:
                del self._runs[job.run_id]

    async def _analyse(self, job: Job) -> list[MoveEval]:
        loop = asyncio.get_running_loop()

        def progress(done: int, total: int) -> None:
            # Called from the engine thread; the loop owns the job's counters.
            loop.call_soon_threadsafe(job.mark, done, total)

        def work(adapter: Adapter) -> list[MoveEval]:
            return analysis.analyse_plan(job.plan, adapter, progress=progress)  # type: ignore[arg-type]

        return await self._with_engine(job.engine, work)

    async def _add_maia(self, job: Job, evals: list[MoveEval]) -> str | None:
        """The human-policy pass. A Maia that will not answer degrades, never fails."""
        if job.maia is None or not evals:
            return None

        def work(adapter: Adapter) -> int:
            return analysis.apply_maia(job.plan, evals, adapter)  # type: ignore[arg-type]

        try:
            await self._with_engine(job.maia, work)
        except asyncio.CancelledError:
            raise
        except EngineFailure as failure:
            return f"human-move predictions skipped: {failure.error}"
        except Exception as exc:
            return f"human-move predictions skipped: {_message(exc)}"
        return None

    async def _with_engine(self, engine: EngineConfig, work: Callable[[Adapter], Any]) -> Any:
        """One blocking engine call on a warm process, with its stderr on the way out."""
        async with self.pool.acquire(_spec(engine)) as adapter:
            try:
                return await asyncio.to_thread(work, adapter)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                raise EngineFailure(_message(exc), _stderr_of(adapter)) from exc

    async def _report_progress(self, job: Job) -> None:
        """Say the run is moving, and say it even when it is not.

        `analyse_plan` reports every few positions, which is the interesting half. The
        timeout is the other half: one very deep position is a long silence, and a silence
        is what the server's stale sweep collects.
        """
        while True:
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(job.moved.wait(), self._heartbeat)
            job.moved.clear()
            sink = self._sink
            if sink is None:
                continue
            try:
                alive = await sink.progress(job.run_id, job.attempt_token, job.done, job.total)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.debug("run %s: progress could not be sent: %s", job.run_id, _message(exc))
                continue
            if not alive:
                # Cancelling from here would deadlock — the job's own task waits on this
                # one — so the handover goes onto a task of its own.
                self._spawn(self._abandon(job.run_id, "the server has taken it back"))
                return

    async def _answer(self, job: Job, evals: list[MoveEval], note: str | None) -> None:
        if job.abandoned:
            return
        sink = self._sink
        if sink is None:
            logger.warning(
                "run %s finished with no link to report it on; the server will requeue it",
                job.run_id,
            )
            return
        await sink.complete(job.run_id, job.attempt_token, evals, note)
        logger.info("run %s finished: %s evaluation(s)%s", job.run_id, len(evals), _note(note))

    async def _answer_failure(self, job: Job, error: str, stderr: str | None) -> None:
        if job.abandoned:
            return
        logger.warning("run %s failed: %s", job.run_id, error)
        await self._report_failure(job.run_id, job.attempt_token, error, stderr=stderr)

    async def _report_failure(
        self, run_id: int, token: str, error: str, *, stderr: str | None = None, retry: bool = True
    ) -> None:
        sink = self._sink
        if sink is None:
            logger.warning("run %s failed with no link to report it on: %s", run_id, error)
            return
        with contextlib.suppress(Exception):
            await sink.failed(run_id, token, error, stderr, retry)

    async def _abandon(self, run_id: int, reason: str, *, answer: bool = True) -> None:
        """Stop working on a run and say nothing more about it."""
        job = self._runs.pop(run_id, None)
        if job is None:
            return
        job.abandoned = True
        task = job.task
        if task is not None and task is not asyncio.current_task():
            task.cancel()
            with contextlib.suppress(BaseException):
                await task
        logger.info("run %s abandoned: %s", run_id, reason)
        if answer and self._socket is not None:
            await self._send_quietly(protocol.run_cancelled(run_id=run_id))

    # --- the poll fallback ------------------------------------------------------

    async def _poll_session(self) -> None:
        """Poll for work until it is time to try the socket again.

        One session is a whole stint of polling rather than one request, so the retry
        window is a plain deadline and the caller's loop stays the same shape it has for
        the socket.
        """
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self.config.reconnect.retry_websocket_seconds
        self._poll_seconds = self.config.poll_seconds
        logger.info(
            "polling %s every %.1fs (jobs only, no streams)",
            self.config.poll_url,
            self._poll_seconds,
        )
        http = self._http(self.config)
        async with http:
            self._sink = PollSink(self, http)
            try:
                announced = False
                while not self._stopping.is_set() and loop.time() < deadline:
                    answer = await self._poll(http, announce=not announced)
                    if answer is not None:
                        await self._absorb(answer, announced=announced)
                        announced = True
                    await self._pause(self._poll_seconds)
            finally:
                self._sink = None

    async def _poll(self, http: Any, *, announce: bool) -> dict[str, Any] | None:
        body: dict[str, Any] = {
            "proto": protocol.PROTO_VERSION,
            "runner": self.config.name,
            "version": __version__,
            "slots": self.config.slots,
            "free_slots": max(0, self.config.slots - len(self._runs)),
            "active_runs": [job.active for job in self._runs.values()],
        }
        if announce:
            body["engines"] = [ad.as_dict() for ad in self._ads]
        try:
            response = await http.post(self.config.poll_url, json=body)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("the poll to %s failed: %s", self.config.poll_url, _message(exc))
            return None
        if response.status_code in (401, 403):
            raise RunnerRefused(
                f"{self.config.server} does not know this runner's token", EXIT_CONFIG
            )
        if response.status_code == 426:
            raise RunnerRefused(_detail(response), EXIT_REFUSED)
        if response.status_code == 429:
            logger.warning("the server is rate limiting this runner: %s", _detail(response))
            return None
        if response.status_code >= 400:
            logger.warning("the poll was refused (%s): %s", response.status_code, _detail(response))
            return None
        return dict(response.json())

    async def _absorb(self, answer: Mapping[str, Any], *, announced: bool) -> None:
        self._runner_id = answer.get("runner_id")
        self._poll_seconds = float(answer.get("poll_seconds") or self.config.poll_seconds)
        if not announced:
            logger.info(
                "connected to %s as runner %s (%r) over polling",
                self.config.server,
                self._runner_id,
                answer.get("runner") or self.config.name,
            )
            self._note_engines(answer.get("engines") or ())
        for run_id in answer.get("cancel") or ():
            await self._abandon(int(run_id), "the server cancelled it", answer=False)
        for entry in answer.get("dispatch") or ():
            await self._on_dispatch(entry)

    def _upgrade(self) -> None:
        """Come back off the fallback: the poll session's retry window has run out."""
        if self._stopping.is_set():
            return
        self._polling = False
        logger.info("trying the websocket again")

    # --- odds and ends ------------------------------------------------------------

    def _probe_summary(self) -> str:
        if not self.config.engines:
            return "this runner advertises no engines; add an `engines:` entry to the yaml"
        if not self._ads:
            return "not one configured engine could be started; there is nothing to advertise"
        return f"{', '.join(self._unprobed)} could not be started and will not be advertised"

    def _spawn(self, coroutine: Any) -> asyncio.Task[Any]:
        task = asyncio.ensure_future(coroutine)
        self._background.add(task)
        task.add_done_callback(self._background.discard)
        return task

    async def _pause(self, seconds: float) -> None:
        """Wait, unless something asks this process to stop first."""
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self._stopping.wait(), max(0.0, seconds))

    async def _shutdown(self) -> None:
        """Give up every slot and stop the engines. The server requeues what was in flight."""
        for run_id in list(self._runs):
            await self._abandon(run_id, "this runner is shutting down", answer=False)
        await self._drop_streams()
        for task in list(self._background):
            task.cancel()
            with contextlib.suppress(BaseException):
                await task
        if self._owns_pool and self._pool is not None:
            await self._pool.close()
            self._pool = None
        logger.info("runner %r stopped", self.config.name)


# --- reading what came back ----------------------------------------------------


def _spec(engine: EngineConfig) -> EngineSpec:
    """The pool key for one configured engine. Changing an option is a new process."""
    return EngineSpec.build(
        engine.path, kind=engine.kind, options=dict(engine.options), name=engine.name
    )


def _board(fen: str) -> Any:
    """A server-sent FEN as a board, or a `ValueError` naming what is wrong with it."""
    from backend.services.explorer import read_fen

    text = (fen or "").strip()
    if not text:
        raise ValueError("an analysis board needs a FEN")
    return read_fen(text)


def _close_code(exc: BaseException) -> int | None:
    """The websocket close code behind a failed receive, however the library spells it.

    The received close frame first and the sent one second — a server that says 4426 is
    telling this process to stop, and a close this side began is not. Read one at a time:
    `ConnectionClosed.code` is deprecated and touching it at all is a warning.
    """
    for frame in (getattr(exc, "rcvd", None), getattr(exc, "sent", None)):
        code = getattr(frame, "code", None)
        if isinstance(code, int):
            return code
    code = vars(exc).get("code")
    return code if isinstance(code, int) else None


def _detail(response: Any) -> str:
    try:
        body = response.json()
    except Exception:
        return response.text[:200]
    if isinstance(body, Mapping):
        return str(body.get("detail") or body.get("error") or body)
    return str(body)


def _stderr_of(adapter: Any) -> str | None:
    tail = getattr(adapter, "stderr_tail", None)
    if tail is None:
        return None
    try:
        return tail()
    except Exception:
        return None


def _message(exc: BaseException) -> str:
    text = str(exc).strip()
    return f"{type(exc).__name__}: {text}" if text else type(exc).__name__


def _note(note: str | None) -> str:
    return "" if note is None else f" ({note})"


def _stamp(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return time.time()
