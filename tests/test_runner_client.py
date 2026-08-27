"""The real `blunderbase-runner` against a real server, plus the bits with no server in them.

Two halves, deliberately:

- **End to end.** A `RunnerClient` with a scripted UCI engine, dialling a `create_app` under
  a real uvicorn on a real port. No fakes anywhere in the path: the frames go over a socket,
  the plan is encoded and decoded, the engine is a subprocess, and the assertions are on the
  rows the server wrote. This is what proves the two halves of `protocol.py` agree.
- **With a scripted socket.** Reconnects, cancellations and the fallback to polling are
  about *when* things happen, and staging them through a real server would be a test about
  timing rather than behaviour. `ScriptedSocket` hands the test the runner's outbox and lets
  it write the inbox.
"""

from __future__ import annotations

import asyncio
import contextlib
import threading
import time
from collections.abc import AsyncIterator, Callable, Iterator
from contextlib import asynccontextmanager, contextmanager
from pathlib import Path
from typing import Any

import pytest

from backend.api.app import create_app
from backend.config import Settings
from backend.db.enums import RunStatus, Tier
from backend.db.models import Engine
from backend.db.session import get_sessionmaker
from backend.runners import protocol
from backend.runners.client import (
    EXIT_CONFIG,
    EXIT_OK,
    EXIT_REFUSED,
    RunnerClient,
    backoff_delays,
)
from backend.runners.config import Reconnect, RunnerConfig
from backend.services import analysis
from backend.services import runners as runners_service
from tests.fake_uci import STOCKFISH_OPTIONS, fake_engine_command

# How long a test waits for something that crosses a thread, a socket and a subprocess.
SETTLE_SECONDS = 30.0
STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

FAST_RECONNECT = {
    "initial_seconds": 0.02,
    "max_seconds": 0.05,
    "websocket_failures": 2,
    "retry_websocket_seconds": 30.0,
}


# --- a server on a real port -------------------------------------------------


@contextmanager
def serving(app: Any) -> Iterator[str]:
    """The app under uvicorn on its own thread, and the URL it answers on.

    A `TestClient` would not do here: the point of these tests is the client's own socket
    and its own HTTP, and both want a port to dial rather than an ASGI callable.
    """
    import uvicorn

    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning"))
    thread = threading.Thread(target=server.run, name="runner-test-server", daemon=True)
    thread.start()
    deadline = time.monotonic() + SETTLE_SECONDS
    while not server.started:
        if time.monotonic() > deadline or not thread.is_alive():  # pragma: no cover - a hang
            raise AssertionError("the test server never started")
        time.sleep(0.02)
    port = server.servers[0].sockets[0].getsockname()[1]
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(SETTLE_SECONDS)


@pytest.fixture()
def server(settings: Settings) -> Iterator[str]:
    """A Blunderbase with no local workers: every run in here belongs to the runner."""
    settings.analysis_workers = False
    settings.runner_heartbeat_seconds = 1.0
    settings.runner_stale_sweep_seconds = 60.0
    with serving(create_app(settings)) as base_url:
        yield base_url


@pytest.fixture(autouse=True)
def _fresh_limiter() -> Iterator[None]:
    runners_service.reset_limiter()
    yield
    runners_service.reset_limiter()


def register(settings: Settings, name: str = "gpu-box", slots: int = 2) -> str:
    """A runner row and its one-time token, the way `blunderbase runners create` mints one."""
    with get_sessionmaker(settings)() as session:
        _runner, token = runners_service.create_runner(session, name, slots=slots)
        return token


def config_for(
    server: str, token: str, tmp_path: Path, *, engines: list[dict[str, Any]] | None = None,
    **changes: Any,
) -> RunnerConfig:
    if engines is None:
        engines = [{"name": "sf-remote", "path": scripted_engine(tmp_path), "tier": "deep"}]
    return RunnerConfig.from_mapping(
        {
            "server": server,
            "token": token,
            "name": "gpu-box",
            "slots": 2,
            "reconnect": FAST_RECONNECT,
            "engines": engines,
            **changes,
        },
        source="<test>",
    )


def scripted_engine(tmp_path: Path, **scenario: Any) -> str:
    """One fake UCI binary, as a command line an `EngineConfig` can carry."""
    return fake_engine_command(
        tmp_path, name="FakeFish 1", options=STOCKFISH_OPTIONS, **scenario
    )


@asynccontextmanager
async def running(client: RunnerClient) -> AsyncIterator[asyncio.Task[int]]:
    """The client's own loop, stopped and awaited however the test leaves it."""
    task = asyncio.ensure_future(client.run())
    try:
        yield task
    finally:
        await client.stop()
        with contextlib.suppress(BaseException):
            await asyncio.wait_for(task, SETTLE_SECONDS)


async def eventually(check: Callable[[], Any], what: str, timeout: float = SETTLE_SECONDS) -> Any:
    deadline = time.monotonic() + timeout
    last: Any = None
    while time.monotonic() < deadline:
        last = check()
        if last:
            return last
        await asyncio.sleep(0.05)
    raise AssertionError(f"{what} never happened (the last look said {last!r})")


def engine_row(settings: Settings, name: str) -> Engine | None:
    from sqlalchemy import select

    with get_sessionmaker(settings)() as session:
        return session.scalars(select(Engine).where(Engine.name == name)).first()


def enqueue(settings: Settings, engine_id: int, tier: Tier = Tier.DEEP) -> int:
    """A one-position run bound to the runner's engine, straight into the queue."""
    with get_sessionmaker(settings)() as session:
        run = analysis.request_analysis(
            session, fen=STARTING_FEN, tier=tier, engine_id=engine_id
        )
        return run.id


def run_state(settings: Settings, run_id: int) -> tuple[RunStatus, str | None, str | None]:
    with get_sessionmaker(settings)() as session:
        run = analysis.require_run(session, run_id)
        return run.status, run.error, run.stderr


# --- end to end ---------------------------------------------------------------


async def test_a_runner_advertises_its_engines_and_drains_a_run(
    server: str, settings: Settings, tmp_path: Path
) -> None:
    token = register(settings)
    client = RunnerClient(config_for(server, token, tmp_path))

    async with running(client):
        engine = await eventually(
            lambda: engine_row(settings, "sf-remote"), "the engine was registered"
        )
        assert engine.runner_id is not None
        assert engine.path.endswith(".json"), "the ad carries the path on the runner"
        assert engine.version == "FakeFish 1", "the runner's own probe named the binary"
        assert engine.options == {}

        run_id = enqueue(settings, engine.id)
        await eventually(
            lambda: run_state(settings, run_id)[0] is RunStatus.DONE, f"run {run_id} finished"
        )

    with get_sessionmaker(settings)() as session:
        rows = analysis.get_move_evals(session, run_id)
    assert len(rows) == 1
    assert rows[0].best_move_uci == "e2e4"
    assert rows[0].eval_before_cp == 21
    assert rows[0].best_lines == [{"multipv": 1, "cp": 21, "mate": None, "pv": ["e2e4", "e7e5"]}]


async def test_an_engine_that_dies_comes_back_as_a_failure_with_its_last_words(
    server: str, settings: Settings, tmp_path: Path
) -> None:
    token = register(settings)
    path = scripted_engine(tmp_path, go_default={"crash": True, "stderr": "Segmentation fault"})
    client = RunnerClient(
        config_for(server, token, tmp_path, engines=[{"name": "sf-remote", "path": path}])
    )

    async with running(client):
        engine = await eventually(
            lambda: engine_row(settings, "sf-remote"), "the engine was registered"
        )
        run_id = enqueue(settings, engine.id)
        # One retry, so the second crash is what finally fails it.
        await eventually(
            lambda: run_state(settings, run_id)[0] is RunStatus.FAILED, f"run {run_id} failed"
        )

    _status, error, stderr = run_state(settings, run_id)
    assert "analysis failed" in error
    assert "Segmentation fault" in stderr


async def test_the_poll_fallback_drains_the_queue_when_the_socket_will_not_open(
    server: str, settings: Settings, tmp_path: Path
) -> None:
    """The socket is broken and the HTTP is not; the work still gets done."""
    token = register(settings)

    async def refused(_config: RunnerConfig) -> Any:
        raise ConnectionRefusedError("this machine cannot hold a socket open")

    config = config_for(server, token, tmp_path, poll_seconds=0.1)
    client = RunnerClient(config, connect=refused)

    async with running(client):
        await eventually(lambda: client.polling, "the runner fell back to polling")
        engine = await eventually(
            lambda: engine_row(settings, "sf-remote"), "the engine was registered over polling"
        )
        run_id = enqueue(settings, engine.id)
        await eventually(
            lambda: run_state(settings, run_id)[0] is RunStatus.DONE, f"run {run_id} finished"
        )

    with get_sessionmaker(settings)() as session:
        assert len(analysis.get_move_evals(session, run_id)) == 1


async def test_check_probes_connects_and_says_what_was_accepted(
    server: str, settings: Settings, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    token = register(settings)
    client = RunnerClient(config_for(server, token, tmp_path))

    status = await client.check()

    printed = capsys.readouterr().out
    assert status == EXIT_OK
    assert "welcomed 'gpu-box'" in printed
    assert "sf-remote: accepted as engine" in printed


async def test_check_refuses_a_token_nobody_minted(
    server: str, settings: Settings, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    client = RunnerClient(config_for(server, "bb_rnr_nonsense", tmp_path))

    status = await client.check()

    assert status == EXIT_CONFIG
    assert "unauthorized" in capsys.readouterr().out


async def test_check_will_not_advertise_an_engine_it_cannot_start(
    server: str, settings: Settings, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    token = register(settings)
    client = RunnerClient(
        config_for(
            server, token, tmp_path, engines=[{"name": "sf-remote", "path": "/nowhere/stockfish"}]
        )
    )

    status = await client.check()

    assert status == EXIT_CONFIG
    assert "nothing to advertise" in capsys.readouterr().out


# --- the reconnect arithmetic --------------------------------------------------


def test_the_backoff_doubles_and_then_holds_at_the_ceiling() -> None:
    delays = backoff_delays(
        Reconnect(initial_seconds=1.0, max_seconds=16.0), rand=lambda: 1.0
    )

    assert [next(delays) for _ in range(7)] == [1.0, 2.0, 4.0, 8.0, 16.0, 16.0, 16.0]


def test_half_of_every_delay_is_jitter() -> None:
    """A fleet coming back together must not dial in lockstep."""
    reconnect = Reconnect(initial_seconds=1.0, max_seconds=16.0)
    earliest = backoff_delays(reconnect, rand=lambda: 0.0)
    latest = backoff_delays(reconnect, rand=lambda: 1.0)

    assert [next(earliest) for _ in range(4)] == [0.5, 1.0, 2.0, 4.0]
    assert [next(latest) for _ in range(4)] == [1.0, 2.0, 4.0, 8.0]


# --- a socket the test writes ---------------------------------------------------


class ScriptedSocket:
    """One connection, with the runner's outbox readable and its inbox writable."""

    def __init__(self) -> None:
        self.incoming: asyncio.Queue[Any] = asyncio.Queue()
        self.sent: list[dict[str, Any]] = []
        self.closed = False

    async def send(self, text: str) -> None:
        self.sent.append(protocol.decode(text))

    async def recv(self) -> str:
        item = await self.incoming.get()
        if isinstance(item, BaseException):
            raise item
        return protocol.encode(item)

    async def close(self) -> None:
        self.closed = True
        # A close has to unblock a receive, exactly as a real socket's does.
        self.incoming.put_nowait(ConnectionResetError("the link was closed"))

    def push(self, frame: dict[str, Any] | BaseException) -> None:
        self.incoming.put_nowait(frame)

    def of_type(self, kind: str) -> list[dict[str, Any]]:
        return [frame for frame in self.sent if frame.get("type") == kind]

    async def wait_for(self, kind: str, timeout: float = 10.0) -> dict[str, Any]:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            found = self.of_type(kind)
            if found:
                return found[-1]
            await asyncio.sleep(0.01)
        raise AssertionError(f"the runner never sent a {kind} (it sent {self.kinds()})")

    def kinds(self) -> list[str]:
        return [str(frame.get("type")) for frame in self.sent]


class Sockets:
    """Hands out one `ScriptedSocket` per connection attempt, and remembers them all."""

    def __init__(self) -> None:
        self.opened: list[ScriptedSocket] = []
        self.attempts = 0

    async def __call__(self, _config: RunnerConfig) -> ScriptedSocket:
        self.attempts += 1
        socket = ScriptedSocket()
        self.opened.append(socket)
        return socket

    async def latest(self, index: int, timeout: float = 10.0) -> ScriptedSocket:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if len(self.opened) > index:
                return self.opened[index]
            await asyncio.sleep(0.01)
        raise AssertionError(f"only {len(self.opened)} connection(s) were ever opened")


def welcome(**changes: Any) -> dict[str, Any]:
    frame = protocol.welcome(
        runner_id=3,
        runner="gpu-box",
        server_version="0.1.0",
        slots=2,
        heartbeat_seconds=0.05,
        engines=[protocol.accepted_engine("sf-remote", 7, True)],
    )
    return {**frame, **changes}


def dispatch(run_id: int, token: str, *, engine: str = "sf-remote") -> dict[str, Any]:
    plan = analysis.RunPlan(
        run_id=run_id,
        tier=Tier.DEEP,
        game_id=None,
        fen=STARTING_FEN,
        variant="standard",
        initial_fen=STARTING_FEN,
        moves_uci=(),
        moves_san=(),
        position_ids=(None,),
        ply_start=0,
        ply_end=0,
        nodes=1000,
        depth=None,
        multipv=1,
        thresholds=analysis.Thresholds(inaccuracy=10.0, mistake=20.0, blunder=30.0),
    )
    return protocol.run_dispatch(
        run_id=run_id,
        attempt_token=token,
        engine=engine,
        plan=protocol.encode_plan(plan),
    )


def scripted_client(tmp_path: Path, sockets: Sockets, **scenario: Any) -> RunnerClient:
    config = RunnerConfig.from_mapping(
        {
            "server": "http://127.0.0.1:1",
            "token": "bb_rnr_x",
            "name": "gpu-box",
            "slots": 2,
            "reconnect": FAST_RECONNECT,
            "engines": [{"name": "sf-remote", "path": scripted_engine(tmp_path, **scenario)}],
        },
        source="<test>",
    )
    return RunnerClient(config, connect=sockets)


async def test_the_hello_carries_the_engines_this_machine_probed(
    tmp_path: Path,
) -> None:
    sockets = Sockets()
    client = scripted_client(tmp_path, sockets)

    async with running(client):
        socket = await sockets.latest(0)
        hello = await socket.wait_for(protocol.HELLO)

    assert hello["proto"] == protocol.PROTO_VERSION
    assert (hello["runner"], hello["slots"], hello["active_runs"]) == ("gpu-box", 2, [])
    advertised = hello["engines"][0]
    assert advertised["name"] == "sf-remote"
    assert advertised["version"] == "FakeFish 1"
    assert advertised["streams"] is True
    assert {option["name"] for option in advertised["declared_options"]} >= {"Threads", "Hash"}


async def test_a_ping_is_answered_with_the_stamp_it_carried(tmp_path: Path) -> None:
    sockets = Sockets()
    client = scripted_client(tmp_path, sockets)

    async with running(client):
        socket = await sockets.latest(0)
        await socket.wait_for(protocol.HELLO)
        socket.push(welcome())
        socket.push(protocol.ping(1756209600.5))
        pong = await socket.wait_for(protocol.PONG)

    assert pong == {"type": protocol.PONG, "t": 1756209600.5}


async def test_a_run_is_computed_and_answered_with_its_evaluations(tmp_path: Path) -> None:
    sockets = Sockets()
    client = scripted_client(tmp_path, sockets)

    async with running(client):
        socket = await sockets.latest(0)
        await socket.wait_for(protocol.HELLO)
        socket.push(welcome())
        socket.push(dispatch(12, "9f3c1a"))
        answer = await socket.wait_for(protocol.RUN_COMPLETE)

    assert (answer["run_id"], answer["attempt_token"]) == (12, "9f3c1a")
    assert answer["evals"][0]["best_move_uci"] == "e2e4"
    # Progress doubles as the run's heartbeat, so it goes out before the answer does.
    assert socket.of_type(protocol.RUN_PROGRESS)


async def test_a_run_for_an_engine_this_machine_does_not_have_is_failed_by_name(
    tmp_path: Path,
) -> None:
    sockets = Sockets()
    client = scripted_client(tmp_path, sockets)

    async with running(client):
        socket = await sockets.latest(0)
        await socket.wait_for(protocol.HELLO)
        socket.push(welcome())
        socket.push(dispatch(12, "9f3c1a", engine="sf-elsewhere"))
        failure = await socket.wait_for(protocol.RUN_FAILED)

    assert "'sf-elsewhere' is not a search engine this runner has" in failure["error"]
    assert failure["retry"] is True


async def test_a_cancel_stops_the_search_and_is_confirmed(tmp_path: Path) -> None:
    sockets = Sockets()
    # Long enough that the cancel lands while the engine is still thinking.
    client = scripted_client(tmp_path, sockets, go_default={"delay": 5.0, "bestmove": "e2e4"})

    async with running(client):
        socket = await sockets.latest(0)
        await socket.wait_for(protocol.HELLO)
        socket.push(welcome())
        socket.push(dispatch(12, "9f3c1a"))
        await eventually(lambda: 12 in client.runs, "the run reached a slot")
        socket.push(protocol.run_cancel(run_id=12, reason="preempted"))
        confirmed = await socket.wait_for(protocol.RUN_CANCELLED)

    assert confirmed["run_id"] == 12
    assert client.runs == {}
    assert protocol.RUN_COMPLETE not in socket.kinds(), "an abandoned run reports nothing"


async def test_a_reconnect_says_what_it_is_still_executing(tmp_path: Path) -> None:
    """The server reconciles against this list; a run left out of it goes back to the queue."""
    sockets = Sockets()
    client = scripted_client(tmp_path, sockets, go_default={"delay": 5.0, "bestmove": "e2e4"})

    async with running(client):
        first = await sockets.latest(0)
        await first.wait_for(protocol.HELLO)
        first.push(welcome())
        first.push(dispatch(12, "9f3c1a"))
        await eventually(lambda: 12 in client.runs, "the run reached a slot")

        first.push(ConnectionResetError("the socket dropped"))
        second = await sockets.latest(1)
        hello = await second.wait_for(protocol.HELLO)

    assert hello["active_runs"] == [{"run_id": 12, "attempt_token": "9f3c1a"}]


async def test_a_run_the_server_takes_back_at_the_welcome_is_dropped(tmp_path: Path) -> None:
    sockets = Sockets()
    client = scripted_client(tmp_path, sockets, go_default={"delay": 5.0, "bestmove": "e2e4"})

    async with running(client):
        first = await sockets.latest(0)
        await first.wait_for(protocol.HELLO)
        first.push(welcome())
        first.push(dispatch(12, "9f3c1a"))
        await eventually(lambda: 12 in client.runs, "the run reached a slot")

        first.push(ConnectionResetError("the socket dropped"))
        second = await sockets.latest(1)
        await second.wait_for(protocol.HELLO)
        second.push(welcome(cancelled_runs=[12]))
        await eventually(lambda: client.runs == {}, "the run was let go")

    assert protocol.RUN_COMPLETE not in second.kinds()


async def test_a_protocol_the_server_will_not_speak_stops_the_process(tmp_path: Path) -> None:
    sockets = Sockets()
    client = scripted_client(tmp_path, sockets)

    task = asyncio.ensure_future(client.run())
    try:
        socket = await sockets.latest(0)
        await socket.wait_for(protocol.HELLO)
        socket.push(
            protocol.error(
                protocol.ERROR_PROTO_MISMATCH, "this server speaks runner protocol 2", fatal=True
            )
        )
        status = await asyncio.wait_for(task, SETTLE_SECONDS)
    finally:
        await client.stop()

    assert status == EXIT_REFUSED, "a version skew is worth telling apart from a bad password"


async def test_a_token_the_server_refuses_stops_the_process(tmp_path: Path) -> None:
    sockets = Sockets()
    client = scripted_client(tmp_path, sockets)

    task = asyncio.ensure_future(client.run())
    try:
        socket = await sockets.latest(0)
        await socket.wait_for(protocol.HELLO)
        socket.push(
            protocol.error(protocol.ERROR_UNAUTHORIZED, "that is not a runner token", fatal=True)
        )
        status = await asyncio.wait_for(task, SETTLE_SECONDS)
    finally:
        await client.stop()

    assert status == EXIT_CONFIG


async def test_enough_socket_failures_and_the_runner_starts_polling(tmp_path: Path) -> None:
    attempts = 0

    async def refused(_config: RunnerConfig) -> Any:
        nonlocal attempts
        attempts += 1
        raise ConnectionRefusedError("no socket here")

    posted: list[str] = []

    class Poller:
        async def __aenter__(self) -> Poller:
            return self

        async def __aexit__(self, *_: object) -> None:
            return None

        async def post(self, url: str, json: dict[str, Any]) -> Any:
            posted.append(url)
            raise ConnectionRefusedError("nor here, but the runner keeps trying")

    sockets = Sockets()
    client = scripted_client(tmp_path, sockets)
    client = RunnerClient(client.config, connect=refused, http=lambda _config: Poller())

    async with running(client):
        await eventually(lambda: client.polling, "the runner fell back to polling")
        await eventually(lambda: posted, "the runner polled")

    assert attempts == client.config.reconnect.websocket_failures
    assert posted[0].endswith("/runner/poll")


async def test_a_session_that_was_welcomed_and_then_dropped_is_not_a_socket_failure(
    tmp_path: Path,
) -> None:
    """`websocket_failures` counts failures to *connect*. A server restart closes with 1012
    and a proxy with nothing at all, and neither says the socket does not work — falling
    back on them costs this machine its analysis boards for no reason at all."""
    sockets = Sockets()
    client = scripted_client(tmp_path, sockets)
    drops = client.config.reconnect.websocket_failures * 2

    async with running(client):
        for attempt in range(drops):
            socket = await sockets.latest(attempt)
            await socket.wait_for(protocol.HELLO)
            # Welcomed first: the queue is FIFO, so the drop lands behind it.
            socket.push(welcome())
            socket.push(ConnectionResetError("the server was redeployed"))
        # It kept dialling the socket rather than reaching for the fallback.
        await sockets.latest(drops)
        assert client.polling is False


async def test_polling_goes_back_to_the_socket_when_the_retry_window_runs_out(
    tmp_path: Path,
) -> None:
    """The fallback is a fallback, not a decision: the socket is worth another try."""
    sockets = Sockets()
    base = scripted_client(tmp_path, sockets)
    config = RunnerConfig.from_mapping(
        {
            "server": base.config.server,
            "token": base.config.token,
            "name": base.config.name,
            "reconnect": {**FAST_RECONNECT, "websocket_failures": 1,
                          "retry_websocket_seconds": 0.05},
            "engines": [{"name": engine.name, "path": engine.path} for engine in
                        base.config.engines],
        },
        source="<test>",
    )

    attempts = 0

    async def refused(_config: RunnerConfig) -> Any:
        nonlocal attempts
        attempts += 1
        raise ConnectionRefusedError("no socket here")

    class Poller:
        async def __aenter__(self) -> Poller:
            return self

        async def __aexit__(self, *_: object) -> None:
            return None

        async def post(self, _url: str, json: dict[str, Any]) -> Any:
            raise ConnectionRefusedError("nor here")

    client = RunnerClient(config, connect=refused, http=lambda _config: Poller())

    async with running(client):
        await eventually(lambda: client.polling, "the runner fell back to polling")
        await eventually(lambda: attempts >= 3, "the socket was tried again")

    assert attempts >= 3


# --- analysis boards --------------------------------------------------------------

AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"

# One reply per `go`, each holding the search open until `stop` — which is what
# `go infinite` looks like — and each answering with a move legal on its own board.
HOLDING = [
    {
        "info": ["depth 12 score cp 31 nodes 4000 nps 8000 time 500 pv e2e4 e7e5"],
        "hold": True,
        "bestmove": "e2e4",
    },
    {
        "info": ["depth 9 score cp -18 nodes 2500 nps 5000 time 500 pv e7e5 g1f3"],
        "hold": True,
        "bestmove": "e7e5",
    },
]


async def snapshot_where(
    socket: ScriptedSocket, check: Callable[[dict[str, Any]], bool], timeout: float = 10.0
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for frame in socket.of_type(protocol.STREAM_SNAPSHOT):
            if check(frame):
                return frame
        await asyncio.sleep(0.02)
    raise AssertionError("no snapshot of that position ever arrived")


async def test_a_board_is_opened_moved_and_closed_on_the_same_engine(tmp_path: Path) -> None:
    """The runner's half of infinite analysis, in the protocol's own vocabulary."""
    sockets = Sockets()
    client = scripted_client(tmp_path, sockets, go=HOLDING)

    async with running(client):
        socket = await sockets.latest(0)
        await socket.wait_for(protocol.HELLO)
        socket.push(welcome())
        socket.push(
            protocol.stream_open(
                session_id="str_7f3c",
                engine="sf-remote",
                fen=STARTING_FEN,
                multipv=1,
                interval_ms=1,
            )
        )
        started = await socket.wait_for(protocol.STREAM_STARTED)
        first = await snapshot_where(socket, lambda frame: bool(frame["lines"]))

        socket.push(protocol.stream_restart(session_id="str_7f3c", fen=AFTER_E4))
        moved = await snapshot_where(
            socket, lambda frame: bool(frame["lines"]) and frame["lines"][0]["cp"] == -18
        )

        socket.push(protocol.stream_close(session_id="str_7f3c", reason="closed"))
        closed = await socket.wait_for(protocol.STREAM_CLOSED)

    assert (started["session_id"], started["engine"]) == ("str_7f3c", "sf-remote")
    assert first["depth"] == 12
    assert first["lines"][0] == {"multipv": 1, "cp": 31, "mate": None, "pv": ["e2e4", "e7e5"]}
    # A position change is stop-and-go on the same slot; the runner never gave the engine up.
    assert moved["lines"][0]["pv"] == ["e7e5", "g1f3"]
    assert moved["seq"] > first["seq"]
    assert closed["reason"] == "closed"
    assert client.streams == {}


async def test_a_board_on_an_engine_this_machine_has_not_got_is_refused_at_once(
    tmp_path: Path,
) -> None:
    """A board that cannot be served must be told, not left waiting for a first snapshot."""
    sockets = Sockets()
    client = scripted_client(tmp_path, sockets)

    async with running(client):
        socket = await sockets.latest(0)
        await socket.wait_for(protocol.HELLO)
        socket.push(welcome())
        socket.push(
            protocol.stream_open(
                session_id="str_7f3c", engine="sf-elsewhere", fen=STARTING_FEN
            )
        )
        refused = await socket.wait_for(protocol.STREAM_CLOSED)

    assert refused["reason"] == "engine_failed"
    assert "sf-elsewhere" in refused["error"]
    assert protocol.STREAM_STARTED not in socket.kinds()


async def test_closing_a_board_that_is_still_waiting_for_an_engine_does_not_stall_the_link(
    tmp_path: Path,
) -> None:
    """A close is awaited on the receive loop. A task still queued behind the pool's
    semaphore reads neither of the session's flags, so waiting for it would cost this
    runner its pongs — and a runner that stops answering is one the server drops."""
    sockets = Sockets()
    config = RunnerConfig.from_mapping(
        {
            "server": "http://127.0.0.1:1",
            "token": "bb_rnr_x",
            "name": "gpu-box",
            # One slot, so the second board has nowhere to go until the first lets go.
            "slots": 1,
            "reconnect": FAST_RECONNECT,
            "engines": [{"name": "sf-remote", "path": scripted_engine(tmp_path, go=HOLDING)}],
        },
        source="<test>",
    )
    client = RunnerClient(config, connect=sockets)

    async with running(client):
        socket = await sockets.latest(0)
        await socket.wait_for(protocol.HELLO)
        socket.push(welcome())
        socket.push(
            protocol.stream_open(
                session_id="str_one", engine="sf-remote", fen=STARTING_FEN, interval_ms=1
            )
        )
        await socket.wait_for(protocol.STREAM_STARTED)

        socket.push(
            protocol.stream_open(
                session_id="str_two", engine="sf-remote", fen=AFTER_E4, interval_ms=1
            )
        )
        await eventually(lambda: "str_two" in client.streams, "the second board was taken on")
        socket.push(protocol.stream_close(session_id="str_two", reason="closed"))
        socket.push(protocol.ping(1756209600.5))

        pong = await socket.wait_for(protocol.PONG)

    assert pong["t"] == 1756209600.5
    assert "str_two" not in client.streams


async def test_a_board_does_not_outlive_the_link_it_was_opened_on(tmp_path: Path) -> None:
    """The server ends the session when the runner drops, so holding the engine is waste."""
    sockets = Sockets()
    client = scripted_client(tmp_path, sockets, go=HOLDING)

    async with running(client):
        first = await sockets.latest(0)
        await first.wait_for(protocol.HELLO)
        first.push(welcome())
        first.push(
            protocol.stream_open(
                session_id="str_7f3c", engine="sf-remote", fen=STARTING_FEN, interval_ms=1
            )
        )
        await first.wait_for(protocol.STREAM_STARTED)

        first.push(ConnectionResetError("the socket dropped"))
        await sockets.latest(1)
        await eventually(lambda: client.streams == {}, "the board was given up")


# --- the console script ----------------------------------------------------------


def test_the_entrypoint_refuses_a_configuration_it_cannot_read(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    from backend.runners import entrypoint

    monkeypatch.delenv("BLUNDERBASE_RUNNER_CONFIG", raising=False)

    status = entrypoint.main(["--config", str(tmp_path / "absent.yaml")])

    assert status == EXIT_CONFIG
    assert "no such file" in capsys.readouterr().err


def test_the_entrypoint_answers_version_without_a_configuration() -> None:
    from backend.runners import entrypoint

    with pytest.raises(SystemExit) as exited:
        entrypoint.main(["--version"])

    assert exited.value.code == 0


# --- dialling out ----------------------------------------------------------------


def test_open_socket_only_passes_ssl_for_the_unverified_case(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """websockets>=14 reads an explicit `ssl=None` as "no TLS" and refuses it for wss://,
    so the ordinary verified connection must leave the argument out entirely."""
    import ssl as ssl_module

    import websockets.asyncio.client

    from backend.runners.client import open_socket

    calls: list[tuple[str, dict[str, Any]]] = []

    async def fake_connect(uri: str, **kwargs: Any) -> object:
        calls.append((uri, kwargs))
        return object()

    monkeypatch.setattr(websockets.asyncio.client, "connect", fake_connect)

    def dial(server: str, **changes: Any) -> tuple[str, dict[str, Any]]:
        config = config_for(server, "bb_rnr_token", tmp_path, **changes)
        asyncio.run(open_socket(config))
        return calls[-1]

    uri, kwargs = dial("https://blunderbase.example")
    assert uri == "wss://blunderbase.example/runner/ws"
    assert "ssl" not in kwargs

    uri, kwargs = dial("http://blunderbase.example")
    assert uri == "ws://blunderbase.example/runner/ws"
    assert "ssl" not in kwargs

    uri, kwargs = dial("https://blunderbase.example", verify_tls=False)
    assert isinstance(kwargs["ssl"], ssl_module.SSLContext)
    assert kwargs["ssl"].verify_mode == ssl_module.CERT_NONE
