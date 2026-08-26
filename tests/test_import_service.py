from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.db.enums import (
    Color,
    EngineKind,
    JobStatus,
    Platform,
    Result,
    RunStatus,
    Source,
    Tier,
)
from backend.db.models import (
    Account,
    AnalysisRun,
    Engine,
    Game,
    GamePosition,
    ImportJob,
    Position,
)
from backend.services import import_service
from backend.services.import_service import ImportFailure, ParsedGame

START_EPD = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"

FIRST_GAME_UCI = [
    "e2e4",
    "e7e5",
    "g1f3",
    "b8c6",
    "f1c4",
    "g8f6",
    "f3g5",
    "d7d5",
    "e4d5",
    "f6d5",
    "g5f7",
    "e8f7",
    "d1f3",
    "f7e6",
    "b1c3",
]


def _multi_game(fixtures_dir: Path) -> str:
    return str(fixtures_dir / "multi_game.pgn")


def _count(session: Session, model: Any) -> int:
    return session.scalar(select(func.count()).select_from(model))


def _add_engine(session: Session, **changes: Any) -> Engine:
    engine = Engine(
        name=changes.pop("name", "Stockfish"),
        kind=changes.pop("kind", EngineKind.UCI),
        path="/opt/homebrew/bin/stockfish",
        default_tier=changes.pop("default_tier", Tier.QUICK),
        enabled=changes.pop("enabled", True),
        **changes,
    )
    session.add(engine)
    session.commit()
    return engine


def _owner(session: Session, platform: Platform = Platform.LICHESS) -> Account:
    account = Account(platform=platform, username="Blunderbase", is_owner=True)
    session.add(account)
    session.commit()
    return account


def test_a_pgn_file_imports_every_readable_game(session: Session, fixtures_dir: Path) -> None:
    job = import_service.run_import(session, "pgn", path=_multi_game(fixtures_dir))

    assert job.status is JobStatus.DONE
    assert (job.games_seen, job.games_imported, job.games_skipped, job.games_failed) == (4, 3, 0, 1)
    assert job.started_at is not None and job.finished_at is not None
    assert _count(session, Game) == 3
    assert {game.source for game in session.scalars(select(Game))} == {Source.PGN}
    assert all(game.import_job_id == job.id for game in session.scalars(select(Game)))


def test_a_bad_game_is_recorded_on_the_job_and_never_aborts_the_sync(
    session: Session, fixtures_dir: Path
) -> None:
    job = import_service.run_import(session, "pgn", path=_multi_game(fixtures_dir))

    assert len(job.errors) == 1
    (error,) = job.errors
    assert "someone vs blunderbase" in error["ref"]
    assert "Qxf7" in error["error"]
    # The game after the broken one is still there.
    assert session.scalars(select(Game).where(Game.black_name == "opponent3")).one()


def test_a_stored_game_keeps_its_metadata(session: Session, fixtures_dir: Path) -> None:
    import_service.run_import(session, "pgn", path=_multi_game(fixtures_dir))

    game = session.scalars(select(Game).where(Game.source_id == "abcd1234")).one()
    assert game.result is Result.WHITE_WIN
    assert game.ply_count == 15
    assert game.moves_uci == FIRST_GAME_UCI
    assert game.moves_san[:3] == ["e4", "e5", "Nf3"]
    assert game.clocks is not None and game.clocks[0] == 300.0
    assert game.played_at == datetime(2026, 2, 10, 18, 4, 11, tzinfo=UTC)
    assert game.eco == "C50"
    assert game.dedup_hash


def test_positions_are_one_row_per_ply_plus_the_final_one(
    session: Session, fixtures_dir: Path
) -> None:
    import_service.run_import(session, "pgn", path=_multi_game(fixtures_dir))

    game = session.scalars(select(Game).where(Game.source_id == "abcd1234")).one()
    rows = list(session.scalars(select(GamePosition).where(GamePosition.game_id == game.id)))
    assert len(rows) == game.ply_count + 1
    assert [row.ply for row in rows] == list(range(game.ply_count + 1))
    assert rows[0].move_uci == "e2e4"
    assert rows[0].move_san == "e4"
    assert rows[-1].move_uci is None and rows[-1].move_san is None


def test_positions_are_shared_between_games(session: Session, fixtures_dir: Path) -> None:
    import_service.run_import(session, "pgn", path=_multi_game(fixtures_dir))

    start = session.scalars(select(Position).where(Position.fen == START_EPD)).one()
    holders = session.scalars(
        select(GamePosition.game_id).where(GamePosition.position_id == start.id)
    ).all()
    assert len(set(holders)) == 3
    assert start.side_to_move is Color.WHITE
    # Every game reached e4-e5-Nf3-Nc6 or d4-Nf6-Nf3-d5, so the two openings never merge,
    # but the total stays below one row per ply per game.
    assert _count(session, Position) < _count(session, GamePosition)


def test_the_position_key_drops_the_move_counters(session: Session) -> None:
    rows = import_service.position_rows(
        ParsedGame(
            source=Source.PGN,
            white_name="a",
            black_name="b",
            result=Result.UNKNOWN,
            pgn="",
            moves_uci=["e2e4"],
            moves_san=["e4"],
        )
    )
    assert rows[0][0] == START_EPD
    assert len(rows[0][1]) == 16
    assert rows[1][0].startswith("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq")


def test_the_same_file_twice_imports_nothing_new(session: Session, fixtures_dir: Path) -> None:
    first = import_service.run_import(session, "pgn", path=_multi_game(fixtures_dir))
    positions = _count(session, Position)
    second = import_service.run_import(session, "pgn", path=_multi_game(fixtures_dir))

    assert (first.games_imported, second.games_imported) == (3, 0)
    assert second.games_skipped == 3
    assert second.games_failed == 1
    assert _count(session, Game) == 3
    assert _count(session, Position) == positions


def test_the_same_game_from_two_sources_is_stored_once(
    session: Session, fixtures_dir: Path
) -> None:
    job = ImportJob(source=Source.LICHESS, status=JobStatus.RUNNING)
    session.add(job)
    session.commit()
    import_service.ingest_game(
        session,
        job,
        ParsedGame(
            source=Source.LICHESS,
            source_id="abcd1234",
            white_name="blunderbase",
            black_name="opponent1",
            result=Result.WHITE_WIN,
            pgn="from the API",
            moves_uci=FIRST_GAME_UCI,
            moves_san=[],
            played_at=datetime(2026, 2, 10, 18, 4, 11, tzinfo=UTC),
        ),
    )
    session.commit()

    second = import_service.run_import(session, "pgn", path=_multi_game(fixtures_dir))

    assert second.games_imported == 2
    assert second.games_skipped == 1
    assert _count(session, Game) == 3
    assert session.scalars(select(Game).where(Game.source_id == "abcd1234")).one().source is (
        Source.LICHESS
    )


def test_a_rematch_with_the_same_moves_is_still_two_games(session: Session) -> None:
    """Two bullet games of one trap line against one opponent on one day share every
    scrap of the dedup hash. Lichess named them separately, so they are two games."""
    job = ImportJob(source=Source.LICHESS, status=JobStatus.RUNNING)
    session.add(job)
    session.commit()
    played = datetime(2026, 2, 10, 18, 4, 11, tzinfo=UTC)

    def rematch(source_id: str) -> ParsedGame:
        return ParsedGame(
            source=Source.LICHESS,
            source_id=source_id,
            white_name="blunderbase",
            black_name="opponent1",
            result=Result.WHITE_WIN,
            pgn="from the API",
            moves_uci=["e2e4", "e7e5"],
            moves_san=["e4", "e5"],
            played_at=played,
        )

    first = import_service.ingest_game(session, job, rematch("zzFirst"))
    session.commit()
    second = import_service.ingest_game(session, job, rematch("zzSecond"))
    session.commit()

    assert (first.created, second.created) == (True, True)
    assert first.game.dedup_hash == second.game.dedup_hash
    assert _count(session, Game) == 2


def test_a_source_id_dedups_even_when_the_moves_differ(session: Session) -> None:
    job = ImportJob(source=Source.LICHESS, status=JobStatus.RUNNING)
    session.add(job)
    session.commit()
    parsed = ParsedGame(
        source=Source.LICHESS,
        source_id="abcd1234",
        white_name="blunderbase",
        black_name="opponent1",
        result=Result.WHITE_WIN,
        pgn="",
        moves_uci=["e2e4"],
        moves_san=["e4"],
    )
    assert import_service.ingest_game(session, job, parsed).created is True
    session.commit()

    parsed.moves_uci = ["d2d4"]
    parsed.moves_san = ["d4"]
    assert import_service.ingest_game(session, job, parsed).created is False
    assert _count(session, Game) == 1


def test_owner_colour_comes_from_the_accounts(session: Session, fixtures_dir: Path) -> None:
    _owner(session)
    account = session.scalars(select(Account)).one()

    import_service.run_import(session, "pgn", path=_multi_game(fixtures_dir))

    white = session.scalars(select(Game).where(Game.source_id == "abcd1234")).one()
    black = session.scalars(select(Game).where(Game.source_id == "98765432")).one()
    assert white.owner_color is Color.WHITE
    assert white.white_account_id == account.id
    assert black.owner_color is Color.BLACK
    assert black.black_account_id == account.id


def test_without_an_account_the_owner_colour_stays_unknown(
    session: Session, fixtures_dir: Path
) -> None:
    import_service.run_import(session, "pgn", path=_multi_game(fixtures_dir))

    games = list(session.scalars(select(Game)))
    assert all(game.owner_color is None for game in games)
    assert all(game.white_account_id is None and game.black_account_id is None for game in games)


def test_an_account_on_another_platform_does_not_claim_a_platform_game(session: Session) -> None:
    session.add(Account(platform=Platform.CHESSCOM, username="blunderbase", is_owner=True))
    session.commit()
    index = import_service.AccountIndex.load(session)

    assert index.match(Source.LICHESS, "blunderbase") == (None, False)
    assert index.match(Source.PGN, "blunderbase")[1] is True
    assert index.match(Source.CHESSCOM, "blunderbase")[1] is True
    assert index.match(Source.PGN, "  BLUNDERBASE ")[1] is True
    assert index.match(Source.PGN, "") == (None, False)


def test_an_import_enqueues_a_quick_run_per_game(session: Session, fixtures_dir: Path) -> None:
    engine = _add_engine(session)

    import_service.run_import(session, "pgn", path=_multi_game(fixtures_dir))

    runs = list(session.scalars(select(AnalysisRun)))
    assert len(runs) == 3
    assert {run.status for run in runs} == {RunStatus.QUEUED}
    assert {run.tier for run in runs} == {Tier.QUICK}
    assert {run.engine_id for run in runs} == {engine.id}
    assert {run.priority for run in runs} == {import_service.QUICK_PRIORITY}


def test_an_enabled_uci_engine_stands_in_when_no_tier_default_is_set(
    session: Session, fixtures_dir: Path
) -> None:
    engine = _add_engine(session, default_tier=None)

    import_service.run_import(session, "pgn", path=_multi_game(fixtures_dir))

    assert {run.engine_id for run in session.scalars(select(AnalysisRun))} == {engine.id}


def test_no_enabled_engine_means_no_run_and_a_clean_import(
    session: Session, fixtures_dir: Path
) -> None:
    _add_engine(session, enabled=False)

    job = import_service.run_import(session, "pgn", path=_multi_game(fixtures_dir))

    assert job.status is JobStatus.DONE
    assert job.games_imported == 3
    assert _count(session, AnalysisRun) == 0


def test_a_maia_engine_is_never_the_quick_stand_in(session: Session) -> None:
    _add_engine(session, name="Maia 1700", kind=EngineKind.MAIA, default_tier=None)
    assert import_service.quick_tier_engine(session) is None


def test_progress_events_report_every_game_and_the_end(
    session: Session, fixtures_dir: Path
) -> None:
    events: list[dict[str, Any]] = []
    job = import_service.run_import(
        session, "pgn", path=_multi_game(fixtures_dir), progress=events.append
    )

    kinds = [event["event"] for event in events]
    assert kinds[0] == import_service.EVENT_IMPORT_STARTED
    assert kinds[-1] == import_service.EVENT_IMPORT_FINISHED
    assert kinds.count(import_service.EVENT_IMPORT_GAME) == 4
    assert all(event["job_id"] == job.id for event in events)
    assert all(event["source"] == "pgn" for event in events)

    games = [event for event in events if event["event"] == import_service.EVENT_IMPORT_GAME]
    assert [event["status"] for event in games] == ["imported", "imported", "failed", "imported"]
    assert games[0]["game_id"] is not None
    assert games[2]["game_id"] is None and "Qxf7" in games[2]["error"]
    assert games[-1]["seen"] == 4
    assert events[-1]["status"] == "done"
    assert events[-1]["imported"] == 3


def test_a_progress_subscriber_that_raises_cannot_abort_a_sync(
    session: Session, fixtures_dir: Path
) -> None:
    def explode(event: dict[str, Any]) -> None:
        raise RuntimeError("the websocket went away")

    job = import_service.run_import(
        session, "pgn", path=_multi_game(fixtures_dir), progress=explode
    )

    assert job.status is JobStatus.DONE
    assert job.games_imported == 3


def test_an_adapter_level_error_fails_the_job_without_losing_it(session: Session) -> None:
    job = import_service.run_import(session, "pgn", path="/nowhere/at/all.pgn")

    assert job.status is JobStatus.FAILED
    assert "FileNotFoundError" in job.message
    assert session.get(ImportJob, job.id) is job
    assert _count(session, Game) == 0


def test_a_game_the_pipeline_cannot_replay_is_a_per_game_failure(session: Session) -> None:
    job = ImportJob(source=Source.PGN, status=JobStatus.RUNNING)
    session.add(job)
    session.commit()
    broken = ParsedGame(
        source=Source.PGN,
        white_name="a",
        black_name="b",
        result=Result.UNKNOWN,
        pgn="",
        moves_uci=["e2e4", "e2e4"],
        moves_san=["e4", "e4"],
    )
    good = ParsedGame(
        source=Source.PGN,
        white_name="c",
        black_name="d",
        result=Result.UNKNOWN,
        pgn="",
        moves_uci=["d2d4"],
        moves_san=["d4"],
    )

    result = import_service.ingest_games(session, job, [broken, good])

    assert (result.seen, result.imported, result.failed) == (2, 1, 1)
    assert result.errors[0]["ref"] == "a vs b"
    assert _count(session, Game) == 1


def test_an_adapter_failure_item_lands_in_the_errors(session: Session) -> None:
    job = ImportJob(source=Source.PGN, status=JobStatus.RUNNING)
    session.add(job)
    session.commit()

    result = import_service.ingest_games(session, job, [ImportFailure(ref="game 7", error="nope")])

    assert result.failed == 1
    assert job.errors == [{"ref": "game 7", "error": "nope"}]


def test_chess960_replays_from_its_own_start_position(
    session: Session, fixtures_dir: Path
) -> None:
    job = import_service.run_import(session, "pgn", path=str(fixtures_dir / "chess960.pgn"))

    assert job.games_imported == 1
    game = session.scalars(select(Game)).one()
    assert game.variant == "chess960"
    assert game.ply_count == 7
    assert _count(session, GamePosition) == 8
    first = session.scalars(
        select(Position).join(GamePosition).where(GamePosition.ply == 0)
    ).one()
    assert first.fen.startswith("bqnbnrkr/pppppppp")


def test_jobs_are_listed_newest_first_and_findable(session: Session, fixtures_dir: Path) -> None:
    first = import_service.run_import(session, "pgn", path=_multi_game(fixtures_dir))
    second = import_service.run_import(session, "pgn", path=_multi_game(fixtures_dir))

    jobs = import_service.list_jobs(session)
    assert [job.id for job in jobs] == [second.id, first.id]
    assert import_service.list_jobs(session, source="lichess") == []
    assert import_service.get_job(session, first.id) is first
    assert import_service.get_job(session, 9999) is None


def test_the_latest_cursor_is_the_last_successful_sync(session: Session) -> None:
    assert import_service.latest_cursor(session, "lichess") is None
    session.add_all(
        [
            ImportJob(source=Source.LICHESS, status=JobStatus.DONE, cursor="100"),
            ImportJob(source=Source.LICHESS, status=JobStatus.DONE, cursor="200"),
            ImportJob(source=Source.LICHESS, status=JobStatus.FAILED, cursor="300"),
        ]
    )
    session.commit()

    assert import_service.latest_cursor(session, "lichess") == "200"


def test_an_unregistered_source_raises_before_a_job_is_created(session: Session) -> None:
    with pytest.raises(import_service.UnknownSourceError):
        import_service.run_import(session, "telepathy")
    assert _count(session, ImportJob) == 0
