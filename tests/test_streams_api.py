"""Infinite analysis end to end: `/streams` in, `stream.snapshot` out.

Both halves of the promise are here. A board on a binary this host starts really starts one
— a scripted UCI process, driven over a pipe, answering `go infinite` and holding it until
it is stopped. A board on a runner goes down the real socket to `tests/fake_runner.py` and
its snapshots come back up. The assertions on the two are deliberately the same shape,
because the whole point is that a browser cannot tell them apart.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from backend.api.app import create_app
from backend.config import Settings
from backend.db.enums import RunStatus
from backend.runners import protocol
from backend.services import streams as streams_service
from tests.conftest import running_app, socket_headers
from tests.fake_runner import connect
from tests.fake_uci import STOCKFISH_OPTIONS, fake_engine_command
from tests.test_runner_gateway import enqueue, register, seed_game, until, wait_for

STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"

SETTLE_SECONDS = 10.0

# One reply per `go`: each holds the search open until `stop`, and each answers with a
# move that is legal on the board it was actually given.
INFINITE_GOES = [
    {
        "info": ["depth 12 seldepth 20 score cp 31 nodes 4000 nps 8000 time 500 pv e2e4 e7e5"],
        "hold": True,
        "bestmove": "e2e4",
    },
    {
        "info": ["depth 9 score cp -18 nodes 2500 nps 5000 time 500 pv e7e5 g1f3"],
        "hold": True,
        "bestmove": "e7e5",
    },
]


@pytest.fixture()
def api(settings: Settings) -> Iterator[TestClient]:
    """The app with no local queue workers: every engine here is somebody's analysis board."""
    settings.analysis_workers = False
    settings.runner_heartbeat_seconds = 60.0
    settings.runner_stale_sweep_seconds = 60.0
    # The reaper is not what these tests are about, and an `/events` socket is open
    # throughout anyway.
    settings.stream_idle_seconds = 300.0
    with running_app(create_app(settings)) as client:
        yield client


def local_engine(api: TestClient, tmp_path: Path, **scenario: Any) -> int:
    """One scripted UCI binary, registered the way the Engines page registers one."""
    path = fake_engine_command(
        tmp_path, name="FakeFish 1", options=STOCKFISH_OPTIONS, **scenario
    )
    created = api.post(
        "/engines", json={"name": "fakefish", "path": path, "default_tier": "deep"}
    )
    assert created.status_code == 201, created.text
    return int(created.json()["id"])


def opened(api: TestClient, **body: Any) -> dict[str, Any]:
    response = api.post("/streams", json={"fen": STARTING_FEN, **body})
    assert response.status_code == 201, response.text
    return response.json()


# --- a board on this host -------------------------------------------------------


def test_a_local_board_streams_snapshots_moves_and_closes(
    api: TestClient, tmp_path: Path
) -> None:
    engine_id = local_engine(api, tmp_path, go=INFINITE_GOES)

    with api.websocket_connect("/events", headers=socket_headers(api)) as events:
        session = opened(api, engine_id=engine_id, multipv=1, game_id=7, ply=12)
        assert session["engine"] == "fakefish"
        assert session["runner_id"] is None
        assert (session["game_id"], session["ply"]) == (7, 12)

        first = until(events, streams_service.EVENT_STREAM_SNAPSHOT)
        assert first["session_id"] == session["id"]
        assert first["seq"] == 1
        assert first["depth"] == 12
        assert first["nodes"] == 4000
        assert first["lines"] == [
            {"multipv": 1, "cp": 31, "mate": None, "pv": ["e2e4", "e7e5"]}
        ]

        moved = api.patch(f"/streams/{session['id']}", json={"fen": AFTER_E4})
        assert moved.status_code == 200, moved.text
        assert moved.json()["fen"].startswith("rnbqkbnr/pppppppp/8/8/4P3")

        # A restart is stop-and-go on the same slot, so the next snapshot is the new
        # position's — evaluated, as an analysis board always is, from the mover's chair.
        after = _snapshot_of(events, moved.json()["fen"])
        assert after["lines"][0] == {
            "multipv": 1,
            "cp": -18,
            "mate": None,
            "pv": ["e7e5", "g1f3"],
        }

        assert api.delete(f"/streams/{session['id']}").status_code == 204
        ended = until(events, streams_service.EVENT_STREAM_ENDED)

    assert (ended["session_id"], ended["reason"]) == (session["id"], "closed")
    assert api.get("/streams").json() == []


def test_a_board_is_listed_while_it_is_open(api: TestClient, tmp_path: Path) -> None:
    engine_id = local_engine(api, tmp_path, go=INFINITE_GOES)

    with api.websocket_connect("/events", headers=socket_headers(api)):
        session = opened(api, engine_id=engine_id, surface="live")
        listed = api.get("/streams").json()
        api.delete(f"/streams/{session['id']}")

    assert [entry["id"] for entry in listed] == [session["id"]]
    assert listed[0]["surface"] == "live"


def test_an_engine_that_will_not_start_is_a_refusal_not_a_silent_board(
    api: TestClient, tmp_path: Path
) -> None:
    """A board that cannot be served has to say so at the POST, not by never drawing."""
    engine_id = local_engine(api, tmp_path, go=INFINITE_GOES)
    # Registered, and then its scenario taken out from under it: what a binary that has
    # moved since somebody added it looks like from here.
    Path(_scenario_path(api, engine_id)).unlink()

    refused = api.post("/streams", json={"fen": STARTING_FEN, "engine_id": engine_id})

    assert refused.status_code == 409
    assert refused.json()["error"] == "stream_unavailable"


def test_a_board_asked_for_a_position_that_is_not_one_is_refused(api: TestClient) -> None:
    refused = api.post("/streams", json={"fen": "definitely not a fen"})

    assert refused.status_code == 422
    assert refused.json()["error"] == "invalid_request"


def test_closing_a_board_that_never_existed_is_a_404(api: TestClient) -> None:
    gone = api.delete("/streams/str_nothing")

    assert gone.status_code == 404
    assert gone.json()["error"] == "unknown_stream"


# --- a board on a runner ---------------------------------------------------------


def test_a_remote_board_is_the_same_board(api: TestClient, settings: Settings) -> None:
    """Open, snapshot, move, close — down a socket, and indistinguishable at the top."""
    runner_id, token = register(settings, slots=2)

    with api.websocket_connect("/events", headers=socket_headers(api)) as events:
        with connect(api, token) as runner:
            engine_id = runner.engine_ids["sf-remote"]
            session = opened(api, engine_id=engine_id, multipv=3)
            assert (session["runner_id"], session["runner"]) == (runner_id, "gpu-box")

            request = runner.recv(protocol.STREAM_OPEN)
            assert request["session_id"] == session["id"]
            assert request["engine"] == "sf-remote"
            assert request["multipv"] == 3
            assert request["fen"] == session["fen"]
            assert request["interval_ms"] == int(settings.stream_snapshot_interval * 1000)
            # The board holds one of the runner's slots, and the dispatcher knows it.
            assert api.app.state.gateway.state(runner_id).streams == {session["id"]}

            runner.send(protocol.stream_started(session_id=session["id"], engine="sf-remote"))
            runner.send(
                protocol.snapshot_frame(
                    session["id"],
                    99,
                    depth=24,
                    nodes=18_402_113,
                    nps=1_840_211,
                    time_ms=10_000,
                    lines=[{"multipv": 1, "cp": 34, "mate": None, "pv": ["e2e4", "e7e5"]}],
                )
            )
            relayed = until(events, streams_service.EVENT_STREAM_SNAPSHOT)

            api.patch(f"/streams/{session['id']}", json={"fen": AFTER_E4, "multipv": 2})
            restart = runner.recv(protocol.STREAM_RESTART)

            api.delete(f"/streams/{session['id']}")
            closed = runner.recv(protocol.STREAM_CLOSE)

    assert relayed["seq"] == 1, "the runner's own numbering is not the one the page reads"
    assert (relayed["runner_id"], relayed["engine_id"]) == (runner_id, engine_id)
    assert relayed["depth"] == 24
    assert relayed["lines"] == [{"multipv": 1, "cp": 34, "mate": None, "pv": ["e2e4", "e7e5"]}]
    assert (restart["session_id"], restart["multipv"]) == (session["id"], 2)
    assert restart["fen"].startswith("rnbqkbnr/pppppppp/8/8/4P3")
    assert closed == {
        "type": protocol.STREAM_CLOSE,
        "session_id": session["id"],
        "reason": "closed",
    }


def test_a_runner_that_says_its_engine_died_ends_the_board(
    api: TestClient, settings: Settings
) -> None:
    _runner_id, token = register(settings)

    with api.websocket_connect("/events", headers=socket_headers(api)) as events:
        with connect(api, token) as runner:
            session = opened(api, engine_id=runner.engine_ids["sf-remote"])
            runner.recv(protocol.STREAM_OPEN)
            runner.send(
                protocol.stream_closed(
                    session_id=session["id"],
                    reason="engine_failed",
                    error="EngineTerminatedError: it died",
                )
            )
            ended = until(events, streams_service.EVENT_STREAM_ENDED)

    assert (ended["reason"], ended["error"]) == (
        "engine_failed",
        "EngineTerminatedError: it died",
    )
    assert api.get("/streams").json() == []


def test_a_runner_that_drops_takes_its_board_with_it(
    api: TestClient, settings: Settings
) -> None:
    """The page is told why, so it can offer another engine — this host's, if there is one."""
    _runner_id, token = register(settings)

    with api.websocket_connect("/events", headers=socket_headers(api)) as events:
        with connect(api, token) as runner:
            session = opened(api, engine_id=runner.engine_ids["sf-remote"])
            runner.recv(protocol.STREAM_OPEN)
        ended = until(events, streams_service.EVENT_STREAM_ENDED, limit=100)

    assert (ended["session_id"], ended["reason"]) == (session["id"], "runner_gone")


def test_a_board_takes_the_slot_of_a_queue_run_rather_than_waiting_for_it(
    api: TestClient, settings: Settings
) -> None:
    """D6: somebody is at a board; a deep pass can start again a minute later."""
    runner_id, token = register(settings, slots=1)
    game_id = seed_game(api)

    with connect(api, token, slots=1) as runner:
        engine_id = runner.engine_ids["sf-remote"]
        run_id = enqueue(api, game_id, engine_id, tier="deep")
        dispatched = runner.recv(protocol.RUN_DISPATCH)
        assert dispatched["run_id"] == run_id

        session = opened(api, engine_id=engine_id)
        # The cancel and the open race each other down one socket, and which arrives
        # first is not something the runner is entitled to an opinion about.
        arrived = _frames(runner, protocol.RUN_CANCEL, protocol.STREAM_OPEN)
        preempted = wait_for(settings, run_id, RunStatus.QUEUED)
        assert api.app.state.gateway.state(runner_id).streams == {session["id"]}

    assert arrived[protocol.RUN_CANCEL]["reason"] == "preempted"
    assert arrived[protocol.STREAM_OPEN]["session_id"] == session["id"]
    # Taken away, not failed: the run is worth exactly as many attempts as it was.
    assert preempted.attempts == 0


def test_a_runner_with_nothing_free_and_nothing_to_take_refuses_the_board(
    api: TestClient, settings: Settings
) -> None:
    runner_id, token = register(settings, slots=1)

    with connect(api, token, slots=1) as runner:
        engine_id = runner.engine_ids["sf-remote"]
        first = opened(api, engine_id=engine_id, surface="game")
        runner.recv(protocol.STREAM_OPEN)
        assert api.app.state.gateway.state(runner_id).free_slots == 0

        refused = api.post(
            "/streams", json={"fen": STARTING_FEN, "engine_id": engine_id, "surface": "live"}
        )

    assert first["id"]
    assert refused.status_code == 409
    assert refused.json()["error"] == "stream_unavailable"


# --- helpers -----------------------------------------------------------------------


def _frames(runner: Any, *kinds: str, limit: int = 20) -> dict[str, dict[str, Any]]:
    """Read until every named frame has arrived, whatever order they come in."""
    found: dict[str, dict[str, Any]] = {}
    for _ in range(limit):
        if not set(kinds) - set(found):
            return found
        frame = runner.recv()
        found.setdefault(str(frame.get("type")), frame)
    raise AssertionError(f"only {sorted(found)} arrived, not {sorted(kinds)}")


def _snapshot_of(events: Any, fen: str, limit: int = 60) -> dict[str, Any]:
    """The first snapshot of a particular position, ignoring the previous one's tail."""
    seen: list[str] = []
    for _ in range(limit):
        frame = events.receive_json()
        seen.append(str(frame.get("event")))
        if (
            frame.get("event") == streams_service.EVENT_STREAM_SNAPSHOT
            and frame.get("fen") == fen
            and frame.get("lines")
        ):
            return frame
    raise AssertionError(f"no snapshot of {fen} arrived; the socket carried {seen}")


def _scenario_path(api: TestClient, engine_id: int) -> str:
    """The scenario file behind a scripted engine, which is the file to delete."""
    path = api.get(f"/engines/{engine_id}").json()["path"]
    return path.rsplit(" ", 1)[-1]
