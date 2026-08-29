"""`/mcp-keys` — minting and revoking the bearer keys `/mcp` accepts, over the real app."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from mcp.types import LATEST_PROTOCOL_VERSION

from backend.api.app import create_app
from backend.config import Settings
from backend.services import mcp_keys as mcp_keys_service
from tests.conftest import running_app

MCP_HEADERS = {
    "content-type": "application/json",
    "accept": "application/json, text/event-stream",
}
INITIALIZE = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": LATEST_PROTOCOL_VERSION,
        "capabilities": {},
        "clientInfo": {"name": "keys-test", "version": "1"},
    },
}


@pytest.fixture()
def api(settings: Settings) -> Iterator[TestClient]:
    settings.analysis_workers = False
    with running_app(create_app(settings)) as client:
        yield client


def create(api: TestClient, name: str = "claude desktop") -> dict[str, Any]:
    response = api.post("/mcp-keys", json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()


def test_a_key_is_minted_once_and_listed_without_its_token(api: TestClient) -> None:
    created = create(api)

    assert created["token"].startswith(mcp_keys_service.TOKEN_PREFIX)
    assert created["key"]["name"] == "claude desktop"
    assert created["key"]["last_used_at"] is None
    assert "key_hash" not in created["key"]

    listing = api.get("/mcp-keys")
    assert listing.status_code == 200, listing.text
    rows = listing.json()
    assert [row["id"] for row in rows] == [created["key"]["id"]]
    assert created["token"] not in listing.text
    assert "key_hash" not in listing.text


def test_a_duplicate_name_is_a_conflict(api: TestClient) -> None:
    create(api, "laptop")

    response = api.post("/mcp-keys", json={"name": " laptop "})
    assert response.status_code == 409
    assert response.json()["error"] == "duplicate_mcp_key"


def test_a_key_is_revoked_and_a_second_revoke_is_a_404(api: TestClient) -> None:
    created = create(api)
    key_id = created["key"]["id"]

    assert api.delete(f"/mcp-keys/{key_id}").status_code == 204
    assert api.get("/mcp-keys").json() == []
    gone = api.delete(f"/mcp-keys/{key_id}")
    assert gone.status_code == 404
    assert gone.json()["error"] == "unknown_mcp_key"


def test_the_routes_are_behind_the_session(settings: Settings) -> None:
    settings.analysis_workers = False
    with running_app(create_app(settings), password=None) as client:
        assert client.get("/mcp-keys").status_code == 401
        assert client.post("/mcp-keys", json={"name": "x"}).status_code == 401


def test_a_minted_key_opens_mcp_until_it_is_revoked(api: TestClient) -> None:
    """The whole point, end to end: mint in the browser, connect the coach, revoke."""
    created = create(api)
    headers = {**MCP_HEADERS, "authorization": f"Bearer {created['token']}"}

    with_key = api.post("/mcp", json=INITIALIZE, headers=headers)
    assert with_key.status_code == 200, with_key.text
    assert '"blunderbase"' in with_key.text

    stamped = api.get("/mcp-keys").json()[0]
    assert stamped["last_used_at"] is not None

    assert api.delete(f"/mcp-keys/{created['key']['id']}").status_code == 204
    revoked = api.post("/mcp", json=INITIALIZE, headers=headers)
    assert revoked.status_code == 401
    assert "serverInfo" not in revoked.text
