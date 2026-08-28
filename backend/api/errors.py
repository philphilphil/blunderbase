"""Every failure this API reports, in one shape.

A service raises a typed exception; the table below turns it into a status code and a
stable machine-readable name. Nothing here formats a traceback, and the catch-all handler
is what guarantees that: an exception nobody anticipated is still an `ErrorResponse`.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

from backend.services import analysis as analysis_service
from backend.services import app_settings as app_settings_service
from backend.services import auth as auth_service
from backend.services import engines as engines_service
from backend.services import import_service
from backend.services import maia_live as maia_live_service
from backend.services import notes as notes_service
from backend.services import runners as runners_service
from backend.services import stats as stats_service
from backend.services import streams as streams_service

Handler = Callable[[Request, Any], Awaitable[JSONResponse]]


class ErrorResponse(BaseModel):
    """The body of every non-2xx response."""

    # A stable name a client can branch on, unlike a message that may be reworded.
    error: str
    # What to show a person.
    detail: str
    # Per-field problems, set only when the request itself did not parse.
    fields: list[dict[str, str]] | None = None


class ApiError(HTTPException):
    """An HTTPException that also carries the error name the body should report.

    `headers` is for the few refusals a client is meant to act on rather than read: the
    `WWW-Authenticate` a bearer door owes and the `Retry-After` a limiter offers.
    """

    def __init__(
        self,
        status_code: int,
        error: str,
        detail: str,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(status_code=status_code, detail=detail, headers=headers)
        self.error = error


# The name reported when an HTTPException was raised without one.
STATUS_NAMES: dict[int, str] = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    422: "invalid_request",
    429: "too_many_requests",
    500: "internal_error",
    501: "not_implemented",
    502: "engine_failed",
    503: "unavailable",
}

# Most specific first: a handler is looked up along the exception's MRO, so a subclass
# registered here always wins over the base class below it.
MAPPINGS: tuple[tuple[type[Exception], int, str], ...] = (
    (import_service.SourceNotImplementedError, 501, "source_not_implemented"),
    (import_service.UnknownSourceError, 404, "unknown_source"),
    (analysis_service.UnknownRunError, 404, "unknown_run"),
    (analysis_service.StaleResultError, 409, "stale_result"),
    (analysis_service.AnalysisRequestError, 422, "invalid_request"),
    (analysis_service.AnalysisError, 500, "analysis_failed"),
    (engines_service.UnknownEngineError, 404, "unknown_engine"),
    (engines_service.DuplicateEngineError, 409, "duplicate_engine"),
    (engines_service.TierUnavailableError, 409, "tier_unavailable"),
    (engines_service.EngineProbeError, 422, "engine_probe_failed"),
    (engines_service.EngineOptionError, 422, "invalid_engine_option"),
    (engines_service.EngineValidationError, 422, "invalid_engine"),
    (engines_service.EngineRunError, 502, "engine_failed"),
    (engines_service.EngineServiceError, 500, "engine_error"),
    (auth_service.AlreadyConfiguredError, 409, "already_configured"),
    (auth_service.LockedOutError, 429, "locked_out"),
    (auth_service.InvalidPasswordError, 401, "invalid_password"),
    (auth_service.WeakPasswordError, 422, "weak_password"),
    (auth_service.AuthError, 401, "unauthorized"),
    (runners_service.UnknownRunnerError, 404, "unknown_runner"),
    (runners_service.DuplicateRunnerError, 409, "duplicate_runner"),
    (runners_service.RunnerLockedOutError, 429, "locked_out"),
    (runners_service.RunnerAuthError, 401, "unauthorized"),
    (runners_service.RunnerValidationError, 422, "invalid_runner"),
    (streams_service.UnknownStreamError, 404, "unknown_stream"),
    (streams_service.StreamLimitError, 409, "stream_limit"),
    (streams_service.StreamUnavailableError, 409, "stream_unavailable"),
    (streams_service.StreamRequestError, 422, "invalid_request"),
    # 409 rather than 503: the board hides its live Maia section on it, which is a shape
    # the deployment is in, not a failure to retry.
    (maia_live_service.LivePolicyRequestError, 422, "invalid_request"),
    (maia_live_service.LiveMaiaUnavailableError, 409, "maia_unavailable"),
    (notes_service.NoteNotFoundError, 404, "unknown_note"),
    (notes_service.LineNotFoundError, 404, "unknown_line"),
    (notes_service.UnknownGameError, 404, "unknown_game"),
    # The settings clamp rather than refuse; this is the one set of them that cannot be
    # clamped into sense, and the page shows the message against the form.
    (app_settings_service.SettingsError, 422, "invalid_settings"),
    (stats_service.UnknownDimensionError, 422, "unknown_dimension"),
    # The two families every service layer raises for "you asked for something that is not
    # there" and "you asked for it wrongly". Registered last so a typed subclass wins.
    (LookupError, 404, "not_found"),
    (ValueError, 422, "invalid_request"),
)


def error_response(status_code: int, error: str, detail: str, **extra: Any) -> JSONResponse:
    body = ErrorResponse(error=error, detail=detail, **extra)
    return JSONResponse(status_code=status_code, content=body.model_dump(exclude_none=True))


def install_error_handlers(app: FastAPI) -> None:
    """Register one handler per known failure, plus the two catch-alls."""
    for exception, status_code, name in MAPPINGS:
        app.add_exception_handler(exception, _typed_handler(status_code, name))
    # Starlette's, not FastAPI's: an unmatched route and a 405 are raised by the router
    # itself, and FastAPI's HTTPException is a subclass, so this catches both.
    app.add_exception_handler(StarletteHTTPException, _http_handler)
    app.add_exception_handler(RequestValidationError, _validation_handler)
    app.add_exception_handler(Exception, _unexpected_handler)


def _typed_handler(status_code: int, name: str) -> Handler:
    async def handle(_request: Request, exc: Exception) -> JSONResponse:
        return error_response(status_code, name, str(exc) or name)

    return handle


async def _http_handler(_request: Request, exc: HTTPException) -> JSONResponse:
    name = getattr(exc, "error", None) or STATUS_NAMES.get(exc.status_code, "error")
    detail = exc.detail if isinstance(exc.detail, str) else name
    response = error_response(exc.status_code, name, detail)
    # Headers on an HTTPException are part of the answer, not decoration: Starlette's own
    # handler forwards them and a 401 without its `WWW-Authenticate` is not one.
    response.headers.update(exc.headers or {})
    return response


async def _validation_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    fields = [
        {"field": ".".join(str(part) for part in entry.get("loc", ())), "message": entry["msg"]}
        for entry in exc.errors()
    ]
    return error_response(
        422, "invalid_request", "the request did not validate", fields=fields or None
    )


async def _unexpected_handler(_request: Request, exc: Exception) -> JSONResponse:
    """Anything nobody anticipated. The type is named; the traceback is not exposed."""
    return error_response(500, "internal_error", f"unhandled {type(exc).__name__}")
