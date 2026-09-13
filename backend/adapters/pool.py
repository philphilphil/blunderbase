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
import contextlib
import threading
import time
from collections.abc import AsyncIterator, Callable, Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any, TypeVar

from backend.adapters.maia import MaiaAdapter
from backend.adapters.stockfish import StockfishAdapter
from backend.config import Settings, default_analysis_concurrency, get_settings

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
        self._detached = False
        self._last_used = clock()

    @property
    def warm(self) -> bool:
        return self._engine is not None

    @property
    def busy(self) -> bool:
        return self._lock.locked()

    @property
    def detached(self) -> bool:
        """The process this slot held now belongs to its caller; the slot is finished."""
        return self._detached

    def holds(self, adapter: Adapter) -> bool:
        return self._engine is adapter

    def detach(self) -> None:
        """Give the process away: the slot forgets it and is never used again.

        Nothing is stopped and nothing is closed — the caller is inside `acquire` and goes
        on driving the same process. Clearing `_engine` is what keeps the pool's reaper and
        its own `close()` off a process that is no longer theirs to end.
        """
        self._detached = True
        self._engine = None

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
        # How many processes this group may hold. Public, because the pool moves it when its
        # own cap is resized (`EnginePool.resize`).
        self.limit = max(1, limit)
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
            # A slot whose process was given away during the call is gone from the group
            # already; putting it back would hand the next caller a slot with no engine and
            # no owner.
            if not slot.detached and slot not in self._free:
                self._free.append(slot)

    def detach(self, adapter: Adapter) -> bool:
        """Take the slot holding `adapter` out of this group. True if one did."""
        for slot in list(self.slots):
            if not slot.holds(adapter):
                continue
            slot.detach()
            self.slots.remove(slot)
            if slot in self._free:
                self._free.remove(slot)
            return True
        return False

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
        if len(self.slots) >= self.limit:
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
        # A shrink in progress: the permits it still means to take out of circulation, and
        # the ones it has taken and is sitting on. See `resize`.
        self._withdrawing = 0
        self._withheld = 0
        self._withdrawer: asyncio.Task[None] | None = None
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

    @asynccontextmanager
    async def reserve(self) -> AsyncIterator[None]:
        """Hold one of the cap's slots without taking a process from the pool.

        For a caller that already owns a process and only owes the machine the *count*: a
        correspondence search resumed from a park drives the engine it kept warm, which is
        outside the pool on purpose, but it is still one more engine working on this host
        and has to stand in the same line as everything else that is.
        """
        self._ensure_reaper()
        await self._semaphore.acquire()
        self._active += 1
        try:
            yield
        finally:
            self._active -= 1
            self._semaphore.release()

    @property
    def free(self) -> int:
        """Slots nobody holds right now — what a worker looks at before claiming a run.

        The cap less what a shrink has withdrawn, less the callers inside it. Advisory: two
        readers may both see one free slot and one of them will wait in `acquire`, which is
        harmless. What it prevents is the worse case — a worker claiming a run, marking it
        `running`, and then sitting on a full pool for as long as a search holds the slot.
        """
        return max(0, self.concurrency - self._withheld - self._active)

    def resize(self, concurrency: int) -> int:
        """Change the cap while callers are inside it. Returns the cap now in force.

        This is what lets **Queue processes** on the Machines page take effect on save
        rather than on the next restart. Growing is immediate: the extra permits are minted
        and the next callers walk straight in. Shrinking never interrupts a search: the
        surplus permits are withdrawn one at a time as callers give them back, so the cap
        simply stops admitting the next caller until enough have finished. A grow that
        arrives while a shrink is still waiting calls the rest of it off first.

        Every group's own limit follows, so an engine that was capped at the old number
        starts more processes under the new one — the cap on an engine's `instances` still
        holds, since a group can never raise itself above what its spec allows.

        Must be called on the event loop's thread, like everything else here.
        """
        target = max(1, int(concurrency))
        delta = target - self.concurrency
        self.concurrency = target
        if delta > 0:
            called_off = min(delta, self._withdrawing)
            self._withdrawing -= called_off
            delta -= called_off
            returned = min(delta, self._withheld)
            self._withheld -= returned
            delta -= returned
            for _ in range(returned + delta):
                self._semaphore.release()
        elif delta < 0:
            self._withdrawing -= delta
            if self._withdrawer is None or self._withdrawer.done():
                self._withdrawer = asyncio.create_task(self._withdraw(), name="engine-pool-shrink")
        for group in self._groups.values():
            group.limit = self._group_limit(group.spec)
        return self.concurrency

    async def _withdraw(self) -> None:
        """Take permits out of circulation as they come free, until the shrink is met."""
        while self._withdrawing > 0:
            await self._semaphore.acquire()
            if self._withdrawing == 0:
                # A grow called the shrink off while this waited: the permit is wanted after all.
                self._semaphore.release()
                return
            self._withdrawing -= 1
            self._withheld += 1

    def _group_limit(self, spec: EngineSpec) -> int:
        # An engine may pin itself below the pool's cap; it can never raise itself above
        # it, since a caller holds one of the pool's slots either way.
        return min(self.concurrency, spec.instances or self.concurrency)

    def warm(self) -> list[str]:
        """One entry per running process, so an engine serving two callers appears twice."""
        return [key for key, group in self._groups.items() for _slot in group.warm]

    def detach(self, adapter: Adapter) -> bool:
        """Hand one warm process over to the caller that is holding it. True if it was ours.

        The correspondence worker is the reason this exists. A paused search keeps its
        process so that resuming it costs nothing — the hash is the whole point — and a
        process that is still in the pool would be handed to the next search of the same
        engine or quietly reaped after ten idle minutes. Detaching makes the caller its
        owner: nothing here starts it, stops it or counts it again, and closing it is the
        caller's job.

        Called from inside `acquire`, before the slot is given back.
        """
        return any(group.detach(adapter) for group in list(self._groups.values()))

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
        withdrawer, self._withdrawer = self._withdrawer, None
        if withdrawer is not None and not withdrawer.done():
            # A shrink still waiting for callers to finish has nothing left to wait for.
            withdrawer.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await withdrawer
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
                limit=self._group_limit(spec),
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


def get_pool(settings: Settings | None = None, *, concurrency: int | None = None) -> EnginePool:
    """The process-wide pool. The API lifespan owns it; workers borrow it.

    `concurrency` is the resolved cap — the `analysis_concurrency` setting, which an adapter
    cannot read for itself. Without it the pool takes the environment's number, else the
    machine's cores minus two: the same answer the setting gives an install that never set it.
    """
    global _POOL
    with _POOL_LOCK:
        if _POOL is None:
            resolved = settings or get_settings()
            _POOL = EnginePool(
                concurrency=concurrency
                or resolved.analysis_concurrency
                or default_analysis_concurrency()
            )
        return _POOL


async def shutdown_pool() -> None:
    global _POOL
    with _POOL_LOCK:
        pool, _POOL = _POOL, None
    if pool is not None:
        await pool.close()
