"""`/runners` — the owner's side of the runner surface, over the real app.

The runners here are `tests/fake_runner.py` on the real socket, so what these tests read
back is the gateway's actual state rather than a fixture pretending to be one: a runner is
"connected" because a link is open, `busy` is a slot really holding a dispatched run, and a
revoke is asserted by the socket closing and the run coming back to the queue.

The local worker set is off throughout. A run bound to a remote engine is not its work.
"""

from __future__ import annotations

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
from backend.runners.config import WS_PATH, WS_SUBPROTOCOL, RunnerConfig
from backend.services import runners as runners_service
from tests.conftest import running_app, socket_headers
from tests.fake_runner import WASM_AD, FakeRunner, connect
from tests.fake_uci import STOCKFISH_OPTIONS, fake_engine_command
from tests.test_runner_gateway import (
    dispatch_for,
    enqueue,
    register,
    run_row,
    seed_game,
    until,
    wait_for,
)


@pytest.fixture()
def api(settings: Settings) -> Iterator[TestClient]:
    """The app with no local workers and no clock of its own: the tests drive both."""
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


def create(api: TestClient, name: str = "gpu-box", **body: Any) -> dict[str, Any]:
    response = api.post("/runners", json={"name": name, **body})
    assert response.status_code == 201, response.text
    return response.json()


def local_engine(api: TestClient, tmp_path: Path) -> int:
    """A scripted UCI binary on this host, registered the way the Engines page registers one."""
    path = fake_engine_command(tmp_path, name="FakeFish 1", options=STOCKFISH_OPTIONS)
    created = api.post("/engines", json={"name": "fakefish", "path": path})
    assert created.status_code == 201, created.text
    return int(created.json()["id"])


def listed(api: TestClient) -> list[dict[str, Any]]:
    response = api.get("/runners")
    assert response.status_code == 200, response.text
    return response.json()


# --- registering ------------------------------------------------------------


def test_creating_a_runner_hands_over_a_token_and_a_paste_ready_yaml(api: TestClient) -> None:
    created = create(api, "gpu-box", slots=4)

    assert created["runner"]["name"] == "gpu-box"
    assert created["runner"]["slots"] == 4
    assert created["runner"]["connected"] is False
    assert created["runner"]["transport"] is None
    assert created["token"].startswith(runners_service.TOKEN_PREFIX)

    # The yaml is not decoration: it is what the runner on the other machine will load.
    config = RunnerConfig.from_mapping(yaml.safe_load(created["config_yaml"]), source="runner.yaml")
    assert config.token == created["token"]
    assert config.name == "gpu-box"
    assert config.slots == 4
    assert config.ws_url.startswith("ws://") and config.ws_url.endswith(WS_PATH)


def test_the_yaml_names_the_server_the_deployment_says_it_is(api: TestClient) -> None:
    api.app.state.settings.public_url = "https://blunderbase.example.com/"

    created = create(api, "gpu-box")

    config = RunnerConfig.from_mapping(yaml.safe_load(created["config_yaml"]))
    assert config.server == "https://blunderbase.example.com"
    assert config.ws_url == "wss://blunderbase.example.com/runner/ws"


def test_the_token_is_shown_once_and_is_readable_nowhere_else(api: TestClient) -> None:
    created = create(api, "gpu-box")

    rows = listed(api)
    assert [row["name"] for row in rows] == ["gpu-box"]
    assert "token" not in rows[0]
    assert created["token"] not in api.get("/runners/status").text


def test_a_second_runner_of_the_same_name_is_refused(api: TestClient) -> None:
    create(api, "gpu-box")

    refused = api.post("/runners", json={"name": "gpu-box"})

    assert refused.status_code == 409
    assert refused.json()["error"] == "duplicate_runner"


def test_the_name_this_host_answers_to_is_not_available(api: TestClient) -> None:
    refused = api.post("/runners", json={"name": "local"})

    assert refused.status_code == 422
    assert refused.json()["error"] == "invalid_runner"


# --- what the list says -----------------------------------------------------


def test_a_connected_runner_reports_its_link_its_engines_and_its_backlog(
    api: TestClient, settings: Settings
) -> None:
    """One slot, one run on it, one run waiting: every count in the payload at once."""
    _runner_id, token = register(settings, "gpu-box", slots=1)
    game_id = seed_game(api)

    with connect(api, token) as runner:
        engine_id = runner.engine_ids["sf-remote"]
        held = enqueue(api, game_id, engine_id, tier="deep")
        dispatch_for(runner)
        waiting = enqueue(api, game_id, engine_id, tier="deep")

        row = listed(api)[0]
        # Read while the link is up: closing it hands the dispatched run straight back.
        assert run_row(settings, held).status is RunStatus.RUNNING
        assert run_row(settings, waiting).status is RunStatus.QUEUED

    assert row["connected"] is True
    assert row["transport"] == "websocket"
    assert row["version"] == "0.1.0"
    assert (row["slots"], row["busy"], row["streams"], row["free_slots"]) == (1, 1, 0, 0)
    assert row["queued_eligible"] == 1, "the second run can only be done by this runner"
    assert [engine["name"] for engine in row["engines"]] == ["sf-remote"]
    assert row["engines"][0]["streams"] is True
    assert row["engines"][0]["path"] == "/usr/games/stockfish"


def test_a_runner_nobody_has_dialled_in_for_is_simply_not_connected(api: TestClient) -> None:
    create(api, "gpu-box", slots=4)

    row = listed(api)[0]

    assert (row["connected"], row["transport"]) == (False, None)
    assert (row["busy"], row["free_slots"], row["queued_eligible"]) == (0, 0, 0)
    assert row["engines"] == []


def test_status_puts_this_host_beside_the_runners(api: TestClient, settings: Settings) -> None:
    _runner_id, token = register(settings, "gpu-box", slots=2)
    game_id = seed_game(api)

    with connect(api, token) as runner:
        enqueue(api, game_id, runner.engine_ids["sf-remote"], tier="deep")
        dispatch_for(runner)

        payload = api.get("/runners/status").json()

    assert [row["name"] for row in payload["runners"]] == ["gpu-box"]
    assert payload["runners"][0]["busy"] == 1
    assert payload["local"]["name"] == "local"
    assert payload["local"]["slots"] == settings.analysis_concurrency
    assert payload["local"]["workers"] is False, "this app was started without them"
    assert payload["local"]["queued"] == 0
    assert payload["queue"] == {"queued": 0, "running": 1}


# --- editing ----------------------------------------------------------------


def test_renaming_a_runner_keeps_its_link_and_says_so_on_the_socket(
    api: TestClient, settings: Settings
) -> None:
    runner_id, token = register(settings, "gpu-box", slots=2)

    with connect(api, token) as runner, api.websocket_connect(
        "/events", headers=socket_headers(api)
    ) as events:
        renamed = api.patch(f"/runners/{runner_id}", json={"name": "the-big-one", "slots": 4})
        announced = until(events, runners_service.EVENT_RUNNER_UPDATED)

        assert renamed.status_code == 200, renamed.text
        assert renamed.json()["name"] == "the-big-one"
        assert renamed.json()["slots"] == 4
        assert renamed.json()["connected"] is True, "a rename is not a disconnection"
        assert announced["name"] == "the-big-one"
        # The token is the identity, so the runner on the wire is untouched by all this.
        runner.send(protocol.ping(1.0))
        assert runner.recv(protocol.PONG)["t"] == 1.0


def test_an_edit_does_not_raise_the_cap_past_what_the_runner_said_it_can_do(
    api: TestClient, settings: Settings
) -> None:
    """The handshake holds a link to the lower of the row's cap and the machine's claim.
    An edit — even one that only renames — must not quietly undo that."""
    runner_id, token = register(settings, "gpu-box", slots=8)

    with connect(api, token, slots=2) as runner:
        assert runner.welcome["slots"] == 2

        renamed = api.patch(f"/runners/{runner_id}", json={"name": "the-big-one"})

        assert renamed.status_code == 200, renamed.text
        state = api.app.state.gateway.state(runner_id)
        assert (state.name, state.slots, state.free_slots) == ("the-big-one", 2, 2)


def test_a_new_cap_reaches_the_live_link_without_a_reconnect(
    api: TestClient, settings: Settings
) -> None:
    runner_id, token = register(settings, "gpu-box", slots=1)
    game_id = seed_game(api)

    with connect(api, token) as runner:
        engine_id = runner.engine_ids["sf-remote"]
        enqueue(api, game_id, engine_id, tier="deep")
        dispatch_for(runner)
        second = enqueue(api, game_id, engine_id, tier="deep")

        assert api.patch(f"/runners/{runner_id}", json={"slots": 2}).status_code == 200

        dispatched = dispatch_for(runner)
        assert dispatched["run_id"] == second


def test_only_the_fields_that_were_sent_change(api: TestClient) -> None:
    created = create(api, "gpu-box", slots=4)

    updated = api.patch(f"/runners/{created['runner']['id']}", json={"name": "cpu-box"})

    assert updated.json()["slots"] == 4


def test_editing_a_runner_that_is_not_there_is_a_named_404(api: TestClient) -> None:
    missing = api.patch("/runners/404", json={"name": "nobody"})

    assert missing.status_code == 404
    assert missing.json()["error"] == "unknown_runner"


# --- revoking ---------------------------------------------------------------


def test_revoking_closes_the_link_and_gives_the_work_back(
    api: TestClient, settings: Settings
) -> None:
    runner_id, token = register(settings, "gpu-box", slots=2)
    game_id = seed_game(api)

    with connect(api, token) as runner:
        run_id = enqueue(api, game_id, runner.engine_ids["sf-remote"], tier="deep")
        dispatch_for(runner)

        revoked = api.delete(f"/runners/{runner_id}")

        assert revoked.status_code == 204
        code, reason = runner.closed()

    assert (code, reason) == (protocol.WS_CLOSE_REVOKED, "revoked")
    requeued = wait_for(settings, run_id, RunStatus.QUEUED)
    assert requeued.attempts == 0, "the owner took the runner away; that is not a failed try"
    assert requeued.engine_id is None, "the engine went with the runner that advertised it"
    assert listed(api) == []
    assert api.get("/engines").json() == []


def test_a_revoked_token_opens_nothing(api: TestClient, settings: Settings) -> None:
    runner_id, token = register(settings, "gpu-box")
    assert api.delete(f"/runners/{runner_id}").status_code == 204

    with api.websocket_connect("/runner/ws", headers={"Authorization": f"Bearer {token}"}) as ws:
        code, _reason = FakeRunner(ws).closed()

    assert code == protocol.WS_CLOSE_UNAUTHORIZED


# --- the handshake a browser can perform ------------------------------------
#
# `new WebSocket(url, protocols)` is the whole of what a tab can send: no headers, and a
# token in the query string would be written into every access log on the way. So the
# token rides in `Sec-WebSocket-Protocol` behind a sentinel, and the accept has to echo the
# sentinel back or the browser fails the handshake — including when it is about to refuse.


def test_a_tab_may_present_its_token_as_a_subprotocol(
    api: TestClient, settings: Settings
) -> None:
    _runner_id, token = register(settings, "this-browser", slots=1)

    with api.websocket_connect(WS_PATH, subprotocols=[WS_SUBPROTOCOL, token]) as socket:
        assert socket.accepted_subprotocol == WS_SUBPROTOCOL
        runner = FakeRunner(socket, name="this-browser", slots=1)
        welcome = runner.hello(browser=True)

    assert welcome["runner"] == "this-browser"
    with get_sessionmaker(settings)() as session:
        assert runners_service.runner_by_name(session, "this-browser").browser is True


def test_a_tabs_engine_is_listed_as_something_other_than_a_file(
    api: TestClient, settings: Settings
) -> None:
    """The page has to say "in this browser" rather than render `wasm:…` as a path, so the
    scheme is on the payload and no client has to parse the string to find it."""
    _runner_id, token = register(settings, "this-browser", slots=1)

    with api.websocket_connect(WS_PATH, subprotocols=[WS_SUBPROTOCOL, token]) as socket:
        FakeRunner(socket, name="this-browser", slots=1, engines=[WASM_AD]).hello(browser=True)
        listing = api.get("/runners").json()
        engines = api.get("/engines").json()

    row = listing[0]
    assert row["browser"] is True
    assert row["engines"][0]["path"] == "wasm:stockfish-18"
    assert row["engines"][0]["path_scheme"] == "wasm"
    assert engines[0]["path_scheme"] == "wasm"


def test_a_refused_tab_is_still_answered_with_the_subprotocol_it_offered(
    api: TestClient,
) -> None:
    """Otherwise the browser fails the handshake itself and the 4401 never reaches it."""
    with api.websocket_connect(
        WS_PATH, subprotocols=[WS_SUBPROTOCOL, "bb_rnr_nobody"]
    ) as socket:
        assert socket.accepted_subprotocol == WS_SUBPROTOCOL
        code, _reason = FakeRunner(socket).closed()

    assert code == protocol.WS_CLOSE_UNAUTHORIZED


def test_a_socket_offering_only_the_sentinel_carries_no_token(api: TestClient) -> None:
    with api.websocket_connect(WS_PATH, subprotocols=[WS_SUBPROTOCOL]) as socket:
        code, _reason = FakeRunner(socket).closed()

    assert code == protocol.WS_CLOSE_UNAUTHORIZED


def test_a_subprotocol_without_the_sentinel_is_not_a_credential(
    api: TestClient, settings: Settings
) -> None:
    """A bare list of protocols is somebody else's contract, not a token to read."""
    _runner_id, token = register(settings, "gpu-box")

    with api.websocket_connect(WS_PATH, subprotocols=[token]) as socket:
        assert socket.accepted_subprotocol is None
        code, _reason = FakeRunner(socket).closed()

    assert code == protocol.WS_CLOSE_UNAUTHORIZED


def test_a_token_in_the_query_string_opens_nothing(api: TestClient, settings: Settings) -> None:
    """It would be logged by every proxy it passed through, so it is not read."""
    _runner_id, token = register(settings, "gpu-box")

    with api.websocket_connect(f"{WS_PATH}?token={token}") as socket:
        code, _reason = FakeRunner(socket).closed()

    assert code == protocol.WS_CLOSE_UNAUTHORIZED


def test_the_header_still_opens_the_socket_and_says_nothing_about_a_browser(
    api: TestClient, settings: Settings
) -> None:
    """The Python runner is unchanged by any of this."""
    _runner_id, token = register(settings, "gpu-box")

    with connect(api, token) as runner:
        assert runner.welcome is not None

    with get_sessionmaker(settings)() as session:
        assert runners_service.runner_by_name(session, "gpu-box").browser is False


def test_revoking_a_runner_that_is_not_there_is_a_named_404(api: TestClient) -> None:
    missing = api.delete("/runners/404")

    assert missing.status_code == 404
    assert missing.json()["error"] == "unknown_runner"


# --- the queue breakdown ----------------------------------------------------


def test_the_queue_says_where_the_backlog_will_be_worked(
    api: TestClient, settings: Settings, tmp_path: Path
) -> None:
    """A mixed deployment: a binary here, a runner there, and a backlog split between them."""
    _runner_id, token = register(settings, "gpu-box", slots=1)
    game_id = seed_game(api)
    here = local_engine(api, tmp_path)

    with connect(api, token) as runner:
        engine_id = runner.engine_ids["sf-remote"]
        enqueue(api, game_id, engine_id, tier="deep")
        dispatch_for(runner)
        enqueue(api, game_id, engine_id, tier="deep")
        enqueue(api, game_id, here, tier="quick")

        payload = api.get("/analysis/queue").json()

    assert (payload["queued"], payload["running"]) == (2, 1)
    destinations = {row["destination"]: row for row in payload["destinations"]}
    assert destinations["local"] == {
        "destination": "local",
        "runner_id": None,
        "name": "local",
        "connected": True,
        "slots": settings.analysis_concurrency,
        "queued": 1,
        "running": 0,
        "streams": 0,
    }
    assert destinations["runner"]["name"] == "gpu-box"
    assert (destinations["runner"]["queued"], destinations["runner"]["running"]) == (1, 1)
    assert destinations["runner"]["connected"] is True


def test_a_deployment_with_no_runners_reads_exactly_as_it_did_before(api: TestClient) -> None:
    payload = api.get("/analysis/queue").json()

    assert (payload["queued"], payload["running"], payload["busy"]) == (0, 0, 0)
    assert [row["destination"] for row in payload["destinations"]] == ["local"]
    assert api.get("/runners").json() == []
    assert api.get("/runners/status").json()["runners"] == []
