from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import httpx
import pytest
from mcp.types import LATEST_PROTOCOL_VERSION
from sqlalchemy.orm import Session, sessionmaker
from starlette.types import Receive, Scope, Send

from backend.config import Settings
from backend.mcp.http import BearerGuard, TransportDisabledError, create_http_app

KEY = "not-the-key-you-are-looking-for"
BASE_URL = "http://127.0.0.1:8765"
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
        "clientInfo": {"name": "bearer-test", "version": "1"},
    },
}


@pytest.fixture()
def remote_settings(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> Settings:
    """Settings with the remote transport configured, independent of the environment."""
    monkeypatch.delenv("BLUNDERBASE_MCP_BEARER_KEY", raising=False)
    return Settings(root=tmp_path, mcp_bearer_key=KEY)


async def echo(scope: Scope, receive: Receive, send: Send) -> None:
    """The app behind the guard, standing in for the MCP transport."""
    if scope["type"] == "lifespan":
        while True:
            message = await receive()
            if message["type"] == "lifespan.startup":
                await send({"type": "lifespan.startup.complete"})
            elif message["type"] == "lifespan.shutdown":
                await send({"type": "lifespan.shutdown.complete"})
                return
    body = json.dumps({"reached": scope["path"]}).encode()
    await send(
        {
            "type": "http.response.start",
            "status": 200,
            "headers": [(b"content-type", b"application/json")],
        }
    )
    await send({"type": "http.response.body", "body": body})


@asynccontextmanager
async def running(app: Any) -> AsyncIterator[httpx.AsyncClient]:
    """An ASGI app with its lifespan started, and a client pointed at it.

    The streamable-HTTP app runs its session manager in the lifespan, and httpx's ASGI
    transport does not drive lifespan itself, so the protocol is spoken here by hand.
    """
    incoming: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    outgoing: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    task = asyncio.create_task(
        app({"type": "lifespan", "asgi": {"version": "3.0"}}, incoming.get, outgoing.put)
    )
    await incoming.put({"type": "lifespan.startup"})
    started = await outgoing.get()
    assert started["type"] == "lifespan.startup.complete", started
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url=BASE_URL
        ) as client:
            yield client
    finally:
        await incoming.put({"type": "lifespan.shutdown"})
        await outgoing.get()
        await task


# --- the guard itself ------------------------------------------------------


async def test_a_request_without_a_key_is_refused() -> None:
    async with running(BearerGuard(echo, KEY)) as client:
        response = await client.get("/mcp")
    assert response.status_code == 401
    assert response.headers["www-authenticate"].startswith("Bearer")
    assert response.json()["error"] == "unauthorized"


async def test_a_request_with_the_wrong_key_is_refused() -> None:
    async with running(BearerGuard(echo, KEY)) as client:
        response = await client.get("/mcp", headers={"authorization": f"Bearer {KEY}x"})
    assert response.status_code == 401


@pytest.mark.parametrize(
    "header",
    ["", KEY, f"Basic {KEY}", f"Bearer{KEY}", "Bearer", "Bearer "],
)
async def test_a_malformed_authorization_header_is_refused(header: str) -> None:
    async with running(BearerGuard(echo, KEY)) as client:
        response = await client.get("/mcp", headers={"authorization": header})
    assert response.status_code == 401


async def test_the_right_key_reaches_the_app() -> None:
    async with running(BearerGuard(echo, KEY)) as client:
        response = await client.get("/mcp", headers={"authorization": f"Bearer {KEY}"})
    assert response.status_code == 200
    assert response.json() == {"reached": "/mcp"}


async def test_the_scheme_is_read_case_insensitively() -> None:
    async with running(BearerGuard(echo, KEY)) as client:
        response = await client.get("/mcp", headers={"authorization": f"bearer {KEY}"})
    assert response.status_code == 200


async def test_the_transport_refuses_to_exist_without_a_key(tmp_path: Any) -> None:
    with pytest.raises(TransportDisabledError):
        BearerGuard(echo, "   ")
    with pytest.raises(TransportDisabledError):
        create_http_app(Settings(root=tmp_path, mcp_bearer_key=""))


# --- the transport it guards -----------------------------------------------


async def test_the_mcp_transport_answers_an_authorized_client(
    remote_settings: Settings, sessions: sessionmaker[Session]
) -> None:
    app = create_http_app(remote_settings, sessions=sessions, json_response=True)
    async with running(app) as client:
        response = await client.post(
            "/mcp",
            json=INITIALIZE,
            headers={**MCP_HEADERS, "authorization": f"Bearer {KEY}"},
        )
    assert response.status_code == 200
    payload = response.json()
    assert payload["result"]["serverInfo"]["name"] == "blunderbase"


async def test_the_mcp_transport_turns_an_unauthorized_client_away(
    remote_settings: Settings, sessions: sessionmaker[Session]
) -> None:
    """And turns it away in front of the protocol: no server info, no tool list."""
    app = create_http_app(remote_settings, sessions=sessions, json_response=True)
    async with running(app) as client:
        response = await client.post("/mcp", json=INITIALIZE, headers=MCP_HEADERS)
    assert response.status_code == 401
    assert "serverInfo" not in response.text
