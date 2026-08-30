"""The door in front of the API.

Blunderbase used to bind to loopback and carry no auth at all; deployed on the open
internet that is not a policy, it is an open database. So every route is guarded, and the
short list of things that are not is here rather than spread across the routers:

- `/health`, because the container's healthcheck has no cookie jar;
- `/auth/*`, because a locked door needs a handle;
- `/mcp`, which has its own bearer guard in front of the protocol itself;
- `/runner`, the transport a remote runner speaks, which carries its own per-runner bearer
  token instead of a cookie. `/runners` — the owner's CRUD over the same rows — is
  deliberately *not* exempt: the rule below is `path == prefix or path.startswith(prefix +
  "/")`, so the plural never falls under the singular's exemption;
- the built web app and its `index.html`, because the page has to load in order to show
  the login screen. That one is not a rule here at all — `install_auth` is added to the
  middleware stack *before* `install_web`, so a static file is answered by `WebApp` and
  never reaches this guard, while `/api/...` and the bare router paths do.

An unauthenticated request is always JSON, never a redirect: the client is a fetch call,
and a 302 to a login page it cannot render is worse than a status it can branch on. When
nobody has chosen a password yet the body says `setup_required` instead of `unauthorized`,
which is how the UI knows to show the setup screen rather than the login one.
"""

from __future__ import annotations

from anyio import to_thread
from fastapi import FastAPI
from starlette.requests import HTTPConnection, Request
from starlette.responses import Response
from starlette.types import ASGIApp, Receive, Scope, Send

from backend.api.errors import error_response
from backend.config import Settings
from backend.db.session import get_sessionmaker
from backend.services import auth as auth_service

COOKIE_NAME = "blunderbase_session"
COOKIE_MAX_AGE = int(auth_service.SESSION_TTL.total_seconds())
COOKIE_SAMESITE = "lax"

# A `Secure` cookie is dropped by the browser over plain HTTP, so it cannot be the default
# for a developer on `http://localhost`. Everywhere else it is: a deployment reachable by
# name is a deployment that belongs behind TLS.
LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "[::1]"})

EXEMPT_EXACT = frozenset({"/health"})
EXEMPT_PREFIXES = ("/auth", "/mcp", "/runner")

# 4401 rather than 1008: the 4000 range is the application's, and mirroring HTTP's 401
# lets the page tell "you are not signed in" from "the server went away".
WS_CLOSE_UNAUTHORIZED = 4401

AUTHENTICATED = "authenticated"
SETUP_REQUIRED = "setup_required"
UNAUTHORIZED = "unauthorized"

DETAIL = {
    SETUP_REQUIRED: "no password has been set yet; choose one at POST /auth/setup",
    UNAUTHORIZED: "sign in at POST /auth/login",
}


def exempt(path: str) -> bool:
    """Whether this path is one of the few that answer without a session."""
    return path in EXEMPT_EXACT or any(
        path == prefix or path.startswith(f"{prefix}/") for prefix in EXEMPT_PREFIXES
    )


def cookie_secure(request: Request) -> bool:
    """Whether the session cookie should carry `Secure` for this request's origin."""
    if request.url.scheme == "https":
        return True
    return (request.url.hostname or "").lower() not in LOOPBACK_HOSTS


def set_session_cookie(response: Response, request: Request, token: str) -> None:
    """Hand the browser its session. HTTP-only, so no script of any origin can read it."""
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=COOKIE_MAX_AGE,
        path="/",
        httponly=True,
        samesite=COOKIE_SAMESITE,
        secure=cookie_secure(request),
    )


def clear_session_cookie(response: Response, request: Request) -> None:
    """Take it back. The attributes have to match the ones it was set with."""
    response.delete_cookie(
        COOKIE_NAME,
        path="/",
        httponly=True,
        samesite=COOKIE_SAMESITE,
        secure=cookie_secure(request),
    )


class AuthGuard:
    """ASGI middleware demanding a session cookie of every request that is not exempt.

    Middleware rather than a dependency so that a route added later is guarded by having
    been added, and so that the `/events` WebSocket — which a `Depends` would reach only
    after the handshake — is refused by the same rule as everything else.

    The check is a database read and the loop must not do one: it goes out to a worker
    thread, the same place a `def` handler's queries run — and because those threads are
    the scarce thing under load, a token the database has just confirmed is taken on trust
    for a few seconds (`auth_service.token_recently_validated`) rather than costing that
    thread and those two reads again on the very next request of the same burst.
    """

    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        self.app = app
        self.settings = settings

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket") or exempt(scope["path"]):
            await self.app(scope, receive, send)
            return
        token = HTTPConnection(scope).cookies.get(COOKIE_NAME)
        state = await to_thread.run_sync(self.state, token)
        if state == AUTHENTICATED:
            await self.app(scope, receive, send)
            return
        if scope["type"] == "websocket":
            await _deny_socket(receive, send, state)
            return
        await error_response(401, state, DETAIL[state])(scope, receive, send)

    def state(self, token: str | None) -> str:
        """Whether this cookie gets in, and if not, which of the two reasons it is.

        A cookie confirmed moments ago answers without a Session at all; anything else —
        an unknown cookie, no cookie, a deployment nobody has set a password on — is
        decided by the database, and only the yes is worth remembering.
        """
        if auth_service.token_recently_validated(token):
            return AUTHENTICATED
        with get_sessionmaker(self.settings)() as session:
            if auth_service.setup_required(session):
                return SETUP_REQUIRED
            if not token or not auth_service.validate_session(session, token):
                return UNAUTHORIZED
        auth_service.remember_valid_token(token)
        return AUTHENTICATED


async def _deny_socket(receive: Receive, send: Send, state: str) -> None:
    """Accept, then close with the reason.

    Closing before the accept would reject the handshake with a bare HTTP 403 and no code
    at all; a browser learns nothing from that, and the page needs to know it should show
    the login screen rather than retry the connection.
    """
    message = await receive()
    if message["type"] != "websocket.connect":
        return
    await send({"type": "websocket.accept"})
    await send({"type": "websocket.close", "code": WS_CLOSE_UNAUTHORIZED, "reason": state})


def install_auth(app: FastAPI, settings: Settings) -> None:
    """Add the guard. Must be added before `install_web`, so the page is served in front
    of it and the `/api` prefix has already come off the paths it sees."""
    app.add_middleware(AuthGuard, settings=settings)
