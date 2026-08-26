from __future__ import annotations

import json
import secrets
from collections.abc import Callable

from anyio import to_thread
from mcp.server import MCPServer
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker
from starlette.applications import Starlette
from starlette.datastructures import Headers
from starlette.routing import Route
from starlette.types import ASGIApp, Receive, Scope, Send

from backend.config import Settings, get_settings
from backend.db.session import get_sessionmaker
from backend.mcp.server import build_server
from backend.services import auth as auth_service

# The remote transport. One key, checked on every request, in front of an app that binds
# to a network interface rather than to loopback.
MCP_PATH = "/mcp"
SCHEME = "bearer"
UNAUTHORIZED = {
    "error": "unauthorized",
    "message": "this endpoint needs the Blunderbase bearer key in an Authorization header",
}

Verifier = Callable[[str], bool]


class TransportDisabledError(RuntimeError):
    """The remote transport was asked for with neither a bearer key nor a password."""


class BearerGuard:
    """ASGI middleware demanding one bearer key of every HTTP request.

    The key is the owner's password, verified against the same hash the web session is:
    one credential, two front doors, nothing extra to configure on a deployment that has
    been through first-run setup. `BLUNDERBASE_MCP_BEARER_KEY` stays the override — set
    it and it is the only thing accepted, which is what keeps existing automation and the
    compose files working while the password changes underneath.

    It sits outside the MCP app so an unauthenticated caller never reaches the protocol at
    all — not even to be told which tools exist. Lifespan and any other scope pass through
    untouched, because the streamable-HTTP app runs its session manager there.
    """

    def __init__(self, app: ASGIApp, key: str = "", *, verify: Verifier | None = None) -> None:
        self.app = app
        self.key = key.strip()
        self.verify = verify
        if not self.key and verify is None:
            raise TransportDisabledError(
                "the MCP HTTP transport needs a password set or BLUNDERBASE_MCP_BEARER_KEY"
            )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or await self.authorized(
            Headers(scope=scope).get("authorization")
        ):
            await self.app(scope, receive, send)
            return
        await self.reject(send)

    async def authorized(self, header: str | None) -> bool:
        scheme, _, presented = (header or "").partition(" ")
        if scheme.strip().casefold() != SCHEME:
            return False
        token = presented.strip()
        if not token:
            return False
        if self.key:
            # Constant time, so a wrong key tells an attacker nothing about how wrong it was.
            return secrets.compare_digest(token, self.key)
        # A password check is a scrypt derivation and a database read; neither belongs on
        # the event loop.
        return await to_thread.run_sync(self.verify, token)

    async def reject(self, send: Send) -> None:
        body = json.dumps(UNAUTHORIZED, separators=(",", ":")).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 401,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                    (b"www-authenticate", b'Bearer realm="blunderbase"'),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})


def create_http_app(
    settings: Settings | None = None,
    *,
    server: MCPServer | None = None,
    sessions: sessionmaker[Session] | None = None,
    path: str = MCP_PATH,
    json_response: bool = False,
) -> ASGIApp:
    """The streamable-HTTP transport behind the bearer key.

    Stateless: every request carries everything it needs, so the owner's client can
    reconnect, or reach a restarted server, without a session to resume.

    Raises `TransportDisabledError` when there is neither an environment key nor a
    password to check one against: a transport that would refuse every caller is a
    configuration mistake, not a service.
    """
    resolved = settings or get_settings()
    # The bind host decides the SDK's DNS-rebinding policy, and this app is the one
    # transport meant to be reachable from elsewhere: told the loopback default it would
    # reject the owner's own hostname. Nothing unauthenticated reaches it either way.
    app = (server or build_server(resolved, sessions)).streamable_http_app(
        streamable_http_path=path,
        json_response=json_response,
        stateless_http=True,
        host=resolved.host,
    )
    return BearerGuard(app, resolved.mcp_bearer_key, verify=password_verifier(resolved, sessions))


def password_verifier(
    settings: Settings, sessions: sessionmaker[Session] | None = None
) -> Verifier | None:
    """Check a presented bearer token against the owner's password, or None if there is none.

    Resolved once, at the point the transport is built, so a database that has never been
    migrated — `blunderbase mcp --transport http` pointed at nothing — is a refusal to
    start rather than a 500 per request. The check itself reads the row every time, so a
    password change takes effect without a restart.
    """
    factory = sessions or get_sessionmaker(settings)
    try:
        with factory() as session:
            if auth_service.setup_required(session):
                return None
    except SQLAlchemyError:
        # No credentials table at all is the same answer as an empty one.
        return None

    def verify(token: str) -> bool:
        with factory() as session:
            return auth_service.verify_bearer(session, token)

    return verify


def mount_http_app(
    app: Starlette,
    settings: Settings | None = None,
    *,
    sessions: sessionmaker[Session] | None = None,
    path: str = MCP_PATH,
) -> MCPServer:
    """Add the guarded transport to another app's routes, and hand back its server.

    This is what puts the coach and the browser in one process: the MCP tools that drive
    the live board and the `/events` sockets watching it are then the same
    `services.live` state, and the owner's page follows what the coach does.

    A `Route` rather than a `Mount`, because the transport owns exactly one path and has
    no sub-paths of its own: mounted, `/mcp` would answer with a redirect to `/mcp/` that
    a client posting JSON-RPC has no reason to follow.

    The caller keeps `server.session_manager.run()` open for as long as it serves. The
    transport runs its sessions in a task group that context opens, and the host app
    never drives a route's lifespan — the standalone app's `lifespan=` is exactly this
    same call, which is why `run_http` needs nothing extra.
    """
    resolved = settings or get_settings()
    server = build_server(resolved, sessions)
    transport = create_http_app(resolved, server=server, sessions=sessions, path=path)
    app.router.routes.append(Route(path, endpoint=transport))
    return server


def run_http(settings: Settings | None = None, host: str | None = None, port: int = 0) -> None:
    """Serve the remote transport with uvicorn."""
    import uvicorn

    resolved = settings or get_settings()
    uvicorn.run(
        create_http_app(resolved), host=host or resolved.host, port=port or resolved.port
    )
