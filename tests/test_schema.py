from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, StatementError
from sqlalchemy.orm import Session, sessionmaker

from backend.db.base import Base
from backend.db.enums import (
    Classification,
    Color,
    EngineKind,
    JobStatus,
    NoteSource,
    Platform,
    Result,
    RunStatus,
    Source,
    Speed,
    Tier,
)
from backend.db.models import (
    Account,
    AnalysisRun,
    Engine,
    Game,
    GamePosition,
    ImportJob,
    Line,
    MoveEval,
    Note,
    Position,
)

PLAYED_AT = datetime(2026, 8, 1, 18, 30, tzinfo=UTC)

EXPECTED_TABLES = {
    "accounts",
    "analysis_runs",
    "app_settings",
    "auth_sessions",
    "credentials",
    "engines",
    "game_positions",
    "games",
    "import_jobs",
    "lines",
    "mcp_keys",
    "move_evals",
    "notes",
    "positions",
    "runners",
}


def seed(session: Session) -> dict[str, int]:
    """One row in every table, wired together the way an import plus a run would leave them."""
    account = Account(platform=Platform.LICHESS, username="owner", display_name="The Owner")
    engine = Engine(
        name="stockfish-17",
        kind=EngineKind.UCI,
        path="/opt/homebrew/bin/stockfish",
        version="17",
        options={"Threads": 2, "Hash": 256},
    )
    session.add_all([account, engine])
    session.flush()

    job = ImportJob(
        source=Source.LICHESS,
        account_id=account.id,
        status=JobStatus.DONE,
        cursor="1754068200000",
        games_seen=1,
        games_imported=1,
        errors=[{"ref": "abcd1234", "error": "unparseable"}],
    )
    position = Position(
        fen="rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3",
        zobrist_key="823c9b50fd114196",
        side_to_move=Color.BLACK,
    )
    session.add_all([job, position])
    session.flush()

    game = Game(
        source=Source.LICHESS,
        source_id="abcd1234",
        dedup_hash="f" * 64,
        white_name="owner",
        black_name="rival",
        white_rating=1780,
        black_rating=1802,
        white_account_id=account.id,
        owner_color=Color.WHITE,
        result=Result.WHITE_WIN,
        termination="Normal",
        rated=True,
        speed=Speed.BLITZ,
        time_control="180+2",
        initial_clock=180,
        increment=2,
        eco="B90",
        opening_name="Sicilian Defense: Najdorf Variation",
        played_at=PLAYED_AT,
        pgn='[Event "Rated blitz game"]\n\n1. e4 c5 1-0\n',
        moves_uci=["e2e4", "c7c5"],
        moves_san=["e4", "c5"],
        clocks=[178.0, 177.5],
        ply_count=2,
        import_job_id=job.id,
    )
    session.add(game)
    session.flush()

    game_position = GamePosition(
        game_id=game.id, ply=1, position_id=position.id, move_uci="c7c5", move_san="c5"
    )
    run = AnalysisRun(
        game_id=game.id,
        engine_id=engine.id,
        tier=Tier.QUICK,
        status=RunStatus.DONE,
        nodes=50_000,
        multipv=1,
        priority=0,
        started_at=PLAYED_AT,
        finished_at=PLAYED_AT,
    )
    session.add_all([game_position, run])
    session.flush()

    move_eval = MoveEval(
        run_id=run.id,
        ply=1,
        position_id=position.id,
        move_uci="c7c5",
        move_san="c5",
        eval_before_cp=28,
        eval_after_cp=-310,
        win_before=53.5,
        win_after=39.1,
        win_loss=14.4,
        classification=Classification.BLUNDER,
        best_move_uci="e7e5",
        best_lines=[{"multipv": 1, "cp": 28, "mate": None, "pv": ["e7e5", "g1f3"]}],
        maia_policy={"1700": [{"uci": "e7e5", "p": 0.31}]},
    )
    line = Line(game_id=game.id, base_ply=1, moves=["g1f3", "d7d6"])
    session.add(line)
    session.flush()
    note = Note(
        text="Keeps playing the Najdorf without the …e5 plan.",
        tags=["opening", "najdorf"],
        game_id=game.id,
        position_id=position.id,
        line_id=line.id,
        ply=2,
        source=NoteSource.MCP,
    )
    session.add_all([move_eval, note])
    session.commit()

    return {
        "account": account.id,
        "engine": engine.id,
        "job": job.id,
        "position": position.id,
        "game": game.id,
        "game_position": game_position.id,
        "run": run.id,
        "move_eval": move_eval.id,
        "line": line.id,
        "note": note.id,
    }


def test_metadata_covers_every_entity() -> None:
    assert set(Base.metadata.tables) == EXPECTED_TABLES


def test_every_table_roundtrips(sessions: sessionmaker[Session]) -> None:
    with sessions() as writer:
        ids = seed(writer)

    with sessions() as reader:
        account = reader.get(Account, ids["account"])
        assert account is not None
        assert account.platform is Platform.LICHESS
        assert account.is_owner is True
        assert account.created_at.tzinfo is UTC

        engine = reader.get(Engine, ids["engine"])
        assert engine is not None
        assert engine.kind is EngineKind.UCI
        assert engine.options == {"Threads": 2, "Hash": 256}
        assert engine.enabled is True

        job = reader.get(ImportJob, ids["job"])
        assert job is not None
        assert job.status is JobStatus.DONE
        assert job.cursor == "1754068200000"
        assert job.errors == [{"ref": "abcd1234", "error": "unparseable"}]
        assert (job.games_imported, job.games_skipped, job.games_failed) == (1, 0, 0)

        position = reader.get(Position, ids["position"])
        assert position is not None
        assert position.side_to_move is Color.BLACK
        assert position.zobrist_key == "823c9b50fd114196"

        game = reader.get(Game, ids["game"])
        assert game is not None
        assert game.source is Source.LICHESS
        assert game.result is Result.WHITE_WIN
        assert game.speed is Speed.BLITZ
        assert game.owner_color is Color.WHITE
        assert game.moves_uci == ["e2e4", "c7c5"]
        assert game.moves_san == ["e4", "c5"]
        assert game.clocks == [178.0, 177.5]
        assert game.variant == "standard"
        assert game.played_at == PLAYED_AT
        assert game.import_job_id == ids["job"]

        game_position = reader.get(GamePosition, ids["game_position"])
        assert game_position is not None
        assert (game_position.ply, game_position.move_san) == (1, "c5")
        assert game_position.position.fen == position.fen

        run = reader.get(AnalysisRun, ids["run"])
        assert run is not None
        assert run.tier is Tier.QUICK
        assert run.status is RunStatus.DONE
        assert (run.nodes, run.multipv, run.attempts, run.priority) == (50_000, 1, 0, 0)

        move_eval = reader.get(MoveEval, ids["move_eval"])
        assert move_eval is not None
        assert move_eval.classification is Classification.BLUNDER
        assert move_eval.best_lines == [
            {"multipv": 1, "cp": 28, "mate": None, "pv": ["e7e5", "g1f3"]}
        ]
        assert move_eval.maia_policy == {"1700": [{"uci": "e7e5", "p": 0.31}]}

        line = reader.get(Line, ids["line"])
        assert line is not None
        assert (line.game_id, line.base_ply) == (game.id, 1)
        assert line.moves == ["g1f3", "d7d6"]
        assert line.created_at.tzinfo is UTC

        note = reader.get(Note, ids["note"])
        assert note is not None
        assert note.tags == ["opening", "najdorf"]
        assert (note.line_id, note.ply) == (ids["line"], 2)
        assert note.source is NoteSource.MCP
        assert note.line is not None and note.line.moves == ["g1f3", "d7d6"]
        assert note.created_at.tzinfo is UTC
        assert note.updated_at.tzinfo is UTC


def test_game_source_id_is_unique_per_source(session: Session) -> None:
    seed(session)
    session.add(
        Game(
            source=Source.LICHESS,
            source_id="abcd1234",
            dedup_hash="e" * 64,
            white_name="owner",
            black_name="other",
            result=Result.DRAW,
            pgn="1. e4 1/2-1/2\n",
        )
    )
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


def test_missing_source_id_does_not_collide(session: Session) -> None:
    for name in ("one", "two"):
        session.add(
            Game(
                source=Source.PGN,
                dedup_hash=name * 8,
                white_name="owner",
                black_name=name,
                result=Result.DRAW,
                pgn="1. e4 1/2-1/2\n",
            )
        )
    session.commit()
    assert len(session.scalars(select(Game)).all()) == 2


def test_unknown_enum_value_is_rejected_in_python(session: Session) -> None:
    """No database constraint spells this; `EnumString` refuses the value on the way in."""
    session.add(
        Game(
            source="telepathy",
            dedup_hash="a" * 64,
            white_name="owner",
            black_name="rival",
            result=Result.DRAW,
            pgn="1. e4 1/2-1/2\n",
        )
    )
    with pytest.raises(StatementError) as caught:
        session.flush()
    assert isinstance(caught.value.orig, ValueError)
    assert "telepathy" in str(caught.value.orig)
    session.rollback()


def test_deleting_a_game_takes_its_analysis_with_it(sessions: sessionmaker[Session]) -> None:
    with sessions() as writer:
        ids = seed(writer)
    with sessions() as writer:
        game = writer.get(Game, ids["game"])
        assert game is not None
        writer.delete(game)
        writer.commit()
    with sessions() as reader:
        assert reader.get(AnalysisRun, ids["run"]) is None
        assert reader.get(MoveEval, ids["move_eval"]) is None
        assert reader.get(GamePosition, ids["game_position"]) is None
        # A line only exists because of its game, so it goes with it.
        assert reader.get(Line, ids["line"]) is None
        # Positions outlive the games that reached them; that is the point of the table.
        assert reader.get(Position, ids["position"]) is not None


def test_a_note_outlives_the_line_it_was_written_about(sessions: sessionmaker[Session]) -> None:
    """Unpinning a variation must not take the thinking that was written about it."""
    with sessions() as writer:
        ids = seed(writer)
        note = writer.get(Note, ids["note"])
        assert note is not None
        # The game would cascade the note away; this is about the line alone.
        note.game_id = None
        line = writer.get(Line, ids["line"])
        assert line is not None
        writer.delete(line)
        writer.commit()

    with sessions() as reader:
        note = reader.get(Note, ids["note"])
        assert note is not None
        assert note.line_id is None
        assert note.ply == 2


def test_the_source_of_a_note_is_validated_in_python(session: Session) -> None:
    session.add(Note(text="from nowhere", source="telepathy"))
    with pytest.raises(StatementError):
        session.flush()
    session.rollback()
