"""Correspondence searches on a runner's engine: step 4 of `docs/correspondence.md`.

The whole journey through the real app — the search worker, the gateway and the rows — with
`tests/fake_runner.py` as the machine at the other end, speaking the protocol frame for
frame. What these prove that no unit test can:

- a search on a runner's engine goes out as `stream_open` under `corr:<id>`, carrying the
  shortlist as root moves, and holds one of the runner's slots without preempting;
- what comes back as snapshots is checkpointed into the tree exactly as a local search's is;
- a pause is `stream_pause` on a runner that can park a process (row `paused`, warm, slot
  free), and a `stream_close` with a cold resume on one that cannot;
- a runner that drops off leaves the row `running` and the page saying "waiting for host",
  and its reconnect opens the search again;
- the capacity strip lists the runner as a host with its own slots.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from backend.api.app import create_app
from backend.config import Settings
from backend.runners import protocol
from backend.services import correspondence as correspondence_service
from backend.services import runners as runners_service
from tests.conftest import running_app, socket_headers
from tests.fake_runner import connect
from tests.test_runner_gateway import register, until

SETTLE_SECONDS = 20.0
LINES = [{"multipv": 1, "cp": 34, "mate": None, "pv": ["e2e4", "e7e5"]}]


@pytest.fixture()
def api(settings: Settings) -> Iterator[TestClient]:
    """The app *with* its workers: the correspondence search worker is the subject."""
    settings.analysis_workers = True
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


def settle(check: Callable[[], Any], what: str, timeout: float = SETTLE_SECONDS) -> Any:
    """Poll until `check` answers with something truthy: the worker is on its own loop."""
    deadline = time.monotonic() + timeout
    last: Any = None
    while time.monotonic() < deadline:
        last = check()
        if last:
            return last
        time.sleep(0.05)
    raise AssertionError(f"{what} never happened (the last look said {last!r})")


def new_game(api: TestClient, opponent: str = "Gegner, Ein") -> dict[str, Any]:
    response = api.post(
        "/correspondence/games",
        json={"white": "Baum, Philipp", "black": opponent, "owner_color": "white"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def search_row(api: TestClient, search_id: int) -> dict[str, Any]:
    listed = api.get("/correspondence/searches", params={"active": "false"}).json()["searches"]
    return next(row for row in listed if row["id"] == search_id)


def status_of(api: TestClient, search_id: int) -> str:
    return str(search_row(api, search_id)["status"])


def runner_row(api: TestClient, runner_id: int) -> dict[str, Any]:
    listed = api.get("/runners").json()
    return next(row for row in listed if row["id"] == runner_id)


def node_depth(api: TestClient, game_id: int, node_id: int) -> int | None:
    tree = api.get(f"/correspondence/games/{game_id}").json()["tree"]
    own = tree.get("own") if tree["id"] == node_id else None
    return None if not own else own.get("depth")


# --- the whole journey ---------------------------------------------------------


def test_a_search_on_a_runner_is_a_stream_that_checkpoints_pauses_warm_and_stops(
    api: TestClient, settings: Settings
) -> None:
    runner_id, token = register(settings, slots=2)
    with api.websocket_connect("/events", headers=socket_headers(api)) as events:
        with connect(api, token, slots=2) as runner:
            engine_id = runner.engine_ids["sf-remote"]
            game = new_game(api)
            node_id = game["tree"]["id"]

            created = api.post(
                "/correspondence/searches",
                json={"node_id": node_id, "engine_id": engine_id, "multipv": 2},
            )
            assert created.status_code == 201, created.text
            search = created.json()
            assert search["runner_id"] == runner_id
            assert search["host_connected"] is True
            session_id = f"corr:{search['id']}"

            # Out over the link, as a stream under the search's own session id.
            opened = runner.recv(protocol.STREAM_OPEN)
            assert opened["session_id"] == session_id
            assert opened["engine"] == "sf-remote"
            assert opened["multipv"] == 2
            assert opened["root_moves"] is None
            # It holds one of the runner's slots — and the strip counts it against that host.
            held = settle(lambda: runner_row(api, runner_id)["streams"] == 1, "the slot")
            assert held
            hosts = {row["host"]: row for row in api.get("/correspondence/status").json()["hosts"]}
            assert hosts["gpu-box"]["slots"] == 2
            assert hosts["gpu-box"]["connected"] is True

            runner.send(protocol.stream_started(session_id=session_id, engine="sf-remote"))
            settle(lambda: status_of(api, search["id"]) == "running", "running")

            runner.send(
                protocol.snapshot_frame(
                    session_id, 1, depth=20, nodes=400_000, nps=200_000, time_ms=2000, lines=LINES
                )
            )
            picture = until(events, correspondence_service.EVENT_SNAPSHOT)
            assert (picture["search_id"], picture["depth"]) == (search["id"], 20)
            # Checkpointed into the tree exactly as a local search's picture is.
            game_id = game["game"]["game_id"]
            settle(lambda: node_depth(api, game_id, node_id) == 20, "the checkpoint")
            # Counted against that host, now that it is running there.
            live = {row["host"]: row for row in api.get("/correspondence/status").json()["hosts"]}
            assert (live["gpu-box"]["in_use"], live["this host"]["in_use"]) == (1, 0)

            # Pause: the runner can park a process, so it is asked to, and answers.
            assert api.post(f"/correspondence/searches/{search['id']}/pause").status_code == 200
            paused = runner.recv(protocol.STREAM_PAUSE)
            assert paused["session_id"] == session_id
            runner.send(protocol.stream_paused(session_id=session_id, warm=True))
            settle(lambda: status_of(api, search["id"]) == "paused", "paused")
            row = search_row(api, search["id"])
            assert row["warm"] is True
            # The slot went back to the runner's queue work.
            settle(lambda: runner_row(api, runner_id)["streams"] == 0, "the slot back")

            # Resume: the parked process over there is set going, not a new one.
            assert api.post(f"/correspondence/searches/{search['id']}/resume").status_code == 200
            resumed = runner.recv(protocol.STREAM_RESUME)
            assert resumed["session_id"] == session_id
            assert resumed["multipv"] == 2
            runner.send(protocol.stream_started(session_id=session_id, engine="sf-remote"))
            settle(lambda: status_of(api, search["id"]) == "running", "running again")

            # Stop: closed over the link, and the runner's answer is what ends the row.
            assert api.post(f"/correspondence/searches/{search['id']}/stop").status_code == 200
            closed = runner.recv(protocol.STREAM_CLOSE)
            assert closed["session_id"] == session_id
            runner.send(protocol.stream_closed(session_id=session_id, reason="closed"))
            settle(lambda: status_of(api, search["id"]) == "stopped", "stopped")
            settle(lambda: runner_row(api, runner_id)["streams"] == 0, "the slot back again")


def test_a_runner_without_warm_pause_is_paused_cold_and_resumed_with_a_fresh_open(
    api: TestClient, settings: Settings
) -> None:
    """A runner from before there was a pause frame: closed, and opened again on resume."""
    _runner_id, token = register(settings, slots=1)
    with connect(api, token, slots=1, features=()) as runner:
        engine_id = runner.engine_ids["sf-remote"]
        game = new_game(api)
        created = api.post(
            "/correspondence/searches",
            json={"node_id": game["tree"]["id"], "engine_id": engine_id},
        )
        assert created.status_code == 201, created.text
        search = created.json()
        session_id = f"corr:{search['id']}"
        runner.recv(protocol.STREAM_OPEN)
        runner.send(protocol.stream_started(session_id=session_id, engine="sf-remote"))
        settle(lambda: status_of(api, search["id"]) == "running", "running")

        api.post(f"/correspondence/searches/{search['id']}/pause")
        closed = runner.recv(protocol.STREAM_CLOSE)
        assert closed["session_id"] == session_id
        runner.send(protocol.stream_closed(session_id=session_id, reason="closed"))
        settle(lambda: status_of(api, search["id"]) == "paused", "paused")
        assert search_row(api, search["id"])["warm"] is False

        api.post(f"/correspondence/searches/{search['id']}/resume")
        reopened = runner.recv(protocol.STREAM_OPEN)
        assert reopened["session_id"] == session_id


def test_a_shortlist_on_a_runner_that_cannot_take_one_fails_the_search_by_name(
    api: TestClient, settings: Settings
) -> None:
    _runner_id, token = register(settings, slots=1)
    with connect(api, token, slots=1, features=()) as runner:
        engine_id = runner.engine_ids["sf-remote"]
        game = new_game(api)
        created = api.post(
            "/correspondence/searches",
            json={"node_id": game["tree"]["id"], "engine_id": engine_id, "root_moves": ["e2e4"]},
        )
        assert created.status_code == 201, created.text
        search = created.json()
        settle(lambda: status_of(api, search["id"]) == "failed", "failed")
        assert "update the runner" in search_row(api, search["id"])["error"]


def test_a_runner_that_drops_off_leaves_the_search_waiting_and_its_return_reopens_it(
    api: TestClient, settings: Settings
) -> None:
    runner_id, token = register(settings, slots=1)
    with connect(api, token, slots=1) as runner:
        engine_id = runner.engine_ids["sf-remote"]
        game = new_game(api)
        created = api.post(
            "/correspondence/searches",
            json={"node_id": game["tree"]["id"], "engine_id": engine_id, "root_moves": ["e2e4"]},
        )
        assert created.status_code == 201, created.text
        search = created.json()
        session_id = f"corr:{search['id']}"
        # A shortlist travels as root moves, which this runner announced it takes.
        assert runner.recv(protocol.STREAM_OPEN)["root_moves"] == ["e2e4"]
        runner.send(protocol.stream_started(session_id=session_id, engine="sf-remote"))
        settle(lambda: status_of(api, search["id"]) == "running", "running")

    # The link is gone. The row is not touched — the search is waiting, not over — and the
    # page is told which of the two it is looking at.
    settle(lambda: runner_row(api, runner_id)["connected"] is False, "the runner away")
    row = search_row(api, search["id"])
    assert row["status"] == "running"
    assert row["host_connected"] is False

    with connect(api, token, slots=1) as runner:
        reopened = runner.recv(protocol.STREAM_OPEN)
        assert reopened["session_id"] == session_id
        assert reopened["root_moves"] == ["e2e4"]
        runner.send(protocol.stream_started(session_id=session_id, engine="sf-remote"))
        settle(lambda: search_row(api, search["id"])["host_connected"] is True, "back")
        api.post(f"/correspondence/searches/{search['id']}/stop")
        runner.recv(protocol.STREAM_CLOSE)
        runner.send(protocol.stream_closed(session_id=session_id, reason="closed"))
        settle(lambda: status_of(api, search["id"]) == "stopped", "stopped")


def test_a_search_waits_for_a_free_slot_rather_than_taking_one_from_a_queue_run(
    api: TestClient, settings: Settings
) -> None:
    """Nobody is sitting at a correspondence search, so it never preempts: two searches on
    a one-slot runner is one searching and one queued until the first lets go."""
    _runner_id, token = register(settings, slots=1)
    with connect(api, token, slots=1) as runner:
        engine_id = runner.engine_ids["sf-remote"]
        first_game = new_game(api)
        second_game = new_game(api, opponent="Andere, Eine")
        first = api.post(
            "/correspondence/searches",
            json={"node_id": first_game["tree"]["id"], "engine_id": engine_id},
        ).json()
        opened = runner.recv(protocol.STREAM_OPEN)
        assert opened["session_id"] == f"corr:{first['id']}"
        runner.send(protocol.stream_started(session_id=opened["session_id"], engine="sf-remote"))
        settle(lambda: status_of(api, first["id"]) == "running", "the first running")

        second = api.post(
            "/correspondence/searches",
            json={"node_id": second_game["tree"]["id"], "engine_id": engine_id},
        ).json()
        time.sleep(0.5)
        assert status_of(api, second["id"]) == "queued"

        api.post(f"/correspondence/searches/{first['id']}/stop")
        runner.recv(protocol.STREAM_CLOSE)
        runner.send(protocol.stream_closed(session_id=opened["session_id"], reason="closed"))
        # The slot came free, and the search that was waiting for it goes out.
        next_open = runner.recv(protocol.STREAM_OPEN)
        assert next_open["session_id"] == f"corr:{second['id']}"
