from __future__ import annotations

import json
import secrets
from collections.abc import Callable
from urllib.parse import urlsplit

from anyio import to_thread
from mcp.server import MCPServer
from mcp.server.transport_security import TransportSecuritySettings
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
    """The remote transport was asked for with neither a configured key nor a key verifier."""


class BearerGuard:
    """ASGI middleware demanding a bearer token of every HTTP request.

    Dedicated keys open it: `BLUNDERBASE_MCP_BEARER_KEY` is compared first in constant
    time, then `verify` checks keys minted on the Assistant page. Browser passwords
    are never accepted. Each minted key can be revoked independently.

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
                "the MCP HTTP transport needs setup for MCP keys or BLUNDERBASE_MCP_BEARER_KEY"
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
        # Key lookups belong off the event loop.
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


LOOPBACK_BINDS = frozenset({"127.0.0.1", "localhost", "::1"})
LOOPBACK_HOSTS = ("127.0.0.1:*", "localhost:*", "[::1]:*", "127.0.0.1", "localhost", "[::1]")
LOOPBACK_ORIGINS = ("http://127.0.0.1:*", "http://localhost:*", "http://[::1]:*")
DEFAULT_PORTS = {"http": 80, "https": 443}


def transport_security(settings: Settings) -> TransportSecuritySettings | None:
    """The SDK's Host/Origin check, told about the name this installation is reached by.

    On a loopback bind the SDK switches DNS-rebinding protection on and, left alone,
    accepts only a localhost Host — so a reverse proxy in front of a source checkout,
    forwarding `Host: blunderbase.example.com`, got 421 for every request. The check
    stays on; `BLUNDERBASE_PUBLIC_URL` (which that setup already needs) joins the
    loopback names on its allow-list. A non-loopback bind returns None and keeps the
    SDK's own answer, which is no Host check: that server is meant to be reached by
    whatever name the network gives it, and the bearer key is its door.
    """
    if settings.host not in LOOPBACK_BINDS:
        return None
    hosts = list(LOOPBACK_HOSTS)
    origins = list(LOOPBACK_ORIGINS)
    public = urlsplit(settings.public_url.strip())
    try:
        port = public.port
    except ValueError:  # "host:abc" — not a URL anything could be reached by
        public = public._replace(netloc="")
        port = None
    if public.scheme in {"http", "https"} and public.netloc:
        netloc = public.netloc.rpartition("@")[2].lower()
        hosts.append(netloc)
        origins.append(f"{public.scheme}://{netloc}")
        if port is None:
            # A proxy may pass the port along in Host even when it is the default one.
            hosts.append(f"{netloc}:*")
        elif port == DEFAULT_PORTS[public.scheme]:
            # `https://host:443/` names the same place as `https://host/`, and clients
            # leave a default port out of Host and Origin — allow the bare forms too.
            bare = netloc.rpartition(":")[0]
            hosts.append(bare)
            origins.append(f"{public.scheme}://{bare}")
    return TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=hosts,
        allowed_origins=origins,
    )


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

    Raises `TransportDisabledError` without an environment key or initialized setup.
    `before_setup=True` keeps the API route available before setup so newly minted
    keys work without restarting the transport.
    """
    resolved = settings or get_settings()
    app = (server or build_server(resolved, sessions)).streamable_http_app(
        streamable_http_path=path,
        json_response=json_response,
        stateless_http=True,
        host=resolved.host,
        transport_security=transport_security(resolved),
    )
    verify = key_verifier(resolved, sessions, before_setup=before_setup)
    return BearerGuard(app, resolved.mcp_bearer_key, verify=verify)


def key_verifier(
    settings: Settings,
    sessions: sessionmaker[Session] | None = None,
    *,
    before_setup: bool = False,
) -> Verifier | None:
    """Check a dedicated MCP key against the database on every request.

    Standalone transports require initialized setup unless an environment key is set.
    The API uses `before_setup=True` to mount the route before setup; keys created
    later become usable immediately, and revocation takes effect on the next request.
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
            # A database without the key table cannot authenticate a key.
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

    The route exists before setup. Without a configured or minted key the guard answers
    401 to everyone. A key minted on Assistant works immediately because the route and
    its task group are already there.

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
    bind = host or resolved.host
    if bind != resolved.host:
        # The transport's Host check follows the address it is actually bound to.
        resolved = resolved.model_copy(update={"host": bind})
    uvicorn.run(create_http_app(resolved), host=bind, port=port or resolved.port)
