"""The poll fallback: the same gateway, seen through a buffer instead of a socket.

A runner that cannot hold a websocket open announces itself, takes work away and hands
results back over three POSTs. The dispatches are the very same frames the socket carries
— minus their `type`, because a response is not a stream — which is the point: there is
one dispatcher, not two.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from backend.api.app import create_app
from backend.config import Settings
from backend.db.enums import RunStatus
from backend.db.session import get_sessionmaker
from backend.runners import protocol
from backend.services import analysis
from backend.services import engines as engines_service
from backend.services import runners as runners_service
from backend.workers import runner_gateway
from tests.conftest import running_app, socket_headers
from tests.fake_runner import (
    MAIA_AD,
    STOCKFISH_AD,
    bearer,
    eval_row,
    poll_complete,
    poll_heartbeat,
    poll_once,
)
from tests.test_runner_gateway import (
    PLAYED,
    enqueue,
    register,
    run_row,
    seed_game,
    until,
)


@pytest.fixture()
def api(settings: Settings) -> Iterator[TestClient]:
    settings.analysis_workers = False
    settings.runner_heartbeat_seconds = 60.0
    settings.runner_stale_sweep_seconds = 60.0
    settings.runner_poll_seconds = 3.0
    with running_app(create_app(settings)) as client:
        yield client


@pytest.fixture(autouse=True)
def _fresh_limiter() -> Iterator[None]:
    runners_service.reset_limiter()
    yield
    runners_service.reset_limiter()


def announce(api: TestClient, token: str, **kwargs: object) -> dict:
    answer = poll_once(api, token, **kwargs)  # type: ignore[arg-type]
    assert answer.status_code == 200, answer.text
    return answer.json()


def last_seen(settings: Settings, runner_id: int) -> datetime:
    with get_sessionmaker(settings)() as session:
        stamp = runners_service.require_runner(session, runner_id).last_seen_at
    assert stamp is not None
    return stamp


def blank_beat(settings: Settings, run_id: int) -> None:
    """Clear a run's beat, so that the next write of it is visible for what it is."""
    with get_sessionmaker(settings)() as session:
        analysis.require_run(session, run_id).heartbeat_at = None
        session.commit()


def age_beat(api: TestClient, runner_id: int, run_id: int) -> None:
    """Age a held attempt out of the beat throttle, the way waiting would."""
    held = api.app.state.gateway.state(runner_id).runs[run_id]
    held.beaten -= runner_gateway.HEARTBEAT_WRITE_SECONDS


# --- announcing ------------------------------------------------------------


def test_a_first_poll_registers_the_engines_and_says_how_often_to_come_back(
    api: TestClient, settings: Settings
) -> None:
    runner_id, token = register(settings, slots=4)

    answer = announce(api, token)

    assert answer["runner_id"] == runner_id
    assert answer["proto"] == protocol.PROTO_VERSION
    assert answer["runner"] == "gpu-box"
    assert answer["poll_seconds"] == 3.0
    assert answer["dispatch"] == []
    assert answer["cancel"] == []
    assert [entry["name"] for entry in answer["engines"]] == ["sf-remote"]
    assert answer["engines"][0]["accepted"] is True
    with get_sessionmaker(settings)() as session:
        assert runners_service.require_runner(session, runner_id).connected is True


def test_an_engine_on_a_polling_runner_is_queue_only(
    api: TestClient, settings: Settings
) -> None:
    """A snapshot needs somewhere to travel, and a poll response is not that."""
    _runner_id, token = register(settings)

    answer = announce(api, token, engines=[STOCKFISH_AD, MAIA_AD])

    assert {entry["name"]: entry["streams"] for entry in answer["engines"]} == {
        "sf-remote": False,
        "maia-remote": False,
    }


def test_a_later_poll_that_re_announces_nothing_keeps_what_it_advertised(
    api: TestClient, settings: Settings
) -> None:
    _runner_id, token = register(settings)
    announce(api, token)

    answer = announce(api, token, engines=None)

    assert [entry["name"] for entry in answer["engines"]] == ["sf-remote"]
    assert answer["engines"][0]["accepted"] is True


# --- taking work away -------------------------------------------------------


def test_a_poll_carries_the_work_the_socket_would_have_pushed(
    api: TestClient, settings: Settings
) -> None:
    _runner_id, token = register(settings)
    game_id = seed_game(api)
    engine_id = announce(api, token)["engines"][0]["engine_id"]
    run_id = enqueue(api, game_id, engine_id, tier="deep")

    answer = announce(api, token)

    assert len(answer["dispatch"]) == 1
    dispatch = answer["dispatch"][0]
    assert "type" not in dispatch
    assert dispatch["run_id"] == run_id
    assert dispatch["engine"] == "sf-remote"
    assert dispatch["maia_engine"] is None
    assert list(protocol.decode_plan(dispatch["plan"]).moves_uci) == PLAYED
    assert run_row(settings, run_id).status is RunStatus.RUNNING


def test_a_poll_never_takes_more_than_the_room_it_reports(
    api: TestClient, settings: Settings
) -> None:
    _runner_id, token = register(settings, slots=4)
    game_id = seed_game(api)
    engine_id = announce(api, token, slots=4)["engines"][0]["engine_id"]
    for _ in range(3):
        enqueue(api, game_id, engine_id, tier="deep")

    answer = announce(api, token, slots=4, free_slots=1)

    assert len(answer["dispatch"]) == 1
    assert api.app.state.gateway.state(_runner_id).busy == 1


def test_a_heartbeat_keeps_a_run_alive_and_a_stolen_one_is_taken_back(
    api: TestClient, settings: Settings
) -> None:
    _runner_id, token = register(settings)
    game_id = seed_game(api)
    engine_id = announce(api, token)["engines"][0]["engine_id"]
    run_id = enqueue(api, game_id, engine_id, tier="deep")
    dispatch = announce(api, token)["dispatch"][0]

    beat = poll_heartbeat(api, token, dispatch, done=4, total=9)
    assert beat.json() == {"ok": True, "cancel": False}

    with get_sessionmaker(settings)() as session:
        analysis.fail_run(
            session, analysis.require_run(session, run_id), "taken away", retry=False
        )
    # The theft is only ever noticed by a beat that actually reaches the row, and the beat
    # above bought this attempt a window of silence.
    age_beat(api, _runner_id, run_id)
    stolen = poll_heartbeat(api, token, dispatch, done=5, total=9)

    assert stolen.json() == {"ok": False, "cancel": True}
    assert api.app.state.gateway.state(_runner_id).busy == 0


def test_a_beat_inside_the_window_is_not_a_second_write(
    api: TestClient, settings: Settings
) -> None:
    """A run says it is alive far more often than the sweep asks, and only the first of
    those says it to the database — the rest are answered from what the gateway already
    knows, which is what keeps the hottest frame in the protocol off SQLite's one writer."""
    runner_id, token = register(settings)
    game_id = seed_game(api)
    engine_id = announce(api, token)["engines"][0]["engine_id"]
    run_id = enqueue(api, game_id, engine_id, tier="deep")
    dispatch = announce(api, token)["dispatch"][0]

    assert poll_heartbeat(api, token, dispatch, done=1, total=9).json()["ok"] is True
    assert run_row(settings, run_id).heartbeat_at is not None, "the first beat writes"
    blank_beat(settings, run_id)

    assert poll_heartbeat(api, token, dispatch, done=2, total=9).json()["ok"] is True
    assert run_row(settings, run_id).heartbeat_at is None, "and the one behind it does not"

    age_beat(api, runner_id, run_id)
    assert poll_heartbeat(api, token, dispatch, done=3, total=9).json()["ok"] is True
    assert run_row(settings, run_id).heartbeat_at is not None, "the window closed"


def test_a_poll_inside_the_window_does_not_write_last_seen_again(
    api: TestClient, settings: Settings
) -> None:
    """What decides a poller is gone is the gateway's own clock, not this column, so it is
    written for the Runners page to read rather than on every visit."""
    runner_id, token = register(settings)
    announce(api, token)
    announce(api, token)
    written = last_seen(settings, runner_id)

    announce(api, token)
    assert last_seen(settings, runner_id) == written

    api.app.state.gateway.state(runner_id).touched -= runner_gateway.TOUCH_WRITE_SECONDS
    announce(api, token)
    assert last_seen(settings, runner_id) > written


def test_a_poll_heartbeat_moves_the_progress_bar_the_way_a_socket_one_does(
    api: TestClient, settings: Settings
) -> None:
    """A run is the same run wherever it ran, and over whatever: the browser watching the
    queue must not be able to tell that this machine fell back to polling."""
    _runner_id, token = register(settings)
    game_id = seed_game(api)
    engine_id = announce(api, token)["engines"][0]["engine_id"]
    run_id = enqueue(api, game_id, engine_id, tier="deep")
    dispatch = announce(api, token)["dispatch"][0]

    with api.websocket_connect("/events", headers=socket_headers(api)) as events:
        assert poll_heartbeat(api, token, dispatch, done=4, total=9).json()["ok"] is True
        frame = until(events, analysis.EVENT_RUN_PROGRESS)

    assert frame["run_id"] == run_id
    assert (frame["done"], frame["total"]) == (4, 9)


# --- handing results back ----------------------------------------------------


def test_a_completed_run_over_the_fallback_writes_its_rows(
    api: TestClient, settings: Settings
) -> None:
    _runner_id, token = register(settings)
    game_id = seed_game(api)
    engine_id = announce(api, token)["engines"][0]["engine_id"]
    run_id = enqueue(api, game_id, engine_id, tier="deep")
    dispatch = announce(api, token)["dispatch"][0]

    answer = poll_complete(
        api,
        token,
        dispatch,
        evals=[eval_row(ply, move_uci=PLAYED[ply]) for ply in range(8)],
        note="human-move predictions skipped: the Maia model is on another host",
    )

    assert answer.status_code == 200
    assert answer.json() == {"accepted": True, "reason": None}
    run = run_row(settings, run_id)
    assert run.status is RunStatus.DONE
    assert run.error == "human-move predictions skipped: the Maia model is on another host"
    with get_sessionmaker(settings)() as session:
        assert [row.move_uci for row in analysis.get_move_evals(session, run_id)] == PLAYED


def test_a_failure_over_the_fallback_is_stored_with_its_stderr(
    api: TestClient, settings: Settings
) -> None:
    _runner_id, token = register(settings)
    game_id = seed_game(api)
    engine_id = announce(api, token)["engines"][0]["engine_id"]
    run_id = enqueue(api, game_id, engine_id, tier="deep")
    dispatch = announce(api, token)["dispatch"][0]

    answer = poll_complete(
        api, token, dispatch, error="EngineError: the process died", stderr="Segmentation fault"
    )

    assert answer.json() == {"accepted": True, "reason": None}
    run = run_row(settings, run_id)
    assert run.status is RunStatus.QUEUED, "one retry, so it comes straight back"
    assert (run.error, run.stderr) == ("EngineError: the process died", "Segmentation fault")


def test_a_replayed_result_is_a_200_that_says_it_was_dropped(
    api: TestClient, settings: Settings
) -> None:
    """The runner did nothing wrong, and a 4xx would only make it try again."""
    _runner_id, token = register(settings)
    game_id = seed_game(api)
    engine_id = announce(api, token)["engines"][0]["engine_id"]
    run_id = enqueue(api, game_id, engine_id, tier="deep")
    dispatch = announce(api, token)["dispatch"][0]
    poll_complete(api, token, dispatch, evals=[eval_row(0)])

    replayed = poll_complete(api, token, dispatch, evals=[eval_row(0), eval_row(1)])

    assert replayed.status_code == 200
    assert replayed.json() == {"accepted": False, "reason": protocol.ERROR_STALE_RESULT}
    with get_sessionmaker(settings)() as session:
        assert len(analysis.get_move_evals(session, run_id)) == 1


def test_a_result_that_is_neither_a_success_nor_a_failure_is_refused(
    api: TestClient, settings: Settings
) -> None:
    _runner_id, token = register(settings)

    answer = api.post(
        "/runner/runs/1/complete", json={"attempt_token": "abc"}, headers=bearer(token)
    )

    assert answer.status_code == 422
    assert answer.json()["error"] == "invalid_request"


# --- reconciliation ----------------------------------------------------------


def test_a_run_the_poller_no_longer_names_goes_back_to_the_queue(
    api: TestClient, settings: Settings
) -> None:
    _runner_id, token = register(settings)
    game_id = seed_game(api)
    engine_id = announce(api, token)["engines"][0]["engine_id"]
    run_id = enqueue(api, game_id, engine_id, tier="deep")
    dispatch = announce(api, token)["dispatch"][0]

    # The runner restarted: it holds nothing, and says so.
    answer = announce(api, token, active_runs=[])

    assert answer["cancel"] == []
    assert [entry["run_id"] for entry in answer["dispatch"]] == [run_id]
    assert answer["dispatch"][0]["attempt_token"] != dispatch["attempt_token"]


def test_a_run_the_poller_names_and_no_longer_owns_is_cancelled_by_id(
    api: TestClient, settings: Settings
) -> None:
    _runner_id, token = register(settings)
    announce(api, token)

    answer = announce(api, token, active_runs=[{"run_id": 9999, "attempt_token": "deadbeef"}])

    assert answer["cancel"] == [9999]


def test_a_run_the_poller_still_holds_is_left_alone(
    api: TestClient, settings: Settings
) -> None:
    _runner_id, token = register(settings)
    game_id = seed_game(api)
    engine_id = announce(api, token)["engines"][0]["engine_id"]
    run_id = enqueue(api, game_id, engine_id, tier="deep")
    dispatch = announce(api, token)["dispatch"][0]

    answer = announce(
        api,
        token,
        free_slots=0,
        active_runs=[
            {"run_id": run_id, "attempt_token": dispatch["attempt_token"]},
        ],
    )

    assert answer["cancel"] == []
    assert answer["dispatch"] == []
    assert run_row(settings, run_id).status is RunStatus.RUNNING


def test_a_poller_that_stops_coming_back_is_dropped_like_a_socket_that_went_quiet(
    api: TestClient, settings: Settings
) -> None:
    """A poller has no ping to miss, so its deadline is the only thing between a machine
    that was switched off and a queue that keeps routing work to it forever."""
    runner_id, token = register(settings)
    announce(api, token)
    gateway = api.app.state.gateway
    state = gateway.state(runner_id)
    state.last_seen -= (
        settings.runner_poll_seconds * runner_gateway.MISSED_POLLS
        + settings.runner_heartbeat_seconds
        + 1.0
    )

    api.portal.call(gateway.beat)

    assert gateway.state(runner_id) is None
    with get_sessionmaker(settings)() as session:
        assert runners_service.require_runner(session, runner_id).connected is False
        engines = engines_service.engines_of_runner(session, runner_id)
        assert [engine.enabled for engine in engines] == [False]


def test_a_poller_that_keeps_coming_back_is_left_alone(
    api: TestClient, settings: Settings
) -> None:
    runner_id, token = register(settings)
    announce(api, token)

    api.portal.call(api.app.state.gateway.beat)

    assert api.app.state.gateway.state(runner_id) is not None


# --- refusals ----------------------------------------------------------------


def test_a_protocol_this_server_does_not_speak_is_a_426(
    api: TestClient, settings: Settings
) -> None:
    _runner_id, token = register(settings)

    answer = poll_once(api, token, proto=2)

    assert answer.status_code == 426
    body = answer.json()
    assert body["error"] == protocol.ERROR_PROTO_MISMATCH
    assert "protocol 1" in body["detail"]


def test_a_token_that_is_nobody_s_is_a_401_that_asks_for_a_bearer(api: TestClient) -> None:
    answer = poll_once(api, "bb_rnr_nonsense")

    assert answer.status_code == 401
    assert answer.json()["error"] == "unauthorized"
    assert answer.headers["www-authenticate"] == 'Bearer realm="blunderbase-runner"'


def test_the_runner_s_own_limiter_shuts_the_door_and_says_for_how_long(
    api: TestClient,
) -> None:
    """Deliberately not the owner's: a stranger here must not lock a browser out."""
    for _ in range(runners_service.LOCKOUT_THRESHOLD):
        assert poll_once(api, "bb_rnr_nonsense").status_code == 401

    locked = poll_once(api, "bb_rnr_nonsense")

    assert locked.status_code == 429
    assert locked.json()["error"] == "locked_out"
    assert int(locked.headers["retry-after"]) >= 1
    # And the owner's own door is untouched by any of it.
    assert api.get("/auth/status").json()["authenticated"] is True


def test_the_poll_endpoints_are_not_behind_the_owner_s_cookie(
    api: TestClient, settings: Settings
) -> None:
    _runner_id, token = register(settings)
    api.cookies.clear()

    assert poll_once(api, token).status_code == 200
