from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from mcp.types import LATEST_PROTOCOL_VERSION
from sqlalchemy.orm import Session, sessionmaker
from starlette.types import Receive, Scope, Send

from backend.api.app import create_app
from backend.config import Settings
from backend.db.migrate import upgrade_to_head
from backend.db.session import get_sessionmaker
from backend.mcp.http import BearerGuard, TransportDisabledError, create_http_app
from backend.services import auth as auth_service
from backend.services import mcp_keys as mcp_keys_service

KEY = "not-the-key-you-are-looking-for"
PASSWORD = "the-owners-own-password"
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


@pytest.fixture()
def keyless_settings(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> Settings:
    """Settings with no environment key, so the owner's password is the bearer key."""
    monkeypatch.delenv("BLUNDERBASE_MCP_BEARER_KEY", raising=False)
    return Settings(root=tmp_path)


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
    """Neither an environment key nor a password: a door that refuses everyone is a mistake."""
    with pytest.raises(TransportDisabledError):
        BearerGuard(echo, "   ")
    with pytest.raises(TransportDisabledError):
        create_http_app(Settings(root=tmp_path, mcp_bearer_key=""))


# --- the bearer key is the owner's password --------------------------------


async def test_the_owners_password_is_the_bearer_key(
    keyless_settings: Settings, sessions: sessionmaker[Session]
) -> None:
    with sessions() as session:
        auth_service.set_password(session, PASSWORD)
    app = create_http_app(keyless_settings, sessions=sessions, json_response=True)

    async with running(app) as client:
        response = await client.post(
            "/mcp",
            json=INITIALIZE,
            headers={**MCP_HEADERS, "authorization": f"Bearer {PASSWORD}"},
        )

    assert response.status_code == 200
    assert response.json()["result"]["serverInfo"]["name"] == "blunderbase"


async def test_a_token_that_is_not_the_password_is_refused(
    keyless_settings: Settings, sessions: sessionmaker[Session]
) -> None:
    with sessions() as session:
        auth_service.set_password(session, PASSWORD)
    app = create_http_app(keyless_settings, sessions=sessions, json_response=True)

    async with running(app) as client:
        response = await client.post(
            "/mcp", json=INITIALIZE, headers={**MCP_HEADERS, "authorization": "Bearer nearly"}
        )

    assert response.status_code == 401
    assert "serverInfo" not in response.text


async def test_the_environment_key_works_alongside_the_password(
    remote_settings: Settings, sessions: sessionmaker[Session]
) -> None:
    """Set, it is one more accepted token: the compose files keep working, and so does the
    owner's own password. What it does not do is turn a wrong token into a right one."""
    with sessions() as session:
        auth_service.set_password(session, PASSWORD)
    app = create_http_app(remote_settings, sessions=sessions, json_response=True)

    async with running(app) as client:
        with_key = await client.post(
            "/mcp", json=INITIALIZE, headers={**MCP_HEADERS, "authorization": f"Bearer {KEY}"}
        )
        with_password = await client.post(
            "/mcp", json=INITIALIZE, headers={**MCP_HEADERS, "authorization": f"Bearer {PASSWORD}"}
        )
        with_neither = await client.post(
            "/mcp", json=INITIALIZE, headers={**MCP_HEADERS, "authorization": "Bearer nearly"}
        )

    assert with_key.status_code == 200
    assert with_password.status_code == 200
    assert with_neither.status_code == 401


async def test_the_environment_key_alone_is_enough_with_no_password(
    remote_settings: Settings, sessions: sessionmaker[Session]
) -> None:
    """No verifier at all — a database nobody has set up — and the env key still opens."""
    with sessions() as session:
        assert auth_service.setup_required(session)
    app = create_http_app(remote_settings, sessions=sessions, json_response=True)

    async with running(app) as client:
        with_key = await client.post(
            "/mcp", json=INITIALIZE, headers={**MCP_HEADERS, "authorization": f"Bearer {KEY}"}
        )
        guessed = await client.post(
            "/mcp", json=INITIALIZE, headers={**MCP_HEADERS, "authorization": "Bearer nearly"}
        )

    assert with_key.status_code == 200
    assert guessed.status_code == 401


# --- the bearer key can be a minted key ------------------------------------


async def test_a_stored_key_is_accepted_through_the_real_verifier(
    keyless_settings: Settings, sessions: sessionmaker[Session]
) -> None:
    with sessions() as session:
        auth_service.set_password(session, PASSWORD)
        _key, token = mcp_keys_service.create_key(session, "laptop")
    app = create_http_app(keyless_settings, sessions=sessions, json_response=True)

    async with running(app) as client:
        response = await client.post(
            "/mcp", json=INITIALIZE, headers={**MCP_HEADERS, "authorization": f"Bearer {token}"}
        )

    assert response.status_code == 200
    assert response.json()["result"]["serverInfo"]["name"] == "blunderbase"


async def test_a_revoked_key_is_rejected(
    keyless_settings: Settings, sessions: sessionmaker[Session]
) -> None:
    with sessions() as session:
        auth_service.set_password(session, PASSWORD)
        key, token = mcp_keys_service.create_key(session, "laptop")
    app = create_http_app(keyless_settings, sessions=sessions, json_response=True)

    async with running(app) as client:
        before = await client.post(
            "/mcp", json=INITIALIZE, headers={**MCP_HEADERS, "authorization": f"Bearer {token}"}
        )
        with sessions() as session:
            assert mcp_keys_service.delete_key(session, key.id)
        after = await client.post(
            "/mcp", json=INITIALIZE, headers={**MCP_HEADERS, "authorization": f"Bearer {token}"}
        )

    assert before.status_code == 200
    assert after.status_code == 401
    assert "serverInfo" not in after.text


async def test_a_stored_key_and_the_environment_key_both_open_the_door(
    remote_settings: Settings, sessions: sessionmaker[Session]
) -> None:
    with sessions() as session:
        auth_service.set_password(session, PASSWORD)
        _key, token = mcp_keys_service.create_key(session, "laptop")
    app = create_http_app(remote_settings, sessions=sessions, json_response=True)

    async with running(app) as client:
        with_env = await client.post(
            "/mcp", json=INITIALIZE, headers={**MCP_HEADERS, "authorization": f"Bearer {KEY}"}
        )
        with_stored = await client.post(
            "/mcp", json=INITIALIZE, headers={**MCP_HEADERS, "authorization": f"Bearer {token}"}
        )

    assert with_env.status_code == 200
    assert with_stored.status_code == 200


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


# --- the transport inside the API app --------------------------------------


def test_the_transport_is_mounted_when_a_key_is_configured(settings: Settings) -> None:
    """One process for the coach and the browser, which is what live mode needs."""
    settings.mcp_bearer_key = KEY
    settings.analysis_workers = False
    app = create_app(settings)
    # The bind host is the loopback default here, so the SDK's DNS-rebinding protection
    # is on and the client has to say the same thing uvicorn would be told.
    with TestClient(app, base_url=BASE_URL) as client:
        assert app.state.mcp is not None
        assert client.post("/mcp", json=INITIALIZE, headers=MCP_HEADERS).status_code == 401
        response = client.post(
            "/mcp", json=INITIALIZE, headers={**MCP_HEADERS, "authorization": f"Bearer {KEY}"}
        )
    assert response.status_code == 200
    assert '"blunderbase"' in response.text


def test_the_transport_is_mounted_for_a_password_with_no_key_configured(
    settings: Settings,
) -> None:
    """A deployment set up through the web UI has a remote transport without an env var."""
    upgrade_to_head(settings)
    with get_sessionmaker(settings)() as session:
        auth_service.set_password(session, PASSWORD)
    settings.analysis_workers = False
    app = create_app(settings)

    # Nothing at build time: with no key there is nothing to mount around until the
    # lifespan has migrated the database and opened the session manager's task group.
    assert app.state.mcp is None
    with TestClient(app, base_url=BASE_URL) as client:
        assert app.state.mcp is not None
        assert client.post("/mcp", json=INITIALIZE, headers=MCP_HEADERS).status_code == 401
        response = client.post(
            "/mcp",
            json=INITIALIZE,
            headers={**MCP_HEADERS, "authorization": f"Bearer {PASSWORD}"},
        )
    assert response.status_code == 200
    assert '"blunderbase"' in response.text


def test_the_transport_refuses_everyone_before_first_run_setup(settings: Settings) -> None:
    """No key and no password yet: the route is there, and it lets nobody past."""
    settings.analysis_workers = False
    app = create_app(settings)
    with TestClient(app, base_url=BASE_URL) as client:
        assert app.state.mcp is not None
        assert client.post("/mcp", json=INITIALIZE, headers=MCP_HEADERS).status_code == 401
        guessed = client.post(
            "/mcp", json=INITIALIZE, headers={**MCP_HEADERS, "authorization": "Bearer anything"}
        )
    assert guessed.status_code == 401
    assert "serverInfo" not in guessed.text


def test_guessing_at_mcp_does_not_lock_the_owner_out_of_the_browser(
    settings: Settings,
) -> None:
    """`/mcp` is unauthenticated by design — the bearer check is its authentication — so a
    stranger reaching it must not be able to spend the login's lockout on the owner."""
    upgrade_to_head(settings)
    with get_sessionmaker(settings)() as session:
        auth_service.set_password(session, PASSWORD)
    settings.analysis_workers = False
    app = create_app(settings)

    with TestClient(app, base_url=BASE_URL) as client:
        for guess in range(auth_service.LOCKOUT_THRESHOLD * 3):
            refused = client.post(
                "/mcp",
                json=INITIALIZE,
                headers={**MCP_HEADERS, "authorization": f"Bearer nearly-{guess}"},
            )
            assert refused.status_code == 401

        signed_in = client.post("/auth/login", json={"password": PASSWORD})

    assert signed_in.status_code == 200


def test_a_password_set_through_the_ui_reaches_mcp_without_a_restart(
    settings: Settings,
) -> None:
    """The whole point: first-run setup in the browser, then `/mcp` works in the same process."""
    settings.analysis_workers = False
    app = create_app(settings)
    with TestClient(app, base_url=BASE_URL) as client:
        before = client.post(
            "/mcp", json=INITIALIZE, headers={**MCP_HEADERS, "authorization": f"Bearer {PASSWORD}"}
        )
        assert before.status_code == 401

        assert client.post("/auth/setup", json={"password": PASSWORD}).status_code == 200

        after = client.post(
            "/mcp", json=INITIALIZE, headers={**MCP_HEADERS, "authorization": f"Bearer {PASSWORD}"}
        )
    assert after.status_code == 200
    assert '"blunderbase"' in after.text
