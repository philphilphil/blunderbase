"""The live Lichess import: a finished game syncs the account a moment after it ends.

One asyncio task in the serve process holding Lichess's event stream for the owner's
connected account (`GET /api/stream/event`). The stream carries a few small frames per game
and a keep-alive line every seven seconds; a `gameFinish` is the only frame that matters
here, and what it sets off is the ordinary sync — `import_service.run_import` with the
username, exactly what the Sync button and the schedule call — so a live import has the same
cursor, the same job row and the same `/events` progress as every other.

**Syncs are coalesced, not queued.** A finish waits a couple of seconds for Lichess's export
to have the game, and any finish that arrives while a sync is waiting or running folds into
one more sync after it: the sync reads from the cursor, so one run after the last finish
picks up every game before it.

**The stream follows the settings, not the other way round.** What to follow is asked of
`services.lichess_connection.live_target` when the loop starts, whenever the connection
changes (`lichess.connection`), and every `RECHECK_SECONDS` while connected — so signing in,
signing out, syncing the account for the first time or taking Lichess out of syncing all
reach the stream within a minute without anything having to call in here.

A refused token is not retried: it is dead until the owner signs in again, and hammering
Lichess with it would be the one way to make that worse. Any other failure reconnects with a
backoff that doubles up to `MAX_BACKOFF_SECONDS`, and the timed sync is still there for a
game that ended while the stream was down.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator, Callable
from contextlib import suppress
from typing import Any

from backend.adapters import lichess_oauth
from backend.api.events import EventBroker
from backend.config import Settings
from backend.db.enums import Source
from backend.db.session import get_sessionmaker, session_scope
from backend.services import events as events_service
from backend.services import import_service
from backend.services import lichess_connection as connection_service
from backend.services.lichess_connection import LiveTarget

logger = logging.getLogger(__name__)

# How long a finished game is given to reach Lichess's export before the sync asks for it.
SETTLE_SECONDS = 3.0
# How often a held stream checks that it is still the one the settings ask for.
RECHECK_SECONDS = 60.0
MIN_BACKOFF_SECONDS = 5.0
MAX_BACKOFF_SECONDS = 300.0
# Lichess's answer to a 429 is "wait a full minute", whatever else is going on.
RATE_LIMIT_SECONDS = 60.0
# How long `stop` lets a live sync in flight finish before giving up on waiting for it.
SHUTDOWN_GRACE = 10.0

Stream = Callable[..., AsyncIterator[dict[str, Any]]]


class LichessLive:
    def __init__(
        self,
        *,
        settings: Settings,
        broker: EventBroker,
        stream: Stream = lichess_oauth.stream_events,
        settle_seconds: float = SETTLE_SECONDS,
    ) -> None:
        self.settings = settings
        self.broker = broker
        self._stream = stream
        self._settle = settle_seconds
        self._task: asyncio.Task[None] | None = None
        self._syncer: asyncio.Task[None] | None = None
        self._wanted: str | None = None
        self._wake: asyncio.Event | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._unsubscribe: Callable[[], None] | None = None
        # The token Lichess refused, so the loop leaves it alone until a different one is
        # stored rather than asking again every minute.
        self._rejected: str | None = None

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    async def start(self) -> None:
        if self.running:
            return
        self._loop = asyncio.get_running_loop()
        self._wake = asyncio.Event()
        self._unsubscribe = events_service.subscribe(self._on_event)
        self._task = asyncio.create_task(self._run(), name="lichess-live")

    async def stop(self) -> None:
        if self._unsubscribe is not None:
            self._unsubscribe()
            self._unsubscribe = None
        task, self._task = self._task, None
        if task is not None and not task.done():
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
        syncer, self._syncer = self._syncer, None
        if syncer is not None and not syncer.done():
            with suppress(Exception):
                await asyncio.wait_for(asyncio.shield(syncer), timeout=SHUTDOWN_GRACE)
            syncer.cancel()
            with suppress(asyncio.CancelledError):
                await syncer
        connection_service.set_stream_state("off")

    # --- the stream -------------------------------------------------------

    async def _run(self) -> None:
        backoff = MIN_BACKOFF_SECONDS
        while True:
            target = await asyncio.to_thread(self._target)
            if target is None:
                connection_service.set_stream_state("off")
                await self._sleep(RECHECK_SECONDS)
                continue
            if target.token == self._rejected:
                connection_service.set_stream_state("rejected")
                await self._sleep(RECHECK_SECONDS)
                continue
            connection_service.set_stream_state("connecting")
            try:
                await self._follow(target)
            except asyncio.CancelledError:
                raise
            except lichess_oauth.LichessTokenRejectedError:
                logger.warning("lichess refused the stored token; live import is off")
                self._rejected = target.token
                continue
            except lichess_oauth.LichessStreamRateLimitedError:
                logger.warning("lichess is rate limiting the event stream")
                connection_service.set_stream_state("connecting")
                await self._sleep(RATE_LIMIT_SECONDS)
                continue
            except Exception as exc:
                logger.warning("lichess event stream failed: %s", exc)
                connection_service.set_stream_state("connecting")
                await self._sleep(backoff)
                backoff = min(backoff * 2, MAX_BACKOFF_SECONDS)
                continue
            # Lichess closed a stream that had been open, or the settings changed under
            # it: either way the next look is a fresh one, after a polite pause.
            backoff = MIN_BACKOFF_SECONDS
            await self._sleep(MIN_BACKOFF_SECONDS)

    async def _follow(self, target: LiveTarget) -> None:
        """Hold the stream until it ends, fails, or stops being the one to hold."""
        reader = asyncio.create_task(self._read(target))
        watcher = asyncio.create_task(self._watch(target))
        try:
            done, _ = await asyncio.wait({reader, watcher}, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for task in (reader, watcher):
                if not task.done():
                    task.cancel()
                    with suppress(asyncio.CancelledError):
                        await task
        if reader in done:
            reader.result()

    async def _read(self, target: LiveTarget) -> None:
        def opened() -> None:
            logger.info("following lichess games of %r live", target.username)
            connection_service.set_stream_state("live")

        async for event in self._stream(target.token, on_open=opened):
            game_id = lichess_oauth.finished_game_id(event)
            if game_id is not None:
                logger.info("lichess game %s finished; syncing %r", game_id, target.username)
                self._request_sync(target.username)

    async def _watch(self, target: LiveTarget) -> None:
        """Return once the settings name a different target, or none."""
        while True:
            await self._sleep(RECHECK_SECONDS)
            if await asyncio.to_thread(self._target) != target:
                return

    # --- the sync ---------------------------------------------------------

    def _request_sync(self, username: str) -> None:
        self._wanted = username
        if self._syncer is None or self._syncer.done():
            self._syncer = asyncio.create_task(self._drain(), name="lichess-live-sync")

    async def _drain(self) -> None:
        while self._wanted is not None:
            await asyncio.sleep(self._settle)
            username, self._wanted = self._wanted, None
            try:
                await asyncio.to_thread(self._sync, username)
            except Exception:
                logger.exception("live lichess sync failed")

    def _sync(self, username: str) -> None:
        with session_scope(self.settings) as session:
            import_service.run_import(
                session, str(Source.LICHESS), progress=self.broker.publish, username=username
            )

    # --- plumbing ---------------------------------------------------------

    def _target(self) -> LiveTarget | None:
        with get_sessionmaker(self.settings)() as session:
            return connection_service.live_target(session)

    def _on_event(self, event: dict[str, Any]) -> None:
        """Wake the loop when the connection changed. Called from any thread.

        A frame carrying `stream` is this worker announcing its own state, which is news to
        the page and not to the loop that sent it.
        """
        if event.get("event") != connection_service.EVENT_CONNECTION or "stream" in event:
            return
        loop, wake = self._loop, self._wake
        if loop is None or wake is None:
            return
        with suppress(RuntimeError):
            loop.call_soon_threadsafe(wake.set)

    async def _sleep(self, seconds: float) -> None:
        """Wait out `seconds`, or less if the connection changes meanwhile."""
        wake = self._wake
        assert wake is not None
        with suppress(TimeoutError):
            await asyncio.wait_for(wake.wait(), timeout=seconds)
        wake.clear()
