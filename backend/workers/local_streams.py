"""The analysis board on a binary this host can start.

One asyncio task per session. It takes a slot out of the same `EnginePool` the analysis
workers draw on — an infinite search is a whole core for as long as somebody is looking at
the board, and the one place that is counted is the pool's semaphore — and then does
nothing but drive `adapters/infinite.py` on a thread and bounce snapshots back.

The shape is dictated by two things the broker's interface promises:

- **The slot is taken before `open` returns.** The task signals as soon as the pool has
  handed it a warm process, so a board that cannot be served says so at the `POST` rather
  than by never producing a snapshot.
- **A restart keeps the slot.** The task loops: stop the search, re-read the session's fen
  and multipv, and go again on the same process. Releasing and re-acquiring would let queue
  work take the engine in the gap, which is exactly what a position change must not cost.

A failure is reported by ending the session, never by raising out of the task: nothing is
awaiting it but the close that is trying to shut it down.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from backend.config import Settings, get_settings
from backend.services import streams as streams_service
from backend.services.streams import StreamSession, StreamUnavailableError

if TYPE_CHECKING:  # pragma: no cover - typing only
    from backend.adapters.infinite import Snapshot
    from backend.adapters.pool import EnginePool

logger = logging.getLogger(__name__)

# How long `open` waits for the pool to hand over a warm process. Sized for an engine
# starting, not for a queue: past this, every slot is genuinely busy and the board is told.
SLOT_TIMEOUT = 20.0
# How long `close` waits for a task to notice the stop and let go of its slot.
CLOSE_TIMEOUT = 10.0

NO_SLOT = "every local engine slot is busy right now"
STOPPED = "the engine stopped searching this position"


@dataclass(slots=True)
class _Search:
    """One session's task, and the two flags the loop reads between searches."""

    started: asyncio.Event
    task: asyncio.Task[None] | None = None
    stop: threading.Event | None = None
    restart: bool = False
    closing: bool = False
    error: str | None = None


class LocalStreamBackend:
    """`go infinite` on this host, one warm process per open board."""

    name = streams_service.LOCAL

    def __init__(
        self,
        broker: streams_service.StreamBroker,
        *,
        pool: EnginePool | None = None,
        settings: Settings | None = None,
    ) -> None:
        self.broker = broker
        self.settings = settings or get_settings()
        self._pool = pool
        self._searches: dict[str, _Search] = {}
        self._background: set[asyncio.Task[Any]] = set()

    @property
    def pool(self) -> EnginePool:
        """The warm processes. Shared with the analysis workers, so one cap covers both."""
        if self._pool is None:
            from backend.adapters.pool import EnginePool

            self._pool = EnginePool(concurrency=self.settings.analysis_concurrency)
        return self._pool

    async def open(self, session: StreamSession) -> None:
        if session.spec is None:  # pragma: no cover - the broker always resolves one
            raise StreamUnavailableError(f"{session.engine!r} has no local process to start")
        search = _Search(started=asyncio.Event())
        self._searches[session.id] = search
        search.task = asyncio.create_task(
            self._serve(session, search), name=f"stream-{session.id}"
        )
        try:
            await asyncio.wait_for(search.started.wait(), SLOT_TIMEOUT)
        except TimeoutError:
            await self._stop(session.id, search)
            raise StreamUnavailableError(NO_SLOT) from None
        if search.error is not None:
            self._searches.pop(session.id, None)
            raise StreamUnavailableError(search.error)

    async def restart(self, session: StreamSession) -> None:
        search = self._searches.get(session.id)
        if search is None or search.task is None or search.task.done():
            raise StreamUnavailableError(f"{session.engine!r} is no longer searching")
        search.restart = True
        if search.stop is not None:
            search.stop.set()

    async def close(self, session: StreamSession, reason: str) -> None:
        search = self._searches.pop(session.id, None)
        if search is None:
            return
        await self._stop(session.id, search)

    async def _stop(self, session_id: str, search: _Search) -> None:
        """Ask the task to let go, and wait for it: the slot is not free until it has."""
        self._searches.pop(session_id, None)
        search.closing = True
        if search.stop is not None:
            search.stop.set()
        task = search.task
        if task is None or task is asyncio.current_task():
            return
        if not search.started.is_set():
            # Still queued behind the pool's semaphore, where neither flag reaches it. A
            # slot it is handed now would be one nobody is waiting for any more.
            task.cancel()
        try:
            await asyncio.wait_for(asyncio.shield(task), CLOSE_TIMEOUT)
        except TimeoutError:  # pragma: no cover - an engine that will not stop
            logger.warning("stream %s would not let go of its engine", session_id)
        except BaseException:
            pass

    async def _serve(self, session: StreamSession, search: _Search) -> None:
        """Hold one engine and search whatever the session is showing, until it is closed."""
        from backend.adapters.infinite import InfiniteSearch

        loop = asyncio.get_running_loop()
        finished = False
        try:
            async with self.pool.acquire(session.spec) as adapter:  # type: ignore[arg-type]
                search.started.set()
                driver = InfiniteSearch(
                    adapter,  # type: ignore[arg-type]
                    interval=self.settings.stream_snapshot_interval,
                )

                def emit(snapshot: Snapshot) -> None:
                    # Called on the engine thread; the broker's fan-out belongs to the loop.
                    loop.call_soon_threadsafe(self.broker.snapshot, session.id, snapshot.as_dict())

                while not search.closing:
                    board = _board(session.fen)
                    multipv = session.multipv
                    search.restart = False
                    search.stop = threading.Event()
                    finished = await asyncio.to_thread(
                        driver.run,
                        board,
                        multipv=multipv,
                        on_snapshot=emit,
                        stop=search.stop,
                    )
                    if search.closing or not search.restart:
                        break
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            search.error = _message(exc)
            logger.info("stream %s: the engine failed: %s", session.id, search.error)
        finally:
            search.started.set()
        if search.closing:
            return
        # Ending on its own: the engine died, or it answered and stopped (a terminal
        # position). The board has to be told either way — on a task of its own, because
        # the broker's answer is to close this session, which would otherwise be this task
        # waiting for itself to finish.
        self._spawn(
            self.broker.backend_ended(
                session.id,
                reason=streams_service.REASON_ENGINE_FAILED,
                error=search.error or (STOPPED if finished else None),
            )
        )

    def _spawn(self, coroutine: Any) -> asyncio.Task[Any]:
        task = asyncio.ensure_future(coroutine)
        self._background.add(task)
        task.add_done_callback(self._background.discard)
        return task


def _board(fen: str) -> Any:
    from backend.services.explorer import read_fen

    return read_fen(fen)


def _message(exc: BaseException) -> str:
    text = str(exc).strip()
    return f"{type(exc).__name__}: {text}" if text else type(exc).__name__
