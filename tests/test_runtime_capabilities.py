"""One build, three runtime surfaces: server, self-contained desktop, and the public demo."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError

from backend.api.app import create_app
from backend.api.auth import COOKIE_NAME, DESKTOP_TOKEN_HEADER
from backend.config import Settings
from tests.conftest import API_BASE_URL

TOKEN = "a" * 64
DESKTOP_CAPABILITIES = {
    "password_auth": False,
    "mcp": False,
    "remote_runners": False,
    "read_only": False,
}
DEMO_CAPABILITIES = {**DESKTOP_CAPABILITIES, "read_only": True}


@pytest.fixture()
def desktop(settings: Settings) -> Iterator[TestClient]:
    settings.runtime_mode = "desktop"
    settings.desktop_token = SecretStr(TOKEN)
    settings.analysis_workers = False
    with TestClient(create_app(settings), base_url=API_BASE_URL) as client:
        yield client


@pytest.fixture()
def demo(settings: Settings) -> Iterator[TestClient]:
    settings.runtime_mode = "demo"
    settings.analysis_workers = False
    with TestClient(create_app(settings), base_url=API_BASE_URL) as client:
        yield client


def unlock(client: TestClient) -> None:
    response = client.get("/auth/status", headers={DESKTOP_TOKEN_HEADER: TOKEN})
    assert response.status_code == 200
    assert response.json()["authenticated"] is True


def test_desktop_mode_requires_a_real_launch_secret(tmp_path) -> None:
    with pytest.raises(ValidationError, match="64-character lowercase hexadecimal token"):
        Settings(root=tmp_path, runtime_mode="desktop", desktop_token="guessable")


def test_desktop_advertises_its_runtime_capabilities_and_never_asks_for_setup(
    desktop: TestClient,
) -> None:
    status = desktop.get("/auth/status").json()

    assert status["capabilities"] == DESKTOP_CAPABILITIES
    assert status["setup_required"] is False
    assert status["authenticated"] is False


def test_the_launch_secret_becomes_an_http_only_desktop_session(desktop: TestClient) -> None:
    response = desktop.get("/auth/status", headers={DESKTOP_TOKEN_HEADER: TOKEN})

    assert response.json()["authenticated"] is True
    assert "HttpOnly" in response.headers["set-cookie"]
    assert desktop.cookies[COOKIE_NAME] == TOKEN
    assert desktop.get("/games").status_code == 200


def test_a_wrong_launch_secret_opens_nothing(desktop: TestClient) -> None:
    response = desktop.get("/auth/status", headers={DESKTOP_TOKEN_HEADER: "b" * 64})

    assert response.json()["authenticated"] is False
    assert desktop.get("/games").status_code == 401


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("/auth/setup", {"password": "valid-password"}),
        ("/auth/login", {"password": "valid-password"}),
        ("/auth/password", {"current": "valid-password", "new": "other-password"}),
        ("/auth/logout", {}),
    ],
)
def test_password_actions_are_unavailable_on_desktop(
    desktop: TestClient, path: str, body: dict[str, str]
) -> None:
    unlock(desktop)

    response = desktop.post(path, json=body)

    assert response.status_code == 404
    assert response.json()["error"] == "capability_unavailable"


def test_remote_surfaces_are_absent_but_local_capacity_remains(desktop: TestClient) -> None:
    unlock(desktop)

    assert desktop.get("/api/mcp-keys").status_code == 404
    assert desktop.get("/api/runners").status_code == 404
    status = desktop.get("/api/runners/status")
    assert status.status_code == 200
    assert status.json()["runners"] == []
    assert status.json()["local"]["name"] == "local"


def test_desktop_can_confirm_a_library_reset_without_a_password(desktop: TestClient) -> None:
    unlock(desktop)

    response = desktop.post("/games/delete-all", json={})

    assert response.status_code == 200
    assert response.json()["games"] == 0


# --- the public demo ---------------------------------------------------------


def test_demo_needs_no_password_and_says_it_is_read_only(demo: TestClient) -> None:
    status = demo.get("/auth/status").json()

    assert status["capabilities"] == DEMO_CAPABILITIES
    assert status["setup_required"] is False
    assert status["authenticated"] is True
    assert "set-cookie" not in demo.get("/auth/status").headers


def test_demo_answers_every_read_to_a_stranger(demo: TestClient) -> None:
    for path in ("/games", "/stats/dimensions", "/explorer", "/notes", "/settings"):
        assert demo.get(path).status_code == 200, path
    assert demo.get("/api/games").status_code == 200
    with demo.websocket_connect("/events") as socket:
        socket.close()


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("POST", "/notes", {"text": "a stranger's note"}),
        ("PUT", "/settings", {}),
        ("POST", "/games/delete-all", {}),
        ("POST", "/import/lichess", {"username": "somebody"}),
        ("DELETE", "/engines/1", None),
        ("PATCH", "/notes/1", {"text": "x"}),
        ("POST", "/api/notes", {"text": "under the prefix too"}),
    ],
)
def test_demo_refuses_every_write_before_a_handler_sees_it(
    demo: TestClient, method: str, path: str, body: dict[str, object] | None
) -> None:
    response = demo.request(method, path, json=body)

    assert response.status_code == 403
    assert response.json()["error"] == "read_only"


def test_demo_still_answers_the_reads_that_are_spelled_post(demo: TestClient) -> None:
    """The analysis board, Maia and a one-off eval touch no row — they pass the guard and
    fail, if they fail, on the engines this deployment has rather than on the rule."""
    for path, body in (
        ("/maia/policy", {"fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"}),
        ("/analysis/position", {"fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"}),
        ("/streams", {"fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"}),
    ):
        response = demo.post(path, json=body)
        assert response.status_code != 403, path
        assert response.json().get("error") != "read_only", path


def test_demo_has_no_coach_and_no_runners(demo: TestClient) -> None:
    assert demo.get("/api/mcp-keys").status_code == 404
    assert demo.get("/api/runners").status_code == 404
    assert demo.post("/auth/setup", json={"password": "valid-password"}).status_code == 404
