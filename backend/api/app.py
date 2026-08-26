from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import AsyncExitStack, asynccontextmanager
from typing import Any

from fastapi import FastAPI

from backend.api.auth import install_auth
from backend.api.errors import install_error_handlers
from backend.api.events import EventBroker
from backend.api.routes import ROUTERS
from backend.api.routes.imports import wait_for_imports
from backend.api.web import install_web
from backend.config import Settings, get_settings
from backend.db.migrate import upgrade_to_head
from backend.db.session import get_sessionmaker
from backend.services import auth as auth_service
from backend.workers import AnalysisWorkers

TITLE = "Blunderbase"
DESCRIPTION = "A personal chess database. Every route is a thin wrapper over `backend.services`."


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Bring the database to head, then run the analysis workers for as long as we do.

    The queue is `AnalysisRun` rows, so nothing is lost across a restart: starting the
    workers is also what collects the runs the previous process left `running`.
    """
    settings: Settings = app.state.settings
    upgrade_to_head(settings)
    _mount_mcp_for_the_owners_password(app, settings)
    app.state.loop = asyncio.get_running_loop()
    events: EventBroker = app.state.events
    events.start()
    workers = AnalysisWorkers(settings=settings)
    app.state.workers = workers
    if settings.analysis_workers:
        await workers.start()
    try:
        async with AsyncExitStack() as stack:
            if app.state.mcp is not None:
                # The mounted transport keeps its sessions in a task group this context
                # opens. It is a route rather than a sub-application, so nothing else
                # would ever start it.
                await stack.enter_async_context(app.state.mcp.session_manager.run())
            yield
    finally:
        await wait_for_imports(app.state.imports)
        await workers.stop()
        events.stop()
        app.state.loop = None


def _mount_mcp_for_the_owners_password(app: FastAPI, settings: Settings) -> None:
    """Serve `/mcp` when the owner has a password, even with no bearer key configured.

    The key and the password are one credential now, so a deployment that was set up
    through the web UI has a remote transport without anyone exporting an environment
    variable. It is decided here rather than in `create_app` because the answer is a row,
    and the database has only just been migrated — on a first run it did not exist at all.

    Consequence worth knowing: a password chosen through the UI reaches `/mcp` at the next
    restart, not immediately. The transport's sessions live in a task group the lifespan
    below opens, and there is no second chance to open one while the server is serving.
    """
    if app.state.mcp is not None:
        return
    with get_sessionmaker(settings)() as session:
        if auth_service.setup_required(session):
            return
    from backend.mcp.http import mount_http_app

    app.state.mcp = mount_http_app(app, settings)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title=TITLE, description=DESCRIPTION, lifespan=lifespan)
    app.state.settings = settings
    app.state.events = EventBroker()
    # Syncs run in worker threads under their own transaction; the tasks are held here so
    # nothing collects them mid-flight and shutdown can wait on them.
    imports: set[asyncio.Task[Any]] = set()
    app.state.imports = imports
    app.state.workers = None
    app.state.loop = None
    app.state.mcp = None

    install_error_handlers(app)
    for router in ROUTERS:
        app.include_router(router)

    @app.get("/health", tags=["meta"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    if settings.mcp_http_enabled:
        # Imported here so a process that serves no remote transport never builds the
        # coach's tool surface, and `blunderbase mcp --transport http` keeps working as
        # its own app either way.
        from backend.mcp.http import mount_http_app

        app.state.mcp = mount_http_app(app, settings)

    # Added before the web app so the page and its assets are answered in front of the
    # guard — the UI has to load in order to show the login screen — and so the `/api`
    # prefix has already been stripped from the paths the guard matches.
    install_auth(app, settings)
    app.state.web = install_web(app, settings.web_dist)
    return app


app = create_app()
