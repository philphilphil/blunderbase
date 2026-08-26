"""Serving the built web app out of the API process.

One process, one port: the page, the routes it reads, the `/events` socket and the coach's
MCP transport are all the same origin, which is what makes the deployed artifact a single
container instead of a backend, a static server and a reverse proxy in front of both.

The one thing that needs arranging is that the UI's own routes are spelled exactly like
the routers they read from — `/games`, `/explorer`, `/stats`, `/live` are all both a page
and an API path. So the split is the same one the Vite dev proxy already makes
(`web/vite.config.ts`): **the client talks to `/api/*`** and everything else belongs to
the page. `ApiPrefix` strips that prefix so the routers keep their bare paths, and
`SpaFiles` answers every other GET with a file from the build, or with `index.html` when
there is no such file — a client-side route, reached by a reload or a shared link.

Both are ASGI middleware rather than routes, because a route would be matched after the
routers and `/games` would answer a page reload with JSON. `RESERVED` is what keeps the
API, the socket, the health check and the transport in front of the page regardless.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from starlette.exceptions import HTTPException
from starlette.responses import Response
from starlette.staticfiles import StaticFiles
from starlette.types import ASGIApp, Receive, Scope, Send

INDEX = "index.html"
API_PREFIX = "/api"
# Paths that are never the page's, whatever the browser asks for. Everything under
# `/api`, plus the endpoints a client reaches by their bare name.
RESERVED: tuple[str, ...] = (API_PREFIX, "/health", "/events", "/mcp", "/docs", "/redoc")
RESERVED_EXACT: frozenset[str] = frozenset({"/openapi.json"})
SERVED_METHODS = frozenset({"GET", "HEAD"})


def reserved(path: str) -> bool:
    return path in RESERVED_EXACT or any(
        path == prefix or path.startswith(f"{prefix}/") for prefix in RESERVED
    )


class ApiPrefix:
    """Serve the routers under `/api` as well as at their bare paths.

    The prefix is stripped before routing rather than declared on every router, so there
    is one copy of each route in the app and one in the OpenAPI schema. It is what the
    dev proxy does to the same requests, so the browser's URLs are identical either way.
    """

    def __init__(self, app: ASGIApp, prefix: str = API_PREFIX) -> None:
        self.app = app
        self.prefix = prefix

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] in ("http", "websocket") and self.claims(scope["path"]):
            scope = dict(scope)
            scope["path"] = scope["path"][len(self.prefix) :] or "/"
            scope["raw_path"] = scope["path"].encode()
        await self.app(scope, receive, send)

    def claims(self, path: str) -> bool:
        return path.startswith(f"{self.prefix}/") or path == self.prefix


class SpaFiles(StaticFiles):
    """The build's files, with `index.html` standing in for anything that is not one."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        try:
            return await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
            return await super().get_response(INDEX, scope)


class WebApp:
    """`SpaFiles` in front of the API, for the paths the API has not reserved."""

    def __init__(self, app: ASGIApp, directory: Path) -> None:
        self.app = app
        self.files = SpaFiles(directory=directory)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["method"] in SERVED_METHODS:
            if not reserved(scope["path"]):
                await self.files(scope, receive, send)
                return
        await self.app(scope, receive, send)


def install_web(app: FastAPI, directory: Path | None) -> bool:
    """Mount `/api` and, if the web app was built, the page. Says whether it was.

    A missing directory is the development case, not an error: `pnpm dev` is serving the
    page and proxying `/api` here. `index.html` has to be there too — a half-built or
    emptied `dist` would otherwise answer every page load with a 500.
    """
    # Added first so it runs last: the prefix must come off *after* `WebApp` has decided,
    # or `/api/games` would look to it like the games page and be answered with the page.
    app.add_middleware(ApiPrefix)
    if directory is None or not (directory / INDEX).is_file():
        return False
    app.add_middleware(WebApp, directory=directory)
    return True
