"""The scheduled sync: the Sync button, pressed by a clock.

One asyncio task in the serve process. Every `auto_sync_poll_seconds` it asks
`services/auto_sync.due_syncs` what is due and runs those one after another, each in a
worker thread under its own transaction — exactly the call `routes/imports.py` makes for a
press of the button, with the same progress hook, so the page watching `/events` sees a
scheduled sync the way it sees a manual one and the history records it the same way.

One at a time rather than all at once, because the point of a schedule is to be quiet:
three archives walked in parallel every half hour is a load spike nobody asked for, and a
sync that is still running when the next tick comes is simply not due yet.

The first look at the clock waits a full poll interval. A process that synced on the way up
would make every restart a sync, and a test that starts the app would find a thread
reading its database before it had written anything.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import suppress

from backend.api.events import EventBroker
from backend.config import Settings
from backend.db.session import get_sessionmaker, session_scope
from backend.db.types import utcnow
from backend.services import app_settings as app_settings_service
from backend.services import import_service
from backend.services.auto_sync import DueSync, due_syncs

logger = logging.getLogger(__name__)

# How long `stop` lets a sync that is mid-archive finish before giving up on waiting. The
# thread keeps going either way and the job row records how it ended; this only decides
# whether shutdown blocks for it.
SHUTDOWN_GRACE = 10.0


class AutoSync:
    def __init__(self, *, settings: Settings, broker: EventBroker) -> None:
        self.settings = settings
        self.broker = broker
        self._task: asyncio.Task[None] | None = None

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    async def start(self) -> None:
        if self.running:
            return
        self._task = asyncio.create_task(self._loop(), name="auto-sync")

    async def stop(self) -> None:
        task = self._task
        self._task = None
        if task is None or task.done():
            return
        # A sync in flight is worth a moment; a loop that is only sleeping is not.
        with suppress(asyncio.TimeoutError):
            await asyncio.wait_for(asyncio.shield(task), timeout=SHUTDOWN_GRACE)
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task

    async def _loop(self) -> None:
        while True:
            await asyncio.sleep(self.settings.auto_sync_poll_seconds)
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("scheduled sync failed")

    async def tick(self) -> int:
        """One look at the clock: run whatever is due, and say how many that was."""
        due = await asyncio.to_thread(self._due)
        for item in due:
            logger.info("scheduled sync of %s %r", item.source, item.username)
            await asyncio.to_thread(self._sync, item)
        return len(due)

    def _due(self) -> list[DueSync]:
        with get_sessionmaker(self.settings)() as session:
            minutes = app_settings_service.get_auto_sync_minutes(session)
            if minutes is None:
                return []
            return due_syncs(session, minutes, utcnow())

    def _sync(self, item: DueSync) -> None:
        with session_scope(self.settings) as session:
            import_service.run_import(
                session, item.source, progress=self.broker.publish, username=item.username
            )
