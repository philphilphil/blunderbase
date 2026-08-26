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
from backend.services import runners as runners_service

SCHEME = "bearer"
REALM = 'Bearer realm="blunderbase-runner"'


def bearer_of(connection: HTTPConnection) -> str | None:
    """The token an `Authorization: Bearer …` header carries, or None if it carries none."""
    scheme, _, presented = (connection.headers.get("authorization") or "").partition(" ")
    if scheme.strip().casefold() != SCHEME:
        return None
    return presented.strip() or None


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
    await websocket.accept()
    try:
        return await runner_from_header(bearer_of(websocket), websocket.app.state.settings)
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
