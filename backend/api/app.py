from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI

from backend.api.errors import install_error_handlers
from backend.api.events import EventBroker
from backend.api.routes import ROUTERS
from backend.api.routes.imports import wait_for_imports
from backend.config import Settings, get_settings
from backend.db.migrate import upgrade_to_head
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
    app.state.loop = asyncio.get_running_loop()
    events: EventBroker = app.state.events
    events.start()
    workers = AnalysisWorkers(settings=settings)
    app.state.workers = workers
    if settings.analysis_workers:
        await workers.start()
    try:
        yield
    finally:
        await wait_for_imports(app.state.imports)
        await workers.stop()
        events.stop()
        app.state.loop = None


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

    install_error_handlers(app)
    for router in ROUTERS:
        app.include_router(router)

    @app.get("/health", tags=["meta"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
