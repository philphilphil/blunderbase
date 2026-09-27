from __future__ import annotations

import codecs
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
    # The Elo tags say what the players brought; the RatingDiff tags what the game did.
    assert (game.white_rating, game.black_rating) == (1720, 1681)
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


# ChessBase's charset, and the PGN standard's: "ü" and "é" are one byte each, which UTF-8
# does not accept.
ACCENTED = """[Event "Bundesliga"]
[Site "Köln"]
[White "Müller, Hans"]
[Black "Pérez, José"]
[Result "1-0"]

1. e4 e5 {Schöner Zug} 1-0
"""


def _names(path: Path) -> tuple[str | None, str | None]:
    (game,) = _games(path)
    assert isinstance(game, ParsedGame)
    return game.white_name, game.black_name


def test_a_windows_1252_file_keeps_its_accented_names(tmp_path: Path) -> None:
    path = tmp_path / "chessbase.pgn"
    path.write_bytes(ACCENTED.encode("cp1252"))
    assert _names(path) == ("Müller, Hans", "Pérez, José")
    (game,) = _games(path)
    assert isinstance(game, ParsedGame)
    assert "�" not in (game.pgn or "")
    assert "Köln" in (game.pgn or "")


def test_a_utf8_file_is_read_as_utf8(tmp_path: Path) -> None:
    path = tmp_path / "lichess.pgn"
    path.write_bytes(ACCENTED.encode("utf-8"))
    assert _names(path) == ("Müller, Hans", "Pérez, José")


def test_a_utf8_file_with_a_byte_order_mark_is_read_as_utf8(tmp_path: Path) -> None:
    path = tmp_path / "bom.pgn"
    path.write_bytes(ACCENTED.encode("utf-8-sig"))
    assert _names(path) == ("Müller, Hans", "Pérez, José")


def test_a_utf8_file_invalid_only_near_its_end_still_falls_back(tmp_path: Path) -> None:
    """The check reads the whole file, not a sniffed prefix: a Latin-1 name in the last game
    of a long archive decides the charset as much as one in the first."""
    padding = NO_DATE + "\n" * (pgn_import.CHUNK + 1)
    path = tmp_path / "long.pgn"
    path.write_bytes(padding.encode("ascii") + ACCENTED.encode("cp1252"))
    items = _games(path)
    assert len(items) == 2
    last = items[-1]
    assert isinstance(last, ParsedGame)
    assert last.white_name == "Müller, Hans"


# A BOM (Notepad's UTF-8 default) in front of Windows-1252 bytes, as when a ChessBase game
# is pasted into such a file: not valid UTF-8, so it falls back, and the BOM must not end up
# as "ï»¿" before the first tag, where it would cost that game its headers.
BOM_THEN_CP1252 = codecs.BOM_UTF8 + ACCENTED.encode("cp1252")


def test_a_bom_file_that_falls_back_keeps_its_first_games_headers(tmp_path: Path) -> None:
    path = tmp_path / "mixed.pgn"
    path.write_bytes(BOM_THEN_CP1252)
    assert _names(path) == ("Müller, Hans", "Pérez, José")


def test_decode_pgn_drops_a_bom_before_the_windows_1252_fallback() -> None:
    text = pgn_import.decode_pgn(BOM_THEN_CP1252)
    assert text.startswith('[Event "Bundesliga"]')
    (game,) = list(pgn_import.parse_stream(io.StringIO(text)))
    assert isinstance(game, ParsedGame)
    assert game.white_name == "Müller, Hans"


# A UTF-8 archive with one ChessBase game appended (`cat a.pgn b.pgn`): the one stray
# Windows-1252 line must not turn every UTF-8 name before it into "MÃ¼ller".
MIXED = ACCENTED.encode("utf-8") + b"\n" + ACCENTED.replace("Müller", "Jürgen").encode("cp1252")


def test_decode_pgn_falls_back_line_by_line_in_a_mixed_file() -> None:
    text = pgn_import.decode_pgn(MIXED)
    assert "Müller, Hans" in text
    assert "Jürgen, Hans" in text
    assert "Ã" not in text


def test_a_mixed_file_keeps_the_names_of_both_charsets(tmp_path: Path) -> None:
    path = tmp_path / "mixed.pgn"
    path.write_bytes(codecs.BOM_UTF8 + MIXED)
    names = [item.white_name for item in _games(path) if isinstance(item, ParsedGame)]
    assert names == ["Müller, Hans", "Jürgen, Hans"]


def test_decode_pgn_reads_strict_utf8_and_falls_back_to_windows_1252() -> None:
    assert pgn_import.decode_pgn(ACCENTED.encode("cp1252")) == ACCENTED
    assert pgn_import.decode_pgn(ACCENTED.encode("utf-8")) == ACCENTED
    assert pgn_import.decode_pgn(ACCENTED.encode("utf-8-sig")) == ACCENTED
    # Windows-1252 beyond Latin-1 (the euro sign), and a byte it leaves undefined, which
    # decodes to its own code point the way the browser's decoder reads it.
    assert pgn_import.decode_pgn(b"\x80 \x81 \xfc") == "€ \x81 ü"
