from __future__ import annotations

import io
from pathlib import Path

from backend.adapters import pgn_import
from backend.db.enums import Result, Source, Speed
from backend.services.import_service import ImportFailure, ParsedGame

CRAZYHOUSE = """[Event "Rated Crazyhouse game"]
[Site "https://lichess.org/cccc1111"]
[White "blunderbase"]
[Black "opponent5"]
[Result "1-0"]
[Variant "Crazyhouse"]

1. e4 e5 1-0
"""

NO_DATE = """[Event "Club night"]
[Site "Hamburg"]
[Date "????.??.??"]
[White "Baum, P."]
[Black "Gast, G."]
[Result "1/2-1/2"]

1. c4 e5 1/2-1/2
"""


def _games(path: Path) -> list[ParsedGame | ImportFailure]:
    return list(pgn_import.parse_file(path))


def test_a_multi_game_file_yields_every_game_in_order(fixtures_dir: Path) -> None:
    items = _games(fixtures_dir / "multi_game.pgn")
    assert len(items) == 4
    assert [isinstance(item, ImportFailure) for item in items] == [False, False, True, False]


def test_metadata_comes_off_the_headers(fixtures_dir: Path) -> None:
    game = _games(fixtures_dir / "multi_game.pgn")[0]
    assert isinstance(game, ParsedGame)
    assert game.source is Source.PGN
    assert game.source_id == "abcd1234"
    assert (game.white_name, game.black_name) == ("blunderbase", "opponent1")
    assert (game.white_rating, game.black_rating) == (1712, 1688)
    assert game.result is Result.WHITE_WIN
    assert game.termination == "Normal"
    assert game.rated is True
    assert game.speed is Speed.BLITZ
    assert (game.time_control, game.initial_clock, game.increment) == ("300+3", 300, 3)
    assert game.eco == "C50"
    assert game.opening_name.startswith("Italian Game")
    assert game.played_at is not None
    assert game.played_at.isoformat() == "2026-02-10T18:04:11+00:00"
    assert game.variant == "standard"
    assert game.initial_fen is None
    assert len(game.moves_uci) == len(game.moves_san) == 15
    assert game.moves_uci[:4] == ["e2e4", "e7e5", "g1f3", "b8c6"]
    assert game.moves_san[:4] == ["e4", "e5", "Nf3", "Nc6"]
    assert game.pgn.startswith("[Event ")


def test_clock_comments_become_a_seconds_list(fixtures_dir: Path) -> None:
    game = _games(fixtures_dir / "multi_game.pgn")[0]
    assert isinstance(game, ParsedGame)
    assert game.clocks is not None
    assert len(game.clocks) == len(game.moves_uci)
    assert game.clocks[:4] == [300.0, 300.0, 298.0, 297.0]


def test_a_game_without_clock_comments_stores_no_clocks(fixtures_dir: Path) -> None:
    game = _games(fixtures_dir / "multi_game.pgn")[1]
    assert isinstance(game, ParsedGame)
    assert game.clocks is None
    assert game.source_id == "98765432"
    assert game.speed is Speed.RAPID
    assert game.rated is None


def test_a_malformed_game_is_recorded_and_the_file_keeps_going(fixtures_dir: Path) -> None:
    items = _games(fixtures_dir / "multi_game.pgn")
    failure = items[2]
    assert isinstance(failure, ImportFailure)
    assert "someone vs blunderbase" in failure.ref
    assert "Qxf7" in failure.error
    assert isinstance(items[3], ParsedGame)


def test_chess960_keeps_its_start_position_and_variant(fixtures_dir: Path) -> None:
    game = _games(fixtures_dir / "chess960.pgn")[0]
    assert isinstance(game, ParsedGame)
    assert game.variant == "chess960"
    assert game.initial_fen is not None
    assert game.initial_fen.startswith("bqnbnrkr/pppppppp")
    assert game.moves_uci[:4] == ["e2e4", "e7e5", "e1f3", "e8f6"]


def test_an_unsupported_variant_is_a_failure_not_a_crash() -> None:
    items = list(pgn_import.parse_stream(io.StringIO(CRAZYHOUSE)))
    assert len(items) == 1
    assert isinstance(items[0], ImportFailure)
    assert "crazyhouse" in items[0].error


def test_an_unknown_date_leaves_played_at_empty() -> None:
    items = list(pgn_import.parse_stream(io.StringIO(NO_DATE)))
    game = items[0]
    assert isinstance(game, ParsedGame)
    assert game.played_at is None
    assert game.speed is None
    assert game.source_id is None


def test_the_limit_stops_reading_early(fixtures_dir: Path) -> None:
    items = list(pgn_import.parse_file(fixtures_dir / "multi_game.pgn", limit=2))
    assert len(items) == 2


def test_a_time_control_that_is_not_a_clock_stays_unparsed() -> None:
    assert pgn_import._time_control("-") == (None, None)
    assert pgn_import._time_control("40/9000:1800") == (None, None)
    assert pgn_import._time_control("600") == (600, 0)
    assert pgn_import._time_control("180+2") == (180, 2)
