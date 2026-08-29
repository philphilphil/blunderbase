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

# The remote transport. A bearer token, checked on every request, in front of an app that
# binds to a network interface rather than to loopback.
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
    """ASGI middleware demanding a bearer token of every HTTP request.

    Three things open it, tried in this order. `BLUNDERBASE_MCP_BEARER_KEY`, when set, is
    compared first and in constant time — it costs no database read, and it is what keeps
    the compose files and existing automation working while everything else changes
    underneath. Then `verify`, which is `services.auth.verify_bearer`: a key the owner
    minted on the Assistant page, else the owner's password, checked against the same hash
    the web session is. The environment key is one more accepted token rather than the
    only one, so a deployment that pins one for automation can still hand a coach a key it
    can revoke on its own.

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
        # Constant time, so a wrong key tells an attacker nothing about how wrong it was.
        if self.key and secrets.compare_digest(token, self.key):
            return True
        if self.verify is None:
            return False
        # A key lookup is a database read and a password check a scrypt derivation on top;
        # neither belongs on the event loop.
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
    before_setup: bool = False,
) -> ASGIApp:
    """The streamable-HTTP transport behind the bearer key.

    Stateless: every request carries everything it needs, so the owner's client can
    reconnect, or reach a restarted server, without a session to resume.

    Raises `TransportDisabledError` when there is neither an environment key nor a
    password to check one against: a transport that would refuse every caller is a
    configuration mistake, not a service. `before_setup=True` turns that off — see
    `password_verifier` — for the copy mounted inside the API app, which has to exist
    before the owner has chosen anything so it can start serving the moment they do.
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
    verify = password_verifier(resolved, sessions, before_setup=before_setup)
    return BearerGuard(app, resolved.mcp_bearer_key, verify=verify)


def password_verifier(
    settings: Settings,
    sessions: sessionmaker[Session] | None = None,
    *,
    before_setup: bool = False,
) -> Verifier | None:
    """Check a presented bearer token against the owner's keys and password, or None if
    there is no password yet.

    No password means no keys either — a key is minted through a route only a signed-in
    owner reaches — so "setup required" is the whole test for whether a verifier can say
    yes to anything.

    Resolved once, at the point the transport is built, so a database that has never been
    migrated — `blunderbase mcp --transport http` pointed at nothing — is a refusal to
    start rather than a 500 per request. The check itself reads the row every time, so a
    password change takes effect without a restart.

    `before_setup=True` skips that resolution and always hands back a verifier: it answers
    "no" to everything until a password exists, and yes the moment one does. That is what
    lets the API app mount `/mcp` at startup on a deployment that has never been set up —
    the transport's sessions live in a task group only the lifespan can open, so a route
    added later would have nowhere to run.
    """
    factory = sessions or get_sessionmaker(settings)
    if not before_setup:
        try:
            with factory() as session:
                if auth_service.setup_required(session):
                    return None
        except SQLAlchemyError:
            # No credentials table at all is the same answer as an empty one.
            return None

    def verify(token: str) -> bool:
        try:
            with factory() as session:
                return auth_service.verify_bearer(session, token)
        except SQLAlchemyError:
            # A database with no credentials table yet: no token can be the owner's.
            return False

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

    The route exists whether or not the deployment has been set up yet: with no bearer key
    and no password the guard answers 401 to everyone, and starts accepting the password
    the moment one is chosen in the browser — no restart, because the route and its task
    group are already there.

    The caller keeps `server.session_manager.run()` open for as long as it serves. The
    transport runs its sessions in a task group that context opens, and the host app
    never drives a route's lifespan — the standalone app's `lifespan=` is exactly this
    same call, which is why `run_http` needs nothing extra.

    A session manager runs once and never again, so a second call replaces the route
    rather than adding one: the transport belongs to the lifespan that is serving, and an
    app started twice gets a working transport both times.
    """
    resolved = settings or get_settings()
    server = build_server(resolved, sessions)
    transport = create_http_app(
        resolved, server=server, sessions=sessions, path=path, before_setup=True
    )
    routes = app.router.routes
    routes[:] = [route for route in routes if not (isinstance(route, Route) and route.path == path)]
    routes.append(Route(path, endpoint=transport))
    return server


def run_http(settings: Settings | None = None, host: str | None = None, port: int = 0) -> None:
    """Serve the remote transport with uvicorn."""
    import uvicorn

    resolved = settings or get_settings()
    uvicorn.run(
        create_http_app(resolved), host=host or resolved.host, port=port or resolved.port
    )
