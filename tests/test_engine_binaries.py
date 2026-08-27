"""The same adapters against a real engine binary.

Excluded from the default run: `uv run pytest -m engine` opts in, and
`BLUNDERBASE_TEST_STOCKFISH` / `BLUNDERBASE_TEST_MAIA` say where the binaries are (a
Stockfish on PATH is found on its own).
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path

import chess
import chess.engine
import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from backend.adapters.maia import MaiaAdapter
from backend.adapters.pool import EnginePool, EngineSpec
from backend.adapters.stockfish import StockfishAdapter, probe_engine
from backend.config import Settings
from backend.db.base import Base
from backend.db.enums import EngineKind, RunStatus, Tier
from backend.db.models import AnalysisRun
from backend.db.session import create_db_engine
from backend.services import app_settings
from backend.services.analysis import get_move_evals
from backend.services.engines import add_engine, sample_eval
from backend.services.import_service import run_import
from backend.workers import drain

pytestmark = pytest.mark.engine

ITALIAN = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 5 4"
MATE_IN_ONE = "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1"


def stockfish_path() -> str:
    path = os.environ.get("BLUNDERBASE_TEST_STOCKFISH") or shutil.which("stockfish")
    if not path:
        pytest.skip("no stockfish binary; set BLUNDERBASE_TEST_STOCKFISH")
    return path


def maia_command() -> str:
    command = os.environ.get("BLUNDERBASE_TEST_MAIA")
    if not command:
        pytest.skip("no maia command; set BLUNDERBASE_TEST_MAIA")
    return command


def test_a_real_stockfish_declares_the_options_the_ui_edits() -> None:
    probed = probe_engine(stockfish_path())

    assert (probed.name or "").lower().startswith("stockfish")
    assert probed.option("Threads") is not None
    assert probed.option("Hash") is not None
    multipv = probed.option("MultiPV")
    assert multipv is not None and multipv.managed is True


def test_a_real_stockfish_finds_the_mate() -> None:
    with StockfishAdapter(stockfish_path(), options={"Threads": 1, "Hash": 16}) as adapter:
        result = adapter.analyse(chess.Board(MATE_IN_ONE), chess.engine.Limit(depth=12))

    assert result.score.mate_in == 1
    best = result.best
    assert best is not None and best.uci == "a1a8"


def test_a_real_stockfish_ranks_its_multipv_lines() -> None:
    with StockfishAdapter(stockfish_path()) as adapter:
        result = adapter.analyse(chess.Board(ITALIAN), chess.engine.Limit(nodes=200_000), multipv=3)

    assert [candidate.rank for candidate in result.candidates] == [1, 2, 3]
    assert all(candidate.pv_san for candidate in result.candidates)


async def test_the_pool_keeps_a_real_stockfish_warm() -> None:
    spec = EngineSpec.build(stockfish_path(), name="Stockfish")
    pool = EnginePool(concurrency=1, reap_interval=0)

    def analyse(engine: object) -> object:
        assert isinstance(engine, StockfishAdapter)
        return engine.analyse(chess.Board(), chess.engine.Limit(nodes=50_000))

    first = await pool.run(spec, analyse)
    second = await pool.run(spec, analyse)
    assert pool.warm() == [spec.key]
    await pool.close()

    assert first.best is not None and second.best is not None
    assert pool.warm() == []


def test_a_real_engine_registered_through_the_service_can_be_test_run(
    session: Session,
) -> None:
    engine = add_engine(
        session,
        name="Stockfish",
        path=stockfish_path(),
        options={"Threads": 1},
        default_tier=Tier.QUICK,
    )

    sample = sample_eval(session, engine.id, ITALIAN, nodes=100_000, multipv=2)

    assert sample["best_move"] is not None
    assert len(sample["lines"]) == 2
    assert sample["engine_name"] == "Stockfish"


def test_a_real_maia_answers_with_a_human_policy(session: Session) -> None:
    command = maia_command()
    with MaiaAdapter(command) as maia:
        moves = maia.policy(chess.Board(ITALIAN), multipv=3)

    assert moves
    assert all(move.san for move in moves)

    engine = add_engine(session, name="Maia", path=command, kind=EngineKind.MAIA)
    sample = sample_eval(session, engine.id, ITALIAN, multipv=3)
    assert sample["policy"]["any"]


async def test_a_real_quick_pass_runs_a_whole_game_through_the_workers(
    tmp_path: Path, fixtures_dir: Path
) -> None:
    """The same pipeline the fake-UCI suite covers, driven by a real Stockfish."""
    engine = create_db_engine(f"sqlite+pysqlite:///{tmp_path / 'blunderbase.db'}")
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)
    settings = Settings(root=tmp_path, analysis_concurrency=1)
    try:
        with sessions() as owned:
            # A budget a real engine gets through in a test: the import queues its quick
            # pass with whatever is stored when it runs, so this is set before the import.
            app_settings.set_value(owned, app_settings.QUICK_NODES, 20_000)
            add_engine(
                owned,
                name="Stockfish",
                path=stockfish_path(),
                options={"Threads": 1},
                default_tier=Tier.QUICK,
            )
            job = run_import(owned, "pgn", path=str(fixtures_dir / "analysis_game.pgn"))
            assert job.games_imported == 1, job.errors

        await drain(settings, sessions=sessions, timeout=120.0)

        with sessions() as owned:
            run = owned.scalars(select(AnalysisRun)).one()
            rows = get_move_evals(owned, run.id)
    finally:
        engine.dispose()

    assert run.status is RunStatus.DONE
    assert len(rows) == 6
    assert all(row.win_before is not None and row.classification is not None for row in rows)
    assert all(row.best_move_uci for row in rows)
