from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator
from contextlib import AsyncExitStack, asynccontextmanager, suppress
from typing import Any

from fastapi import FastAPI
from starlette.middleware.gzip import GZipMiddleware

from backend.api.auth import install_auth
from backend.api.errors import install_error_handlers
from backend.api.events import EventBroker
from backend.api.routes import ROUTERS
from backend.api.routes.imports import wait_for_imports
from backend.api.web import install_web
from backend.config import Settings, get_settings
from backend.db.migrate import upgrade_to_head
from backend.db.session import get_engine, get_sessionmaker
from backend.services import maia_live, stats
from backend.services import runners as runners_service
from backend.services.streams import StreamBroker
from backend.workers import AnalysisWorkers
from backend.workers.local_streams import LocalStreamBackend
from backend.workers.runner_gateway import RunnerGateway
from backend.workers.runner_streams import RemoteStreamBackend

TITLE = "Blunderbase"
DESCRIPTION = "A personal chess database. Every route is a thin wrapper over `backend.services`."

# How long the stat-summary folder waits between passes once it has found nothing to fold.
# It is looking for the games an account reconciliation unfolded, which is a rare event and
# not one anybody is watching a clock over, so this is long enough to cost nothing and short
# enough that the dimensions are not left scanning for an afternoon.
STAT_SUMMARY_IDLE_SECONDS = 300.0

# Below this a gzip member's own header and trailer cost more than the compression saves,
# so a short body is sent as it is. Every payload worth the trade — a page of game cards, a
# stats dimension, the built JavaScript — is far above it.
GZIP_MINIMUM_SIZE = 1000

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Bring the database to head, then run the analysis workers for as long as we do.

    The queue is `AnalysisRun` rows, so nothing is lost across a restart: starting the
    workers is also what collects the runs the previous process left `running`. The runner
    gateway is the same story a connection at a time — `disconnect_all` clears the
    `connected` flags a dead process left set, before anything reads them.
    """
    settings: Settings = app.state.settings
    upgrade_to_head(settings)
    logger.info("database pool ready: %s", get_engine(settings).pool.status())
    _clear_stale_connections(settings)
    _mount_mcp(app, settings)
    app.state.loop = asyncio.get_running_loop()
    events: EventBroker = app.state.events
    events.start()
    workers = AnalysisWorkers(settings=settings)
    app.state.workers = workers
    if settings.analysis_workers:
        await workers.start()
    gateway = RunnerGateway(settings=settings)
    app.state.gateway = gateway
    await gateway.start()
    streams = _analysis_boards(settings, workers, gateway)
    app.state.streams = streams
    await streams.start()
    summaries = asyncio.create_task(_backfill_stat_summaries(settings))
    try:
        async with AsyncExitStack() as stack:
            # The mounted transport keeps its sessions in a task group this context opens.
            # It is a route rather than a sub-application, so nothing else would ever
            # start it.
            await stack.enter_async_context(app.state.mcp.session_manager.run())
            yield
    finally:
        # Cancelled first, and between chunks: every chunk it has finished is committed, so
        # there is nothing here to wait for and nothing to lose by stopping now.
        summaries.cancel()
        with suppress(asyncio.CancelledError):
            await summaries
        await wait_for_imports(app.state.imports)
        # Before the gateway and the workers, in that order: an analysis board holds a slot
        # on one of them, and both have to still be there for it to give the slot back to.
        await streams.stop()
        app.state.streams = None
        await gateway.stop()
        app.state.gateway = None
        await workers.stop()
        # The warm Maia the analysis board queries is a process this one started and
        # nothing else will collect.
        await asyncio.to_thread(maia_live.shutdown)
        events.stop()
        app.state.loop = None


async def _backfill_stat_summaries(settings: Settings) -> None:
    """Fold the per-game stat summaries of any game that is missing one, a chunk at a time.

    A finished run folds its own game, so on a library that has always had these columns
    this finds nothing and says nothing. What it is for is the two ways a game can be left
    unfolded: a library imported and analysed before the columns existed, and the games
    `accounts.reconcile_games` throws the folds of away when it learns whose side is whose.
    Until every game is folded the stats dimensions answer by scanning every analysed ply
    of every one of them, which is exactly what this exists to stop — so it runs on its
    own rather than waiting for the owner to find a CLI command.

    It idles rather than finishing, because the second case can happen at any time and a
    library that healed only on the next restart is not healed. Idling costs one indexed
    lookup every `IDLE_SECONDS`.

    Each chunk is one committed transaction in a thread, so it takes SQLite's single writer
    for a moment at a time and hands it back; the loop is cancelled between chunks at
    shutdown and whatever it had folded stands. Nothing here may take the server down with
    it: a library that cannot be folded is a slow one, not a broken one.
    """
    sessions = get_sessionmaker(settings)

    def fold() -> int:
        with sessions() as session:
            return stats.rebuild_stat_summaries(session)

    while True:
        started = time.monotonic()
        folded = 0
        try:
            while done := await asyncio.to_thread(fold):
                if not folded:
                    logger.info("folding the stat summaries of games that are missing one")
                folded += done
        except asyncio.CancelledError:
            if folded:
                logger.info("stat summary backfill stopped after %s game(s)", folded)
            raise
        except Exception:
            logger.exception("stat summary backfill failed after %s game(s)", folded)
        else:
            if folded:
                logger.info(
                    "stat summaries folded for %s game(s) in %.1fs",
                    folded,
                    time.monotonic() - started,
                )
        await asyncio.sleep(STAT_SUMMARY_IDLE_SECONDS)


def _analysis_boards(
    settings: Settings, workers: AnalysisWorkers, gateway: RunnerGateway
) -> StreamBroker:
    """The infinite-analysis broker, wired to both hosts it can serve a board on.

    The local backend shares the workers' engine pool on purpose: an infinite search and a
    queue pass are the same machine's cores, and `analysis_concurrency` is where that is
    counted. The remote one plugs into the gateway's handler seam and is what makes a
    board on a runner indistinguishable from one here.
    """
    broker = StreamBroker(settings=settings)
    broker.register_backend(
        LocalStreamBackend.name, LocalStreamBackend(broker, pool=workers.pool, settings=settings)
    )
    remote = RemoteStreamBackend(gateway, broker, settings=settings)
    remote.install()
    broker.register_backend(RemoteStreamBackend.name, remote)
    return broker


def _clear_stale_connections(settings: Settings) -> None:
    """Nobody is dialled in yet, whatever the last process left the rows saying."""
    with get_sessionmaker(settings)() as session:
        cleared = runners_service.disconnect_all(session)
    if cleared:
        logger.info("cleared %s runner connection(s) a previous process left set", cleared)


def _mount_mcp(app: FastAPI, settings: Settings) -> None:
    """Serve `/mcp` for as long as we serve anything, key or no key, password or none yet.

    The key and the password are one credential, so a deployment set up through the web UI
    has a remote transport without anyone exporting an environment variable — and it has
    it *immediately*, because the route and the task group its sessions live in are opened
    here, before anyone has chosen a password. Until one exists the bearer guard answers
    401 to every caller; the first request after first-run setup is the first one it lets
    through. Mounting on demand is not an option: the lifespan is the only place that can
    open the session manager's task group, and it runs exactly once.

    Which is why this is the only place that mounts, key or no key. A transport built in
    `create_app` would be one whose sessions nothing ever runs.
    """
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
    app.state.gateway = None
    app.state.streams = None
    app.state.loop = None
    app.state.mcp = None

    install_error_handlers(app)
    for router in ROUTERS:
        app.include_router(router)

    @app.get("/health", tags=["meta"])
    async def health() -> dict[str, str]:
        """Whether this process is answering, and nothing more.

        `async` on purpose, and touching neither the database nor a service: a `def` route
        is run in Starlette's threadpool, so the container's healthcheck would queue behind
        whatever has filled it — a backfill's worth of analysis requests, say — and time
        out while the process was perfectly alive. Answered on the event loop it cannot be
        starved by work in the pool, which is the one thing a healthcheck must not be.
        """
        return {"status": "ok"}

    # `/mcp` is mounted by the lifespan rather than here — see `_mount_mcp`.

    # Added before the web app so the page and its assets are answered in front of the
    # guard — the UI has to load in order to show the login screen — and so the `/api`
    # prefix has already been stripped from the paths the guard matches.
    install_auth(app, settings)
    app.state.web = install_web(
        app, settings.web_dist, isolate=settings.cross_origin_isolation
    )
    # Added last so it runs first, outside the page and the guard both: everything this
    # process sends leaves compressed, the API's JSON and the build's assets alike.
    #
    # It is a pool fix as much as a bandwidth one. A handler's Session is released by the
    # dependency teardown, which FastAPI runs only once the response has been written out,
    # so a payload that takes seconds to reach a browser on the other side of a network is
    # a pooled connection held for those seconds. These payloads compress about tenfold and
    # the hold shrinks with them, which is what stops a batch of analysis requests draining
    # the pool while the answers are still in flight.
    #
    # `text/event-stream` is in Starlette's own exclusion list and a non-HTTP scope is
    # passed straight through, so neither the MCP transport's streams nor the `/events`
    # socket are buffered by this.
    app.add_middleware(GZipMiddleware, minimum_size=GZIP_MINIMUM_SIZE)
    return app


app = create_app()
