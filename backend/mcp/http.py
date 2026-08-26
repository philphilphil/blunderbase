from __future__ import annotations

import json
import secrets

from mcp.server import MCPServer
from sqlalchemy.orm import Session, sessionmaker
from starlette.datastructures import Headers
from starlette.types import ASGIApp, Receive, Scope, Send

from backend.config import Settings, get_settings
from backend.mcp.server import build_server

# The remote transport. One key, checked on every request, in front of an app that binds
# to a network interface rather than to loopback.
MCP_PATH = "/mcp"
SCHEME = "bearer"
UNAUTHORIZED = {
    "error": "unauthorized",
    "message": "this endpoint needs the Blunderbase bearer key in an Authorization header",
}


class TransportDisabledError(RuntimeError):
    """The remote transport was asked for without a bearer key configured."""


class BearerGuard:
    """ASGI middleware demanding one bearer key of every HTTP request.

    This is the whole of Blunderbase's auth surface: one owner, one key, no sessions and
    no OAuth. It sits outside the MCP app so an unauthenticated caller never reaches the
    protocol at all — not even to be told which tools exist. Lifespan and any other scope
    pass through untouched, because the streamable-HTTP app runs its session manager
    there.
    """

    def __init__(self, app: ASGIApp, key: str) -> None:
        self.app = app
        self.key = key.strip()
        if not self.key:
            raise TransportDisabledError(
                "the MCP HTTP transport needs BLUNDERBASE_MCP_BEARER_KEY set"
            )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or self.authorized(Headers(scope=scope).get("authorization")):
            await self.app(scope, receive, send)
            return
        await self.reject(send)

    def authorized(self, header: str | None) -> bool:
        scheme, _, token = (header or "").partition(" ")
        if scheme.strip().casefold() != SCHEME:
            return False
        # Constant time, so a wrong key tells an attacker nothing about how wrong it was.
        return secrets.compare_digest(token.strip(), self.key)

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
    return BearerGuard(app, resolved.mcp_bearer_key)


def run_http(settings: Settings | None = None, host: str | None = None, port: int = 0) -> None:
    """Serve the remote transport with uvicorn."""
    import uvicorn

    resolved = settings or get_settings()
    uvicorn.run(
        create_http_app(resolved), host=host or resolved.host, port=port or resolved.port
    )
