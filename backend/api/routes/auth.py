"""`/auth` — the only routes that answer without a session.

One owner, one password, one cookie. There is no registration: the first person to reach
a deployment nobody has configured chooses the password, and from then on `setup_required`
is false forever. Every response here is the same `AuthStatus`, so the page can render
from the answer to whichever call it made.
"""

from __future__ import annotations

from fastapi import APIRouter, Request, Response, status

from backend.api.auth import COOKIE_NAME, clear_session_cookie, set_session_cookie
from backend.api.deps import SessionDep
from backend.api.errors import ApiError
from backend.api.schemas import AuthStatus, PasswordChange, PasswordLogin, PasswordSetup
from backend.services import auth as auth_service

router = APIRouter(prefix="/auth", tags=["auth"])

SIGNED_IN = AuthStatus(setup_required=False, authenticated=True)


@router.get("/status", response_model=AuthStatus, summary="Is there a password, and do I have it")
def auth_status(session: SessionDep, request: Request) -> AuthStatus:
    required = auth_service.setup_required(session)
    return AuthStatus(
        setup_required=required,
        authenticated=not required
        and auth_service.validate_session(session, request.cookies.get(COOKIE_NAME)),
    )


@router.post("/setup", response_model=AuthStatus, summary="Choose the owner's password")
def setup(
    session: SessionDep, request: Request, response: Response, body: PasswordSetup
) -> AuthStatus:
    """First run only. A second caller gets a 409, which is the race guard, not politeness."""
    auth_service.set_password(session, body.password)
    _sign_in(session, request, response)
    return SIGNED_IN


@router.post("/login", response_model=AuthStatus, summary="Sign in")
def login(
    session: SessionDep, request: Request, response: Response, body: PasswordLogin
) -> AuthStatus:
    _require_setup(session)
    if not auth_service.verify_password(session, body.password):
        raise ApiError(status.HTTP_401_UNAUTHORIZED, "invalid_password", "that is not the password")
    _sign_in(session, request, response)
    return SIGNED_IN


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, summary="Sign out")
def logout(session: SessionDep, request: Request) -> Response:
    """Always 204: a browser asking to be signed out is never told it already was."""
    auth_service.revoke_session(session, request.cookies.get(COOKIE_NAME))
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_session_cookie(response, request)
    return response


@router.post("/password", response_model=AuthStatus, summary="Change the password")
def change_password(
    session: SessionDep, request: Request, response: Response, body: PasswordChange
) -> AuthStatus:
    """Every other browser is signed out, and this one is handed a fresh cookie.

    The MCP bearer key is the same password, so a change invalidates that too — which is
    the point of saying so in the docs rather than only here.
    """
    _require_setup(session)
    auth_service.change_password(session, body.current, body.new)
    _sign_in(session, request, response)
    return SIGNED_IN


def _sign_in(session: SessionDep, request: Request, response: Response) -> None:
    set_session_cookie(response, request, auth_service.create_session(session))


def _require_setup(session: SessionDep) -> None:
    if auth_service.setup_required(session):
        raise ApiError(
            status.HTTP_409_CONFLICT, "setup_required", "no password has been set yet"
        )
