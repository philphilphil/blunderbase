"""The gateway end to end: a runner on the real socket, speaking the real protocol.

Every test here drives `create_app`'s own app through `TestClient` — the same lifespan,
the same gateway, the same database — with `tests/fake_runner.py` standing in for the
machine at the other end. Nothing reaches into the gateway to make something happen except
where a test has to control the clock: the stale sweep is driven through the client's own
portal rather than waited for, so the assertions are about behaviour and not about timing.

The local worker set is switched off throughout. A run bound to a remote engine is not its
work, and leaving it running would only make the tests slower to read.
"""

from __future__ import annotations

import time
from collections.abc import Iterator
from datetime import timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from backend.api.app import create_app
from backend.config import Settings
from backend.db.enums import EngineKind, RunStatus
from backend.db.models import AnalysisRun, Engine, MoveEval, Runner
from backend.db.session import get_sessionmaker
from backend.db.types import utcnow
from backend.runners import protocol
from backend.services import analysis
from backend.services import runners as runners_service
from backend.workers import runner_gateway
from tests.conftest import running_app, socket_headers
from tests.fake_runner import (
    MAIA_AD,
    STOCKFISH_AD,
    FakeRunner,
    bearer,
    connect,
    eval_row,
)

ONE_GAME = """[Event "Casual Blitz game"]
[Site "https://lichess.org/upload01"]
[Date "2026.04.01"]
[White "blunderbase"]
[Black "newcomer"]
[Result "1-0"]
[WhiteElo "1750"]
[BlackElo "1600"]
[TimeControl "300+0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 1-0
"""

PLAYED = ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6", "b5a4", "g8f6"]

# How long a test waits for something the gateway does off the back of a closed socket.
SETTLE_SECONDS = 5.0
# What a claim is slowed to when a test needs one still in flight when a socket goes.
SLOW_CLAIM_SECONDS = 0.5


@pytest.fixture()
def api(settings: Settings) -> Iterator[TestClient]:
    """The app with no local workers and no sweep of its own: the tests drive both."""
    settings.analysis_workers = False
    settings.runner_heartbeat_seconds = 60.0
    settings.runner_stale_sweep_seconds = 60.0
    with running_app(create_app(settings)) as client:
        yield client


@pytest.fixture(autouse=True)
def _fresh_limiter() -> Iterator[None]:
    runners_service.reset_limiter()
    yield
    runners_service.reset_limiter()


def register(settings: Settings, name: str = "gpu-box", slots: int = 2) -> tuple[int, str]:
    """A runner row and its one-time token, the way `blunderbase runners create` mints one."""
    with get_sessionmaker(settings)() as session:
        runner, token = runners_service.create_runner(session, name, slots=slots)
        return runner.id, token


def seed_game(api: TestClient) -> int:
    started = api.post("/import/pgn", json={"text": ONE_GAME, "wait": True})
    assert started.json()["job"]["games_imported"] == 1, started.text
    return api.get("/games").json()["games"][0]["id"]


def enqueue(api: TestClient, game_id: int, engine_id: int | None, **body: Any) -> int:
    request = {"game_id": game_id, "engine_id": engine_id, **body}
    queued = api.post("/analysis", json=request)
    assert queued.status_code == 202, queued.text
    return int(queued.json()["id"])


def run_row(settings: Settings, run_id: int) -> AnalysisRun:
    with get_sessionmaker(settings)() as session:
        return analysis.require_run(session, run_id)


def wait_for(settings: Settings, run_id: int, status: RunStatus) -> AnalysisRun:
    deadline = time.monotonic() + SETTLE_SECONDS
    while time.monotonic() < deadline:
        run = run_row(settings, run_id)
        if run.status is status:
            return run
        time.sleep(0.02)
    raise AssertionError(f"run {run_id} never reached {status}: it is {run.status}")


def go_stale(settings: Settings, run_id: int) -> None:
    """Backdate a run's heartbeat past the point a sweep will collect it."""
    with get_sessionmaker(settings)() as session:
        run = analysis.require_run(session, run_id)
        run.heartbeat_at = utcnow() - timedelta(seconds=analysis.STALE_AFTER_SECONDS * 2)
        session.commit()


def until(events: Any, event: str, limit: int = 50) -> dict[str, Any]:
    """The first frame of this kind on an `/events` socket, or a failure naming what came."""
    seen: list[str] = []
    for _ in range(limit):
        frame = events.receive_json()
        seen.append(frame.get("event"))
        if frame.get("event") == event:
            return frame
    raise AssertionError(f"{event} never arrived; the socket carried {seen}")


def dispatch_for(runner: FakeRunner) -> dict[str, Any]:
    frame = runner.recv(protocol.RUN_DISPATCH)
    assert frame["attempt_token"]
    return frame


# --- the handshake ---------------------------------------------------------


def test_a_runner_that_says_hello_is_welcomed_and_its_engines_registered(
    api: TestClient, settings: Settings
) -> None:
    _runner_id, token = register(settings, "gpu-box", slots=4)

    with connect(api, token) as runner:
        welcome = runner.welcome
        with get_sessionmaker(settings)() as session:
            engine = session.scalars(select(Engine)).one()

    assert welcome["type"] == protocol.WELCOME
    assert welcome["proto"] == protocol.PROTO_VERSION
    assert welcome["runner"] == "gpu-box"
    assert welcome["slots"] == 2, "the runner claimed two of the four slots it is allowed"
    assert welcome["heartbeat_seconds"] == settings.runner_heartbeat_seconds
    assert welcome["cancelled_runs"] == []
    assert welcome["engines"] == [
        {
            "name": "sf-remote",
            "engine_id": welcome["engines"][0]["engine_id"],
            "accepted": True,
            "reason": None,
            "streams": True,
        }
    ]

    assert (engine.name, engine.path, engine.enabled) == ("sf-remote", STOCKFISH_AD["path"], True)
    assert engine.runner_id is not None
    assert engine.options == {"Threads": 8}


def test_a_connected_runner_is_recorded_and_a_disconnect_takes_its_engines_with_it(
    api: TestClient, settings: Settings
) -> None:
    runner_id, token = register(settings)

    with connect(api, token):
        with get_sessionmaker(settings)() as session:
            assert session.get(Runner, runner_id).connected is True

    deadline = time.monotonic() + SETTLE_SECONDS
    while time.monotonic() < deadline:
        with get_sessionmaker(settings)() as session:
            row = session.get(Runner, runner_id)
            engine = session.scalars(select(Engine)).one()
            if row.connected is False and engine.enabled is False:
                return
        time.sleep(0.02)
    raise AssertionError("the runner was never marked disconnected")


def test_an_engine_a_local_one_already_answers_to_is_refused_by_name(
    api: TestClient, settings: Settings
) -> None:
    """Two engines called `stockfish` and a dispatcher cannot tell which machine a run meant."""
    with get_sessionmaker(settings)() as session:
        session.add(Engine(name="sf-remote", kind=EngineKind.UCI, path="/usr/bin/stockfish"))
        session.commit()
    _runner_id, token = register(settings)

    with connect(api, token) as runner:
        entry = runner.welcome["engines"][0]

    assert entry["accepted"] is False
    assert entry["engine_id"] is None
    assert "already registered on this host" in entry["reason"]


def test_a_maia_advertisement_never_claims_to_stream(api: TestClient, settings: Settings) -> None:
    _runner_id, token = register(settings)

    with connect(api, token, engines=[STOCKFISH_AD, MAIA_AD]) as runner:
        streams = {entry["name"]: entry["streams"] for entry in runner.welcome["engines"]}

    assert streams == {"sf-remote": True, "maia-remote": False}


def test_re_advertising_replaces_what_the_runner_offered_before(
    api: TestClient, settings: Settings
) -> None:
    _runner_id, token = register(settings)

    with connect(api, token) as runner:
        runner.send(protocol.advertise_engines([{**STOCKFISH_AD, "name": "sf-other"}]))
        accepted = runner.recv(protocol.ENGINES_ACCEPTED)
        with get_sessionmaker(settings)() as session:
            enabled = {engine.name: engine.enabled for engine in session.scalars(select(Engine))}

    assert [entry["name"] for entry in accepted["engines"]] == ["sf-other"]
    # The old row is switched off rather than deleted: a run may still point at it.
    assert enabled == {"sf-remote": False, "sf-other": True}


def test_a_ping_is_answered_with_the_stamp_it_carried(
    api: TestClient, settings: Settings
) -> None:
    _runner_id, token = register(settings)

    with connect(api, token) as runner:
        runner.send(protocol.ping(1756209600.5))
        pong = runner.recv(protocol.PONG)

    assert pong == {"type": protocol.PONG, "t": 1756209600.5}


# --- refusals --------------------------------------------------------------


def test_a_token_that_is_nobody_s_is_closed_with_the_reason(api: TestClient) -> None:
    with api.websocket_connect("/runner/ws", headers=bearer("bb_rnr_nonsense")) as socket:
        runner = FakeRunner(socket)
        code, reason = runner.closed()

    assert (code, reason) == (protocol.WS_CLOSE_UNAUTHORIZED, protocol.ERROR_UNAUTHORIZED)


def test_the_runner_door_never_asks_for_the_owner_s_cookie(
    api: TestClient, settings: Settings
) -> None:
    """`/runner` is exempt from `AuthGuard`; `/runners` deliberately is not."""
    _runner_id, token = register(settings)
    api.cookies.clear()

    with connect(api, token) as runner:
        assert runner.welcome["runner_id"]


def test_a_protocol_this_server_does_not_speak_is_refused_before_any_work(
    api: TestClient, settings: Settings
) -> None:
    _runner_id, token = register(settings)

    with connect(api, token, say_hello=False) as runner:
        runner.send(protocol.hello(runner="gpu-box") | {"proto": 2})
        refusal = runner.recv(protocol.ERROR)
        code, reason = runner.closed()

    assert refusal["code"] == protocol.ERROR_PROTO_MISMATCH
    assert refusal["fatal"] is True
    assert "protocol 1" in refusal["message"]
    assert (code, reason) == (protocol.WS_CLOSE_PROTO_MISMATCH, protocol.ERROR_PROTO_MISMATCH)


def test_a_first_frame_that_is_not_a_hello_is_refused(
    api: TestClient, settings: Settings
) -> None:
    _runner_id, token = register(settings)

    with connect(api, token, say_hello=False) as runner:
        runner.send(protocol.ping(1.0))
        refusal = runner.recv(protocol.ERROR)
        code, _reason = runner.closed()

    assert refusal["code"] == protocol.ERROR_BAD_PAYLOAD
    assert code == 1008


def test_a_second_connection_takes_the_runner_over_and_closes_the_first(
    api: TestClient, settings: Settings
) -> None:
    """D8: a reconnect behind a half-open socket is the common case, so the new link wins."""
    _runner_id, token = register(settings)

    with connect(api, token) as first, connect(api, token) as second:
        assert second.welcome["runner_id"] == first.welcome["runner_id"]
        code, reason = first.closed()

    assert (code, reason) == (protocol.WS_CLOSE_DUPLICATE, protocol.ERROR_DUPLICATE_CONNECTION)


def test_a_message_the_protocol_does_not_define_is_answered_and_the_link_stays_open(
    api: TestClient, settings: Settings
) -> None:
    _runner_id, token = register(settings)

    with connect(api, token) as runner:
        runner.send({"type": "sing_a_song"})
        refusal = runner.recv(protocol.ERROR)
        runner.send(protocol.ping(2.0))
        pong = runner.recv(protocol.PONG)

    assert refusal["code"] == protocol.ERROR_UNKNOWN_MESSAGE
    assert refusal["fatal"] is False
    assert pong["t"] == 2.0


def test_a_frame_missing_what_it_needs_is_answered_and_the_link_stays_open(
    api: TestClient, settings: Settings
) -> None:
    _runner_id, token = register(settings)

    with connect(api, token) as runner:
        runner.send({"type": protocol.RUN_PROGRESS, "run_id": 1})
        refusal = runner.recv(protocol.ERROR)
        runner.socket.send_text("{not json at all")
        unusable = runner.recv(protocol.ERROR)
        runner.send(protocol.ping(3.0))
        assert runner.recv(protocol.PONG)["t"] == 3.0

    assert refusal["code"] == protocol.ERROR_BAD_PAYLOAD
    assert "attempt_token" in refusal["message"]
    assert unusable["code"] == protocol.ERROR_BAD_PAYLOAD


# --- dispatch --------------------------------------------------------------


def test_a_run_goes_out_progresses_and_comes_back_as_rows(
    api: TestClient, settings: Settings
) -> None:
    _runner_id, token = register(settings)
    game_id = seed_game(api)

    with connect(api, token) as runner:
        engine_id = runner.engine_ids["sf-remote"]
        run_id = enqueue(api, game_id, engine_id, tier="deep")

        frame = dispatch_for(runner)
        assert frame["run_id"] == run_id
        assert frame["engine"] == "sf-remote"
        assert frame["maia_engine"] is None
        plan = protocol.decode_plan(frame["plan"])
        assert list(plan.moves_uci) == PLAYED
        assert plan.run_id == run_id

        runner.progress(frame, 4, 9)
        beaten = run_row(settings, run_id)
        assert beaten.status is RunStatus.RUNNING

        rows = [eval_row(ply, move_uci=PLAYED[ply], move_san=None) for ply in range(8)]
        ack = runner.complete(frame, rows)

    assert ack == {"type": protocol.RUN_ACK, "run_id": run_id, "accepted": True, "reason": None}
    run = run_row(settings, run_id)
    assert run.status is RunStatus.DONE
    assert run.attempts == 1
    with get_sessionmaker(settings)() as session:
        stored = analysis.get_move_evals(session, run_id)
    assert [row.ply for row in stored] == list(range(8))
    assert [row.move_uci for row in stored] == PLAYED
    assert stored[0].best_lines == [{"multipv": 1, "cp": 20, "mate": None, "pv": ["e2e4", "e7e5"]}]


def test_progress_is_the_run_s_heartbeat_and_reaches_the_events_socket(
    api: TestClient, settings: Settings
) -> None:
    """A UI cannot tell a remote run from a local one, and does not need to."""
    _runner_id, token = register(settings)
    game_id = seed_game(api)

    with api.websocket_connect("/events", headers=socket_headers(api)) as events:
        with connect(api, token) as runner:
            run_id = enqueue(api, game_id, runner.engine_ids["sf-remote"])
            frame = dispatch_for(runner)
            with get_sessionmaker(settings)() as session:
                analysis.require_run(session, run_id).heartbeat_at = None
                session.commit()

            runner.progress(frame, 6, 9)
            # The beat is the same statement as the answer, so once the next frame is in
            # the runner's hands the row has already been touched.
            runner.send(protocol.ping(1.0))
            runner.recv(protocol.PONG)
            beaten = run_row(settings, run_id)
        published = until(events, analysis.EVENT_RUN_PROGRESS)

    assert beaten.heartbeat_at is not None
    assert published["run_id"] == run_id
    assert (published["done"], published["total"]) == (6, 9)
    assert published["tier"] == "quick"
    assert published["status"] == "running"


def test_a_maia_on_the_same_runner_rides_along_with_the_dispatch(
    api: TestClient, settings: Settings
) -> None:
    _runner_id, token = register(settings)
    game_id = seed_game(api)

    with connect(api, token, engines=[STOCKFISH_AD, MAIA_AD]) as runner:
        enqueue(api, game_id, runner.engine_ids["sf-remote"])
        frame = dispatch_for(runner)

    assert frame["engine"] == "sf-remote"
    assert frame["maia_engine"] == "maia-remote"


def test_a_failure_is_stored_with_its_stderr_and_the_run_is_retried(
    api: TestClient, settings: Settings
) -> None:
    _runner_id, token = register(settings)
    game_id = seed_game(api)

    with connect(api, token) as runner:
        run_id = enqueue(api, game_id, runner.engine_ids["sf-remote"])
        frame = dispatch_for(runner)
        ack = runner.fail(frame, "EngineError: the process died", stderr="Segmentation fault")
        assert ack["accepted"] is True
        # One retry, so the run comes straight back with the error still on it.
        again = dispatch_for(runner)
        run = run_row(settings, run_id)

    assert again["run_id"] == run_id
    assert again["attempt_token"] != frame["attempt_token"]
    assert run.attempts == 2
    assert run.error == "EngineError: the process died"
    assert run.stderr == "Segmentation fault"


def test_a_second_answer_for_the_same_attempt_is_dropped_rather_than_written(
    api: TestClient, settings: Settings
) -> None:
    _runner_id, token = register(settings)
    game_id = seed_game(api)

    with connect(api, token) as runner:
        run_id = enqueue(api, game_id, runner.engine_ids["sf-remote"])
        frame = dispatch_for(runner)
        assert runner.complete(frame, [eval_row(0)])["accepted"] is True
        replayed = runner.complete(frame, [eval_row(0), eval_row(1)])

    assert replayed == {
        "type": protocol.RUN_ACK,
        "run_id": run_id,
        "accepted": False,
        "reason": protocol.ERROR_STALE_RESULT,
    }
    with get_sessionmaker(settings)() as session:
        assert len(analysis.get_move_evals(session, run_id)) == 1
    assert run_row(settings, run_id).status is RunStatus.DONE


def test_an_answer_for_a_run_that_never_existed_is_dropped(
    api: TestClient, settings: Settings
) -> None:
    _runner_id, token = register(settings)

    with connect(api, token) as runner:
        ack = runner.complete({"run_id": 9999, "attempt_token": "deadbeef"}, [eval_row(0)])

    assert ack["accepted"] is False
    assert ack["reason"] == protocol.ERROR_UNKNOWN_RUN


def test_the_dispatcher_hands_out_no_more_runs_than_the_runner_has_slots(
    api: TestClient, settings: Settings
) -> None:
    runner_id, token = register(settings, slots=1)
    game_id = seed_game(api)

    with connect(api, token, slots=1) as runner:
        engine_id = runner.engine_ids["sf-remote"]
        first = enqueue(api, game_id, engine_id, tier="deep")
        second = enqueue(api, game_id, engine_id, tier="deep")

        frame = dispatch_for(runner)
        state = api.app.state.gateway.state(runner_id)
        assert (state.slots, state.busy, state.free_slots) == (1, 1, 0)
        assert run_row(settings, second if frame["run_id"] == first else first).status is (
            RunStatus.QUEUED
        )

        runner.complete(frame, [eval_row(0)])
        # The completion frees the slot, and the next run follows it out.
        following = dispatch_for(runner)

    assert {frame["run_id"], following["run_id"]} == {first, second}


# --- taking a run away ------------------------------------------------------


def test_a_dropped_socket_hands_the_run_straight_back_with_its_attempt_refunded(
    api: TestClient, settings: Settings
) -> None:
    _runner_id, token = register(settings)
    game_id = seed_game(api)

    with connect(api, token) as runner:
        run_id = enqueue(api, game_id, runner.engine_ids["sf-remote"])
        frame = dispatch_for(runner)
        assert run_row(settings, run_id).attempts == 1

    queued = wait_for(settings, run_id, RunStatus.QUEUED)
    # Taken away mid-search, not failed: two restarts during one deep pass must not be
    # able to mark it permanently failed with no engine having crashed.
    assert queued.attempts == 0
    assert queued.attempt_token == frame["attempt_token"]

    with connect(api, token) as runner:
        again = dispatch_for(runner)
    assert again["run_id"] == run_id
    assert again["attempt_token"] != frame["attempt_token"]


def test_a_claim_in_flight_when_the_socket_goes_does_not_take_the_run_back(
    api: TestClient, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The handback waits for the dispatch round on the link rather than racing it.

    The round that follows a dispatch is normally over long before the socket goes, so the
    interleaving this is about — the claim landing on the far side of the handback, taking
    the run straight back out for a link that has gone — is one a loaded machine hits and a
    quick one does not. Slowing the claim to the width of the whole disconnect makes it the
    ordering every time.
    """
    real = analysis.claim_next_run

    def slow_claim(session: Any, **kwargs: Any) -> Any:
        time.sleep(SLOW_CLAIM_SECONDS)
        return real(session, **kwargs)

    monkeypatch.setattr(analysis, "claim_next_run", slow_claim)
    _runner_id, token = register(settings)
    game_id = seed_game(api)

    with connect(api, token) as runner:
        run_id = enqueue(api, game_id, runner.engine_ids["sf-remote"])
        frame = dispatch_for(runner)

    queued = wait_for(settings, run_id, RunStatus.QUEUED)
    time.sleep(SLOW_CLAIM_SECONDS * 2)
    settled = run_row(settings, run_id)
    assert (settled.status, settled.attempts) == (RunStatus.QUEUED, 0)
    assert settled.attempt_token == queued.attempt_token == frame["attempt_token"]


def test_a_reconnect_during_the_handback_is_not_undone_by_it(
    api: TestClient, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A machine that comes straight back is not marked gone by the release of its old link.

    The handback is two writes, the disconnection and the runs, and a runner that restarts
    fast says hello while they are in flight. Its registration landing between them — or
    between the last of them and its first claim — left a welcomed runner with its engines
    switched off underneath it: nothing was ever dispatched, and the reconnect tests hung
    on exactly that whenever CI was slow. Slowing the disconnection write to the width of
    the reconnect makes that the ordering every time.
    """
    real = runners_service.mark_disconnected

    def slow_disconnect(session: Any, runner_id: int, **kwargs: Any) -> None:
        time.sleep(SLOW_CLAIM_SECONDS)
        real(session, runner_id, **kwargs)

    monkeypatch.setattr(runners_service, "mark_disconnected", slow_disconnect)
    runner_id, token = register(settings)
    game_id = seed_game(api)

    with connect(api, token) as runner:
        run_id = enqueue(api, game_id, runner.engine_ids["sf-remote"])
        frame = dispatch_for(runner)

    with connect(api, token) as runner:
        again = dispatch_for(runner)
        assert again["run_id"] == run_id
        assert again["attempt_token"] != frame["attempt_token"]
        # Long after the old link's release has landed, the row is still the new link's.
        time.sleep(SLOW_CLAIM_SECONDS * 2)
        with get_sessionmaker(settings)() as session:
            assert runners_service.require_runner(session, runner_id).connected is True
            enabled = session.scalars(
                select(Engine.enabled).where(Engine.runner_id == runner_id)
            ).all()
            assert enabled and all(enabled)
        assert run_row(settings, run_id).status is RunStatus.RUNNING


def test_the_sweep_takes_a_silent_run_back_and_tells_the_runner_so(
    api: TestClient, settings: Settings
) -> None:
    _runner_id, token = register(settings)
    game_id = seed_game(api)

    with connect(api, token) as runner:
        run_id = enqueue(api, game_id, runner.engine_ids["sf-remote"])
        frame = dispatch_for(runner)
        go_stale(settings, run_id)

        assert api.portal.call(api.app.state.gateway.sweep) == [run_id]
        cancelled = runner.recv(protocol.RUN_CANCEL)
        # It is queued again, so the same runner is welcome to it under a new attempt.
        redispatched = dispatch_for(runner)

    assert cancelled == {"type": protocol.RUN_CANCEL, "run_id": run_id, "reason": "requeued"}
    assert redispatched["attempt_token"] != frame["attempt_token"]


def test_a_result_for_a_run_the_sweep_took_away_is_dropped(
    api: TestClient, settings: Settings
) -> None:
    _runner_id, token = register(settings)
    game_id = seed_game(api)

    with connect(api, token) as runner:
        run_id = enqueue(api, game_id, runner.engine_ids["sf-remote"])
        frame = dispatch_for(runner)
        go_stale(settings, run_id)
        api.portal.call(api.app.state.gateway.sweep)
        runner.recv(protocol.RUN_CANCEL)
        current = dispatch_for(runner)

        stale = runner.complete(frame, [eval_row(0)])
        # The attempt that is actually running was left alone.
        still = run_row(settings, run_id)
        with get_sessionmaker(settings)() as session:
            written = session.scalars(select(MoveEval)).all()

    assert stale["accepted"] is False
    assert stale["reason"] == protocol.ERROR_STALE_RESULT
    assert still.status is RunStatus.RUNNING
    assert still.attempt_token == current["attempt_token"]
    assert written == []


def test_a_sweep_does_not_cancel_the_attempt_that_replaced_the_one_it_collected(
    api: TestClient, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Requeueing wakes the pump, which can have handed the run straight back out — to this
    same runner — before the release loop runs. A `run_cancel` names a run and not an
    attempt, so sending one now would stop the search that is actually under way."""
    # One slot, and it is held: the gateway's own pump has no room to race the re-claim
    # staged below, so this is a test about the ordering rather than about which claim won.
    runner_id, token = register(settings, slots=1)
    game_id = seed_game(api)
    gateway = api.app.state.gateway

    with connect(api, token, slots=1) as runner:
        run_id = enqueue(api, game_id, runner.engine_ids["sf-remote"])
        first = dispatch_for(runner)
        go_stale(settings, run_id)

        state = gateway.state(runner_id)
        collect = gateway._requeue_stale
        fresh: list[Any] = []

        def requeue_and_reclaim() -> list[int]:
            """The sweep, with the pump having got there first — on the sweep's own thread,
            so the two cannot land in the other order."""
            stale = collect()
            claim = gateway._claim(runner_id)
            assert claim is not None
            state.runs[claim.run_id] = runner_gateway.RemoteRun(
                run_id=claim.run_id,
                attempt_token=claim.attempt_token,
                plan=claim.plan,
                started=time.monotonic(),
            )
            fresh.append(claim)
            return stale

        monkeypatch.setattr(gateway, "_requeue_stale", requeue_and_reclaim)
        assert api.portal.call(gateway.sweep) == [run_id]

        runner.send(protocol.ping(1.0))
        answered = runner.recv()
        # Read while the link is up: closing it hands the run it is holding straight back.
        running = run_row(settings, run_id)

    assert answered["type"] == protocol.PONG, "a cancel was queued ahead of the pong"
    assert running.status is RunStatus.RUNNING
    assert running.attempt_token == fresh[0].attempt_token != first["attempt_token"]


def test_a_confirmed_cancellation_does_not_free_the_slot_of_the_attempt_after_it(
    api: TestClient, settings: Settings
) -> None:
    """The runner's receive loop is sequential: it confirms the cancel it was sent before it
    reads the dispatch that followed, and the confirmation names a run, not an attempt."""
    runner_id, token = register(settings, slots=1)
    game_id = seed_game(api)
    gateway = api.app.state.gateway

    with connect(api, token, slots=1) as runner:
        run_id = enqueue(api, game_id, runner.engine_ids["sf-remote"])
        dispatch_for(runner)
        go_stale(settings, run_id)
        api.portal.call(gateway.sweep)
        runner.recv(protocol.RUN_CANCEL)
        current = dispatch_for(runner)

        runner.send(protocol.run_cancelled(run_id=run_id))
        runner.send(protocol.ping(1.0))
        runner.recv(protocol.PONG)

        state = gateway.state(runner_id)
        assert set(state.runs) == {run_id}
        assert state.runs[run_id].attempt_token == current["attempt_token"]
        assert state.free_slots == 0


def test_a_claim_that_lands_across_a_reconnect_goes_back_to_the_queue(
    api: TestClient, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A dispatch belongs to the link it was claimed for. Pushed down the link that took the
    runner over instead, it would be work the new link's slot accounting knows nothing
    about — and the runner would be handed more jobs than its cap for as long as it held."""
    runner_id, token = register(settings, slots=1)
    game_id = seed_game(api)
    gateway = api.app.state.gateway

    with connect(api, token, slots=1) as runner:
        state = gateway.state(runner_id)
        replacement = runner_gateway.RunnerState(
            runner_id=runner_id,
            name=state.name,
            slots=1,
            version=None,
            link=runner_gateway.PollLink(runner_id, state.name),
            engine_ids=state.engine_ids,
            ready=True,
        )
        claim = gateway._claim
        claimed: list[Any] = []

        def claim_then_reconnect(for_runner: int) -> Any:
            """The socket dropped and the runner dialled straight back in, while the claim
            was still on its way back from the database."""
            found = claim(for_runner)
            gateway._states[for_runner] = replacement
            claimed.append(found)
            return found

        monkeypatch.setattr(gateway, "_claim", claim_then_reconnect)
        run_id = enqueue(api, game_id, runner.engine_ids["sf-remote"], tier="deep")

        deadline = time.monotonic() + SETTLE_SECONDS
        while not claimed and time.monotonic() < deadline:
            time.sleep(0.02)
        assert claimed and claimed[0] is not None, "the run was never claimed"
        # Straight back to the queue rather than out to the stale sweep, and with the
        # attempt refunded: nobody ever started searching it.
        queued = wait_for(settings, run_id, RunStatus.QUEUED)

    assert queued.attempts == 0
    assert replacement.link.pending == [], "the new link was handed a run it never claimed"
    assert (replacement.runs, state.runs) == ({}, {})


def test_a_link_that_missed_its_pings_is_closed_so_the_runner_dials_back_in(
    api: TestClient, settings: Settings
) -> None:
    """Dropping it and leaving the socket open takes a healthy machine out of the
    deployment: it never learns, and only a close frame sends it round to reconnect."""
    runner_id, token = register(settings)
    gateway = api.app.state.gateway

    with connect(api, token) as runner:
        gateway.state(runner_id).missed_pings = runner_gateway.MISSED_PINGS
        api.portal.call(gateway.beat)
        code, reason = runner.closed()

    assert (code, reason) == (runner_gateway.WS_CLOSE_GOING_AWAY, runner_gateway.REASON_TIMEOUT)
    assert gateway.state(runner_id) is None


def test_progress_for_a_run_that_moved_on_is_answered_with_a_cancel(
    api: TestClient, settings: Settings
) -> None:
    """A runner learns on its next beat rather than at the end of a search nobody wants."""
    _runner_id, token = register(settings)
    game_id = seed_game(api)

    with connect(api, token) as runner:
        run_id = enqueue(api, game_id, runner.engine_ids["sf-remote"])
        frame = dispatch_for(runner)
        with get_sessionmaker(settings)() as session:
            analysis.fail_run(
                session, analysis.require_run(session, run_id), "taken away", retry=False
            )

        runner.progress(frame, 2, 9)
        cancelled = runner.recv(protocol.RUN_CANCEL)

    assert cancelled == {"type": protocol.RUN_CANCEL, "run_id": run_id, "reason": "stolen"}
    assert run_row(settings, run_id).status is RunStatus.FAILED


# --- reconnect reconciliation -----------------------------------------------


def test_a_reconnect_is_told_about_the_run_it_no_longer_holds(
    api: TestClient, settings: Settings
) -> None:
    """The database is the authority: saying "I am still on it" does not make it so."""
    _runner_id, token = register(settings)
    game_id = seed_game(api)

    with connect(api, token) as runner:
        run_id = enqueue(api, game_id, runner.engine_ids["sf-remote"], tier="deep")
        held = dispatch_for(runner)

    wait_for(settings, run_id, RunStatus.QUEUED)

    with connect(api, token, say_hello=False) as runner:
        welcome = runner.hello(
            active_runs=[{"run_id": run_id, "attempt_token": held["attempt_token"]}]
        )
        assert welcome["cancelled_runs"] == [run_id]
        # Cancelled and queued, so it goes out again — under a new attempt.
        again = dispatch_for(runner)
        assert again["run_id"] == run_id
        assert again["attempt_token"] != held["attempt_token"]


def test_a_reconnect_resumes_a_run_that_is_still_its_own(
    api: TestClient, settings: Settings
) -> None:
    runner_id, token = register(settings, slots=2)
    game_id = seed_game(api)

    with connect(api, token) as first:
        run_id = enqueue(api, game_id, first.engine_ids["sf-remote"], tier="deep")
        held = dispatch_for(first)

        with connect(api, token, say_hello=False) as second:
            welcome = second.hello(
                active_runs=[{"run_id": run_id, "attempt_token": held["attempt_token"]}]
            )
            assert welcome["cancelled_runs"] == []
            state = api.app.state.gateway.state(runner_id)
            assert set(state.runs) == {run_id}
            assert run_row(settings, run_id).status is RunStatus.RUNNING
            # The run is still the runner's, so the new link can simply finish it.
            assert second.complete(held, [eval_row(0)])["accepted"] is True
        first.closed()

    assert run_row(settings, run_id).status is RunStatus.DONE


def test_a_run_the_reconnecting_runner_does_not_claim_goes_back_to_the_queue(
    api: TestClient, settings: Settings
) -> None:
    _runner_id, token = register(settings, slots=2)
    game_id = seed_game(api)

    with connect(api, token) as first:
        run_id = enqueue(api, game_id, first.engine_ids["sf-remote"], tier="deep")
        held = dispatch_for(first)

        # A second link takes the runner over without naming the run: nobody is searching
        # it, so it belongs back in the queue rather than waiting out the stale sweep.
        with connect(api, token, say_hello=False) as second:
            welcome = second.hello(active_runs=[])
            assert welcome["cancelled_runs"] == []
            requeued = dispatch_for(second)
            assert requeued["run_id"] == run_id
            assert requeued["attempt_token"] != held["attempt_token"]
        first.closed()


# --- the seams the stream backends plug into --------------------------------


def test_a_reserved_slot_is_one_the_dispatcher_no_longer_has(
    api: TestClient, settings: Settings
) -> None:
    runner_id, token = register(settings, slots=1)
    game_id = seed_game(api)
    gateway = api.app.state.gateway

    with connect(api, token, slots=1) as runner:
        assert api.portal.call(gateway.reserve_slot, runner_id, "str_7f3c") is True
        state = gateway.state(runner_id)
        assert (state.streams, state.free_slots) == ({"str_7f3c"}, 0)

        run_id = enqueue(api, game_id, runner.engine_ids["sf-remote"], tier="deep")
        time.sleep(0.1)
        assert run_row(settings, run_id).status is RunStatus.QUEUED

        api.portal.call(gateway.release_slot, runner_id, "str_7f3c")
        frame = dispatch_for(runner)

    assert frame["run_id"] == run_id


def test_a_stream_takes_the_slot_of_the_run_that_started_last(
    api: TestClient, settings: Settings
) -> None:
    """D6: somebody is at a board, so it does not queue behind a deep pass."""
    runner_id, token = register(settings, slots=1)
    game_id = seed_game(api)
    gateway = api.app.state.gateway

    with connect(api, token, slots=1) as runner:
        run_id = enqueue(api, game_id, runner.engine_ids["sf-remote"], tier="deep")
        dispatch_for(runner)

        assert api.portal.call(gateway.reserve_slot, runner_id, "str_7f3c") is True
        cancelled = runner.recv(protocol.RUN_CANCEL)
        preempted = wait_for(settings, run_id, RunStatus.QUEUED)

    assert cancelled == {"type": protocol.RUN_CANCEL, "run_id": run_id, "reason": "preempted"}
    # Taken away, not failed: the attempt is refunded exactly as a dropped socket's is.
    assert preempted.attempts == 0


def test_a_registered_handler_sees_the_messages_the_gateway_has_no_answer_for(
    api: TestClient, settings: Settings
) -> None:
    _runner_id, token = register(settings)
    gateway = api.app.state.gateway
    seen: list[dict[str, Any]] = []

    async def handler(_runner_id: int, frame: dict[str, Any]) -> None:
        seen.append(frame)

    cancel = api.portal.call(gateway.register_handler, protocol.STREAM_SNAPSHOT, handler)
    try:
        with connect(api, token) as runner:
            runner.send(protocol.snapshot_frame("str_7f3c", 7, depth=24, lines=[]))
            runner.send(protocol.ping(1.0))
            runner.recv(protocol.PONG)
    finally:
        api.portal.call(cancel)

    assert [frame["session_id"] for frame in seen] == ["str_7f3c"]
    assert seen[0]["seq"] == 7


# --- what the UI is told -----------------------------------------------------


def test_the_events_socket_follows_a_runner_arriving_working_and_leaving(
    api: TestClient, settings: Settings
) -> None:
    _runner_id, token = register(settings, slots=2)
    game_id = seed_game(api)

    with api.websocket_connect("/events", headers=socket_headers(api)) as events:
        with connect(api, token) as runner:
            arrived = until(events, runners_service.EVENT_RUNNER_CONNECTED)
            enqueue(api, game_id, runner.engine_ids["sf-remote"], tier="deep")
            dispatch_for(runner)
            busy = until(events, runners_service.EVENT_RUNNER_UPDATED)
        gone = until(events, runners_service.EVENT_RUNNER_DISCONNECTED)

    assert arrived["name"] == "gpu-box"
    assert arrived["transport"] == "websocket"
    assert arrived["engines"] == ["sf-remote"]
    assert (busy["busy"], busy["streams"], busy["free_slots"]) == (1, 0, 1)
    assert busy["connected"] is True
    assert gone["reason"] == "socket_closed"
