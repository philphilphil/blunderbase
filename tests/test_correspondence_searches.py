"""Correspondence searches: the worker, its slots, and what survives a pause.

Every engine here is `fake_uci.py` — a real subprocess speaking UCI over a pipe, scripted
to climb through depths and then hold, which is what `go infinite` looks like from the
driver's side. That is the only way to test the two things this step is actually about:
that a checkpoint moves the stored verdict forward and never back, and that pausing a
search keeps *the same process* — asserted by its pid, because a pause that quietly started
a new engine would look identical from every other angle and would cost the owner the hash
the whole feature exists to keep.
"""

from __future__ import annotations

import asyncio
import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fake_uci import STOCKFISH_OPTIONS, commands, fake_engine_command, overlapped, read_log
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from backend.api.app import create_app
from backend.config import Settings
from backend.db.base import Base
from backend.db.enums import Color, EngineKind, SearchKind, SearchStatus
from backend.db.models import CorrespondenceEval, CorrespondenceSearch, Engine, Runner
from backend.db.session import create_db_engine, get_sessionmaker
from backend.services import app_settings as app_settings_service
from backend.services import correspondence as correspondence_service
from backend.services import events as events_service
from backend.workers import CorrespondenceSearches
from tests.conftest import running_app

# One info line per depth, each a little better than the last: the trajectory a checkpoint
# is supposed to record, and the rising depth that is supposed to trigger one.
CLIMB = [
    f"depth {depth} score cp {10 * depth} nodes {1000 * depth} time {100 * depth} pv e2e4 e7e5"
    for depth in range(1, 6)
]
TOP_DEPTH = 5


@pytest.fixture(autouse=True)
def _no_stray_subscribers() -> Iterator[None]:
    """A worker that failed to stop must not be listening during the next test."""
    yield
    events_service.clear_subscribers()
    correspondence_service.clear_snapshots()
    correspondence_service.clear_capacity()


@pytest.fixture()
def db(tmp_path: Path) -> Any:
    """A file database of its own: the worker's database thread is a second connection."""
    engine = create_db_engine(f"sqlite+pysqlite:///{tmp_path / 'blunderbase.db'}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)
    yield factory
    engine.dispose()


@pytest.fixture()
def settings(tmp_path: Path) -> Settings:
    # A snapshot per info line rather than two a second: the scripted engine prints its
    # whole climb in a burst, and the throttle would merge it into one picture.
    return Settings(root=tmp_path, stream_snapshot_interval=0.001)


# --- helpers ---------------------------------------------------------------


def add_engine(
    sessions: sessionmaker[Session],
    tmp_path: Path,
    *,
    name: str = "FakeFish",
    infos: list[str] | None = None,
    log: Path | None = None,
    hold: bool = True,
    **scenario: Any,
) -> Engine:
    """One scripted engine as an `Engine` row this host can start."""
    scenario.setdefault("options", STOCKFISH_OPTIONS)
    scenario.setdefault("name", name)
    scenario["go_default"] = {
        "info": list(infos if infos is not None else CLIMB),
        "hold": hold,
        "bestmove": "e2e4",
    }
    if log is not None:
        scenario["log"] = str(log)
    engine = Engine(
        name=name, kind=EngineKind.UCI, path=fake_engine_command(tmp_path, **scenario), enabled=True
    )
    with sessions() as session:
        session.add(engine)
        session.commit()
        return engine


def make_game(sessions: sessionmaker[Session]) -> dict[str, Any]:
    with sessions() as session:
        return correspondence_service.create_game(
            session,
            white="Baum, Philipp",
            black="Gegner, Ein",
            owner_color=Color.WHITE,
            iccf_id="1234567",
        )


def call(sessions: sessionmaker[Session], fn: Any, *args: Any, **kwargs: Any) -> Any:
    with sessions() as session:
        return fn(session, *args, **kwargs)


def search_row(sessions: sessionmaker[Session], search_id: int) -> CorrespondenceSearch:
    with sessions() as session:
        return session.get(CorrespondenceSearch, search_id)  # type: ignore[return-value]


def eval_row(sessions: sessionmaker[Session], epd: str) -> CorrespondenceEval | None:
    with sessions() as session:
        return session.scalars(
            select(CorrespondenceEval).where(CorrespondenceEval.epd == epd)
        ).first()


async def wait_for(check: Any, timeout: float = 30.0, describe: Any = None) -> Any:
    """Poll until `check` answers with something truthy, or give up and say what it was.

    `describe` is what the failure prints: a worker that never got there is only debuggable
    if the row it was waiting on comes with the complaint.
    """
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while loop.time() < deadline:
        found = check()
        if found:
            return found
        await asyncio.sleep(0.02)
    raise AssertionError(f"the worker never got there: {describe() if describe else ''}")


async def wait_for_status(
    sessions: sessionmaker[Session], search_id: int, status: SearchStatus, timeout: float = 30.0
) -> CorrespondenceSearch:
    def ready() -> Any:
        row = search_row(sessions, search_id)
        return row if row is not None and row.status is status else None

    return await wait_for(ready, timeout, describe=lambda: _describe(sessions, search_id))


async def wait_for_parked(
    sessions: sessionmaker[Session], search_id: int, timeout: float = 30.0
) -> CorrespondenceSearch:
    """Paused *and* warm: the row goes paused the moment it is asked, and the worker's
    answer — the process is parked, the slot is back — arrives once the engine has let go.
    """

    def ready() -> Any:
        row = search_row(sessions, search_id)
        return row if row is not None and row.status is SearchStatus.PAUSED and row.warm else None

    return await wait_for(ready, timeout, describe=lambda: _describe(sessions, search_id))


def pids(log: Path) -> set[int]:
    return {entry["pid"] for entry in read_log(log)}


# --- the worker ------------------------------------------------------------


async def test_a_search_checkpoints_every_time_the_depth_rises(
    settings: Settings, db: Any, tmp_path: Path
) -> None:
    engine = add_engine(db, tmp_path)
    game = make_game(db)
    node_id = game["tree"]["id"]
    epd = game["tree"]["epd"]

    async with CorrespondenceSearches(settings=settings, sessions=db):
        started = call(
            db, correspondence_service.start_search, node_id=node_id, engine_id=engine.id
        )
        row = await wait_for(
            lambda: eval_row(db, epd) if _depth(db, epd) >= TOP_DEPTH else None,
            describe=lambda: _describe(db, started["id"]),
        )
        call(db, correspondence_service.stop_search, started["id"])
        await wait_for_status(db, started["id"], SearchStatus.STOPPED)

    assert row.cp == 10 * TOP_DEPTH
    assert row.nodes == 1000 * TOP_DEPTH
    assert row.engine_id == engine.id
    assert row.engine_name == "FakeFish"
    # One entry per depth, never two for one depth, and the last is where it got to.
    depths = [entry["depth"] for entry in row.history]
    assert depths == sorted(set(depths))
    assert depths[-1] == TOP_DEPTH
    assert row.history[-1]["best"] == "e2e4"
    # The engine's own clock, accumulated: the last picture said 500ms.
    assert row.time_ms == 100 * TOP_DEPTH


async def test_a_shallower_result_never_overwrites_a_deeper_one(
    settings: Settings, db: Any, tmp_path: Path
) -> None:
    """The forward-only rule, asserted where it is written rather than through a race."""
    engine = add_engine(db, tmp_path)
    game = make_game(db)
    node_id, epd = game["tree"]["id"], game["tree"]["epd"]
    with db() as session:
        session.add(
            CorrespondenceEval(
                epd=epd,
                engine_id=engine.id,
                engine_name="FakeFish",
                cp=42,
                depth=40,
                nodes=9_000_000,
                time_ms=1000,
                history=[{"depth": 40, "nodes": 9_000_000, "cp": 42, "mate": None, "best": "d2d4"}],
            )
        )
        session.commit()
    started = call(db, correspondence_service.start_search, node_id=node_id, engine_id=engine.id)

    shallow = {"depth": 12, "nodes": 500, "time_ms": 250, "lines": [{"multipv": 1, "cp": -300}]}
    call(db, correspondence_service.checkpoint, started["id"], shallow, time_delta_ms=250)

    row = eval_row(db, epd)
    assert row is not None
    assert (row.cp, row.depth, row.nodes) == (42, 40, 9_000_000)
    assert len(row.history) == 1
    # Time is the one thing that is a sum rather than a picture: the engine really did
    # spend those seconds on this position.
    assert row.time_ms == 1250

    deeper = {
        "depth": 41,
        "nodes": 10_000_000,
        "time_ms": 900,
        "lines": [{"multipv": 1, "cp": 55, "pv": ["g1f3"]}],
    }
    call(db, correspondence_service.checkpoint, started["id"], deeper, time_delta_ms=900)
    row = eval_row(db, epd)
    assert row is not None
    assert (row.cp, row.depth) == (55, 41)
    assert [entry["depth"] for entry in row.history] == [40, 41]


def test_the_history_keys_on_nodes_as_well_as_depth(db: Any, tmp_path: Path) -> None:
    """A Leela sits at one depth for a day; the trajectory is in its node count.

    Keyed on depth alone, a three-day search of an engine whose depth barely moves ends
    with a single history point — no sparkline, no "settled for six hours", which is the
    readout the whole history exists for. A picture a quarter more nodes in is a point of
    its own; a picture a second later at the same numbers still overwrites.
    """
    engine = add_engine(db, tmp_path)
    game = make_game(db)
    node_id, epd = game["tree"]["id"], game["tree"]["epd"]
    started = call(db, correspondence_service.start_search, node_id=node_id, engine_id=engine.id)

    for nodes, cp in ((1_000_000, 18), (1_050_000, 19), (4_000_000, 24), (400_000_000, 31)):
        call(
            db,
            correspondence_service.checkpoint,
            started["id"],
            {"depth": 19, "nodes": nodes, "lines": [{"multipv": 1, "cp": cp, "pv": ["e2e4"]}]},
        )

    row = eval_row(db, epd)
    assert row is not None
    # The second picture is the first one again — barely any more work behind it — and the
    # two that follow are stretches of their own.
    assert [(entry["nodes"], entry["cp"]) for entry in row.history] == [
        (1_050_000, 19),
        (4_000_000, 24),
        (400_000_000, 31),
    ]
    assert {entry["depth"] for entry in row.history} == {19}
    assert (row.cp, row.nodes) == (31, 400_000_000)


def test_a_search_with_no_line_leaves_no_eval_row_behind(db: Any, tmp_path: Path) -> None:
    """A checkmate, or a stop inside the first snapshot: the engine judged nothing.

    A row written here would be an all-NULL verdict keyed by (position, engine), and the
    key is shared — every game that ever reached this position would show a pane with no
    number on it, and pinning that engine would blank the node.
    """
    engine = add_engine(db, tmp_path)
    game = make_game(db)
    node_id, epd = game["tree"]["id"], game["tree"]["epd"]
    started = call(db, correspondence_service.start_search, node_id=node_id, engine_id=engine.id)

    assert call(db, correspondence_service.checkpoint, started["id"], {}, final=True) is None
    assert eval_row(db, epd) is None
    # The heartbeat is still the search's, whatever the picture said.
    assert search_row(db, started["id"]).heartbeat_at is not None

    # And the first real picture makes the row, as it always did.
    call(
        db,
        correspondence_service.checkpoint,
        started["id"],
        {"depth": 12, "nodes": 5000, "lines": [{"multipv": 1, "cp": 20, "pv": ["e2e4"]}]},
        time_delta_ms=250,
    )
    row = eval_row(db, epd)
    assert row is not None and (row.cp, row.depth, row.time_ms) == (20, 12, 250)


async def test_a_limit_stops_the_search_and_calls_it_done(
    settings: Settings, db: Any, tmp_path: Path
) -> None:
    engine = add_engine(db, tmp_path)
    game = make_game(db)

    async with CorrespondenceSearches(settings=settings, sessions=db):
        started = call(
            db,
            correspondence_service.start_search,
            node_id=game["tree"]["id"],
            engine_id=engine.id,
            limit_depth=3,
        )
        row = await wait_for_status(db, started["id"], SearchStatus.DONE)

    assert row.finished_at is not None
    assert row.warm is False
    stored = eval_row(db, game["tree"]["epd"])
    assert stored is not None and (stored.depth or 0) >= 3


async def test_pause_parks_the_process_and_resume_uses_the_same_one(
    settings: Settings, db: Any, tmp_path: Path
) -> None:
    """The point of the whole pause: one pid, two searches, a hash that never went cold."""
    log = tmp_path / "engine.log"
    engine = add_engine(db, tmp_path, log=log)
    game = make_game(db)

    async with CorrespondenceSearches(settings=settings, sessions=db) as worker:
        started = call(
            db, correspondence_service.start_search, node_id=game["tree"]["id"], engine_id=engine.id
        )
        await wait_for_status(db, started["id"], SearchStatus.RUNNING)
        await wait_for(lambda: commands(log, "go-start"))

        call(db, correspondence_service.pause_search, started["id"])
        parked = await wait_for_parked(db, started["id"])
        assert parked.warm is True
        assert worker.parked == 1
        # The slot is back: nothing is executing here while a search is parked.
        assert await worker.wait_idle(5.0)

        call(db, correspondence_service.resume_search, started["id"])
        await wait_for_status(db, started["id"], SearchStatus.RUNNING)
        await wait_for(lambda: len(commands(log, "go-start")) >= 2)
        assert worker.parked == 0

        call(db, correspondence_service.stop_search, started["id"])
        await wait_for_status(db, started["id"], SearchStatus.STOPPED)

    assert len(pids(log)) == 1, "a resume started a second process instead of reusing the hash"


async def test_stopping_a_parked_search_quits_its_process(
    settings: Settings, db: Any, tmp_path: Path
) -> None:
    log = tmp_path / "engine.log"
    engine = add_engine(db, tmp_path, log=log)
    game = make_game(db)

    async with CorrespondenceSearches(settings=settings, sessions=db) as worker:
        started = call(
            db, correspondence_service.start_search, node_id=game["tree"]["id"], engine_id=engine.id
        )
        await wait_for_status(db, started["id"], SearchStatus.RUNNING)
        call(db, correspondence_service.pause_search, started["id"])
        await wait_for_parked(db, started["id"])
        assert worker.parked == 1

        call(db, correspondence_service.stop_search, started["id"])
        await wait_for(lambda: worker.parked == 0)
        await wait_for(lambda: "quit" in commands(log))

    row = search_row(db, started["id"])
    assert row.status is SearchStatus.STOPPED
    assert row.warm is False


async def test_two_engines_search_one_node_at_the_same_time(
    settings: Settings, db: Any, tmp_path: Path
) -> None:
    log = tmp_path / "engines.log"
    first = add_engine(db, tmp_path, name="FakeFish", log=log)
    second = add_engine(db, tmp_path, name="FakeLeela", log=log)
    game = make_game(db)
    node_id = game["tree"]["id"]

    async with CorrespondenceSearches(settings=settings, sessions=db, slots=2) as worker:
        one = call(db, correspondence_service.start_search, node_id=node_id, engine_id=first.id)
        two = call(db, correspondence_service.start_search, node_id=node_id, engine_id=second.id)
        await wait_for_status(db, one["id"], SearchStatus.RUNNING)
        await wait_for_status(db, two["id"], SearchStatus.RUNNING)
        assert worker.busy == 2

        # Two verdicts on one position, side by side — the node reads the deeper one and
        # says the engines disagree when they do.
        await wait_for(lambda: len(_evals(db, game["tree"]["epd"])) == 2)
        call(db, correspondence_service.stop_search, one["id"])
        call(db, correspondence_service.stop_search, two["id"])
        await wait_for_status(db, one["id"], SearchStatus.STOPPED)
        await wait_for_status(db, two["id"], SearchStatus.STOPPED)

    assert overlapped(log), "the two engines never searched at the same time"
    assert len(pids(log)) == 2


async def test_the_worker_tells_the_status_payload_what_it_sized_itself_to(
    settings: Settings, db: Any, tmp_path: Path
) -> None:
    """A running worker is where the strip's slot count comes from, setting or no setting."""
    call(db, app_settings_service.set_value, app_settings_service.CORRESPONDENCE_SLOTS, 6)

    async with CorrespondenceSearches(settings=settings, sessions=db, slots=3) as worker:
        assert worker.capacity()["slots"] == 3
        assert call(db, correspondence_service.status)["slots"] == 3

    # The registration goes with the worker: nothing left behind to answer for a process
    # that is no longer driving any engine.
    assert call(db, correspondence_service.status)["slots"] == 6


async def test_a_running_row_is_relaunched_at_boot(
    settings: Settings, db: Any, tmp_path: Path
) -> None:
    """What the last process left `running` is what this one starts, cold."""
    engine = add_engine(db, tmp_path)
    game = make_game(db)
    with db() as session:
        row = CorrespondenceSearch(
            node_id=game["tree"]["id"],
            engine_id=engine.id,
            kind=SearchKind.SEARCH,
            status=SearchStatus.RUNNING,
            warm=True,
        )
        session.add(row)
        session.commit()
        search_id = row.id

    async with CorrespondenceSearches(settings=settings, sessions=db):
        relaunched = await wait_for_status(db, search_id, SearchStatus.RUNNING)
        # Warm is a claim about a process, and no process survives a restart.
        assert relaunched.warm is False
        await wait_for(lambda: eval_row(db, game["tree"]["epd"]))
        call(db, correspondence_service.stop_search, search_id)
        await wait_for_status(db, search_id, SearchStatus.STOPPED)


async def test_a_running_row_whose_engine_is_gone_is_parked_with_the_reason(
    settings: Settings, db: Any, tmp_path: Path
) -> None:
    engine = add_engine(db, tmp_path)
    game = make_game(db)
    with db() as session:
        row = CorrespondenceSearch(
            node_id=game["tree"]["id"],
            engine_id=engine.id,
            kind=SearchKind.SEARCH,
            status=SearchStatus.RUNNING,
            warm=True,
        )
        session.add(row)
        session.commit()
        search_id = row.id
        session.get(Engine, engine.id).enabled = False  # type: ignore[union-attr]
        session.commit()

    async with CorrespondenceSearches(settings=settings, sessions=db):
        await asyncio.sleep(0.05)

    row = search_row(db, search_id)
    assert row.status is SearchStatus.PAUSED
    assert row.warm is False
    assert "switched off" in (row.error or "")


async def test_the_worker_answers_pause_all_and_resume_all(
    settings: Settings, db: Any, tmp_path: Path
) -> None:
    first = add_engine(db, tmp_path, name="FakeFish")
    second = add_engine(db, tmp_path, name="FakeLeela")
    game = make_game(db)
    node_id = game["tree"]["id"]

    async with CorrespondenceSearches(settings=settings, sessions=db, slots=2) as worker:
        one = call(db, correspondence_service.start_search, node_id=node_id, engine_id=first.id)
        two = call(db, correspondence_service.start_search, node_id=node_id, engine_id=second.id)
        await wait_for_status(db, one["id"], SearchStatus.RUNNING)
        await wait_for_status(db, two["id"], SearchStatus.RUNNING)

        call(db, correspondence_service.pause_all)
        await wait_for_parked(db, one["id"])
        await wait_for_parked(db, two["id"])
        assert await worker.wait_idle(5.0)
        assert worker.parked == 2

        call(db, correspondence_service.resume_all)
        await wait_for_status(db, one["id"], SearchStatus.RUNNING)
        await wait_for_status(db, two["id"], SearchStatus.RUNNING)

        call(db, correspondence_service.pause_all)
        await wait_for_parked(db, one["id"])
        await wait_for_parked(db, two["id"])


async def test_a_snapshot_goes_out_on_the_event_hub(
    settings: Settings, db: Any, tmp_path: Path
) -> None:
    engine = add_engine(db, tmp_path)
    game = make_game(db)
    seen: list[dict[str, Any]] = []
    events_service.subscribe(
        lambda event: (
            seen.append(event)
            if event.get("event") == correspondence_service.EVENT_SNAPSHOT
            else None
        )
    )

    async with CorrespondenceSearches(settings=settings, sessions=db):
        started = call(
            db, correspondence_service.start_search, node_id=game["tree"]["id"], engine_id=engine.id
        )
        await wait_for(lambda: seen)
        # The pane opened after the search started reads the same picture off the row.
        merged = await wait_for(
            lambda: call(db, correspondence_service.list_searches)["searches"][0].get("snapshot")
        )
        call(db, correspondence_service.stop_search, started["id"])
        await wait_for_status(db, started["id"], SearchStatus.STOPPED)

    first = seen[0]
    assert first["search_id"] == started["id"]
    assert first["node_id"] == game["tree"]["id"]
    assert first["game_id"] == game["game"]["game_id"]
    assert first["engine_id"] == engine.id
    assert first["seq"] == 1
    assert first["lines"][0]["cp"] == 10
    assert merged["search_id"] == started["id"]


async def test_a_search_is_restricted_to_the_moves_it_was_given(
    settings: Settings, db: Any, tmp_path: Path
) -> None:
    log = tmp_path / "engine.log"
    engine = add_engine(db, tmp_path, log=log)
    game = make_game(db)

    async with CorrespondenceSearches(settings=settings, sessions=db):
        started = call(
            db,
            correspondence_service.start_search,
            node_id=game["tree"]["id"],
            engine_id=engine.id,
            root_moves=["e2e4", "d2d4"],
        )
        await wait_for_status(db, started["id"], SearchStatus.RUNNING)
        go = await wait_for(
            lambda: [line for line in commands(log, "go ") if "searchmoves" in line]
        )
        call(db, correspondence_service.stop_search, started["id"])
        await wait_for_status(db, started["id"], SearchStatus.STOPPED)

    assert "searchmoves e2e4 d2d4" in go[0]
    # And it leaves the shared verdict alone: the best of a shortlist is not the position's
    # evaluation, and forward-only would make a written one permanent.
    assert eval_row(db, game["tree"]["epd"]) is None


async def test_a_shutdown_leaves_a_running_search_running_for_the_next_boot(
    settings: Settings, db: Any, tmp_path: Path
) -> None:
    """A restart is not a stop, and the row is what carries a search across one.

    `stop()` asks every engine to let go, which inside a run looks exactly like the owner
    pressing Stop — so the shutdown path must write nothing at all. A row left `stopped` by
    a `docker restart` would be a search `recover_at_boot` never starts again: every search
    on the machine quietly ended by an update.
    """
    engine = add_engine(db, tmp_path)
    game = make_game(db)

    worker = CorrespondenceSearches(settings=settings, sessions=db)
    await worker.start()
    started = call(
        db, correspondence_service.start_search, node_id=game["tree"]["id"], engine_id=engine.id
    )
    await wait_for_status(db, started["id"], SearchStatus.RUNNING)
    await wait_for(lambda: eval_row(db, game["tree"]["epd"]))
    await worker.stop()

    down = search_row(db, started["id"])
    assert down.status is SearchStatus.RUNNING, "a shutdown ended the search instead of parking it"
    assert down.started_at is not None

    async with CorrespondenceSearches(settings=settings, sessions=db):
        # A relaunch is a new stretch, so `started_at` moving is the proof that the next
        # boot really started this search again rather than leaving the row where it was.
        again = await wait_for(
            lambda: (
                row
                if (row := search_row(db, started["id"])).status is SearchStatus.RUNNING
                and row.started_at != down.started_at
                else None
            ),
            describe=lambda: _describe(db, started["id"]),
        )
        assert again.warm is False
        call(db, correspondence_service.stop_search, started["id"])
        await wait_for_status(db, started["id"], SearchStatus.STOPPED)


async def test_a_stop_that_lands_while_the_process_is_parked_quits_it(
    settings: Settings, db: Any, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Stop in the instant between the park and the run letting go: the process still goes.

    The run is in `_parked` and still in `_runs`, which is the one window where neither the
    task nor the parked branch obviously owns the engine. Nobody quitting it means a hash
    held for the life of the server, and a capacity strip saying nothing is parked.
    """
    log = tmp_path / "engine.log"
    engine = add_engine(db, tmp_path, log=log)
    game = make_game(db)
    parked_for_real = correspondence_service.mark_parked

    def stopped_in_the_same_breath(session: Session, search_id: int, *, warm: bool) -> Any:
        answer = parked_for_real(session, search_id, warm=warm)
        with db() as other:
            correspondence_service.stop_search(other, search_id)
        return answer

    monkeypatch.setattr(correspondence_service, "mark_parked", stopped_in_the_same_breath)

    async with CorrespondenceSearches(settings=settings, sessions=db) as worker:
        started = call(
            db, correspondence_service.start_search, node_id=game["tree"]["id"], engine_id=engine.id
        )
        await wait_for_status(db, started["id"], SearchStatus.RUNNING)
        await wait_for(lambda: commands(log, "go-start"))
        call(db, correspondence_service.pause_search, started["id"])
        await wait_for_status(db, started["id"], SearchStatus.STOPPED)
        await wait_for(lambda: "quit" in commands(log))
        assert worker.parked == 0

    row = search_row(db, started["id"])
    assert row.warm is False


async def test_a_resume_that_lands_just_after_the_park_starts_the_search_again(
    settings: Settings, db: Any, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Resume in the same instant: the row is queued, and this process must act on it.

    `mark_parked` commits before it answers, so a resume that arrives right after that
    commit is invisible to the answer the worker reads back — and `_launch` refuses the id
    while the parking task is still winding down. Missing it leaves the row queued for good,
    with both slots free and the page saying "waiting for a slot" forever.
    """
    log = tmp_path / "engine.log"
    engine = add_engine(db, tmp_path, log=log)
    game = make_game(db)
    parked_for_real = correspondence_service.mark_parked

    def resumed_in_the_same_breath(session: Session, search_id: int, *, warm: bool) -> Any:
        answer = parked_for_real(session, search_id, warm=warm)
        with db() as other:
            correspondence_service.resume_search(other, search_id)
        return answer

    monkeypatch.setattr(correspondence_service, "mark_parked", resumed_in_the_same_breath)

    async with CorrespondenceSearches(settings=settings, sessions=db):
        started = call(
            db, correspondence_service.start_search, node_id=game["tree"]["id"], engine_id=engine.id
        )
        await wait_for_status(db, started["id"], SearchStatus.RUNNING)
        await wait_for(lambda: commands(log, "go-start"))
        call(db, correspondence_service.pause_search, started["id"])
        # A second `go` on the same process: the search really is going again.
        await wait_for(
            lambda: len(commands(log, "go-start")) >= 2,
            describe=lambda: _describe(db, started["id"]),
        )
        assert search_row(db, started["id"]).status is SearchStatus.RUNNING
        call(db, correspondence_service.stop_search, started["id"])
        await wait_for_status(db, started["id"], SearchStatus.STOPPED)

    assert len(pids(log)) == 1


async def test_a_resume_whose_row_is_stopped_before_it_starts_quits_the_process(
    settings: Settings, db: Any, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The other end of the same window: the process is out of `_parked` and unowned.

    A resumed search takes its warm process back before it reads the row. If the row goes
    terminal in that moment there is nothing to resume — and putting the engine back on the
    shelf for a stopped search would park it there forever.
    """
    log = tmp_path / "engine.log"
    engine = add_engine(db, tmp_path, log=log)
    game = make_game(db)
    context_for_real = correspondence_service.search_context

    async with CorrespondenceSearches(settings=settings, sessions=db) as worker:
        started = call(
            db, correspondence_service.start_search, node_id=game["tree"]["id"], engine_id=engine.id
        )
        await wait_for_status(db, started["id"], SearchStatus.RUNNING)
        call(db, correspondence_service.pause_search, started["id"])
        await wait_for_parked(db, started["id"])
        assert worker.parked == 1

        def stopped_before_it_starts(session: Session, search_id: int) -> Any:
            correspondence_service.stop_search(session, search_id)
            return context_for_real(session, search_id)

        monkeypatch.setattr(correspondence_service, "search_context", stopped_before_it_starts)
        call(db, correspondence_service.resume_search, started["id"])
        await wait_for_status(db, started["id"], SearchStatus.STOPPED)
        await wait_for(lambda: "quit" in commands(log))
        assert worker.parked == 0

    row = search_row(db, started["id"])
    assert row.warm is False


async def test_a_resume_that_cannot_read_its_row_quits_the_parked_process(
    settings: Settings, db: Any, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The engine went away between the resume and the worker reading it: the row fails,
    and the process it had already taken off the shelf goes with it rather than lingering.
    """
    log = tmp_path / "engine.log"
    engine = add_engine(db, tmp_path, log=log)
    game = make_game(db)

    async with CorrespondenceSearches(settings=settings, sessions=db) as worker:
        started = call(
            db, correspondence_service.start_search, node_id=game["tree"]["id"], engine_id=engine.id
        )
        await wait_for_status(db, started["id"], SearchStatus.RUNNING)
        call(db, correspondence_service.pause_search, started["id"])
        await wait_for_parked(db, started["id"])

        def gone_before_it_starts(session: Session, search_id: int) -> Any:
            raise correspondence_service.CorrespondenceError("FakeFish has been switched off")

        monkeypatch.setattr(correspondence_service, "search_context", gone_before_it_starts)
        call(db, correspondence_service.resume_search, started["id"])
        row = await wait_for_status(db, started["id"], SearchStatus.FAILED)
        await wait_for(lambda: "quit" in commands(log))
        assert worker.parked == 0

    assert "switched off" in (row.error or "")


async def test_an_engine_that_dies_fails_its_search(
    settings: Settings, db: Any, tmp_path: Path
) -> None:
    engine = add_engine(
        db, tmp_path, name="Crasher", infos=[], hold=False, go={"crash": True, "stderr": "boom"}
    )
    game = make_game(db)

    async with CorrespondenceSearches(settings=settings, sessions=db):
        started = call(
            db, correspondence_service.start_search, node_id=game["tree"]["id"], engine_id=engine.id
        )
        row = await wait_for_status(db, started["id"], SearchStatus.FAILED)

    assert row.error
    assert row.warm is False


# --- the service -----------------------------------------------------------


def test_one_engine_on_one_node_at_a_time(session: Session, tmp_path: Path) -> None:
    engine = Engine(name="FakeFish", kind=EngineKind.UCI, path=sys.executable)
    session.add(engine)
    session.commit()
    game = correspondence_service.create_game(
        session, white="A", black="B", owner_color=Color.WHITE
    )
    node_id = game["tree"]["id"]

    first = correspondence_service.start_search(session, node_id=node_id, engine_id=engine.id)
    with pytest.raises(correspondence_service.SearchBusyError):
        correspondence_service.start_search(session, node_id=node_id, engine_id=engine.id)

    # Parked still owns the node; finished does not.
    correspondence_service.pause_search(session, first["id"])
    with pytest.raises(correspondence_service.SearchBusyError):
        correspondence_service.start_search(session, node_id=node_id, engine_id=engine.id)
    correspondence_service.stop_search(session, first["id"])
    again = correspondence_service.start_search(session, node_id=node_id, engine_id=engine.id)
    assert again["status"] == "queued"


def _attic(session: Session, *, connected: bool, streams: bool = True) -> Engine:
    """An engine advertised by a runner, with the runner in the given state."""
    runner = Runner(name="attic", token_hash="x" * 64, slots=2, connected=connected)
    session.add(runner)
    session.commit()
    engine = Engine(
        name="AtticFish",
        kind=EngineKind.UCI,
        path="runner:sf",
        runner_id=runner.id,
        streams=streams,
    )
    session.add(engine)
    session.commit()
    return engine


def test_a_search_on_a_connected_runner_is_accepted_and_knows_its_host(session: Session) -> None:
    """Step 4: a runner's engine is one a search may run on, and the row says which host."""
    engine = _attic(session, connected=True)
    game = correspondence_service.create_game(
        session, white="A", black="B", owner_color=Color.WHITE
    )

    started = correspondence_service.start_search(
        session, node_id=game["tree"]["id"], engine_id=engine.id
    )

    assert started["status"] == "queued"
    assert started["runner_id"] == engine.runner_id
    assert started["host_connected"] is True
    entry = next(
        row for row in correspondence_service.status(session)["engines"]
        if row["engine_id"] == engine.id
    )
    assert entry["search_trouble"] is None
    assert entry["host"] == "runner 'attic'"


def test_a_runner_that_is_away_is_refused_by_name_and_waited_for_by_the_worker(
    session: Session,
) -> None:
    """A person is told; the worker, asking with `away_ok`, is let through to wait."""
    engine = _attic(session, connected=False)
    game = correspondence_service.create_game(
        session, white="A", black="B", owner_color=Color.WHITE
    )

    with pytest.raises(correspondence_service.CorrespondenceError) as failure:
        correspondence_service.start_search(
            session, node_id=game["tree"]["id"], engine_id=engine.id
        )
    assert "runner 'attic'" in str(failure.value)
    assert "not connected" in str(failure.value)
    assert correspondence_service._engine_trouble(session, engine.id, away_ok=True) is None


def test_a_runner_engine_that_carries_no_stream_is_refused(session: Session) -> None:
    """A poller's engine takes queue work and nothing else, and the sentence says so."""
    engine = _attic(session, connected=True, streams=False)
    game = correspondence_service.create_game(
        session, white="A", black="B", owner_color=Color.WHITE
    )

    with pytest.raises(correspondence_service.CorrespondenceError) as failure:
        correspondence_service.start_search(
            session, node_id=game["tree"]["id"], engine_id=engine.id
        )
    assert "no stream" in str(failure.value)


def test_an_engine_that_does_not_drive_a_board_is_refused(session: Session) -> None:
    engine = Engine(name="Queue only", kind=EngineKind.UCI, path=sys.executable, streams=False)
    session.add(engine)
    session.commit()
    game = correspondence_service.create_game(
        session, white="A", black="B", owner_color=Color.WHITE
    )

    with pytest.raises(correspondence_service.CorrespondenceError) as failure:
        correspondence_service.start_search(
            session, node_id=game["tree"]["id"], engine_id=engine.id
        )
    assert "does not drive a board" in str(failure.value)


def test_the_pickers_offer_every_engine_and_say_which_cannot_search(session: Session) -> None:
    """One list for both modes: a task may run on any of them, a search on the ones with no
    `search_trouble`. The deep role's engine is the default; a runner's is offered with the
    reason it cannot search yet rather than hidden; Maia is offered to neither."""
    from backend.services import engines as engines_service

    first = Engine(name="One", kind=EngineKind.UCI, path=sys.executable)
    second = Engine(name="Two", kind=EngineKind.UCI, path=sys.executable)
    maia = Engine(name="Maia", kind=EngineKind.MAIA, path=sys.executable)
    runner = Runner(name="attic", token_hash="x" * 64, slots=2)
    session.add_all([first, second, maia, runner])
    session.commit()
    remote = Engine(name="Attic", kind=EngineKind.UCI, path="runner:sf", runner_id=runner.id)
    session.add(remote)
    session.commit()
    engines_service.assign_default_roles(session, second)

    body = correspondence_service.status(session)
    assert [engine["name"] for engine in body["engines"]] == ["One", "Two", "Attic"]
    assert [engine["default"] for engine in body["engines"]] == [False, True, False]
    assert [engine["host"] for engine in body["engines"]] == [
        "this host",
        "this host",
        "runner 'attic'",
    ]
    assert body["engines"][0]["search_trouble"] is None
    assert "runner 'attic'" in body["engines"][2]["search_trouble"]
    assert "eligible_engines" not in body

    # An engine switched off stops being offered; the default falls to one that can search.
    second.enabled = False
    session.commit()
    body = correspondence_service.status(session)
    assert [(engine["name"], engine["default"]) for engine in body["engines"]] == [
        ("One", True),
        ("Attic", False),
    ]


def test_the_status_payload_counts_slots_and_parked_processes(session: Session) -> None:
    engine = Engine(
        name="FakeFish", kind=EngineKind.UCI, path=sys.executable, options={"Hash": 4096}
    )
    session.add(engine)
    session.commit()
    game = correspondence_service.create_game(
        session, white="A", black="B", owner_color=Color.WHITE
    )
    started = correspondence_service.start_search(
        session, node_id=game["tree"]["id"], engine_id=engine.id
    )
    correspondence_service.mark_running(session, started["id"])

    live = correspondence_service.status(session)
    assert live["slots"] == 2
    assert live["in_use"] == 1
    assert live["hosts"][0] == {
        "runner_id": None,
        "host": "this host",
        "slots": 2,
        "in_use": 1,
        "parked": 0,
        "connected": True,
    }
    assert live["engines"] == [
        {
            "engine_id": engine.id,
            "name": "FakeFish",
            "version": None,
            "hash_mb": 4096,
            "default": True,
            "runner_id": None,
            "host": "this host",
            "search_trouble": None,
        }
    ]

    correspondence_service.mark_parked(session, started["id"], warm=True)
    parked = correspondence_service.status(session)
    assert parked["in_use"] == 0
    assert parked["parked"] == [
        {
            "search_id": started["id"],
            "node_id": game["tree"]["id"],
            "engine_id": engine.id,
            "engine_name": "FakeFish",
            "hash_mb": 4096,
        }
    ]


def test_the_slots_in_the_strip_are_the_running_pool_not_the_saved_setting(
    session: Session,
) -> None:
    """Raising the setting without a restart must not invent slots the machine has not got.

    The pool and the semaphore are sized once, at boot. A strip that read the setting would
    answer "2 of 6 in use" the moment the owner saved 6, with two searches sitting at
    "waiting for a slot" beside four slots that do not exist — and the strip is exactly the
    number the owner is being asked to act on.
    """
    app_settings_service.set_value(session, app_settings_service.CORRESPONDENCE_SLOTS, 6)
    assert correspondence_service.status(session)["slots"] == 6

    correspondence_service.register_capacity(lambda: {"slots": 2})
    running = correspondence_service.status(session)
    assert running["slots"] == 2
    assert running["hosts"][0]["slots"] == 2

    # No worker in this process — the CLI, a read-only deployment — and the setting is the
    # best answer there is.
    correspondence_service.clear_capacity()
    assert correspondence_service.status(session)["slots"] == 6


def test_every_transition_says_so_on_the_event_hub(session: Session) -> None:
    seen: list[dict[str, Any]] = []
    events_service.subscribe(
        lambda event: (
            seen.append(event)
            if event.get("event") == correspondence_service.EVENT_SEARCH
            else None
        )
    )
    engine = Engine(name="FakeFish", kind=EngineKind.UCI, path=sys.executable)
    session.add(engine)
    session.commit()
    game = correspondence_service.create_game(
        session, white="A", black="B", owner_color=Color.WHITE
    )
    started = correspondence_service.start_search(
        session, node_id=game["tree"]["id"], engine_id=engine.id
    )
    correspondence_service.pause_search(session, started["id"])
    correspondence_service.resume_search(session, started["id"])
    correspondence_service.stop_search(session, started["id"])

    assert [event["status"] for event in seen] == ["queued", "paused", "queued", "stopped"]
    assert seen[0]["game_id"] == game["game"]["game_id"]
    assert seen[0]["node_id"] == game["tree"]["id"]
    assert seen[0]["engine_id"] == engine.id
    assert seen[-1]["warm"] is False


def test_a_resumed_search_is_dated_from_the_stretch_it_is_in(session: Session) -> None:
    """`started_at` is this stretch's start, because that is what the page's clock counts.

    A search started on Monday, paused on Monday evening and resumed on Friday has been
    searching for a minute, not for four days, and the pane that said `4d 0h` after a minute
    of work would be the most misleading number on the screen. The whole age is `created_at`.
    """
    engine = Engine(name="FakeFish", kind=EngineKind.UCI, path=sys.executable)
    session.add(engine)
    session.commit()
    game = correspondence_service.create_game(
        session, white="A", black="B", owner_color=Color.WHITE
    )
    started = correspondence_service.start_search(
        session, node_id=game["tree"]["id"], engine_id=engine.id
    )
    first = correspondence_service.mark_running(session, started["id"])
    correspondence_service.pause_search(session, started["id"])
    correspondence_service.resume_search(session, started["id"])
    again = correspondence_service.mark_running(session, started["id"])

    assert first is not None and again is not None
    assert again["started_at"] > first["started_at"]
    assert again["created_at"] == first["created_at"]


def test_a_search_is_refused_on_a_finished_game(session: Session) -> None:
    engine = Engine(name="FakeFish", kind=EngineKind.UCI, path=sys.executable)
    session.add(engine)
    session.commit()
    game = correspondence_service.create_game(
        session, white="A", black="B", owner_color=Color.WHITE
    )
    game_id = game["game"]["game_id"]
    correspondence_service.finish_game(session, game_id, result="1-0")

    with pytest.raises(correspondence_service.TreeLockedError):
        correspondence_service.start_search(
            session, node_id=game["tree"]["id"], engine_id=engine.id
        )


def test_resume_all_says_why_a_search_stays_paused(session: Session) -> None:
    """The bulk path is the one with nobody to raise at, so the reason goes on the row.

    Resuming one search raises and the sentence reaches the owner in the dialog; **Resume
    all** would otherwise leave one pane sitting at *paused, cold* with nothing on it —
    which is exactly the state the manual promises says so.
    """
    seen: list[dict[str, Any]] = []
    events_service.subscribe(
        lambda event: (
            seen.append(event)
            if event.get("event") == correspondence_service.EVENT_SEARCH
            else None
        )
    )
    engine = Engine(name="FakeFish", kind=EngineKind.UCI, path=sys.executable)
    session.add(engine)
    session.commit()
    game = correspondence_service.create_game(
        session, white="A", black="B", owner_color=Color.WHITE
    )
    started = correspondence_service.start_search(
        session, node_id=game["tree"]["id"], engine_id=engine.id
    )
    correspondence_service.pause_search(session, started["id"])
    engine.enabled = False
    session.commit()
    seen.clear()

    answered = correspondence_service.resume_all(session)

    row = session.get(CorrespondenceSearch, started["id"])
    assert row is not None
    assert row.status is SearchStatus.PAUSED
    assert "switched off" in (row.error or "")
    assert [one["id"] for one in answered["searches"]] == [started["id"]]
    assert answered["searches"][0]["error"] == row.error
    assert [event["status"] for event in seen] == ["paused"]

    # Switched on again, the same press does what it says.
    engine.enabled = True
    session.commit()
    correspondence_service.resume_all(session)
    session.refresh(row)
    assert row.status is SearchStatus.QUEUED
    assert row.error is None


def test_a_restricted_search_never_writes_the_positions_verdict(session: Session) -> None:
    """`root_moves` is a shortlist, and a shortlist's best move is not the position's value.

    The eval row is shared by every node and every game that reaches this position, and the
    forward-only rule would make a restricted number permanent — no later full-width search
    under its depth could take it back. So a restricted search checkpoints its heartbeat
    and nothing else.
    """
    engine = Engine(name="FakeFish", kind=EngineKind.UCI, path=sys.executable)
    session.add(engine)
    session.commit()
    game = correspondence_service.create_game(
        session, white="A", black="B", owner_color=Color.WHITE
    )
    node_id = game["tree"]["id"]
    epd = game["tree"]["epd"]

    wide = correspondence_service.start_search(session, node_id=node_id, engine_id=engine.id)
    correspondence_service.checkpoint(
        session, wide["id"], _snapshot(depth=30, cp=20, move="e2e4"), time_delta_ms=1000
    )
    correspondence_service.stop_search(session, wide["id"])

    narrow = correspondence_service.start_search(
        session, node_id=node_id, engine_id=engine.id, root_moves=["g1f3"]
    )
    written = correspondence_service.checkpoint(
        session, narrow["id"], _snapshot(depth=45, cp=-60, move="g1f3"), time_delta_ms=1000
    )

    assert written is None
    row = session.scalars(select(CorrespondenceEval).where(CorrespondenceEval.epd == epd)).first()
    assert row is not None
    assert (row.cp, row.depth) == (20, 30)
    assert (row.best_lines or [])[0]["pv"][0] == "e2e4"
    assert len(row.history or []) == 1
    # Alive, though: a search that may not write a verdict still says it is running.
    search = session.get(CorrespondenceSearch, narrow["id"])
    assert search is not None and search.heartbeat_at is not None


def test_a_root_move_that_is_not_legal_is_refused(session: Session) -> None:
    engine = Engine(name="FakeFish", kind=EngineKind.UCI, path=sys.executable)
    session.add(engine)
    session.commit()
    game = correspondence_service.create_game(
        session, white="A", black="B", owner_color=Color.WHITE
    )

    with pytest.raises(correspondence_service.CorrespondenceError):
        correspondence_service.start_search(
            session,
            node_id=game["tree"]["id"],
            engine_id=engine.id,
            root_moves=["e2e5"],
        )


def test_the_slot_count_is_a_setting(session: Session) -> None:
    assert app_settings_service.get_correspondence_slots(session) == 2
    app_settings_service.set_value(session, app_settings_service.CORRESPONDENCE_SLOTS, 99)
    assert app_settings_service.get_correspondence_slots(session) == 16


# --- the HTTP surface ------------------------------------------------------


@pytest.fixture()
def api(settings_for_api: Settings) -> Iterator[TestClient]:
    with running_app(create_app(settings_for_api)) as client:
        yield client


@pytest.fixture()
def settings_for_api(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Settings]:
    """The ordinary app, with no engine worker in it: these tests are about the routes."""
    from backend.config import get_settings
    from backend.db.session import reset_engines

    monkeypatch.setenv("BLUNDERBASE_ROOT", str(tmp_path))
    monkeypatch.setenv("BLUNDERBASE_DB_PATH", str(tmp_path / "blunderbase.db"))
    monkeypatch.setenv("BLUNDERBASE_ANALYSIS_WORKERS", "false")
    get_settings.cache_clear()
    reset_engines()
    yield get_settings()
    get_settings.cache_clear()
    reset_engines()


def api_engine(settings: Settings, **changes: Any) -> int:
    """An engine row straight in the database: probing a binary is another test's subject."""
    fields: dict[str, Any] = {
        "name": "FakeFish",
        "kind": EngineKind.UCI,
        "path": sys.executable,
        "enabled": True,
    }
    fields.update(changes)
    with get_sessionmaker(settings)() as session:
        engine = Engine(**fields)
        session.add(engine)
        session.commit()
        return engine.id


def api_game(api: TestClient) -> dict[str, Any]:
    response = api.post(
        "/correspondence/games",
        json={"white": "Baum, Philipp", "black": "Gegner, Ein", "owner_color": "white"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_a_search_is_started_paused_resumed_and_stopped_over_http(
    api: TestClient, settings_for_api: Settings
) -> None:
    engine_id = api_engine(settings_for_api)
    game = api_game(api)
    node_id = game["tree"]["id"]

    created = api.post(
        "/correspondence/searches",
        json={"node_id": node_id, "engine_id": engine_id, "multipv": 4, "limit_depth": 40},
    )
    assert created.status_code == 201, created.text
    search = created.json()
    assert search["status"] == "queued"
    assert search["multipv"] == 4
    assert search["limit_depth"] == 40
    assert search["engine_name"] == "FakeFish"
    assert search["game_id"] == game["game"]["game_id"]

    listed = api.get("/correspondence/searches").json()["searches"]
    assert [row["id"] for row in listed] == [search["id"]]

    paused = api.post(f"/correspondence/searches/{search['id']}/pause")
    assert paused.status_code == 200
    assert paused.json()["status"] == "paused"
    assert api.post(f"/correspondence/searches/{search['id']}/resume").json()["status"] == "queued"
    assert api.post(f"/correspondence/searches/{search['id']}/stop").json()["status"] == "stopped"
    # Stopped is history, so the active list is empty and the whole list is not.
    assert api.get("/correspondence/searches").json()["searches"] == []
    assert len(api.get("/correspondence/searches?active=false").json()["searches"]) == 1


def test_the_two_everything_buttons(api: TestClient, settings_for_api: Settings) -> None:
    engine_id = api_engine(settings_for_api)
    game = api_game(api)
    api.post(
        "/correspondence/searches", json={"node_id": game["tree"]["id"], "engine_id": engine_id}
    )

    paused = api.post("/correspondence/searches/pause-all")
    assert paused.status_code == 200
    assert [row["status"] for row in paused.json()["searches"]] == ["paused"]
    resumed = api.post("/correspondence/searches/resume-all")
    assert [row["status"] for row in resumed.json()["searches"]] == ["queued"]


def test_the_same_engine_twice_on_one_node_is_a_typed_409(
    api: TestClient, settings_for_api: Settings
) -> None:
    engine_id = api_engine(settings_for_api)
    game = api_game(api)
    body = {"node_id": game["tree"]["id"], "engine_id": engine_id}
    assert api.post("/correspondence/searches", json=body).status_code == 201
    refused = api.post("/correspondence/searches", json=body)
    assert refused.status_code == 409
    assert refused.json()["error"] == "correspondence_search_busy"


def test_a_search_on_an_engine_whose_runner_is_away_is_a_typed_422(
    api: TestClient, settings_for_api: Settings
) -> None:
    with get_sessionmaker(settings_for_api)() as session:
        runner = Runner(name="attic", token_hash="y" * 64, slots=2)
        session.add(runner)
        session.commit()
        runner_id = runner.id
    engine_id = api_engine(
        settings_for_api, name="AtticFish", path="runner:sf", runner_id=runner_id
    )
    game = api_game(api)

    refused = api.post(
        "/correspondence/searches", json={"node_id": game["tree"]["id"], "engine_id": engine_id}
    )
    assert refused.status_code == 422
    assert refused.json()["error"] == "correspondence_invalid"
    assert "attic" in refused.json()["detail"]


def test_an_unknown_search_is_a_typed_404(api: TestClient) -> None:
    response = api.post("/correspondence/searches/404/pause")
    assert response.status_code == 404
    assert response.json()["error"] == "unknown_correspondence_search"


def test_the_status_route_answers_the_capacity_strip(
    api: TestClient, settings_for_api: Settings
) -> None:
    api_engine(settings_for_api, options={"Hash": 2048})
    body = api.get("/correspondence/status").json()
    assert body["slots"] == 2
    assert body["in_use"] == 0
    assert body["hosts"][0]["host"] == "this host"
    assert body["engines"][0]["default"] is True
    assert body["engines"][0]["hash_mb"] == 2048
    assert body["engines"][0]["search_trouble"] is None


def test_the_settings_carry_the_slots(api: TestClient) -> None:
    before = api.get("/settings").json()
    assert before["correspondence_slots"] is None
    assert "correspondence_search_engine_ids" not in before
    assert "correspondence_task_engine_id" not in before

    saved = api.put("/settings", json={"correspondence_slots": 4}).json()
    assert saved["correspondence_slots"] == 4
    # A save that leaves it out clears it, which is what `completeUpdate` is for.
    cleared = api.put("/settings", json={}).json()
    assert cleared["correspondence_slots"] is None


# --- helpers that need the module's names ----------------------------------


def _depth(sessions: sessionmaker[Session], epd: str) -> int:
    row = eval_row(sessions, epd)
    return (row.depth or 0) if row is not None else 0


def _snapshot(*, depth: int, cp: int, move: str) -> dict[str, Any]:
    """One picture in the shape the worker hands `checkpoint`."""
    return {
        "depth": depth,
        "nodes": 1000 * depth,
        "lines": [{"multipv": 1, "depth": depth, "cp": cp, "pv": [move]}],
    }


def _describe(sessions: sessionmaker[Session], search_id: int) -> str:
    row = search_row(sessions, search_id)
    if row is None:
        return f"search {search_id} is gone"
    return f"search {search_id} is {row.status} warm={row.warm} error={row.error!r}"


def _evals(sessions: sessionmaker[Session], epd: str) -> list[CorrespondenceEval]:
    with sessions() as session:
        return list(
            session.scalars(select(CorrespondenceEval).where(CorrespondenceEval.epd == epd))
        )
