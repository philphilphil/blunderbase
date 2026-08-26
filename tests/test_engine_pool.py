"""The pool: one warm process per engine, one cap on concurrent work, nothing leaked."""

from __future__ import annotations

import asyncio
import threading
from pathlib import Path
from typing import Any

import chess
import chess.engine
import pytest
from fake_uci import STOCKFISH_OPTIONS, commands, fake_engine, read_log

from backend.adapters.pool import (
    IDLE_SECONDS,
    MAIA_KIND,
    EnginePool,
    EngineSpec,
    build_adapter,
    get_pool,
    shutdown_pool,
)
from backend.adapters.stockfish import EngineError, EngineStartError, StockfishAdapter

STOCKFISH = EngineSpec.build("stockfish", name="Stockfish")
MAIA = EngineSpec.build("lc0 --weights=maia-1500", kind=MAIA_KIND, name="Maia 1500")


class FakeAdapter:
    """Stands in for a started engine process; counts how often it was shut down."""

    def __init__(self, spec: EngineSpec, log: list[str]) -> None:
        self.spec = spec
        self.log = log
        self.closed = 0
        log.append(f"start:{spec.name}")

    def close(self) -> None:
        self.closed += 1
        self.log.append(f"close:{self.spec.name}")


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def build(
    log: list[str], *, concurrency: int = 2, clock: Clock | None = None, **kwargs: Any
) -> EnginePool:
    return EnginePool(
        concurrency=concurrency,
        factory=lambda spec: FakeAdapter(spec, log),  # type: ignore[arg-type,return-value]
        reap_interval=kwargs.pop("reap_interval", 0),
        clock=clock or Clock(),
        **kwargs,
    )


# --- warm processes -------------------------------------------------------


async def test_nothing_starts_until_someone_asks() -> None:
    log: list[str] = []
    pool = build(log)

    assert pool.warm() == []
    assert log == []
    await pool.close()


async def test_the_same_process_serves_every_call_for_one_engine() -> None:
    log: list[str] = []
    pool = build(log)

    async with pool.acquire(STOCKFISH) as first:
        pass
    async with pool.acquire(STOCKFISH) as second:
        pass

    assert first is second
    assert log == ["start:Stockfish"]
    assert pool.warm() == [STOCKFISH.key]
    await pool.close()


async def test_two_engines_are_two_processes() -> None:
    log: list[str] = []
    pool = build(log)

    async with pool.acquire(STOCKFISH):
        pass
    async with pool.acquire(MAIA):
        pass

    assert log == ["start:Stockfish", "start:Maia 1500"]
    assert len(pool.warm()) == 2
    await pool.close()


async def test_editing_the_options_starts_a_different_process() -> None:
    """A warm process is its options. Reusing it after an edit would keep serving the old
    ones, which is exactly what the Settings screen's user thinks they just changed."""
    log: list[str] = []
    pool = build(log)
    before = EngineSpec.build("stockfish", options={"Threads": 1}, name="Stockfish")
    after = EngineSpec.build("stockfish", options={"Threads": 4}, name="Stockfish")

    assert before.key != after.key
    async with pool.acquire(before) as one:
        pass
    async with pool.acquire(after) as two:
        pass

    assert one is not two
    assert len(pool.warm()) == 2
    await pool.close()


def test_a_spec_key_does_not_depend_on_how_the_options_were_ordered() -> None:
    one = EngineSpec.build("stockfish", options={"Hash": 64, "Threads": 2})
    other = EngineSpec.build("stockfish", options={"Threads": 2, "Hash": 64})

    assert one.key == other.key
    assert one.option_dict == {"Hash": 64, "Threads": 2}


# --- concurrency ----------------------------------------------------------


async def test_two_callers_of_one_engine_get_a_process_each() -> None:
    """Every analysis worker resolves the quick tier to the same engine row, so a single
    process per spec would queue the whole pool behind one search and make the
    concurrency cap mean nothing."""
    log: list[str] = []
    pool = build(log, concurrency=2)
    both = asyncio.Event()
    inside = 0

    async def work() -> None:
        nonlocal inside
        async with pool.acquire(STOCKFISH):
            inside += 1
            if inside == 2:
                both.set()
            await asyncio.wait_for(both.wait(), timeout=5)

    await asyncio.gather(work(), work())

    assert both.is_set()
    assert log == ["start:Stockfish", "start:Stockfish"]
    assert pool.warm() == [STOCKFISH.key, STOCKFISH.key]
    await pool.close()


async def test_one_engine_starts_no_more_processes_than_the_cap() -> None:
    log: list[str] = []
    pool = build(log, concurrency=2)
    inside = asyncio.Event()
    release = asyncio.Event()
    holding = 0

    async def hold() -> None:
        nonlocal holding
        async with pool.acquire(STOCKFISH):
            holding += 1
            if holding == 2:
                inside.set()
            await release.wait()

    async def third() -> None:
        async with pool.acquire(STOCKFISH):
            pass

    held = [asyncio.create_task(hold()), asyncio.create_task(hold())]
    await inside.wait()
    waiting = asyncio.create_task(third())
    await asyncio.sleep(0)
    assert not waiting.done()  # the cap, not the engine, is what it waits for

    release.set()
    await asyncio.gather(*held, waiting)
    assert log == ["start:Stockfish", "start:Stockfish"]
    await pool.close()


async def test_a_second_caller_waits_when_one_process_is_all_the_cap_allows() -> None:
    log: list[str] = []
    pool = build(log, concurrency=1)
    order: list[str] = []
    inside = asyncio.Event()
    release = asyncio.Event()

    async def first() -> None:
        async with pool.acquire(STOCKFISH):
            order.append("first-in")
            inside.set()
            await release.wait()
            order.append("first-out")

    async def second() -> None:
        async with pool.acquire(STOCKFISH):
            order.append("second-in")

    one = asyncio.create_task(first())
    await inside.wait()
    two = asyncio.create_task(second())
    await asyncio.sleep(0)
    assert not two.done()

    release.set()
    await asyncio.gather(one, two)
    assert order == ["first-in", "first-out", "second-in"]
    assert log == ["start:Stockfish"]
    await pool.close()


async def test_the_concurrency_cap_holds_across_different_engines() -> None:
    log: list[str] = []
    pool = build(log, concurrency=1)
    peak = 0
    release = asyncio.Event()
    inside = asyncio.Event()

    async def work(spec: EngineSpec) -> None:
        nonlocal peak
        async with pool.acquire(spec):
            peak = max(peak, pool.active)
            inside.set()
            await release.wait()

    one = asyncio.create_task(work(STOCKFISH))
    await inside.wait()
    two = asyncio.create_task(work(MAIA))
    await asyncio.sleep(0)
    assert not two.done()  # a second engine still costs the one slot

    release.set()
    await asyncio.gather(one, two)
    assert peak == 1
    await pool.close()


async def test_engines_run_side_by_side_up_to_the_cap() -> None:
    log: list[str] = []
    pool = build(log, concurrency=2)
    both = asyncio.Event()
    running = 0

    async def work(spec: EngineSpec) -> None:
        nonlocal running
        async with pool.acquire(spec):
            running += 1
            if running == 2:
                both.set()
            await asyncio.wait_for(both.wait(), timeout=5)

    await asyncio.gather(work(STOCKFISH), work(MAIA))
    assert both.is_set()
    await pool.close()


async def test_the_blocking_call_of_run_happens_off_the_event_loop() -> None:
    log: list[str] = []
    pool = build(log)
    seen: list[str] = []

    def work(engine: Any) -> str:
        seen.append(threading_name())
        return "42"

    assert await pool.run(STOCKFISH, work) == "42"
    assert seen and seen[0] != "MainThread"
    await pool.close()


def threading_name() -> str:
    import threading

    return threading.current_thread().name


# --- failure --------------------------------------------------------------


async def test_a_process_that_dies_mid_call_is_dropped_rather_than_kept() -> None:
    """A crashed engine must not stay in the slot: the next caller would refresh its idle
    timer, so the reaper would never collect it and every later call would hit the corpse."""
    log: list[str] = []
    pool = build(log)

    with pytest.raises(chess.engine.EngineTerminatedError):
        async with pool.acquire(STOCKFISH) as engine:
            first = engine
            raise chess.engine.EngineTerminatedError("engine process died")

    assert pool.warm() == []
    assert first.closed == 1
    async with pool.acquire(STOCKFISH) as revived:
        pass
    assert revived is not first
    assert log == ["start:Stockfish", "close:Stockfish", "start:Stockfish"]
    await pool.close()


async def test_a_crash_releases_the_slot_it_was_holding() -> None:
    log: list[str] = []
    pool = build(log, concurrency=1)

    with pytest.raises(RuntimeError):
        async with pool.acquire(STOCKFISH):
            raise RuntimeError("boom")

    assert pool.active == 0
    async with pool.acquire(MAIA):  # would hang forever on a leaked slot
        pass
    await pool.close()


async def test_a_failed_start_leaves_the_slot_cold_and_the_cap_intact() -> None:
    attempts: list[int] = []

    def failing(spec: EngineSpec) -> Any:
        attempts.append(1)
        raise EngineStartError("stockfish is missing")

    pool = EnginePool(concurrency=1, factory=failing, reap_interval=0)
    for _ in range(2):
        with pytest.raises(EngineStartError):
            async with pool.acquire(STOCKFISH):
                pass

    assert len(attempts) == 2
    assert pool.warm() == []
    assert pool.active == 0
    await pool.close()


async def test_a_close_that_fails_still_leaves_the_slot_cold() -> None:
    class Broken(FakeAdapter):
        def close(self) -> None:
            super().close()
            raise OSError("the process is already gone")

    log: list[str] = []
    pool = EnginePool(
        concurrency=1,
        factory=lambda spec: Broken(spec, log),  # type: ignore[arg-type,return-value]
        reap_interval=0,
    )
    with pytest.raises(RuntimeError):
        async with pool.acquire(STOCKFISH):
            raise RuntimeError("boom")

    assert pool.warm() == []
    await pool.close()


async def test_a_cancelled_call_does_not_leave_a_searching_engine_behind() -> None:
    log: list[str] = []
    pool = build(log)
    inside = asyncio.Event()

    async def work() -> None:
        async with pool.acquire(STOCKFISH):
            inside.set()
            await asyncio.sleep(10)

    task = asyncio.create_task(work())
    await inside.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert pool.warm() == []
    assert log == ["start:Stockfish", "close:Stockfish"]
    await pool.close()


# --- idle reaping and shutdown -------------------------------------------


async def test_an_idle_process_is_shut_down_after_ten_minutes() -> None:
    log: list[str] = []
    clock = Clock()
    pool = build(log, clock=clock)

    async with pool.acquire(STOCKFISH) as engine:
        pass

    clock.advance(IDLE_SECONDS - 1)
    assert await pool.reap_idle() == []
    assert pool.warm() == [STOCKFISH.key]

    clock.advance(2)
    assert await pool.reap_idle() == [STOCKFISH.key]
    assert pool.warm() == []
    assert engine.closed == 1

    async with pool.acquire(STOCKFISH) as revived:
        pass
    assert revived is not engine
    assert log == ["start:Stockfish", "close:Stockfish", "start:Stockfish"]
    await pool.close()


async def test_a_busy_process_is_never_reaped_out_from_under_its_caller() -> None:
    log: list[str] = []
    clock = Clock()
    pool = build(log, clock=clock)

    async with pool.acquire(STOCKFISH) as engine:
        clock.advance(IDLE_SECONDS * 10)
        assert await pool.reap_idle() == []
        assert engine.closed == 0
    await pool.close()


async def test_the_reaper_runs_on_its_own_and_stops_with_the_pool() -> None:
    log: list[str] = []
    closed = threading.Event()

    class Watched(FakeAdapter):
        def close(self) -> None:
            super().close()
            closed.set()

    pool = EnginePool(
        concurrency=2,
        factory=lambda spec: Watched(spec, log),  # type: ignore[arg-type,return-value]
        idle_seconds=0.0,
        reap_interval=0.01,
        clock=Clock(),
    )

    async with pool.acquire(STOCKFISH):
        pass
    # Wait on the shutdown itself rather than polling `warm()`: what this test is about is
    # that the process was closed without anyone asking, and a runner slow enough to lose
    # a polling race would not change that.
    assert await asyncio.to_thread(closed.wait, 5.0)
    assert log == ["start:Stockfish", "close:Stockfish"]

    await pool.close()
    assert pool.warm() == []
    assert log == ["start:Stockfish", "close:Stockfish"]
    assert [task for task in asyncio.all_tasks() if task.get_name() == "engine-pool-reaper"] == []


async def test_closing_the_pool_waits_for_a_process_the_reaper_is_still_shutting_down() -> None:
    """A reaped process is not gone the moment the reaper takes it out of circulation: its
    `close()` runs off the event loop and takes as long as the engine takes to quit. Stopping
    the reaper before that finishes would leave a process running with nothing holding it."""
    log: list[str] = []
    entered = threading.Event()
    release = threading.Event()

    class Slow(FakeAdapter):
        def close(self) -> None:
            entered.set()
            release.wait(5.0)
            super().close()

    pool = EnginePool(
        concurrency=1,
        factory=lambda spec: Slow(spec, log),  # type: ignore[arg-type,return-value]
        idle_seconds=0.0,
        reap_interval=0.01,
        clock=Clock(),
    )

    async with pool.acquire(STOCKFISH):
        pass
    assert await asyncio.to_thread(entered.wait, 5.0)

    closing = asyncio.create_task(pool.close())
    await asyncio.sleep(0.05)
    assert not closing.done()  # the pool waits for the shutdown it interrupted

    release.set()
    await asyncio.wait_for(closing, timeout=5)
    assert log == ["start:Stockfish", "close:Stockfish"]
    assert pool.warm() == []


async def test_close_shuts_every_process_down() -> None:
    log: list[str] = []
    pool = build(log)

    async with pool.acquire(STOCKFISH):
        pass
    async with pool.acquire(MAIA):
        pass
    await pool.close()

    assert pool.warm() == []
    assert log.count("close:Stockfish") == 1
    assert log.count("close:Maia 1500") == 1


# --- against real processes ----------------------------------------------


async def test_the_pool_keeps_one_real_engine_process_warm(tmp_path: Path) -> None:
    log_path = tmp_path / "engine.log"
    command = fake_engine(
        tmp_path,
        options=STOCKFISH_OPTIONS,
        log=str(log_path),
        go_default={"info": ["depth 8 score cp 11 pv e2e4"], "bestmove": "e2e4"},
    )
    spec = EngineSpec.build(" ".join(command), name="FakeFish")
    pool = EnginePool(concurrency=1, reap_interval=0)

    def analyse(engine: Any) -> Any:
        assert isinstance(engine, StockfishAdapter)
        return engine.analyse(chess.Board(), chess.engine.Limit(nodes=100))

    first = await pool.run(spec, analyse)
    second = await pool.run(spec, analyse)
    await pool.close()

    assert first.score.cp == second.score.cp == 11
    assert [entry["cmd"] for entry in read_log(log_path)].count("start") == 1
    assert commands(log_path, "quit") == ["quit"]


async def test_a_real_engine_that_dies_is_replaced_on_the_next_call(tmp_path: Path) -> None:
    log_path = tmp_path / "engine.log"
    command = fake_engine(
        tmp_path,
        options=STOCKFISH_OPTIONS,
        log=str(log_path),
        go=[{"crash": True}],
        crash_once=str(tmp_path / "crashed"),
        go_default={"info": ["depth 8 score cp 11 pv e2e4"], "bestmove": "e2e4"},
    )
    spec = EngineSpec.build(" ".join(command), name="FakeFish")
    pool = EnginePool(concurrency=1, reap_interval=0)

    def analyse(engine: Any) -> Any:
        return engine.analyse(chess.Board(), chess.engine.Limit(nodes=100))

    with pytest.raises(EngineError):
        await pool.run(spec, analyse)
    assert pool.warm() == []

    result = await pool.run(spec, analyse)
    await pool.close()

    assert result.score.cp == 11
    assert [entry["cmd"] for entry in read_log(log_path)].count("start") == 2


def test_the_default_factory_picks_the_adapter_for_the_kind(tmp_path: Path) -> None:
    from backend.adapters.maia import MaiaAdapter

    command = " ".join(fake_engine(tmp_path, options=STOCKFISH_OPTIONS))
    with build_adapter(EngineSpec.build(command)) as uci:
        assert isinstance(uci, StockfishAdapter)
    with build_adapter(EngineSpec.build(command, kind=MAIA_KIND)) as maia:
        assert isinstance(maia, MaiaAdapter)


async def test_the_process_wide_pool_is_one_pool_sized_by_the_settings(settings: Any) -> None:
    pool = get_pool(settings)

    assert get_pool(settings) is pool
    assert pool.concurrency == settings.analysis_concurrency
    await shutdown_pool()
    assert get_pool(settings) is not pool
    await shutdown_pool()
