"""The door in front of `/runner`.

The owner's cookie opens every other route; a runner has no browser and no session, so it
carries its own bearer token instead — one per machine, individually revocable, and
deliberately not the password. `AuthGuard` therefore exempts `/runner` and this guard
stands there instead. `/runners` (plural), the owner's CRUD over the same rows, is not
exempt and is guarded like everything else: the two prefixes never bleed, because the
guard's rule is `path == prefix or path.startswith(prefix + "/")`.

Two shapes of refusal, for two kinds of caller:

- an HTTP poll is answered with the standard `ErrorResponse`, plus the `WWW-Authenticate`
  a bearer scheme owes and the `Retry-After` the limiter has to offer;
- a socket is **accepted and then closed** with a 4000-range code, exactly as
  `api/auth.py` explains: closing before the accept is a bare HTTP rejection that tells
  the runner's log nothing, and a runner that cannot tell "wrong token" from "server went
  away" retries forever against a door that will never open.

**Two places a socket may carry its token.** The header is the first, and is what the
Python runner uses. A browser tab is a runner too, and its `WebSocket` constructor takes a
URL and a list of subprotocols and nothing else — there is no header to set — so it may
present the token in `Sec-WebSocket-Protocol` instead:

    new WebSocket(wsUrl, ["blunderbase.runner.v1", token])

The sentinel (`runners.config.WS_SUBPROTOCOL`) names the scheme and the second entry is
the bearer token verbatim; a minted token is url-safe base64 behind `bb_rnr_`, so every
character of it is already legal in a subprotocol name. The accept **must echo the
sentinel back**, because a browser fails a handshake that offered subprotocols and got
none in return — even when the server is about to refuse the token, since the 4000-range
close code is the only thing that tells the tab *why* it was refused.

The subprotocol path is the socket's alone. `/runner/poll` stays header-only: it is an
ordinary HTTP request made by a process that can set headers, and there is nothing to
work around. And a token is never read from the query string — see `WS_SUBPROTOCOL`.
"""

from __future__ import annotations

import contextlib
from typing import Annotated

from anyio import to_thread
from fastapi import Depends, Request
from starlette.requests import HTTPConnection
from starlette.websockets import WebSocket

from backend.api.errors import ApiError
from backend.config import Settings
from backend.db.models import Runner
from backend.db.session import get_sessionmaker
from backend.runners import protocol
from backend.runners.config import WS_SUBPROTOCOL
from backend.services import runners as runners_service

SCHEME = "bearer"
REALM = 'Bearer realm="blunderbase-runner"'


def bearer_of(connection: HTTPConnection) -> str | None:
    """The token an `Authorization: Bearer …` header carries, or None if it carries none."""
    scheme, _, presented = (connection.headers.get("authorization") or "").partition(" ")
    if scheme.strip().casefold() != SCHEME:
        return None
    return presented.strip() or None


def bearer_of_socket(websocket: WebSocket) -> str | None:
    """The token a socket presents, from the header or from the offered subprotocols.

    The header wins, so a client that can set one behaves exactly as it always has. The
    subprotocol list is read only when the sentinel is in it, which is what keeps an
    unrelated subprotocol from being mistaken for a credential.
    """
    header = bearer_of(websocket)
    if header is not None:
        return header
    offered = _offered(websocket)
    if WS_SUBPROTOCOL not in offered:
        return None
    return next((value for value in offered if value != WS_SUBPROTOCOL), None)


def accepted_subprotocol(websocket: WebSocket) -> str | None:
    """What the accept has to echo: the sentinel when it was offered, otherwise nothing.

    Never anything else. Answering with a subprotocol the client did not offer is a
    handshake the client fails, and answering an offer of unknown protocols with one of
    our own would be inventing a contract neither side agreed to.
    """
    return WS_SUBPROTOCOL if WS_SUBPROTOCOL in _offered(websocket) else None


def _offered(websocket: WebSocket) -> tuple[str, ...]:
    """`Sec-WebSocket-Protocol`, already split into entries by the ASGI server."""
    return tuple(str(value) for value in websocket.scope.get("subprotocols") or ())


async def runner_from_header(token: str | None, settings: Settings) -> Runner:
    """The runner this token is. A hash lookup and a database read, so: on a thread."""
    return await to_thread.run_sync(_authenticate, token, settings)


def _authenticate(token: str | None, settings: Settings) -> Runner:
    with get_sessionmaker(settings)() as session:
        return runners_service.authenticate(session, token)


async def guard_http(request: Request) -> Runner:
    """FastAPI dependency for the poll endpoints: the runner, or a typed refusal."""
    try:
        return await runner_from_header(bearer_of(request), request.app.state.settings)
    except runners_service.RunnerLockedOutError as exc:
        raise ApiError(
            429,
            "locked_out",
            str(exc),
            headers={"Retry-After": str(exc.retry_after), "WWW-Authenticate": REALM},
        ) from exc
    except runners_service.RunnerAuthError as exc:
        raise ApiError(401, "unauthorized", str(exc), headers={"WWW-Authenticate": REALM}) from exc


async def guard_socket(websocket: WebSocket) -> Runner | None:
    """Accept the upgrade, then close it with the reason. None means it was refused."""
    await websocket.accept(subprotocol=accepted_subprotocol(websocket))
    try:
        return await runner_from_header(bearer_of_socket(websocket), websocket.app.state.settings)
    except runners_service.RunnerLockedOutError as exc:
        await deny_socket(
            websocket, protocol.WS_CLOSE_RATE_LIMITED, protocol.ERROR_RATE_LIMITED, str(exc)
        )
    except runners_service.RunnerAuthError as exc:
        await deny_socket(
            websocket, protocol.WS_CLOSE_UNAUTHORIZED, protocol.ERROR_UNAUTHORIZED, str(exc)
        )
    return None


async def deny_socket(websocket: WebSocket, code: int, error: str, message: str) -> None:
    """One fatal `error` frame so the runner can log what happened, then the close code."""
    with contextlib.suppress(Exception):
        await websocket.send_text(protocol.encode(protocol.error(error, message, fatal=True)))
    with contextlib.suppress(Exception):
        await websocket.close(code=code, reason=error)


RunnerDep = Annotated[Runner, Depends(guard_http)]
