"""A game that does not start from the initial array: chess960, and a game set up from a FEN.

The game view replays, numbers and exports a game from where it really starts. These pin the
backend half of that: the summary carries the start FEN, the move rows are numbered and
coloured from the start's side to move and move number rather than from ply parity, and a
chess960 game's king-takes-rook castling still replays. Standard games are unchanged.
"""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.db.enums import Classification, Platform, Source
from backend.db.models import Account, Game
from backend.mcp import payloads
from backend.services import games as games_service
from backend.services import notes
from backend.services.games import GameFilters
from backend.services.import_service import run_import
from tests.test_query_services import analyse

OWNER = "owner"

# After 1.e4 e5 2.Nf3: Black to move, on move 2.
BLACK_TO_MOVE = "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2"
# A chess960-style start where both sides can castle short at once: king b1, rooks a1/h1.
CHESS960 = "rk5r/pppppppp/8/8/8/8/PPPPPPPP/RK5R w HAha - 0 1"

PGN = f"""[Event "Set up"]
[Site "?"]
[White "someone"]
[Black "{OWNER}"]
[Result "*"]
[SetUp "1"]
[FEN "{BLACK_TO_MOVE}"]

2... Nc6 3. Bb5 a6 *

[Event "Fischer random"]
[Site "?"]
[White "{OWNER}"]
[Black "someone"]
[Result "*"]
[Variant "Chess960"]
[SetUp "1"]
[FEN "{CHESS960}"]

1. O-O O-O 2. d4 *

[Event "Plain"]
[Site "?"]
[White "{OWNER}"]
[Black "someone"]
[Result "*"]

1. e4 e5 2. Nf3 *
"""


def _library(session: Session, tmp_path: Path) -> dict[str, Game]:
    session.add(Account(platform=Platform.LICHESS, username=OWNER, is_owner=True))
    session.commit()
    path = tmp_path / "starts.pgn"
    path.write_text(PGN, encoding="utf-8")
    job = run_import(session, Source.PGN, path=str(path))
    assert job.games_imported == 3, job.errors
    stored = session.scalars(select(Game).order_by(Game.id)).all()
    by_event = {games_service.pgn_headers(game).get("Event"): game for game in stored}
    return by_event


def test_a_game_set_up_with_black_to_move_is_numbered_from_its_start(
    session: Session, tmp_path: Path
) -> None:
    game = _library(session, tmp_path)["Set up"]

    detail = games_service.get_game_detail(session, game.id)
    assert detail is not None
    assert detail["game"]["start_fen"] == BLACK_TO_MOVE
    moves = detail["moves"]
    assert [(m["san"], m["color"], m["move_number"]) for m in moves] == [
        ("Nc6", "black", 2),
        ("Bb5", "white", 3),
        ("a6", "black", 3),
    ]
    # The owner is Black here, and Black's moves are plies 0 and 2 — not 1.
    assert [m["by_owner"] for m in moves] == [True, False, True]


def test_a_standard_game_carries_no_start_and_keeps_its_numbering(
    session: Session, tmp_path: Path
) -> None:
    game = _library(session, tmp_path)["Plain"]

    detail = games_service.get_game_detail(session, game.id)
    assert detail is not None
    assert "start_fen" not in detail["game"]
    assert [(m["color"], m["move_number"]) for m in detail["moves"]] == [
        ("white", 1),
        ("black", 1),
        ("white", 2),
    ]


def test_a_chess960_game_replays_its_castling_from_its_own_start(
    session: Session, tmp_path: Path
) -> None:
    game = _library(session, tmp_path)["Fischer random"]

    assert games_service.start_fen(game) == CHESS960
    # Stored king-takes-rook, as a chess960 game is; the start board has to be chess960 to
    # read it back.
    assert game.moves_uci[:2] == ["b1h1", "b8h8"]
    board = games_service.board_now(game)
    assert board.piece_at(6) is not None and board.piece_at(6).symbol() == "K"  # g1
    assert board.piece_at(5) is not None and board.piece_at(5).symbol() == "R"  # f1
    detail = games_service.get_game_detail(session, game.id)
    assert detail is not None
    assert detail["game"]["variant"] == "chess960"
    assert detail["game"]["start_fen"] == CHESS960


def test_the_assistant_sees_where_a_game_starts(session: Session, tmp_path: Path) -> None:
    game = _library(session, tmp_path)["Set up"]
    summary = games_service.game_summary(game)
    assert payloads.game_row(summary)["start_fen"] == BLACK_TO_MOVE


def test_the_offset_is_stored_on_the_game_when_it_is_imported(
    session: Session, tmp_path: Path
) -> None:
    library = _library(session, tmp_path)
    assert library["Set up"].ply_offset == 3
    assert library["Fischer random"].ply_offset == 0
    assert library["Plain"].ply_offset == 0


def test_has_blunders_counts_the_owners_moves_of_a_game_set_up_with_black_to_move(
    session: Session, tmp_path: Path
) -> None:
    """The owner is Black and Black moves first, so ply 1 (Bb5) is the opponent's."""
    game = _library(session, tmp_path)["Set up"]
    blunders = GameFilters(has_blunders=True)

    analyse(session, game, [{"ply": 1, "classification": Classification.BLUNDER}])
    assert games_service.search_games(session, blunders) == []

    analyse(session, game, [{"ply": 0, "classification": Classification.BLUNDER}], priority=5)
    assert [found.id for found in games_service.search_games(session, blunders)] == [game.id]


def test_a_note_on_a_game_set_up_with_black_to_move_is_labelled_from_its_start(
    session: Session, tmp_path: Path
) -> None:
    game = _library(session, tmp_path)["Set up"]
    # Ply 1 is the position after Black's first move, 2... Nc6.
    move = notes.move_context(game, 1)
    assert move is not None
    assert (move["label"], move["color"]) == ("2... Nc6", "black")


def test_ply_offset_reads_side_to_move_and_move_number() -> None:
    assert games_service.ply_offset(None) == 0
    assert games_service.ply_offset(CHESS960) == 0
    assert games_service.ply_offset(BLACK_TO_MOVE) == 3
    assert games_service.ply_offset("8/8/8/8/8/8/8/K1k5 w - - 0 30") == 58


def test_a_castle_spelled_king_takes_rook_folds_into_the_engine_spelling(
    session: Session, tmp_path: Path
) -> None:
    game = _library(session, tmp_path)["Plain"]
    # After 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6, White can castle: three plies of the game, then a
    # line the reader walked.
    walk = ["b8c6", "f1c4", "g8f6"]
    engine = notes.save_line(session, game_id=game.id, base_ply=3, moves=[*walk, "e1g1"])
    # An older browser spelled the same castle king-takes-rook and must not get a second row.
    browser = notes.save_line(session, game_id=game.id, base_ply=3, moves=[*walk, "e1h1"])
    assert browser.id == engine.id
    assert notes.line_payload(session, engine)["moves"][-1] == "e1g1"

    # A row already stored the old way reads back in the engine's spelling, and a longer
    # line in the new spelling extends it instead of starting a new one.
    engine.moves = [*walk, "e1h1"]
    session.commit()
    assert notes.line_payload(session, engine)["moves"][-1] == "e1g1"
    longer = notes.save_line(
        session, game_id=game.id, base_ply=3, moves=[*walk, "e1g1", "f8c5"]
    )
    assert longer.id == engine.id
    assert list(longer.moves) == [*walk, "e1g1", "f8c5"]


def test_chess960_is_said_by_variant_or_by_castling_rights_only_960_can_have(
    session: Session, tmp_path: Path
) -> None:
    """The flag the web replays by, decided the way `start_board` replays the game."""
    library = _library(session, tmp_path)
    assert games_service.game_summary(library["Fischer random"])["chess960"] is True
    assert "chess960" not in games_service.game_summary(library["Set up"])
    assert "chess960" not in games_service.game_summary(library["Plain"])

    # A "from position" game with its rooks off the corners: standard by name, chess960 by
    # its castling rights — and `start_board` replays it as chess960, so the flag agrees.
    fen = "1r2k1r1/pppppppp/8/8/8/8/PPPPPPPP/1R2K1R1 w KQkq - 0 1"
    set_up = Game(variant="standard", pgn=f'[SetUp "1"]\n[FEN "{fen}"]\n\n*')
    assert games_service.is_chess960(set_up) is True
    assert games_service.start_board(set_up).chess960 is True
    assert games_service.is_chess960(Game(variant="standard", pgn='[FEN "not a fen"]')) is False
