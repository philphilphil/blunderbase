"""Warm engine processes, shared by every consumer of an engine.

Ported from the predecessor's `backend/adapters/pool.py`. The idea survives — one warm
process per engine, its own lock, idle shutdown, and a crashed process dropped rather than
kept — but the shape had to change on re-review:

- The predecessor hardcoded two slots, `stockfish` and `maia3`, off `Settings`. Engines are
  database rows here and there can be any number of them, so slots are keyed by an
  `EngineSpec`. The key includes the options, which means editing an engine's UCI options
  in the UI starts a fresh process instead of leaving the old settings warm.
- The locks are asyncio locks. Analysis workers are asyncio tasks in the API process, and a
  `threading.Lock` held for the length of a search would block the event loop, so the whole
  pool is async-facing and every blocking engine call goes out to a thread.
- The predecessor let a chat call and an analysis job each spawn their own engines, capping
  nothing. The spec caps concurrent engine work at `analysis_concurrency`, so the pool owns
  a semaphore and every caller passes through it. The slot is released in a `finally`: a
  crashed engine must cost its process, never its slot.
- "One warm process per engine" is one process per *caller* of an engine, up to the cap.
  Every worker of an archive sync asks for the same quick-tier engine, so a single process
  per spec would put the whole pool in a queue behind one search and make
  `analysis_concurrency` mean nothing. An engine that cannot be run twice — a Maia holding
  one GPU — says so with `EngineSpec.instances`, and then its callers do queue.
"""

from __future__ import annotations

import asyncio
import threading
import time
from collections.abc import AsyncIterator, Callable, Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any, TypeVar

from backend.adapters.maia import MaiaAdapter
from backend.adapters.stockfish import StockfishAdapter
from backend.config import Settings, get_settings

IDLE_SECONDS = 600.0
REAP_INTERVAL_SECONDS = 30.0
CLOSE_TIMEOUT = 5.0

# Matches `backend.db.enums.EngineKind`, spelled as a plain string so that nothing in
# `adapters/` has to know the database exists.
MAIA_KIND = "maia"
UCI_KIND = "uci"

T = TypeVar("T")
Adapter = StockfishAdapter | MaiaAdapter
Clock = Callable[[], float]


@dataclass(frozen=True, slots=True)
class EngineSpec:
    """Everything needed to start one engine, and the identity of its warm process."""

    path: str
    kind: str = UCI_KIND
    options: tuple[tuple[str, Any], ...] = ()
    name: str = ""
    engine_id: int | None = None
    # How many processes of this engine may run at once, at most. None means "as many as
    # the pool's cap allows", which is what everything but a GPU engine wants: a Maia on
    # one card is one process every caller queues on, not one per slot.
    instances: int | None = None

    @classmethod
    def build(
        cls,
        path: str,
        *,
        kind: str = UCI_KIND,
        options: Mapping[str, Any] | None = None,
        name: str = "",
        engine_id: int | None = None,
        instances: int | None = None,
    ) -> EngineSpec:
        return cls(
            path=path,
            kind=str(kind),
            options=tuple(sorted((str(key), value) for key, value in (options or {}).items())),
            name=name,
            engine_id=engine_id,
            instances=instances,
        )

    @property
    def option_dict(self) -> dict[str, Any]:
        return dict(self.options)

    @property
    def key(self) -> str:
        """Same key, same process. Changing an option is a different engine.

        `instances` is deliberately not part of it: it is how many of this process may run,
        not which process it is. Folding it in would make raising the cap orphan the warm
        processes under the old key instead of letting the same group grow.
        """
        options = ",".join(f"{name}={value}" for name, value in self.options)
        return f"{self.kind}|{self.path}|{options}"

    @property
    def label(self) -> str:
        return self.name or self.path


def build_adapter(spec: EngineSpec) -> Adapter:
    if spec.kind == MAIA_KIND:
        return MaiaAdapter(spec.path, options=spec.option_dict)
    return StockfishAdapter(spec.path, options=spec.option_dict)


class _Slot:
    """One warm process, or none. Serializes its own users and times itself out."""

    def __init__(
        self,
        spec: EngineSpec,
        factory: Callable[[EngineSpec], Adapter],
        *,
        idle_seconds: float,
        clock: Clock,
    ) -> None:
        self.spec = spec
        self._factory = factory
        self._idle_seconds = idle_seconds
        self._clock = clock
        # Not reentrant: one UCI process serves one caller at a time.
        self._lock = asyncio.Lock()
        self._engine: Adapter | None = None
        self._stopping = False
        self._last_used = clock()

    @property
    def warm(self) -> bool:
        return self._engine is not None

    @property
    def busy(self) -> bool:
        return self._lock.locked()

    @asynccontextmanager
    async def acquire(self) -> AsyncIterator[Adapter]:
        async with self._lock:
            if self._engine is None:
                # Starting a process is blocking, and Maia's weights take seconds.
                self._engine = await asyncio.to_thread(self._factory, self.spec)
            try:
                yield self._engine
            except BaseException:
                # A call that raised may have left a dead process behind, and the reaper
                # cannot collect one the next caller keeps touching. Drop it now so the
                # slot starts a fresh engine instead of failing forever.
                await self._shutdown()
                raise
            self._last_used = self._clock()

    async def reap(self) -> bool:
        """Shut the process down if it is idle and unused. In-use slots are left alone."""
        if self._lock.locked():
            return False
        async with self._lock:
            if self._engine is None or self._clock() - self._last_used < self._idle_seconds:
                return False
            await self._shutdown()
            return True

    async def close(self, *, timeout: float = CLOSE_TIMEOUT) -> None:
        """Shut the process down, waiting briefly for an in-flight call to finish."""
        acquired = False
        try:
            await asyncio.wait_for(self._lock.acquire(), timeout)
            acquired = True
        except TimeoutError:
            # An engine that will not finish must not hold up the server's shutdown.
            pass
        try:
            await self._shutdown()
        finally:
            if acquired:
                self._lock.release()

    async def _shutdown(self) -> None:
        engine = self._engine
        if engine is None or self._stopping:
            # One `close()` per process: a shutdown already in flight owns this one.
            return
        self._stopping = True
        try:
            await asyncio.to_thread(engine.close)
        except Exception:
            # Closing an already-dead process is not a reason to fail the caller; the
            # slot is cold either way.
            pass
        finally:
            self._stopping = False
        # Cold only once the process is really gone. Clearing the slot before the close ran
        # would let `warm()` — and the pool's own close — skip a process whose shutdown is
        # still in flight, and a cancellation there would orphan it.
        self._engine = None


class _SlotGroup:
    """The warm processes for one engine spec, and which of them are free.

    Callers reach a group having already passed the pool's semaphore, so there are never
    more of them here at once than the pool's cap — which is why taking a process is a plain
    list pop with no waiting: a free one exists, or one more may be started. When the group
    is capped below that (an engine with its own `instances`) the extra callers are handed a
    process that is already in use and queue on its lock, which is the whole point of the
    cap: one GPU process, several callers, one search at a time.

    `_free` therefore holds a process at most once even when several callers share it —
    `acquire` only hands one back if it is not already there. Counting a release per caller
    would let `idle` report one process as several, make the reaper walk it repeatedly, and
    hand a later `_take` a process somebody is still inside.
    """

    def __init__(
        self,
        spec: EngineSpec,
        factory: Callable[[EngineSpec], Adapter],
        *,
        limit: int,
        idle_seconds: float,
        clock: Clock,
    ) -> None:
        self.spec = spec
        self._factory = factory
        self._limit = max(1, limit)
        self._idle_seconds = idle_seconds
        self._clock = clock
        self.slots: list[_Slot] = []
        self._free: list[_Slot] = []

    @property
    def warm(self) -> list[_Slot]:
        return [slot for slot in self.slots if slot.warm]

    @property
    def idle(self) -> list[_Slot]:
        """The processes nobody is using right now — the only ones safe to reap."""
        return list(self._free)

    @asynccontextmanager
    async def acquire(self) -> AsyncIterator[Adapter]:
        slot = self._take()
        try:
            async with slot.acquire() as engine:
                yield engine
        finally:
            if slot not in self._free:
                self._free.append(slot)

    def drop_cold(self) -> None:
        """Forget the processes that have been shut down. A new one is started on demand."""
        # A busy slot is kept whether or not it is warm: a caller sharing a capped process
        # may be starting it right now, and forgetting it here would leave that process
        # running with neither `warm()` nor the pool's own `close()` knowing about it.
        self.slots = [
            slot for slot in self.slots if slot.warm or slot.busy or slot not in self._free
        ]
        self._free = [slot for slot in self._free if slot.warm or slot.busy]

    def _take(self) -> _Slot:
        if self._free:
            return self._free.pop()
        if len(self.slots) >= self._limit:
            # Either a slot was taken out of circulation while every other one was in use, or
            # this engine caps itself below the pool. Waiting on an existing process is right
            # in both cases, and costs nothing.
            return self.slots[0]
        slot = _Slot(
            self.spec, self._factory, idle_seconds=self._idle_seconds, clock=self._clock
        )
        self.slots.append(slot)
        return slot


class EnginePool:
    """Warm engine processes behind one concurrency cap."""

    def __init__(
        self,
        *,
        concurrency: int = 1,
        factory: Callable[[EngineSpec], Adapter] = build_adapter,
        idle_seconds: float = IDLE_SECONDS,
        reap_interval: float = REAP_INTERVAL_SECONDS,
        clock: Clock = time.monotonic,
    ) -> None:
        self.concurrency = max(1, int(concurrency))
        self._factory = factory
        self._idle_seconds = idle_seconds
        self._reap_interval = reap_interval
        self._clock = clock
        self._groups: dict[str, _SlotGroup] = {}
        self._semaphore = asyncio.Semaphore(self.concurrency)
        self._active = 0
        self._closing = False
        self._reaper: asyncio.Task[None] | None = None
        self._reap_stop = asyncio.Event()

    @property
    def active(self) -> int:
        """Callers holding a slot right now."""
        return self._active

    @asynccontextmanager
    async def acquire(self, spec: EngineSpec) -> AsyncIterator[Adapter]:
        self._ensure_reaper()
        await self._semaphore.acquire()
        self._active += 1
        try:
            async with self._group(spec).acquire() as engine:
                yield engine
        finally:
            self._active -= 1
            self._semaphore.release()

    async def run(self, spec: EngineSpec, work: Callable[[Adapter], T]) -> T:
        """Run one blocking engine call on a warm process, off the event loop."""
        async with self.acquire(spec) as engine:
            return await asyncio.to_thread(work, engine)

    def warm(self) -> list[str]:
        """One entry per running process, so an engine serving two callers appears twice."""
        return [key for key, group in self._groups.items() for _slot in group.warm]

    async def reap_idle(self) -> list[str]:
        reaped: list[str] = []
        for key, group in list(self._groups.items()):
            for slot in group.idle:
                if await slot.reap():
                    reaped.append(key)
            group.drop_cold()
            if not group.slots:
                self._groups.pop(key, None)
        return reaped

    async def close(self) -> None:
        self._closing = True
        reaper, self._reaper = self._reaper, None
        if reaper is not None:
            # Cancelling the reaper outright would abandon the `close()` of a process it
            # had already taken out of circulation, leaving it running with nothing left
            # holding it. Ask it to stop and let the reap in flight finish — but no longer
            # than one engine's shutdown budget, since a process that will not quit must
            # not hold up the server's shutdown either.
            self._reap_stop.set()
            try:
                await asyncio.wait_for(reaper, CLOSE_TIMEOUT)
            except (TimeoutError, asyncio.CancelledError):
                pass
        for group in list(self._groups.values()):
            for slot in group.slots:
                await slot.close()
        self._groups.clear()

    def _group(self, spec: EngineSpec) -> _SlotGroup:
        group = self._groups.get(spec.key)
        if group is None:
            group = self._groups[spec.key] = _SlotGroup(
                spec,
                self._factory,
                # An engine may pin itself below the pool's cap; it can never raise itself
                # above it, since a caller holds one of the pool's slots either way.
                limit=min(self.concurrency, spec.instances or self.concurrency),
                idle_seconds=self._idle_seconds,
                clock=self._clock,
            )
        # A group is cached by key and `instances` is not part of the key, so a later spec
        # for the same engine with a different count does not resize the group it finds: the
        # limit it was built with stands until every process idles out and the group is
        # reaped. Editing a runner's yaml already means restarting the runner, so this only
        # shows up in the window between the two.
        return group

    def _ensure_reaper(self) -> None:
        if self._reaper is not None or self._closing or self._reap_interval <= 0:
            return
        self._reaper = asyncio.create_task(self._reap_loop(), name="engine-pool-reaper")

    async def _reap_loop(self) -> None:
        while True:
            try:
                await asyncio.wait_for(self._reap_stop.wait(), self._reap_interval)
            except TimeoutError:
                pass
            else:
                return
            await self.reap_idle()


_POOL: EnginePool | None = None
_POOL_LOCK = threading.Lock()


def get_pool(settings: Settings | None = None) -> EnginePool:
    """The process-wide pool. The API lifespan owns it; workers borrow it."""
    global _POOL
    with _POOL_LOCK:
        if _POOL is None:
            resolved = settings or get_settings()
            _POOL = EnginePool(concurrency=resolved.analysis_concurrency)
        return _POOL


async def shutdown_pool() -> None:
    global _POOL
    with _POOL_LOCK:
        pool, _POOL = _POOL, None
    if pool is not None:
        await pool.close()
