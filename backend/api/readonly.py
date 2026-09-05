"""The demo's other rule: look at anything, change nothing.

The public demo serves a library `blunderbase demo create` built, to anyone, with no
password. What keeps that from being a public scratchpad is this guard: every request that
could change the library — anything that is not a `GET`, `HEAD` or `OPTIONS` — is refused
with `403 {"error": "read_only"}` before it reaches a handler. Middleware rather than a
check in each router, for the reason the auth guard is one: a route added later is covered
by having been added.

The short list of exceptions is the "reads that happen to be POSTs": the analysis board's
session, the human-move model's answer for a position, and a bounded engine evaluation of
one. All three make the process do work but none of them touches a row of the library — a
stream lives in memory and dies with its listener — and a demo whose analysis board is dead
would be a demo of the one screen the product is about, with its most interesting pane
blank. Whether they answer at all depends on what engines the demo deployment has; the
capacity they can be made to spend is bounded by `stream_max_sessions` and the pool the
way it is for the owner, and the one-off eval — which starts a process outside the pool —
by `POSITION_SLOTS` plus, in demo mode alone, `DEMO_POSITION_NODES` (`services/analysis.py`).

`/auth/*` is let through for a different reason: its writes are already 404
`capability_unavailable` without a password in the picture (`routes/auth.py`), and a 404
that names the reason beats a 403 that does not.

The mirror image is the short list of GETs the demo refuses: the whole-library downloads.
A database backup copies and integrity-checks the entire file into the data volume before
the first byte goes out, and a PGN export renders every game; both are seconds of CPU and
hundreds of megabytes per request, to anyone, unauthenticated, and a loop of them is the
cheapest way to take the demo — and the host it shares — down. Nothing in the demo needs
them: its data is synthetic and the person who wants a copy runs `blunderbase demo create`.
"""

from __future__ import annotations

from fastapi import FastAPI
from starlette.types import ASGIApp, Receive, Scope, Send

from backend.api.errors import error_response

READ_ONLY = "read_only"
DETAIL = "this is the read-only demo; run your own Blunderbase to change a library"

DOWNLOAD_DETAIL = (
    "this is the read-only demo; it serves no whole-library downloads — "
    "run your own Blunderbase to back one up"
)

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
# Writes to nothing but the process's own memory and CPU, and the door that answers with
# its own refusal — see the module docstring.
EXEMPT_PREFIXES = ("/streams", "/auth")
EXEMPT_EXACT = frozenset({"/maia/policy", "/analysis/position"})
# Reads the demo refuses anyway: every one is the whole library as a file — see the module
# docstring. A prefix, so the estimate and the prepared-download routes go with the backup.
DOWNLOAD_PREFIXES = ("/library/backup", "/games/export")


def _under(path: str, prefixes: tuple[str, ...]) -> bool:
    return any(path == prefix or path.startswith(f"{prefix}/") for prefix in prefixes)


def exempt(path: str) -> bool:
    """Whether this path is one of the few POSTs the demo answers."""
    return path in EXEMPT_EXACT or _under(path, EXEMPT_PREFIXES)


def whole_library_download(path: str) -> bool:
    """Whether this path hands out the complete library as one file."""
    return _under(path, DOWNLOAD_PREFIXES)


class ReadOnlyGuard:
    """ASGI middleware refusing every request that could change the library."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            path = scope["path"]
            if scope["method"] not in SAFE_METHODS and not exempt(path):
                await error_response(403, READ_ONLY, DETAIL)(scope, receive, send)
                return
            if whole_library_download(path):
                await error_response(403, READ_ONLY, DOWNLOAD_DETAIL)(scope, receive, send)
                return
        await self.app(scope, receive, send)


def install_read_only(app: FastAPI) -> None:
    """Add the guard. Added beside `install_auth`, so it sees the same bare paths."""
    app.add_middleware(ReadOnlyGuard)
