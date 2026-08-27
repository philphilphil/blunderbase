"""The analysis workers end to end: real subprocesses, real rows, real failures.

Every engine here is `fake_uci.py` — a subprocess speaking UCI over a pipe — so the whole
path is exercised: the pool starting a process, python-chess talking to it, the adapter
reading its info lines, the plan turning them into `MoveEval` rows, and one commit at the
end. The scores are scripted, which is what makes the classifications assertable.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest
from fake_uci import MAIA_OPTIONS, STOCKFISH_OPTIONS, fake_engine_command
from sqlalchemy import Engine as SaEngine
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from backend.config import Settings
from backend.db.base import Base
from backend.db.enums import Classification, EngineKind, Platform, RunStatus, Tier
from backend.db.models import Account, AnalysisRun, Engine, Game, MoveEval
from backend.db.session import create_db_engine
from backend.services import analysis, app_settings, import_service
from backend.workers import AnalysisWorkers, analysis_queue

# The fixture game: 1. e4 e5 2. Nf3 Nc6 3. Bb5 a6, six plies and seven positions, the
# owner playing White at 1712.
PLAYED = ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6"]

START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
# Fool's mate: White is to move and has been mated, which no engine can be asked about.
MATED = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3"

# One scripted reply per position, in the order the run walks them. The centipawn score a
# UCI engine reports is always from the side to move's point of view, so these read as
# White +100, White -300, White +50, equal, White -150, White -350, White -300. `pv`
# picks a legal move: the third reply names the move that was actually played, which is
# what makes ply 2 the engine's own first choice.
QUICK_REPLIES = [
    {"info": ["depth 12 score cp 100 nodes 5000 pv d2d4 d7d5"], "bestmove": "d2d4"},
    {"info": ["depth 12 score cp 300 nodes 5000 pv c7c5 g1f3"], "bestmove": "c7c5"},
    {"info": ["depth 12 score cp 50 nodes 5000 pv g1f3 b8c6"], "bestmove": "g1f3"},
    {"info": ["depth 12 score cp 0 nodes 5000 pv g8f6 f1c4"], "bestmove": "g8f6"},
    {"info": ["depth 12 score cp -150 nodes 5000 pv f1c4 g8f6"], "bestmove": "f1c4"},
    {"info": ["depth 12 score cp 350 nodes 5000 pv g8f6 e1g1"], "bestmove": "g8f6"},
    {"info": ["depth 12 score cp -300 nodes 5000 pv e1g1 g8f6"], "bestmove": "e1g1"},
]

EXPECTED = [
    # ply, win_before, win_after, win_loss, classification
    (0, 59.10, 24.89, 34.21, Classification.BLUNDER),
    (1, 75.11, 45.41, 29.70, Classification.MISTAKE),
    (2, 54.59, 50.00, 4.59, Classification.BEST),
    (3, 50.00, 63.47, 0.00, Classification.GOOD),
    (4, 36.53, 21.61, 14.92, Classification.INACCURACY),
    (5, 78.39, 75.11, 3.28, Classification.GOOD),
]

# An answer that is legal in every position: an evaluation and no move at all. Used where
# a test cares about the queue rather than about what the engine said.
NEUTRAL_REPLY = {"info": ["depth 8 score cp 20 nodes 100"], "bestmove": "(none)"}

# 1. f3 e5 2. g4 Qh4#: four positions to ask about, the fifth being the mate itself.
MATE_REPLIES = [
    {"info": ["depth 10 score cp 20 nodes 900 pv e2e4 e7e5"], "bestmove": "e2e4"},
    {"info": ["depth 10 score cp 30 nodes 900 pv e7e5 d2d4"], "bestmove": "e7e5"},
    {"info": ["depth 10 score cp -40 nodes 900 pv d2d4 e5d4"], "bestmove": "d2d4"},
    {"info": ["depth 10 score cp 120 nodes 900 pv d8h4"], "bestmove": "d8h4"},
]

DEEP_REPLIES = [
    {
        "info": [
            "depth 30 multipv 1 score cp 50 nodes 900 pv g1f3 b8c6",
            "depth 30 multipv 2 score cp 40 nodes 900 pv b1c3 g8f6",
            "depth 30 multipv 3 score cp 30 nodes 900 pv d2d4 e5d4",
        ],
        "bestmove": "g1f3",
    },
    {
        "info": [
            "depth 30 multipv 1 score cp -50 nodes 900 pv g8f6 f1c4",
            "depth 30 multipv 2 score cp -60 nodes 900 pv b8c6 f1b5",
            "depth 30 multipv 3 score cp -70 nodes 900 pv d7d6 d2d4",
        ],
        "bestmove": "g8f6",
    },
    {
        "info": [
            "depth 30 multipv 1 score cp 60 nodes 900 pv f1b5 a7a6",
            "depth 30 multipv 2 score cp 50 nodes 900 pv f1c4 g8f6",
            "depth 30 multipv 3 score cp 40 nodes 900 pv d2d4 e5d4",
        ],
        "bestmove": "f1b5",
    },
    {
        "info": [
            "depth 30 multipv 1 score cp -60 nodes 900 pv a7a6 b5a4",
            "depth 30 multipv 2 score cp -70 nodes 900 pv g8f6 e1g1",
            "depth 30 multipv 3 score cp -80 nodes 900 pv d7d6 d2d4",
        ],
        "bestmove": "a7a6",
    },
]


def _maia_reply(moves: list[tuple[str, float]]) -> dict[str, Any]:
    """One lc0 answer: verbose per-move policy shares plus the multi-PV ordering."""
    info = [f"string {uci}  (322 ) N: 0 (+ 0) (P: {share:.2f}%) (WL: 0.03)" for uci, share in moves]
    info += [
        f"depth 1 multipv {rank} score cp 10 nodes 1 pv {uci}"
        for rank, (uci, _share) in enumerate(moves, 1)
    ]
    return {"info": info, "bestmove": moves[0][0]}


@pytest.fixture()
def db(tmp_path: Path) -> Any:
    """A file database of its own, so the worker threads never share a connection."""
    engine = create_db_engine(f"sqlite+pysqlite:///{tmp_path / 'blunderbase.db'}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)
    yield factory
    engine.dispose()


@pytest.fixture()
def settings(tmp_path: Path) -> Settings:
    return Settings(root=tmp_path, analysis_concurrency=1, analysis_poll_seconds=0.01)


def _register(
    sessions: sessionmaker[Session],
    tmp_path: Path,
    *,
    kind: EngineKind = EngineKind.UCI,
    name: str = "FakeFish",
    **scenario: Any,
) -> Engine:
    options = MAIA_OPTIONS if kind is EngineKind.MAIA else STOCKFISH_OPTIONS
    scenario.setdefault("options", options)
    scenario.setdefault("name", name)
    engine = Engine(
        name=name,
        kind=kind,
        path=fake_engine_command(tmp_path, **scenario),
        default_tier=Tier.QUICK if kind is EngineKind.UCI else None,
        enabled=True,
    )
    with sessions() as session:
        session.add(engine)
        session.commit()
    return engine


def _import_game(sessions: sessionmaker[Session], fixtures_dir: Path) -> Game:
    with sessions() as session:
        session.add(Account(platform=Platform.LICHESS, username="blunderbase", is_owner=True))
        session.commit()
        job = import_service.run_import(
            session, "pgn", path=str(fixtures_dir / "analysis_game.pgn")
        )
        assert job.games_imported == 1, job.errors
        return session.scalars(select(Game)).one()


async def _wait_for_status(
    sessions: sessionmaker[Session], status: RunStatus, timeout: float = 10.0
) -> int:
    """The id of the first run to reach `status`, polled for while the workers work."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while loop.time() < deadline:
        with sessions() as session:
            run = session.scalars(select(AnalysisRun).where(AnalysisRun.status == status)).first()
            if run is not None:
                return run.id
        await asyncio.sleep(0.02)
    raise AssertionError(f"no run reached {status}")


async def _wait_until(
    ready: Any, sessions: sessionmaker[Session], run_id: int, timeout: float = 10.0
) -> bool:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while loop.time() < deadline:
        with sessions() as session:
            if ready(analysis.require_run(session, run_id)):
                return True
        await asyncio.sleep(0.02)
    return False


async def _drain(settings: Settings, sessions: sessionmaker[Session], **kwargs: Any) -> None:
    workers = AnalysisWorkers(settings=settings, sessions=sessions, **kwargs)
    await workers.start()
    try:
        assert await workers.wait_idle(30.0), "the queue never emptied"
    finally:
        await workers.stop()


# --- the quick tier end to end --------------------------------------------


async def test_a_quick_pass_evaluates_every_move_and_names_it(
    db: sessionmaker[Session], settings: Settings, tmp_path: Path, fixtures_dir: Path
) -> None:
    _register(db, tmp_path, go=QUICK_REPLIES)
    game = _import_game(db, fixtures_dir)

    await _drain(settings, db)

    with db() as session:
        run = session.scalars(select(AnalysisRun)).one()
        rows = analysis.get_move_evals(session, run.id)

    assert run.status is RunStatus.DONE
    assert run.tier is Tier.QUICK
    assert run.attempts == 1
    assert (run.error, run.stderr) == (None, None)
    assert run.finished_at is not None
    assert [row.ply for row in rows] == list(range(6))
    assert [row.move_uci for row in rows] == PLAYED
    assert [row.move_san for row in rows] == ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"]
    assert [
        (row.ply, row.win_before, row.win_after, row.win_loss, row.classification) for row in rows
    ] == EXPECTED
    assert game.ply_count == 6


async def test_a_quick_pass_stores_the_scores_it_was_given(
    db: sessionmaker[Session], settings: Settings, tmp_path: Path, fixtures_dir: Path
) -> None:
    """Every eval is in the mover's frame, so before and after are two readings of one dial."""
    _register(db, tmp_path, go=QUICK_REPLIES)
    _import_game(db, fixtures_dir)

    await _drain(settings, db)

    with db() as session:
        run = session.scalars(select(AnalysisRun)).one()
        rows = analysis.get_move_evals(session, run.id)

    assert [row.eval_before_cp for row in rows] == [100, 300, 50, 0, -150, 350]
    assert [row.eval_after_cp for row in rows] == [-300, -50, 0, 150, -350, 300]
    assert all(row.eval_before_mate is None for row in rows)


async def test_a_quick_pass_records_the_engines_own_line(
    db: sessionmaker[Session], settings: Settings, tmp_path: Path, fixtures_dir: Path
) -> None:
    _register(db, tmp_path, go=QUICK_REPLIES)
    _import_game(db, fixtures_dir)

    await _drain(settings, db)

    with db() as session:
        run = session.scalars(select(AnalysisRun)).one()
        rows = analysis.get_move_evals(session, run.id)

    assert [row.best_move_uci for row in rows] == [
        "d2d4",
        "c7c5",
        "g1f3",
        "g8f6",
        "f1c4",
        "g8f6",
    ]
    assert rows[0].best_lines == [{"multipv": 1, "cp": 100, "mate": None, "pv": ["d2d4", "d7d5"]}]
    assert rows[0].position_id is not None


async def test_a_run_writes_its_rows_in_a_single_transaction(
    db: sessionmaker[Session], settings: Settings, tmp_path: Path, fixtures_dir: Path
) -> None:
    """The whole point of buffering: SQLite's write lock is held for one commit, not seven."""
    _register(db, tmp_path, go=QUICK_REPLIES)
    _import_game(db, fixtures_dir)
    seen: list[int] = []
    cancel = analysis.subscribe(
        lambda event: (
            seen.append(event["done"]) if event["event"] == analysis.EVENT_RUN_PROGRESS else None
        )
    )
    try:
        await _drain(settings, db)
    finally:
        cancel()

    with db() as session:
        assert len(analysis.get_move_evals(session, session.scalars(select(AnalysisRun)).one().id))
        # Progress was published while the run was working, but nothing was written yet.
        assert seen == [7]


async def test_the_lifecycle_is_published_while_the_worker_runs(
    db: sessionmaker[Session], settings: Settings, tmp_path: Path, fixtures_dir: Path
) -> None:
    _register(db, tmp_path, go=QUICK_REPLIES)
    events: list[dict[str, Any]] = []
    cancel = analysis.subscribe(events.append)
    try:
        _import_game(db, fixtures_dir)
        await _drain(settings, db)
    finally:
        cancel()

    names = [event["event"] for event in events]
    assert names[0] == analysis.EVENT_RUN_QUEUED
    assert names[-1] == analysis.EVENT_RUN_DONE
    assert analysis.EVENT_RUN_STARTED in names
    assert events[-1]["evals"] == 6


async def test_a_finished_game_is_scored_without_asking_the_engine(
    db: sessionmaker[Session], settings: Settings, tmp_path: Path, fixtures_dir: Path
) -> None:
    """The position after mate has no legal move, so only four of the five get a `go`."""
    _register(db, tmp_path, go=MATE_REPLIES)
    with db() as session:
        session.add(Account(platform=Platform.LICHESS, username="blunderbase", is_owner=True))
        session.commit()
        job = import_service.run_import(
            session, "pgn", path=str(fixtures_dir / "analysis_mate.pgn")
        )
        assert job.games_imported == 1, job.errors

    await _drain(settings, db)

    with db() as session:
        run = session.scalars(select(AnalysisRun)).one()
        rows = analysis.get_move_evals(session, run.id)

    assert run.status is RunStatus.DONE
    mating = rows[-1]
    assert mating.move_san == "Qh4#"
    assert (mating.eval_after_cp, mating.eval_after_mate) == (10_000, 0)
    assert mating.win_after == 99.96
    assert mating.classification is Classification.BEST


# --- import hands the queue runnable work ---------------------------------


async def test_importing_a_game_queues_a_pass_the_workers_can_actually_run(
    db: sessionmaker[Session], settings: Settings, tmp_path: Path, fixtures_dir: Path
) -> None:
    """Item six: the import's automatic quick run is a complete, runnable row."""
    _register(db, tmp_path, go=QUICK_REPLIES)
    _import_game(db, fixtures_dir)

    with db() as session:
        queued = session.scalars(select(AnalysisRun)).one()
        assert queued.status is RunStatus.QUEUED
        assert queued.nodes == app_settings.QUICK_NODES_DEFAULT
        assert queued.multipv == 1
        assert queued.priority == analysis.QUICK_PRIORITY

    await _drain(settings, db)

    with db() as session:
        assert session.scalars(select(AnalysisRun)).one().status is RunStatus.DONE


# --- the deep tier --------------------------------------------------------


async def test_a_deep_pass_covers_only_its_ply_range_with_several_lines(
    db: sessionmaker[Session], settings: Settings, tmp_path: Path, fixtures_dir: Path
) -> None:
    _register(db, tmp_path, go=DEEP_REPLIES)
    game = _import_game(db, fixtures_dir)
    with db() as session:
        session.execute(select(AnalysisRun))  # the import's quick run
        session.query(AnalysisRun).delete()
        session.commit()
        app_settings.set_value(session, app_settings.DEEP_NODES, 9000)
        app_settings.set_value(session, app_settings.DEEP_MULTIPV, 3)
        deep = analysis.request_analysis(
            session, game_id=game.id, tier=Tier.DEEP, ply_range=(2, 5)
        )
        deep_id = deep.id

    await _drain(settings, db)

    with db() as session:
        run = analysis.require_run(session, deep_id)
        rows = analysis.get_move_evals(session, deep_id)

    assert run.status is RunStatus.DONE
    assert (run.ply_start, run.ply_end, run.multipv, run.nodes) == (2, 5, 3, 9000)
    assert [row.ply for row in rows] == [2, 3, 4]
    assert [row.move_uci for row in rows] == ["g1f3", "b8c6", "f1b5"]
    assert all(len(row.best_lines) == 3 for row in rows)
    assert [line["multipv"] for line in rows[0].best_lines] == [1, 2, 3]
    assert [line["cp"] for line in rows[0].best_lines] == [50, 40, 30]
    assert [row.classification for row in rows] == [
        Classification.BEST,
        Classification.GOOD,
        Classification.BEST,
    ]


async def test_a_deep_pass_jumps_ahead_of_a_queued_quick_one(
    db: sessionmaker[Session], settings: Settings, tmp_path: Path, fixtures_dir: Path
) -> None:
    """One worker, two runs: the deep one is claimed first because someone is waiting."""
    _register(db, tmp_path, go_default=NEUTRAL_REPLY)
    game = _import_game(db, fixtures_dir)
    with db() as session:
        quick_id = session.scalars(select(AnalysisRun)).one().id
        deep_id = analysis.request_analysis(session, game_id=game.id, tier=Tier.DEEP).id

    finished: list[int] = []
    cancel = analysis.subscribe(
        lambda event: (
            finished.append(event["run_id"]) if event["event"] == analysis.EVENT_RUN_DONE else None
        )
    )
    try:
        await _drain(settings, db, concurrency=1)
    finally:
        cancel()

    assert finished == [deep_id, quick_id]


# --- failure --------------------------------------------------------------


async def test_a_crashed_engine_fails_the_run_with_its_last_words(
    db: sessionmaker[Session], settings: Settings, tmp_path: Path, fixtures_dir: Path
) -> None:
    _register(
        db,
        tmp_path,
        go_default={"crash": True, "stderr": "FakeFish: illegal instruction"},
    )
    _import_game(db, fixtures_dir)

    await _drain(settings, db)

    with db() as session:
        run = session.scalars(select(AnalysisRun)).one()
        assert analysis.get_move_evals(session, run.id) == []
        stored = session.scalars(select(Game)).one()

    assert run.status is RunStatus.FAILED
    assert run.attempts == analysis.MAX_ATTEMPTS, "the run is tried exactly twice"
    assert run.error
    assert run.stderr is not None
    assert "illegal instruction" in run.stderr
    # The game stays browsable with whatever tiers it has, which here is none.
    assert stored.ply_count == 6


async def test_a_crash_costs_one_retry_and_then_the_run_succeeds(
    db: sessionmaker[Session], settings: Settings, tmp_path: Path, fixtures_dir: Path
) -> None:
    _register(
        db,
        tmp_path,
        crash_once=str(tmp_path / "crashed.marker"),
        go=[{"crash": True, "stderr": "FakeFish: boom"}],
        go_default=NEUTRAL_REPLY,
    )
    _import_game(db, fixtures_dir)

    await _drain(settings, db)

    with db() as session:
        run = session.scalars(select(AnalysisRun)).one()
        rows = analysis.get_move_evals(session, run.id)

    assert run.status is RunStatus.DONE
    assert run.attempts == 2, "one crash, one retry"
    assert (run.error, run.stderr) == (None, None)
    assert len(rows) == 6


async def test_a_worker_survives_an_error_no_run_path_expects(
    db: sessionmaker[Session],
    settings: Settings,
    tmp_path: Path,
    fixtures_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A commit that fails costs one run, never the worker. An exception escaping the loop
    would kill the task with nobody to retrieve it: the row would sit `running` for ever
    and the pool would be one worker smaller every time it happened."""
    _register(db, tmp_path, go=QUICK_REPLIES, go_default=NEUTRAL_REPLY)
    _import_game(db, fixtures_dir)
    stored = analysis.complete_run
    calls: list[int] = []

    def once(session: Session, run: AnalysisRun, evals: Any) -> None:
        calls.append(run.id)
        if len(calls) == 1:
            raise RuntimeError("database is locked")
        stored(session, run, evals)

    monkeypatch.setattr(analysis, "complete_run", once)

    await _drain(settings, db)

    with db() as session:
        run = session.scalars(select(AnalysisRun)).one()
        rows = analysis.get_move_evals(session, run.id)

    assert len(calls) == 2, "the worker was still there to run it again"
    assert run.status is RunStatus.DONE
    assert len(rows) == 6


async def test_a_shutdown_hands_a_run_back_without_spending_its_retry(
    db: sessionmaker[Session], settings: Settings, tmp_path: Path, fixtures_dir: Path
) -> None:
    """Stopping the process is not an attempt that failed. Counting it would let two
    restarts during one long deep pass mark the run failed with no engine ever crashing."""
    _register(db, tmp_path, go=[{**NEUTRAL_REPLY, "delay": 5}], go_default=NEUTRAL_REPLY)
    _import_game(db, fixtures_dir)
    workers = AnalysisWorkers(settings=settings, sessions=db, stop_grace=0.05)

    await workers.start()
    try:
        await _wait_for_status(db, RunStatus.RUNNING)
    finally:
        await workers.stop()

    with db() as session:
        run = session.scalars(select(AnalysisRun)).one()

    assert run.status is RunStatus.QUEUED
    assert run.attempts == 0
    assert run.error == analysis.STALE_RUN_MESSAGE


async def test_a_run_being_worked_on_keeps_saying_it_is_alive(
    db: sessionmaker[Session],
    settings: Settings,
    tmp_path: Path,
    fixtures_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The heartbeat is what tells a second worker set to leave this run alone."""
    monkeypatch.setattr(analysis_queue, "HEARTBEAT_SECONDS", 0.02)
    _register(db, tmp_path, go=[{**NEUTRAL_REPLY, "delay": 5}], go_default=NEUTRAL_REPLY)
    _import_game(db, fixtures_dir)
    workers = AnalysisWorkers(settings=settings, sessions=db, stop_grace=0.05)

    await workers.start()
    try:
        run_id = await _wait_for_status(db, RunStatus.RUNNING)
        with db() as session:
            claimed = analysis.require_run(session, run_id).heartbeat_at
        beaten = await _wait_until(lambda run: run.heartbeat_at > claimed, db, run_id)
    finally:
        await workers.stop()

    assert beaten, "the run was never marked alive again"


async def test_an_engine_whose_binary_has_gone_is_failed_without_a_retry(
    db: sessionmaker[Session], settings: Settings, tmp_path: Path, fixtures_dir: Path
) -> None:
    _register(db, tmp_path, go=QUICK_REPLIES)
    _import_game(db, fixtures_dir)
    with db() as session:
        session.scalars(select(Engine)).one().path = "/nowhere/at/all/stockfish"
        session.commit()

    await _drain(settings, db)

    with db() as session:
        run = session.scalars(select(AnalysisRun)).one()

    assert run.status is RunStatus.FAILED
    assert run.attempts == 1, "a missing binary will not be there on a second try either"
    assert "no longer at" in (run.error or "")


async def test_an_engine_switched_off_after_enqueueing_hands_over_to_the_tier(
    db: sessionmaker[Session], settings: Settings, tmp_path: Path, fixtures_dir: Path
) -> None:
    """Disabling an engine must not fail the runs already queued against it."""
    first = _register(db, tmp_path, name="Old", go_default={"crash": True})
    _import_game(db, fixtures_dir)
    _register(db, tmp_path, name="New", go=QUICK_REPLIES)
    with db() as session:
        session.get(Engine, first.id).enabled = False
        session.commit()
        replacement = session.scalars(select(Engine).where(Engine.name == "New")).one().id

    await _drain(settings, db)

    with db() as session:
        run = session.scalars(select(AnalysisRun)).one()
        rows = analysis.get_move_evals(session, run.id)

    assert run.status is RunStatus.DONE
    assert run.engine_id == first.id, "the row still records what it was queued against"
    assert replacement != first.id
    assert len(rows) == 6


# --- restart --------------------------------------------------------------


async def test_starting_the_workers_collects_what_a_dead_process_left_running(
    db: sessionmaker[Session], settings: Settings, tmp_path: Path, fixtures_dir: Path
) -> None:
    _register(db, tmp_path, go=QUICK_REPLIES)
    _import_game(db, fixtures_dir)
    with db() as session:
        stranded = session.scalars(select(AnalysisRun)).one()
        stranded.status = RunStatus.RUNNING
        session.commit()
        stranded_id = stranded.id

    await _drain(settings, db)

    with db() as session:
        run = analysis.require_run(session, stranded_id)
        assert len(analysis.get_move_evals(session, stranded_id)) == 6

    assert run.status is RunStatus.DONE


async def test_a_stranded_run_that_has_spent_its_retries_is_failed_on_restart(
    db: sessionmaker[Session], settings: Settings, tmp_path: Path, fixtures_dir: Path
) -> None:
    _register(db, tmp_path, go=QUICK_REPLIES)
    _import_game(db, fixtures_dir)
    with db() as session:
        stranded = session.scalars(select(AnalysisRun)).one()
        stranded.status = RunStatus.RUNNING
        stranded.attempts = analysis.MAX_ATTEMPTS
        session.commit()
        stranded_id = stranded.id

    await _drain(settings, db)

    with db() as session:
        run = analysis.require_run(session, stranded_id)

    assert run.status is RunStatus.FAILED
    assert run.error == analysis.STALE_RUN_MESSAGE


# --- Maia -----------------------------------------------------------------


async def test_maia_predicts_a_human_move_at_the_owners_rating(
    db: sessionmaker[Session], settings: Settings, tmp_path: Path, fixtures_dir: Path
) -> None:
    _register(db, tmp_path, go=QUICK_REPLIES)
    _register(
        db,
        tmp_path,
        kind=EngineKind.MAIA,
        name="Maia",
        go=[
            _maia_reply([("e2e4", 31.4), ("d2d4", 22.0), ("g1f3", 11.5)]),
            _maia_reply([("g1f3", 40.0), ("b1c3", 18.0), ("f1c4", 12.0)]),
            _maia_reply([("f1c4", 28.0), ("f1b5", 26.0), ("d2d4", 14.0)]),
        ],
    )
    _import_game(db, fixtures_dir)

    await _drain(settings, db)

    with db() as session:
        run = session.scalars(select(AnalysisRun).where(AnalysisRun.tier == Tier.QUICK)).one()
        rows = analysis.get_move_evals(session, run.id)

    assert run.status is RunStatus.DONE
    # The owner is White at 1712, so that is the one level asked about, and only their own
    # moves are worth a second engine pass.
    assert [row.ply for row in rows if row.maia_policy] == [0, 2, 4]
    first = rows[0].maia_policy
    assert sorted(first) == ["1712"]
    assert first["1712"][0]["uci"] == "e2e4"
    assert first["1712"][0]["p"] == 0.314
    assert [entry["rank"] for entry in first["1712"]] == [1, 2, 3]


async def test_a_target_elo_bakes_one_level_into_every_ply_of_both_sides(
    db: sessionmaker[Session], settings: Settings, tmp_path: Path, fixtures_dir: Path
) -> None:
    """The "exploit humans" half is a question about the positions the opponent moves in."""
    with db() as session:
        app_settings.set_maia_target_elo(session, 1700)
    _register(db, tmp_path, go=QUICK_REPLIES)
    _register(
        db,
        tmp_path,
        kind=EngineKind.MAIA,
        name="Maia",
        go=[
            _maia_reply([("e2e4", 31.4), ("d2d4", 22.0)]),
            _maia_reply([("e7e5", 30.0), ("c7c5", 20.0)]),
            _maia_reply([("g1f3", 40.0), ("b1c3", 18.0)]),
            _maia_reply([("b8c6", 35.0), ("g8f6", 20.0)]),
            _maia_reply([("f1b5", 28.0), ("f1c4", 26.0)]),
            _maia_reply([("a7a6", 30.0), ("g8f6", 24.0)]),
        ],
    )
    _import_game(db, fixtures_dir)

    await _drain(settings, db)

    with db() as session:
        run = session.scalars(select(AnalysisRun).where(AnalysisRun.tier == Tier.QUICK)).one()
        rows = analysis.get_move_evals(session, run.id)

    assert run.status is RunStatus.DONE
    assert [row.ply for row in rows if row.maia_policy] == [0, 1, 2, 3, 4, 5]
    # One level, the configured one — not a spread around the 1712 the owner had.
    assert sorted(rows[0].maia_policy) == ["1700"]
    assert rows[0].maia_policy["1700"][0] == {
        "uci": "e2e4",
        "san": "e4",
        "rank": 1,
        "p": 0.314,
    }
    # The opponent's moves carry a policy too: that is the half the target elo is for.
    assert rows[1].maia_policy["1700"][0]["uci"] == "e7e5"


async def test_a_maia_that_will_not_answer_degrades_instead_of_failing_the_run(
    db: sessionmaker[Session], settings: Settings, tmp_path: Path, fixtures_dir: Path
) -> None:
    _register(db, tmp_path, go=QUICK_REPLIES)
    _register(db, tmp_path, kind=EngineKind.MAIA, name="Maia", go_default={"crash": True})
    _import_game(db, fixtures_dir)

    await _drain(settings, db)

    with db() as session:
        run = session.scalars(select(AnalysisRun).where(AnalysisRun.tier == Tier.QUICK)).one()
        rows = analysis.get_move_evals(session, run.id)

    assert run.status is RunStatus.DONE, "an evaluation is worth having without a policy"
    assert len(rows) == 6
    assert all(row.maia_policy is None for row in rows)
    assert "human-move predictions skipped" in (run.error or "")


async def test_no_maia_engine_is_not_an_error(
    db: sessionmaker[Session], settings: Settings, tmp_path: Path, fixtures_dir: Path
) -> None:
    _register(db, tmp_path, go=QUICK_REPLIES)
    _import_game(db, fixtures_dir)

    await _drain(settings, db)

    with db() as session:
        run = session.scalars(select(AnalysisRun)).one()
        rows = analysis.get_move_evals(session, run.id)

    assert run.status is RunStatus.DONE
    assert all(row.maia_policy is None for row in rows)


# --- the pool the workers share -------------------------------------------


async def test_the_workers_take_their_concurrency_cap_from_configuration(
    db: sessionmaker[Session], tmp_path: Path
) -> None:
    settings = Settings(root=tmp_path, analysis_concurrency=3)
    workers = AnalysisWorkers(settings=settings, sessions=db)

    assert workers.concurrency == 3
    assert workers.pool.concurrency == 3
    await workers.stop()


async def test_notify_wakes_a_worker_that_is_between_polls(
    db: sessionmaker[Session], tmp_path: Path, fixtures_dir: Path
) -> None:
    """The API layer calls this after enqueueing so a deep pass does not wait for a poll."""
    settings = Settings(root=tmp_path, analysis_concurrency=1, analysis_poll_seconds=600.0)
    _register(db, tmp_path, go_default=NEUTRAL_REPLY)
    workers = AnalysisWorkers(settings=settings, sessions=db)
    await workers.start()
    try:
        # Let the worker find the queue empty and settle into its ten-minute wait first.
        await asyncio.sleep(0.05)
        _import_game(db, fixtures_dir)
        workers.notify()
        assert await workers.wait_idle(30.0), "the worker slept through the whole run"
    finally:
        await workers.stop()

    with db() as session:
        assert session.scalars(select(AnalysisRun)).one().status is RunStatus.DONE


async def test_an_idle_worker_set_starts_and_stops_cleanly(
    db: sessionmaker[Session], settings: Settings
) -> None:
    workers = AnalysisWorkers(settings=settings, sessions=db)
    await workers.start()
    assert workers.running
    assert await workers.wait_idle(5.0)
    await workers.stop()
    assert not workers.running
    # Stopping twice is what a lifespan that never started does.
    await workers.stop()


# --- the synchronous "what if" eval ---------------------------------------


def test_a_position_can_be_evaluated_on_the_spot(db: sessionmaker[Session], tmp_path: Path) -> None:
    """`analyze_position` is the mid-conversation line, not a queued run."""
    _register(db, tmp_path, go_default=QUICK_REPLIES[0])

    with db() as session:
        answer = analysis.analyze_position(session, START_FEN, 1000)

    assert answer["cp"] == 100
    assert answer["win_percent"] == 59.10
    assert answer["best_move"] == {"uci": "d2d4", "san": "d4"}
    assert answer["lines"][0]["pv"] == ["d2d4", "d7d5"]
    with db() as session:
        assert session.scalars(select(AnalysisRun)).all() == [], "nothing was queued"


def test_a_finished_position_needs_no_engine_at_all(
    db: sessionmaker[Session], tmp_path: Path
) -> None:
    _register(db, tmp_path, go_default={"crash": True})

    with db() as session:
        answer = analysis.analyze_position(session, MATED, 1000)

    assert answer["win_percent"] < 1.0
    assert answer["best_move"] is None


def test_a_bad_fen_never_reaches_an_engine(db: sessionmaker[Session], tmp_path: Path) -> None:
    _register(db, tmp_path, go_default={"crash": True})

    with db() as session, pytest.raises(analysis.AnalysisRequestError):
        analysis.analyze_position(session, "banana", 1000)


def test_the_test_database_is_real_sqlite(db: sessionmaker[Session]) -> None:
    """Guards the fixture itself: worker threads must not share one connection."""
    with db() as session:
        bind = session.get_bind()
        assert isinstance(bind, SaEngine)
        assert bind.dialect.name == "sqlite"
        assert session.scalar(select(MoveEval.id)) is None
