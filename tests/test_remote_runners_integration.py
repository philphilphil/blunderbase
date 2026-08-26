"""Remote runners across every seam at once, from minting a token to the rows it writes.

The stage tests each prove one layer: `test_runner_gateway.py` the dispatcher,
`test_runner_poll.py` the fallback, `test_streams_api.py` the analysis board,
`test_runners_api.py` the owner's surface. This file is the joins between them — the paths
that only exist because two stages meet, and that no single stage's tests can see:

- a token minted through `POST /runners` really opens the socket, and the yaml printed
  beside it really loads;
- work dispatched over the socket and answered over the socket lands as `MoveEval` rows,
  with the same `analysis.*` events a local run emits;
- a link that dies mid-run gives the run back, the next link gets it, and the answer the
  *dead* attempt eventually posts over the fallback is dropped rather than written;
- the two transports are one runner: what the socket registered, the poll drains;
- an analysis board and the queue share one slot count, and the owner's surface says so;
- a runner that is away still owns its backlog, and the local worker never touches it.

Everything here drives `create_app`'s own app: the same lifespan, the same gateway, the
same database, with `tests/fake_runner.py` as the machine at the other end.
"""

from __future__ import annotations

import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient

from backend.api.app import create_app
from backend.config import Settings
from backend.db.enums import RunStatus
from backend.db.session import get_sessionmaker
from backend.runners import protocol
from backend.runners.config import RunnerConfig
from backend.services import analysis
from backend.services import runners as runners_service
from backend.services import streams as streams_service
from tests.conftest import running_app, socket_headers
from tests.fake_runner import (
    STOCKFISH_AD,
    connect,
    eval_row,
    poll_complete,
    poll_heartbeat,
    poll_once,
)
from tests.fake_uci import STOCKFISH_OPTIONS, fake_engine_command
from tests.test_runner_gateway import (
    PLAYED,
    dispatch_for,
    enqueue,
    register,
    run_row,
    seed_game,
    until,
    wait_for,
)

STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"

SETTLE_SECONDS = 20.0


@pytest.fixture()
def api(settings: Settings) -> Iterator[TestClient]:
    """The app with no local workers and no clock of its own: the tests drive both.

    The one test that wants the local worker set builds its own app, because "the two
    halves of the queue do not steal from each other" is the whole of what it asserts.
    """
    settings.analysis_workers = False
    settings.runner_heartbeat_seconds = 60.0
    settings.runner_stale_sweep_seconds = 60.0
    settings.stream_idle_seconds = 300.0
    with running_app(create_app(settings)) as client:
        yield client


@pytest.fixture(autouse=True)
def _fresh_limiter() -> Iterator[None]:
    runners_service.reset_limiter()
    yield
    runners_service.reset_limiter()


def local_engine(
    api: TestClient,
    tmp_path: Path,
    name: str = "fakefish",
    tier: str | None = "quick",
    **scenario: Any,
) -> int:
    """One scripted UCI binary on this host, registered the way the Engines page does it."""
    path = fake_engine_command(tmp_path, name="FakeFish 1", options=STOCKFISH_OPTIONS, **scenario)
    created = api.post("/engines", json={"name": name, "path": path, "default_tier": tier})
    assert created.status_code == 201, created.text
    return int(created.json()["id"])


def evals_of(settings: Settings, run_id: int) -> list[Any]:
    with get_sessionmaker(settings)() as session:
        return analysis.get_move_evals(session, run_id)


def runner_row(api: TestClient, runner_id: int) -> dict[str, Any]:
    listed = api.get("/runners").json()
    return next(row for row in listed if row["id"] == runner_id)


def destinations(api: TestClient) -> dict[str, dict[str, Any]]:
    payload = api.get("/analysis/queue").json()
    return {row["name"]: row for row in payload["destinations"]}


# --- the whole journey --------------------------------------------------------


def test_a_token_minted_through_the_api_drains_a_run_and_writes_its_rows(
    api: TestClient, settings: Settings
) -> None:
    """Stage 5 mints it, stage 3 would read it, stage 2 answers it, stage 1 stores the result."""
    created = api.post("/runners", json={"name": "gpu-box", "slots": 2})
    assert created.status_code == 201, created.text
    body = created.json()
    runner_id = body["runner"]["id"]
    token = body["token"]

    # The paste-ready yaml beside the token is one a real runner would accept.
    config = RunnerConfig.from_mapping(yaml.safe_load(body["config_yaml"]), source="<created>")
    assert config.token == token
    assert config.name == "gpu-box"
    assert config.slots == 2

    game_id = seed_game(api)

    with api.websocket_connect("/events", headers=socket_headers(api)) as events:
        with connect(api, token) as runner:
            engine_id = runner.engine_ids["sf-remote"]
            assert engine_id is not None

            # The advertisement is an engine row like any other, and the owner's surface
            # knows whose machine it is on.
            listed = runner_row(api, runner_id)
            assert listed["connected"] is True
            assert listed["transport"] == "websocket"
            assert [engine["name"] for engine in listed["engines"]] == ["sf-remote"]
            assert listed["engines"][0]["path"] == STOCKFISH_AD["path"]

            run_id = enqueue(api, game_id, engine_id, tier="deep")
            frame = dispatch_for(runner)
            assert frame["run_id"] == run_id
            assert protocol.decode_plan(frame["plan"]).run_id == run_id

            # Mid-flight, the deployment says exactly where the work is.
            busy = runner_row(api, runner_id)
            assert (busy["busy"], busy["free_slots"], busy["queued_eligible"]) == (1, 1, 0)
            assert destinations(api)["gpu-box"]["running"] == 1

            runner.progress(frame, 4, 8)
            progressed = until(events, analysis.EVENT_RUN_PROGRESS)

            rows = [eval_row(ply, move_uci=PLAYED[ply]) for ply in range(8)]
            assert runner.complete(frame, rows)["accepted"] is True
            finished = until(events, analysis.EVENT_RUN_DONE)

    assert (progressed["run_id"], progressed["done"], progressed["total"]) == (run_id, 4, 8)
    assert finished["run_id"] == run_id
    run = run_row(settings, run_id)
    assert (run.status, run.attempts, run.error) == (RunStatus.DONE, 1, None)
    assert [row.move_uci for row in evals_of(settings, run_id)] == PLAYED
    assert api.get(f"/analysis/runs/{run_id}/evals").status_code == 200


def test_a_link_that_dies_mid_run_loses_it_and_its_late_answer_is_never_written(
    api: TestClient, settings: Settings
) -> None:
    """The dead attempt comes back over the *other* transport, which is the honest race."""
    _runner_id, token = register(settings, slots=2)
    game_id = seed_game(api)

    with connect(api, token) as first:
        run_id = enqueue(api, game_id, first.engine_ids["sf-remote"], tier="deep")
        lost = dispatch_for(first)

    # Nobody is searching it, so it is queued again — and the attempt is refunded, because
    # a socket that dropped is not an engine that crashed.
    requeued = wait_for(settings, run_id, RunStatus.QUEUED)
    assert requeued.attempts == 0

    with connect(api, token) as second:
        current = dispatch_for(second)
        assert current["run_id"] == run_id
        assert current["attempt_token"] != lost["attempt_token"]

        # The machine that lost the link finally finishes the pass and posts it over the
        # fallback. It is a 200 that says the payload was dropped: the runner did nothing
        # wrong, and a 4xx would only make it retry.
        late = poll_complete(api, token, lost, evals=[eval_row(0), eval_row(1)])
        assert late.status_code == 200, late.text
        assert late.json() == {"accepted": False, "reason": protocol.ERROR_STALE_RESULT}

        # The attempt that really is running was left alone, and can still answer.
        assert run_row(settings, run_id).attempt_token == current["attempt_token"]
        assert evals_of(settings, run_id) == []
        assert second.complete(current, [eval_row(0)])["accepted"] is True

    assert run_row(settings, run_id).status is RunStatus.DONE
    assert len(evals_of(settings, run_id)) == 1


def test_the_socket_and_the_fallback_are_one_runner(api: TestClient, settings: Settings) -> None:
    """A machine that loses its socket keeps its identity, its engines and its backlog."""
    runner_id, token = register(settings, slots=2)
    game_id = seed_game(api)

    with connect(api, token) as socket_runner:
        engine_id = socket_runner.engine_ids["sf-remote"]

    # The link is gone; the engine row is switched off but not deleted, and the runs
    # queued against it are still this runner's work rather than anybody else's.
    run_id = enqueue(api, game_id, engine_id, tier="deep")
    assert destinations(api)["gpu-box"]["queued"] == 1
    assert destinations(api)["local"]["queued"] == 0

    answered = poll_once(api, token, slots=2)
    assert answered.status_code == 200, answered.text
    body = answered.json()
    assert body["runner_id"] == runner_id
    assert body["engines"][0]["engine_id"] == engine_id, "the same row, re-enabled"
    assert body["engines"][0]["accepted"] is True
    assert [entry["run_id"] for entry in body["dispatch"]] == [run_id]

    dispatch = body["dispatch"][0]
    assert protocol.decode_plan(dispatch["plan"]).run_id == run_id
    listed = runner_row(api, runner_id)
    assert (listed["transport"], listed["busy"]) == ("poll", 1)

    beat = poll_heartbeat(api, token, dispatch, done=3, total=8)
    assert beat.json() == {"ok": True, "cancel": False}

    done = poll_complete(api, token, dispatch, evals=[eval_row(0, move_uci="e2e4")])
    assert done.json() == {"accepted": True, "reason": None}
    assert run_row(settings, run_id).status is RunStatus.DONE
    assert [row.move_uci for row in evals_of(settings, run_id)] == ["e2e4"]


# --- the analysis board and the queue share a runner ---------------------------


def test_a_board_holds_a_runner_slot_the_queue_gets_back_when_it_closes(
    api: TestClient, settings: Settings
) -> None:
    """One slot count, two consumers: `/streams` in front, `/analysis` behind."""
    runner_id, token = register(settings, slots=1)
    game_id = seed_game(api)

    with api.websocket_connect("/events", headers=socket_headers(api)) as events:
        with connect(api, token, slots=1) as runner:
            engine_id = runner.engine_ids["sf-remote"]
            opened = api.post(
                "/streams", json={"fen": STARTING_FEN, "engine_id": engine_id, "multipv": 2}
            )
            assert opened.status_code == 201, opened.text
            session = opened.json()
            assert (session["runner_id"], session["runner"]) == (runner_id, "gpu-box")
            request = runner.recv(protocol.STREAM_OPEN)
            assert (request["session_id"], request["multipv"]) == (session["id"], 2)

            # The board is a slot the dispatcher no longer has, and both surfaces say so.
            held = runner_row(api, runner_id)
            assert (held["streams"], held["busy"], held["free_slots"]) == (1, 0, 0)
            run_id = enqueue(api, game_id, engine_id, tier="deep")
            time.sleep(0.2)
            assert run_row(settings, run_id).status is RunStatus.QUEUED
            assert runner_row(api, runner_id)["queued_eligible"] == 1

            runner.send(protocol.stream_started(session_id=session["id"], engine="sf-remote"))
            runner.send(
                protocol.snapshot_frame(
                    session["id"],
                    41,
                    depth=24,
                    nodes=1_000_000,
                    nps=500_000,
                    time_ms=2000,
                    lines=[{"multipv": 1, "cp": 34, "mate": None, "pv": ["e2e4", "e7e5"]}],
                )
            )
            relayed = until(events, streams_service.EVENT_STREAM_SNAPSHOT)

            moved = api.patch(f"/streams/{session['id']}", json={"fen": AFTER_E4})
            assert moved.status_code == 200, moved.text
            restart = runner.recv(protocol.STREAM_RESTART)

            assert api.delete(f"/streams/{session['id']}").status_code == 204
            closed = runner.recv(protocol.STREAM_CLOSE)
            # The slot came back, so the run that was waiting for it goes out.
            dispatched = dispatch_for(runner)
            ended = until(events, streams_service.EVENT_STREAM_ENDED)

    assert relayed["seq"] == 1, "the broker numbers the board, not the runner"
    assert (relayed["runner_id"], relayed["engine_id"]) == (runner_id, engine_id)
    assert relayed["lines"] == [{"multipv": 1, "cp": 34, "mate": None, "pv": ["e2e4", "e7e5"]}]
    assert restart["fen"].startswith("rnbqkbnr/pppppppp/8/8/4P3")
    assert closed["reason"] == streams_service.REASON_CLOSED
    assert ended["session_id"] == session["id"]
    assert dispatched["run_id"] == run_id


def test_a_board_is_refused_on_a_runner_that_can_only_poll(
    api: TestClient, settings: Settings
) -> None:
    """A poll response carries jobs and nothing else, so the board is refused, not hung."""
    runner_id, token = register(settings)
    answered = poll_once(api, token)
    assert answered.status_code == 200, answered.text
    engine_id = answered.json()["engines"][0]["engine_id"]

    refused = api.post("/streams", json={"fen": STARTING_FEN, "engine_id": engine_id})

    assert refused.status_code == 409
    assert refused.json()["error"] == "stream_unavailable"
    assert "polling" in refused.json()["detail"]
    # Refused rather than half-open: nothing is listed, and no slot was spent.
    assert api.get("/streams").json() == []
    assert runner_row(api, runner_id)["streams"] == 0


# --- what a runner's engine is not for --------------------------------------------


def test_a_one_shot_evaluation_never_starts_a_runner_s_binary(
    api: TestClient, settings: Settings, tmp_path: Path
) -> None:
    """`/analysis/position` is computed in this process; a runner carries whole runs.

    Per-position tunnelling is deliberately outside the protocol, so a remote engine's
    path is a path on somebody else's machine — and this host must not start whatever it
    happens to have there.
    """
    _runner_id, token = register(settings)
    quick_ad = {**STOCKFISH_AD, "tier": "quick"}

    with connect(api, token, engines=[quick_ad]) as runner:
        assert runner.engine_ids["sf-remote"] is not None

        # The only engine in the deployment is the runner's: there is nothing to run here.
        refused = api.post("/analysis/position", json={"fen": STARTING_FEN, "nodes": 1000})
        assert refused.status_code == 409, refused.text
        assert refused.json()["error"] == "tier_unavailable"
        assert "sf-remote" in refused.json()["detail"]

        # A binary on this host, claiming a different tier: the fallback finds it anyway.
        local_engine(api, tmp_path, tier="deep")
        answered = api.post("/analysis/position", json={"fen": STARTING_FEN, "nodes": 1000})

    assert answered.status_code == 200, answered.text
    assert answered.json()["engine_name"] == "fakefish"


def test_the_test_run_button_will_not_start_a_runner_s_binary(
    api: TestClient, settings: Settings
) -> None:
    """The row is an advertisement from another machine; only that machine can start it."""
    _runner_id, token = register(settings)

    with connect(api, token) as runner:
        engine_id = runner.engine_ids["sf-remote"]
        refused = api.post(f"/engines/{engine_id}/test-run", json={"nodes": 1000})

    assert refused.status_code == 502
    assert refused.json()["error"] == "engine_failed"
    assert "runner 'gpu-box'" in refused.json()["detail"]


# --- one queue, two kinds of worker ---------------------------------------------


def test_a_runner_that_is_away_keeps_its_backlog_off_this_host(
    api: TestClient, settings: Settings
) -> None:
    """The local worker excludes every remote engine, disabled ones included; so must the count."""
    runner_id, token = register(settings)
    game_id = seed_game(api)

    with connect(api, token) as runner:
        engine_id = runner.engine_ids["sf-remote"]
    enqueue(api, game_id, engine_id, tier="deep")

    with get_sessionmaker(settings)() as session:
        breakdown = {row["name"]: row for row in runners_service.queue_breakdown(session)}

    assert breakdown["gpu-box"]["queued"] == 1
    assert breakdown["gpu-box"]["connected"] is False
    assert breakdown["local"]["queued"] == 0, "this host has no binary for it and never will"
    assert runner_row(api, runner_id)["queued_eligible"] == 1


def test_the_local_workers_and_a_runner_drain_one_queue_without_stealing(
    settings: Settings, tmp_path: Path
) -> None:
    """The only test here with the worker set running: each half takes exactly its own."""
    settings.analysis_workers = True
    settings.runner_heartbeat_seconds = 60.0
    settings.runner_stale_sweep_seconds = 60.0

    with running_app(create_app(settings)) as api:
        # After the lifespan, which is what brings the database to head.
        runner_id, token = register(settings, slots=2)
        game_id = seed_game(api)
        here = local_engine(
            api,
            tmp_path,
            go_default={"info": ["depth 8 score cp 20 nodes 100"], "bestmove": "(none)"},
        )

        with connect(api, token) as runner:
            there = runner.engine_ids["sf-remote"]
            mine = enqueue(api, game_id, here, tier="quick", nodes=1000)
            theirs = enqueue(api, game_id, there, tier="deep")

            frame = dispatch_for(runner)
            assert frame["run_id"] == theirs, "the local set never claimed the remote run"
            assert runner.complete(frame, [eval_row(0)])["accepted"] is True

            local_run = wait_for(settings, mine, RunStatus.DONE)
            remote_run = wait_for(settings, theirs, RunStatus.DONE)
            listed = runner_row(api, runner_id)

    assert (local_run.status, remote_run.status) == (RunStatus.DONE, RunStatus.DONE)
    # The runner's slots were spent on the runner's run only.
    assert listed["busy"] == 0
    assert len(evals_of(settings, theirs)) == 1
    assert evals_of(settings, mine), "the worker set really ran the local one"
