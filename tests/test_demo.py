from __future__ import annotations

from datetime import UTC, date, datetime
from pathlib import Path

import pytest
from sqlalchemy import func, select

from backend.cli import main
from backend.config import Settings
from backend.db.enums import EngineKind, Platform, RunStatus, Tier
from backend.db.models import Account, AnalysisRun, Credential, Engine, Game, MoveEval, Note
from backend.db.session import session_scope
from backend.services.demo import DEMO_NAME, DemoDataError, create_demo_database


def _analyzed_source(settings: Settings, fixture: Path) -> tuple[int, int]:
    assert main(["db", "upgrade"]) == 0
    with session_scope(settings) as session:
        session.add(Account(platform=Platform.LICHESS, username="blunderbase", is_owner=True))
    assert main(["import", "pgn", str(fixture)]) == 0
    with session_scope(settings) as session:
        game = session.scalars(select(Game).order_by(Game.ply_count.desc())).first()
        assert game is not None and game.ply_count >= 20
        engine = Engine(
            name="source engine",
            kind=EngineKind.UCI,
            path="/source/engine",
            options={},
            enabled=True,
        )
        session.add(engine)
        session.flush()
        run = AnalysisRun(
            game_id=game.id,
            engine_id=engine.id,
            tier=Tier.QUICK,
            status=RunStatus.DONE,
            depth=18,
            nodes=250_000,
            multipv=1,
            finished_at=datetime(2026, 3, 20, 11, tzinfo=UTC),
        )
        session.add(run)
        session.flush()
        session.add(
            MoveEval(
                run_id=run.id,
                ply=0,
                position_id=game.positions[0].position_id,
                move_uci=game.moves_uci[0],
                move_san=game.moves_san[0],
                eval_before_cp=20,
                eval_after_cp=-180,
                win_before=52.0,
                win_after=30.0,
                win_loss=22.0,
                classification="blunder",
                best_move_uci="d2d4",
                best_lines=[{"multipv": 1, "cp": 20, "mate": None, "pv": ["d2d4"]}],
            )
        )
        return game.id, game.white_rating or 0


def test_demo_database_copies_chess_facts_but_no_personal_data(
    settings: Settings, fixtures_dir: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    source_game_id, source_rating = _analyzed_source(settings, fixtures_dir / "query_games.pgn")
    capsys.readouterr()
    output = tmp_path / "showcase.db"

    summary = create_demo_database(
        settings.database_path,
        output,
        game_count=1,
        as_of=date(2026, 8, 29),
    )

    assert (summary.games, summary.analyzed, summary.deep, summary.notes) == (1, 1, 0, 9)
    demo_settings = Settings(
        root=tmp_path,
        data_dir=tmp_path,
        BLUNDERBASE_DB_PATH=output,
        analysis_workers=False,
    )
    with session_scope(demo_settings) as session:
        game = session.scalars(select(Game)).one()
        assert game.moves_uci
        assert game.white_name != "blunderbase" and game.black_name != "blunderbase"
        assert "blunderbase" not in game.pgn.casefold()
        assert DEMO_NAME not in game.pgn  # Handles, not the display name, appear in games.
        owner_rating = game.white_rating if game.owner_color.value == "white" else game.black_rating
        assert owner_rating != source_rating
        assert game.played_at == datetime(2026, 3, 6, 8, tzinfo=UTC)
        assert session.scalar(select(func.count(AnalysisRun.id))) == 1
        assert session.scalar(select(func.count(MoveEval.id))) == 1
        assert session.scalar(select(func.count(Note.id))) == 9
        assert session.scalar(select(func.count(Credential.id))) == 0

    # Reading the source does not rewrite or remove anything in it.
    with session_scope(settings) as session:
        assert session.get(Game, source_game_id) is not None
        assert session.scalar(select(func.count(Game.id))) == 6


def test_demo_database_refuses_to_overwrite_or_alias_the_source(
    settings: Settings, fixtures_dir: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    _analyzed_source(settings, fixtures_dir / "query_games.pgn")
    capsys.readouterr()
    output = tmp_path / "demo.db"
    output.touch()

    with pytest.raises(DemoDataError, match="already exists"):
        create_demo_database(settings.database_path, output)
    with pytest.raises(DemoDataError, match="different file"):
        create_demo_database(settings.database_path, settings.database_path)


def test_demo_cli_reports_the_created_library(
    settings: Settings, fixtures_dir: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    _analyzed_source(settings, fixtures_dir / "query_games.pgn")
    capsys.readouterr()
    output = tmp_path / "cli-demo.db"

    assert main(
        [
            "demo",
            "create",
            "--games",
            "1",
            "--as-of",
            "2026-08-29",
            "--output",
            str(output),
        ]
    ) == 0

    printed = capsys.readouterr().out
    assert f"demo database: {output}" in printed
    assert "1 games, 1 analyzed, 0 deep, 9 notes" in printed
    assert output.is_file()

