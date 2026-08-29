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

**Cross-origin isolation.** The document is served with `Cross-Origin-Opener-Policy:
same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, which is what a browser
wants before it will hand a page a `SharedArrayBuffer` — and without one a WASM engine
running in a tab is single-threaded, which is most of the reason to run one at all.

`require-corp` is the half with teeth: from then on **every cross-origin subresource must
opt in** with `Cross-Origin-Resource-Policy`, or the browser blocks it. What that rules out
is a page that pulls a font from Google Fonts, a script from a CDN, an avatar from Lichess
or a board image from anywhere but here. Today it rules out nothing at all — the build
carries its own fonts, styles, scripts and icons, and everything the page fetches is this
same origin — and that is a property the SPA has to keep, which is why it is written down
here rather than discovered later as a blank square. A deployment that has to break it
turns the whole thing off with `BLUNDERBASE_CROSS_ORIGIN_ISOLATION=false` (also the escape
hatch for a proxy that rewrites or drops the headers) and gets one thread.

The headers go on the **document** and nothing else: `WebApp` only ever handles what the
API has not reserved, so `/api`, `/events` and `/mcp` never see them — a coach's transport
and a WebSocket have no window to isolate — and inside the page's own paths only the HTML
carries them, because COOP and COEP are properties of a browsing context rather than of a
hashed asset. Same-origin subresources need no CORP of their own, which is why the assets
next to the document load unchanged.
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

# The pair a browser wants before it will give the page a `SharedArrayBuffer`. Both, or
# neither: one on its own isolates nothing.
ISOLATION_HEADERS: dict[str, str] = {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
}
DOCUMENT_TYPE = "text/html"

# A dedicated worker does not inherit the document's isolation: it is isolated only if its
# own script response asks to be, and a worker that is not isolated has no
# `SharedArrayBuffer`. The browser engine is emscripten pthreads, so its workers die at load
# without this — and the failure arrives as an `ErrorEvent` with an empty message, empty
# filename and no line number, which says nothing about the cause. COEP alone: COOP is a
# property of a browsing context and a worker has none.
WORKER_ISOLATION_HEADERS: dict[str, str] = {
    "Cross-Origin-Embedder-Policy": "require-corp",
    # The engine's own files are same-origin, so this is belt and braces — but it is what
    # keeps them loadable if the build is ever served from a CDN or a separate asset host.
    "Cross-Origin-Resource-Policy": "same-origin",
}
# Where the browser engine's glue, wasm and network are served from; `web/vite-engine-assets
# .ts` publishes the same three files at the same prefix for the dev server.
ENGINE_PREFIX = "engine/"


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

    def __init__(self, *, directory: Path, isolate: bool = False) -> None:
        super().__init__(directory=directory)
        self.isolate = isolate

    async def get_response(self, path: str, scope: Scope) -> Response:
        try:
            return self._isolated(await super().get_response(path, scope), path)
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
            return self._isolated(await super().get_response(INDEX, scope), INDEX)

    def _isolated(self, response: Response, path: str) -> Response:
        """COOP and COEP on the document, and COEP on the engine — see the module docstring.

        The document is keyed on the content type rather than on the path, so the one
        `index.html` that is served under a hundred client-side routes is isolated under all
        of them, and the hashed assets beside it are left alone.

        The engine's files are keyed on the path instead, because what needs the header
        there is a *worker script*, and it is indistinguishable by content type from every
        other piece of JavaScript in the build — none of which should carry it.
        """
        if not self.isolate:
            return response
        if response.headers.get("content-type", "").startswith(DOCUMENT_TYPE):
            response.headers.update(ISOLATION_HEADERS)
        elif path.lstrip("/").startswith(ENGINE_PREFIX):
            response.headers.update(WORKER_ISOLATION_HEADERS)
        return response


class WebApp:
    """`SpaFiles` in front of the API, for the paths the API has not reserved."""

    def __init__(self, app: ASGIApp, directory: Path, isolate: bool = False) -> None:
        self.app = app
        self.files = SpaFiles(directory=directory, isolate=isolate)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["method"] in SERVED_METHODS:
            if not reserved(scope["path"]):
                await self.files(scope, receive, send)
                return
        await self.app(scope, receive, send)


def install_web(app: FastAPI, directory: Path | None, *, isolate: bool = False) -> bool:
    """Mount `/api` and, if the web app was built, the page. Says whether it was.

    A missing directory is the development case, not an error: `pnpm dev` is serving the
    page and proxying `/api` here. `index.html` has to be there too — a half-built or
    emptied `dist` would otherwise answer every page load with a 500.

    `isolate` is `Settings.cross_origin_isolation`, and applies to the built page alone: in
    development the document comes from the Vite dev server, which this process does not
    serve and cannot add a header to.
    """
    # Added first so it runs last: the prefix must come off *after* `WebApp` has decided,
    # or `/api/games` would look to it like the games page and be answered with the page.
    app.add_middleware(ApiPrefix)
    if directory is None or not (directory / INDEX).is_file():
        return False
    app.add_middleware(WebApp, directory=directory, isolate=isolate)
    return True
