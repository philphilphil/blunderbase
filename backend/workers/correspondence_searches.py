"""Correspondence searches on this host: one asyncio task per engine on a position.

A second owner of the machinery `workers/local_streams.py` drives, with different rules.
An analysis board is one search per surface, replaced on the next click and reaped when
nobody is looking; a correspondence search is one engine on one node for three days with
nobody looking at all, and the broker's policies are exactly wrong for it. So this set has
an `EnginePool` of its own, sized by `correspondence_slots`, and the stream broker is left
alone.

**It reacts to events, not to a queue.** `services/correspondence.py` writes the row and
emits `correspondence.search` on every transition; this subscribes to that hub and acts on
what arrives. The alternative — polling the table — would need a second source of truth
about which rows this process is already running, a poll interval to argue about, and a
lag between pressing Pause and the engine stopping. The rows are still the durable state:
nothing here is lost across a restart, because `recover_at_boot` reads them back.

**A slot is this worker's semaphore, and the pool is where a warm process lives.** Every
search holds one of `correspondence_slots` permits from start to pause; a fresh search
takes its process from the pool (so the next search on the same engine starts with a hash
full of relevant entries), and a paused one takes its process *out* of the pool — the pool's
idle reaper would otherwise quit the very thing a pause exists to keep. The setting is read
once, at start: it sizes the pool and the semaphore, so changing it takes a restart.

**Two destinations for a snapshot, at two rates.** Every picture the driver throttles out
goes to `/events` as `correspondence.snapshot` — the live pane, never written to the
database — and a checkpoint goes to `services.correspondence.checkpoint` on one dedicated
database thread when the depth has gone up or a minute has passed, whichever comes first.
A search at depth 48 therefore writes a row every few minutes and holds SQLite's writer for
milliseconds at a time.

**Limits are a watchdog on the snapshot**, not a UCI `go depth`: depth, nodes or seconds
reached means stop, a final checkpoint, `done`, and the slot back. One driver for every
case, and a limit that is checked where the numbers already are.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from functools import partial
from typing import TYPE_CHECKING, Any, TypeVar

from sqlalchemy.orm import Session, sessionmaker

from backend.config import Settings, get_settings
from backend.db.enums import SearchKind, SearchStatus
from backend.db.session import database_backpressure, get_sessionmaker
from backend.services import app_settings as app_settings_service
from backend.services import correspondence as correspondence_service
from backend.services import events as events_service

if TYPE_CHECKING:  # pragma: no cover - typing only
    from backend.adapters.infinite import Snapshot
    from backend.adapters.pool import Adapter, EnginePool

logger = logging.getLogger(__name__)

# One database thread, for `workers/analysis_queue.py`'s reason: SQLite has one writer, so
# more threads add connection pressure rather than write throughput, and checkpoints are
# short transactions that must never queue behind each other.
DB_THREADS = 1
# How long a checkpoint waits for the depth to rise before writing anyway. A search that
# has been on depth 47 for twenty minutes is still learning — more nodes, a better line —
# and a restart that lost all of it would have lost the afternoon.
CHECKPOINT_SECONDS = 60.0
# How long `stop()` gives a search to notice and let go of its slot before it is cancelled.
# An engine answers `stop` in milliseconds; one that has not in this long never will.
STOP_GRACE_SECONDS = 10.0
# How long a process being quit is given before it is left to the garbage collector. Same
# budget the pool gives one of its own.
CLOSE_TIMEOUT = 5.0
# SQLite's one writer is backpressure rather than a failure, so a transaction that finds it
# busy sleeps outside the database thread and tries again, backing off to this ceiling.
DB_RETRY_INITIAL_SECONDS = 0.05
DB_RETRY_MAX_SECONDS = 1.0

# The statuses that mean a search is over, as they arrive on the event — spelled once so
# the worker and the service cannot come to disagree about which those are.
_TERMINAL = {member.value for member in correspondence_service.TERMINAL_SEARCH_STATES}

T = TypeVar("T")


@dataclass(slots=True)
class _Run:
    """One search this process is executing, and everything its two threads share.

    Read and written on the event loop only. The engine thread reaches it through
    `call_soon_threadsafe`, which is what makes the plain attributes safe.
    """

    search_id: int
    context: dict[str, Any] | None = None
    task: asyncio.Task[None] | None = None
    stop: threading.Event | None = None
    # Asked for by the owner: park the process and give the slot back.
    pausing: bool = False
    # Asked for by the owner (or by shutdown): the search is over.
    closing: bool = False
    # Reached its own limit, which is a `done` rather than a `stopped`.
    limit_hit: bool = False
    seq: int = 0
    started: float = 0.0
    last_depth: int = 0
    last_checkpoint: float = 0.0
    # How much of this stretch's clock the eval row has already been credited with, so a
    # checkpoint adds the time since the last one rather than the time since `go`.
    credited_ms: int = 0
    checkpointing: bool = False
    # The picture waiting to be written, if one arrived while a write was in flight.
    pending: dict[str, Any] | None = None
    # A resume that arrived while this stretch was stopping: the row is queued again, so a
    # new task has to be started once this one is out of the way.
    relaunch: bool = False
    frame: dict[str, Any] | None = None
    snapshot: dict[str, Any] | None = None
    # A process this run owns outright — one it took back out of the parked dictionary and
    # has neither parked again nor closed. Whatever happens to the task, this is quit.
    held: Adapter | None = None
    error: str | None = None
    stderr: str | None = None
    background: set[asyncio.Task[Any]] = field(default_factory=set)


class CorrespondenceSearches:
    """The searches running on this host: a task each, inside one pool and one cap."""

    def __init__(
        self,
        *,
        settings: Settings | None = None,
        sessions: sessionmaker[Session] | None = None,
        pool: EnginePool | None = None,
        slots: int | None = None,
        stop_grace: float = STOP_GRACE_SECONDS,
        checkpoint_seconds: float = CHECKPOINT_SECONDS,
    ) -> None:
        self.settings = settings or get_settings()
        self.stop_grace = stop_grace
        self.checkpoint_seconds = checkpoint_seconds
        self._sessions = sessions
        self._pool = pool
        self._owns_pool = pool is None
        self._slots = slots
        self._permits: asyncio.Semaphore | None = None
        self._runs: dict[int, _Run] = {}
        # The processes of paused searches: warm, holding their hash, outside the pool and
        # outside the cap. Nothing but a resume, a stop or this process ending touches one.
        self._parked: dict[int, Adapter] = {}
        self._db_executor: ThreadPoolExecutor | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._cancel_events: Callable[[], None] | None = None
        self._closing = False
        self._background: set[asyncio.Task[Any]] = set()

    # --- lifecycle --------------------------------------------------------

    @property
    def running(self) -> bool:
        return self._db_executor is not None

    @property
    def slots(self) -> int:
        """How many searches may run at once here. Read at start; a change takes a restart."""
        return int(self._slots or 1)

    @property
    def busy(self) -> int:
        return len(self._runs)

    @property
    def parked(self) -> int:
        return len(self._parked)

    async def start(self) -> None:
        """Take the rows back from the process that died, then start listening."""
        if self._db_executor is not None:
            return
        self._closing = False
        self._loop = asyncio.get_running_loop()
        self._db_executor = ThreadPoolExecutor(
            max_workers=DB_THREADS, thread_name_prefix="correspondence-db"
        )
        try:
            if self._slots is None:
                self._slots = await self._db(self._read_slots)
            self._permits = asyncio.Semaphore(self.slots)
            # Subscribed before the recovery, so a row it queues is launched by its own
            # event; the explicit launch below is what makes that not a requirement.
            self._cancel_events = events_service.subscribe(self._on_event)
            correspondence_service.register_snapshots(self.snapshots)
            correspondence_service.register_capacity(self.capacity)
            recovered = await self._service(correspondence_service.recover_at_boot)
        except BaseException:
            await self.stop()
            raise
        logger.info("correspondence: %s search slot(s) on this host", self.slots)
        for search_id in recovered["relaunch"]:
            self._launch(int(search_id))

    async def stop(self) -> None:
        """Ask every search to let go, then quit what is left — parked processes included."""
        self._closing = True
        cancel, self._cancel_events = self._cancel_events, None
        if cancel is not None:
            cancel()
        correspondence_service.clear_snapshots()
        correspondence_service.clear_capacity()

        runs = list(self._runs.values())
        for run in runs:
            run.closing = True
            if run.stop is not None:
                run.stop.set()
        tasks = [run.task for run in runs if run.task is not None]
        if tasks:
            _done, pending = await asyncio.wait(tasks, timeout=self.stop_grace)
            for task in pending:
                task.cancel()
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)
        if self._background:
            await asyncio.gather(*list(self._background), return_exceptions=True)
        self._runs.clear()

        for search_id in list(self._parked):
            await self._quit_parked(search_id)
        if self._owns_pool and self._pool is not None:
            await self._pool.close()
            self._pool = None
        self._permits = None
        executor, self._db_executor = self._db_executor, None
        if executor is not None:
            executor.shutdown(wait=False, cancel_futures=True)
        self._loop = None

    async def __aenter__(self) -> CorrespondenceSearches:
        await self.start()
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.stop()

    async def wait_idle(self, timeout: float = 30.0) -> bool:
        """Block until no search is executing here. For tests and a headless shutdown."""
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        while loop.time() < deadline:
            if not self._runs:
                return True
            await asyncio.sleep(0.01)
        return False

    def snapshots(self) -> dict[int, dict[str, Any]]:
        """The last picture of every search running here, for `list_searches` to merge."""
        return {
            search_id: run.snapshot
            for search_id, run in self._runs.items()
            if run.snapshot is not None
        }

    def capacity(self) -> dict[str, Any]:
        """What this process is actually sized to, for `status` to print.

        The slots the pool and the semaphore were built with, which is the setting as it
        read at boot — a save since then has not moved either of them, and the strip is
        about what the machine will do rather than what has been asked of it.
        """
        return {"slots": self.slots, "in_use": len(self._runs), "parked": len(self._parked)}

    @property
    def pool(self) -> EnginePool:
        """This worker's own warm processes, capped at `correspondence_slots`.

        Its own rather than the analysis workers': a search that runs for three days must
        not take a slot the quick tier is counting on, and a machine that wants both sized
        together says so by giving the two caps the same number.
        """
        if self._pool is None:
            from backend.adapters.pool import EnginePool

            self._pool = EnginePool(concurrency=self.slots)
        return self._pool

    @property
    def sessions(self) -> sessionmaker[Session]:
        if self._sessions is None:
            self._sessions = get_sessionmaker(self.settings)
        return self._sessions

    # --- reacting ---------------------------------------------------------

    def _on_event(self, event: dict[str, Any]) -> None:
        """One `correspondence.search` event, from whichever thread wrote the row."""
        if event.get("event") != correspondence_service.EVENT_SEARCH:
            return
        if event.get("kind") not in (None, SearchKind.SEARCH.value):
            # A `task`: an `AnalysisRun` in the ordinary queue, which the analysis workers
            # and the runners serve. It travels on the same event because the tree draws
            # both from it, and this pool has nothing to do with it. None is a row from
            # before the kind was carried, which could only ever be a search.
            return
        loop = self._loop
        search_id = event.get("search_id")
        if loop is None or loop.is_closed() or not isinstance(search_id, int):
            return
        status = str(event.get("status") or "")
        with contextlib.suppress(RuntimeError):
            loop.call_soon_threadsafe(self._react, search_id, status)

    def _react(self, search_id: int, status: str) -> None:
        """Make this process agree with the row.

        Idempotent, because the worker's own writes come back through here too: launching a
        search that is already running, pausing one that is already stopping and quitting a
        process that is already gone are all no-ops.
        """
        if self._closing:
            return
        run = self._runs.get(search_id)
        if status == SearchStatus.QUEUED.value:
            if run is not None:
                # A resume that landed while the last stretch was still letting go of its
                # slot: that task is the only one that can start the next stretch, because
                # `_launch` refuses an id that is still in `_runs`. Marked here rather than
                # read back in `_park`, whose answer is a picture from before this event.
                run.relaunch = True
            else:
                self._launch(search_id)
        elif status == SearchStatus.PAUSED.value:
            if run is not None:
                run.pausing = True
                if run.stop is not None:
                    run.stop.set()
        elif status in _TERMINAL:
            if run is not None:
                run.closing = True
                run.relaunch = False
                if run.stop is not None:
                    run.stop.set()
            # Not an `elif`: a run that has already parked its process is still in `_runs`
            # until its task's `finally`, and in that window the process it left behind is
            # nobody's to quit but this — a stop would otherwise leave it holding its hash
            # for the life of the server, with the capacity strip saying nothing is parked.
            if search_id in self._parked:
                self._spawn(self._quit_parked(search_id))

    def _launch(self, search_id: int) -> None:
        if self._closing or search_id in self._runs:
            return
        run = _Run(search_id=search_id)
        self._runs[search_id] = run
        run.task = asyncio.create_task(self._serve(run), name=f"correspondence-search-{search_id}")

    # --- one search -------------------------------------------------------

    async def _serve(self, run: _Run) -> None:
        """Hold a slot and drive one engine, until it is paused, stopped or done."""
        search_id = run.search_id
        # Out of the parked dictionary and into this run's hands the moment it is taken:
        # every way out of here below either hands the process to somebody else — the pool,
        # the parked dictionary — or leaves it here for `finally` to quit. A process that
        # was neither would be memory nothing accounts for and nothing ever frees.
        adapter = self._parked.pop(search_id, None)
        run.held = adapter
        try:
            try:
                context = await self._service(correspondence_service.search_context, search_id)
            except Exception as exc:
                await self._fail(run, _message(exc))
                return
            if context is None:
                # Stopped, or already running: the row moved on while this was starting.
                # The process goes back only if the row is one a resume would still want;
                # a row that went terminal in that window has already been told its memory
                # is free, so `finally` quits the process rather than parking it again.
                state = await self._service(correspondence_service.search_state, search_id)
                if adapter is not None and state == SearchStatus.PAUSED.value:
                    self._parked[search_id] = adapter
                    run.held = None
                return
            run.context = context

            permits = self._permits
            if permits is None:  # pragma: no cover - start() always makes one
                return
            async with permits:
                if run.closing:
                    # Stopped while it was queueing: `finally` quits whatever it took.
                    return
                if run.pausing:
                    # Paused while it was queueing for a slot: it never searched, so there
                    # is nothing to flush and nothing to say but that it is parked.
                    await self._park(run, adapter, pooled=False)
                    return
                if adapter is not None:
                    await self._drive(run, adapter, pooled=False)
                else:
                    async with self.pool.acquire(context["spec"]) as engine:
                        await self._drive(run, engine, pooled=True)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await self._fail(run, run.error or _message(exc), run.stderr)
        finally:
            if run.background:
                await asyncio.gather(*list(run.background), return_exceptions=True)
            held, run.held = run.held, None
            if held is not None:
                # Whatever ended this task — a stop, a failure, a cancelled shutdown —
                # a process nobody else owns must not outlive it. Spawned rather than
                # awaited because a `finally` reached through cancellation cannot wait.
                self._spawn(self._close(held))
            self._runs.pop(search_id, None)
            if run.relaunch and not self._closing:
                self._launch(search_id)

    async def _drive(self, run: _Run, adapter: Adapter, *, pooled: bool) -> None:
        """One stretch of searching on one process, and what is done with it afterwards."""
        from backend.adapters.infinite import InfiniteSearch
        from backend.services.explorer import read_fen

        context = run.context or {}
        loop = asyncio.get_running_loop()
        # A pooled process is the pool's to dispose of; one that came back from a park is
        # this run's, until it is parked again or quit.
        run.held = None if pooled else adapter
        # Before the row says `running`, and re-armed after: a pause that arrives in the
        # moment between the two would otherwise be a stop event nobody holds — the flag
        # set on a run whose event did not exist yet, and an engine that then searches on
        # with nothing able to stop it.
        run.stop = threading.Event()
        await self._service(correspondence_service.mark_running, run.search_id)
        if run.pausing or run.closing:
            run.stop.set()
        run.started = time.monotonic()
        run.last_checkpoint = run.started
        run.credited_ms = 0
        driver = InfiniteSearch(adapter, interval=self.settings.stream_snapshot_interval)

        def emit(snapshot: Snapshot) -> None:
            # On the engine thread: everything this worker does with a picture belongs to
            # the loop, so nothing but the handover happens here.
            loop.call_soon_threadsafe(self._on_snapshot, run, snapshot.as_dict())

        try:
            await asyncio.to_thread(
                driver.run,
                read_fen(context["fen"]),
                multipv=context["multipv"],
                root_moves=context["root_moves"],
                on_snapshot=emit,
                stop=run.stop,
            )
        except Exception as exc:
            run.error = _message(exc)
            run.stderr = _stderr_of(adapter)
            # Out through `pool.acquire`, which drops the process: an engine that failed
            # once is not one to hand to the next search. A process this run owns is quit
            # by `_serve`'s `finally`, which holds it either way.
            raise

        await self._flush(run)
        if self._closing:
            # The process is going down, not the search. The row is left exactly as the
            # owner left it — `running`, or `paused` if a pause was in flight — because
            # `stop()` sets `closing` on every run to make the engines let go, and a
            # `stopped` written from that would be a search `recover_at_boot` never starts
            # again: a plain restart would quietly end every search on the machine.
            return
        if run.pausing and not run.closing:
            await self._park(run, adapter, pooled=pooled)
            return
        if not pooled:
            # Resumed from a park and now over: this process is nobody's, so it is quit
            # here. A pooled one goes back warm instead, which is the win a sibling
            # position's search collects for free.
            run.held = None
            await self._close(adapter)
        await self._service(
            correspondence_service.mark_finished,
            run.search_id,
            status=SearchStatus.STOPPED if run.closing else SearchStatus.DONE,
        )

    async def _park(self, run: _Run, adapter: Adapter | None, *, pooled: bool) -> None:
        """Give the slot back and keep the process, hash and all."""
        if adapter is not None:
            if pooled:
                # Out of the pool, or its reaper would quit the one thing a pause keeps.
                self.pool.detach(adapter)
            self._parked[run.search_id] = adapter
            run.held = None
        answer = await self._service(
            correspondence_service.mark_parked, run.search_id, warm=adapter is not None
        )
        # Resumed while the engine was stopping: the row never went paused, and this task
        # is the only one that can start the next stretch — `_launch` refuses while it runs.
        # Only ever set, never cleared: a resume that lands after the commit inside
        # `mark_parked` is invisible to this answer and arrives as a `queued` event, which
        # sets the same flag; clearing it here would lose whichever of the two got there
        # first and leave the row queued with nothing in this process to start it.
        if bool(answer) and answer.get("status") == SearchStatus.QUEUED.value:
            run.relaunch = True

    async def _quit_parked(self, search_id: int) -> None:
        adapter = self._parked.pop(search_id, None)
        if adapter is not None:
            await self._close(adapter)

    async def _close(self, adapter: Adapter) -> None:
        with contextlib.suppress(Exception, TimeoutError):
            await asyncio.wait_for(asyncio.to_thread(adapter.close), CLOSE_TIMEOUT)

    async def _fail(self, run: _Run, error: str, stderr: str | None = None) -> None:
        logger.info("correspondence search %s failed: %s", run.search_id, error)
        with contextlib.suppress(Exception):
            await self._service(
                correspondence_service.mark_finished,
                run.search_id,
                status=SearchStatus.FAILED,
                error=error,
                stderr=stderr,
            )

    # --- snapshots and checkpoints ---------------------------------------

    def _on_snapshot(self, run: _Run, frame: dict[str, Any]) -> None:
        """One picture, on the loop: out to `/events`, and to the database when it is due."""
        if run.search_id not in self._runs:
            return
        context = run.context or {}
        run.seq += 1
        run.frame = frame
        run.snapshot = {
            "search_id": run.search_id,
            "node_id": context.get("node_id"),
            "game_id": context.get("game_id"),
            "engine_id": context.get("engine_id"),
            "engine_name": context.get("engine_name"),
            "seq": run.seq,
            **frame,
        }
        events_service.emit(
            {"event": correspondence_service.EVENT_SNAPSHOT, **(run.snapshot or {})}
        )

        depth = frame.get("depth")
        depth = depth if isinstance(depth, int) else 0
        if self._limit_reached(run, frame) and run.stop is not None:
            run.limit_hit = True
            run.stop.set()
        now = time.monotonic()
        if depth > run.last_depth or now - run.last_checkpoint >= self.checkpoint_seconds:
            run.last_depth = max(run.last_depth, depth)
            run.last_checkpoint = now
            self._checkpoint(run, frame)

    def _checkpoint(self, run: _Run, frame: dict[str, Any]) -> None:
        """Write this picture into the eval row, on the database thread, one at a time.

        Writes never overlap and never queue up: a picture that arrives while one is in
        flight replaces whatever was waiting, and the writer takes it when it comes back.
        Dropping it instead would be wrong in the case that matters — the last depth of a
        search that then thinks for an hour would be the depth nobody wrote.
        """
        run.pending = frame
        if run.checkpointing:
            return
        run.checkpointing = True

        async def write() -> None:
            try:
                while run.pending is not None:
                    picture, run.pending = run.pending, None
                    await self._service(
                        correspondence_service.checkpoint,
                        run.search_id,
                        picture,
                        time_delta_ms=self._credit(run, picture),
                    )
            except Exception:
                logger.exception("correspondence search %s could not checkpoint", run.search_id)
            finally:
                run.checkpointing = False

        task = asyncio.create_task(write(), name=f"correspondence-checkpoint-{run.search_id}")
        run.background.add(task)
        task.add_done_callback(run.background.discard)

    async def _flush(self, run: _Run) -> None:
        """The last picture, written before the row stops being `running`."""
        while run.checkpointing:
            await asyncio.sleep(0.01)
        with contextlib.suppress(Exception):
            await self._service(
                correspondence_service.checkpoint,
                run.search_id,
                run.frame,
                time_delta_ms=self._credit(run, run.frame or {}),
                final=True,
            )

    def _credit(self, run: _Run, frame: dict[str, Any]) -> int:
        """How long this stretch has run since the last checkpoint, in milliseconds.

        The engine's own clock, which restarts at every `go`: the delta since the last
        credit is what an eval's accumulated time is owed, and it is counted here rather
        than in the service because only this side knows which stretch a picture is from.
        """
        elapsed = frame.get("time_ms")
        if not isinstance(elapsed, int) or elapsed < run.credited_ms:
            return 0
        delta = elapsed - run.credited_ms
        run.credited_ms = elapsed
        return delta

    def _limit_reached(self, run: _Run, frame: dict[str, Any]) -> bool:
        """Whether this search has arrived where it was told to stop.

        Checked on the snapshot rather than asked of the engine, so one driver serves the
        limited and the unlimited case alike. The seconds limit is therefore checked when a
        picture arrives — twice a second while an engine is searching, which is as precise
        as a three-day search needs anybody to be.
        """
        context = run.context or {}
        depth, nodes = frame.get("depth"), frame.get("nodes")
        wanted_depth = context.get("limit_depth")
        wanted_nodes = context.get("limit_nodes")
        wanted_seconds = context.get("limit_seconds")
        if wanted_depth and isinstance(depth, int) and depth >= int(wanted_depth):
            return True
        if wanted_nodes and isinstance(nodes, int) and nodes >= int(wanted_nodes):
            return True
        return bool(wanted_seconds) and time.monotonic() - run.started >= float(wanted_seconds)

    # --- the database side (always on its one thread) ---------------------

    async def _service(self, fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
        """One service call in one transaction, on the worker's database thread."""
        return await self._db(partial(self._with_session, fn, *args, **kwargs))

    def _with_session(self, fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
        with self.sessions() as session:
            return fn(session, *args, **kwargs)

    async def _db(self, work: Callable[[], T]) -> T:
        """One transaction on that thread, retried while the database is merely busy.

        SQLite has one writer and this process is full of them — a request, an import, the
        analysis queue — so "the database is locked" means later, not failed. A checkpoint
        that gave up on it would lose an hour of depth; a `mark_running` that did would fail
        a search that is perfectly healthy. Every other error is a bug and reaches the
        caller on the first try, which is `workers/analysis_queue.py`'s rule as well.
        """
        loop = asyncio.get_running_loop()
        executor = self._db_executor
        if executor is None:
            raise RuntimeError("the correspondence database executor is not running")
        delay = DB_RETRY_INITIAL_SECONDS
        while True:
            try:
                return await loop.run_in_executor(executor, work)
            except Exception as exc:
                if not database_backpressure(exc):
                    raise
                await asyncio.sleep(delay)
                delay = min(DB_RETRY_MAX_SECONDS, delay * 2)

    def _read_slots(self) -> int:
        with self.sessions() as session:
            return app_settings_service.get_correspondence_slots(session)

    def _spawn(self, coroutine: Any) -> asyncio.Task[Any]:
        task = asyncio.ensure_future(coroutine)
        self._background.add(task)
        task.add_done_callback(self._background.discard)
        return task


def _stderr_of(adapter: Any) -> str | None:
    tail = getattr(adapter, "stderr_tail", None)
    if tail is None:
        return None
    try:
        return tail()
    except Exception:
        return None


def _message(exc: BaseException) -> str:
    text = str(exc).strip()
    return f"{type(exc).__name__}: {text}" if text else type(exc).__name__
