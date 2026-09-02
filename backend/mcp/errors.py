from __future__ import annotations

import functools
import json
from collections.abc import Callable
from typing import Any

from mcp.types import CallToolResult, TextContent

from backend.services import analysis as analysis_service
from backend.services import engines as engines_service
from backend.services import live as live_service
from backend.services import maia_live as maia_live_service
from backend.services import notes as notes_service
from backend.services import reference as reference_service
from backend.services import stats as stats_service

# The vocabulary of things that can go wrong, as the coach reads them. A code is part of
# the tool contract: it is what a client branches on, so it never carries a row id or a
# file path — those go in the message.
BAD_ARGUMENT = "bad_argument"
BAD_FEN = "bad_fen"
UNKNOWN_GAME = "unknown_game"
UNKNOWN_RUN = "unknown_run"
UNKNOWN_NOTE = "unknown_note"
UNKNOWN_DIMENSION = "unknown_dimension"
NOT_FOUND = "not_found"
ENGINE_UNAVAILABLE = "engine_unavailable"
ENGINE_FAILED = "engine_failed"
QUEUE_FULL = "queue_full"
NOT_IMPLEMENTED = "not_implemented"
ILLEGAL_MOVE = "illegal_move"
NO_LIVE_POSITION = "no_live_position"
# The reference databases are somebody else's service, so they can fail in ways nothing
# else here can: the owner has not pasted a token, the one they pasted was refused, or
# Lichess itself is unhappy. The first two are asked of a person, the last two are waited
# out, and a coach that can tell them apart says the useful sentence.
REFERENCE_TOKEN_MISSING = "reference_token_missing"
REFERENCE_TOKEN_REJECTED = "reference_token_rejected"
REFERENCE_RATE_LIMITED = "reference_rate_limited"
REFERENCE_UNAVAILABLE = "reference_unavailable"


class CoachError(Exception):
    """A failure a coach tool saw coming, on its way to the model as structured JSON.

    The tool returns `is_error=True` with a one-object payload rather than raising, so the
    model reads a code it can branch on instead of a sentence it has to parse — and never
    a traceback. Anything unanticipated stays an exception: the SDK reports it as this
    tool failing and logs the traceback on the server, where it belongs.
    """

    def __init__(self, code: str, message: str, **detail: Any) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail

    def payload(self) -> dict[str, Any]:
        return {"error": self.code, "message": self.message, **self.detail}

    def as_result(self) -> CallToolResult:
        text = json.dumps(self.payload(), separators=(",", ":"), ensure_ascii=False, default=str)
        return CallToolResult(content=[TextContent(type="text", text=text)], is_error=True)


# Service failures that mean something specific to a caller. Ordered most specific first:
# `UnknownRunError` is also an `AnalysisError`, and `TierUnavailableError` is also an
# `EngineServiceError`.
TRANSLATIONS: tuple[tuple[type[Exception], str], ...] = (
    (analysis_service.UnknownRunError, UNKNOWN_RUN),
    (analysis_service.AnalysisRequestError, BAD_ARGUMENT),
    (analysis_service.AnalysisError, ENGINE_FAILED),
    (engines_service.TierUnavailableError, ENGINE_UNAVAILABLE),
    # A deployment with no local Maia has less to answer with, not a broken tool: the code
    # is the one a coach already knows for "there is no engine here to ask".
    (maia_live_service.LivePolicyRequestError, BAD_FEN),
    (maia_live_service.LiveMaiaUnavailableError, ENGINE_UNAVAILABLE),
    (engines_service.UnknownEngineError, NOT_FOUND),
    (engines_service.EngineServiceError, ENGINE_FAILED),
    (stats_service.UnknownDimensionError, UNKNOWN_DIMENSION),
    (notes_service.NoteNotFoundError, UNKNOWN_NOTE),
    (notes_service.LineNotFoundError, NOT_FOUND),
    (notes_service.UnknownGameError, UNKNOWN_GAME),
    (live_service.UnknownLiveGameError, UNKNOWN_GAME),
    (live_service.IllegalMoveError, ILLEGAL_MOVE),
    (live_service.NoLivePositionError, NO_LIVE_POSITION),
    (live_service.LiveFenError, BAD_FEN),
    (live_service.LiveRequestError, BAD_ARGUMENT),
    (reference_service.TokenMissingError, REFERENCE_TOKEN_MISSING),
    (reference_service.ReferenceAuthError, REFERENCE_TOKEN_REJECTED),
    (reference_service.ReferenceRateLimitedError, REFERENCE_RATE_LIMITED),
    (reference_service.ReferenceError, REFERENCE_UNAVAILABLE),
    (ValueError, BAD_ARGUMENT),
    (LookupError, NOT_FOUND),
)

TRANSLATED = tuple(kind for kind, _code in TRANSLATIONS)


def translate(exc: Exception) -> CoachError:
    """A service exception as the coach error it means."""
    for kind, code in TRANSLATIONS:
        if isinstance(exc, kind):
            return CoachError(code, str(exc))
    return CoachError(BAD_ARGUMENT, str(exc))


def guarded[T: Callable[..., Any]](fn: T) -> T:
    """Turn the failures a tool anticipates into structured error results.

    A guarded tool still declares `-> TextContent`, which is what tells the SDK to send
    one compact block and publish no output schema; on the failing path the wrapper hands
    back a whole `CallToolResult` instead, which the SDK passes through untouched. That
    is the only way to set `is_error` and still choose every byte of the payload.

    `functools.wraps` is what keeps the tool's own signature and docstring visible to the
    SDK — it reads both through `__wrapped__` to build the schema the model sees.
    """

    @functools.wraps(fn)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        try:
            return fn(*args, **kwargs)
        except CoachError as exc:
            return exc.as_result()
        except TRANSLATED as exc:
            return translate(exc).as_result()

    return wrapper  # type: ignore[return-value]
