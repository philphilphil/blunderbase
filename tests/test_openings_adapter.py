"""The vendored opening book: what it holds, and how a line is named from it."""

from __future__ import annotations

from backend.adapters import openings

# The book's own count at the pinned upstream commit — `scripts/build_openings.py` asserts
# the same number when it rebuilds the table, so the two cannot drift apart quietly.
EXPECTED_OPENINGS = 3810

AFTER_E4 = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"
KINGS_PAWN = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -"

# 1.d4 Nf6 2.c4 e6 3.Nf3 d5 4.Nc3 Bb4 — the Ragozin, and then eight plies past it.
RAGOZIN = ["d2d4", "g8f6", "c2c4", "e7e6", "g1f3", "d7d5", "b1c3", "f8b4"]
DEEPER = RAGOZIN + ["c1g5", "h7h6", "g5h4", "c7c5", "e2e3", "b8c6", "a2a3", "b4c3"]


def epds(ucis: list[str]) -> list[str]:
    import chess

    board = chess.Board()
    positions = [board.epd()]
    for uci in ucis:
        board.push_uci(uci)
        positions.append(board.epd())
    return positions


def test_the_whole_table_reads() -> None:
    book = openings.book()
    assert len(book) == EXPECTED_OPENINGS
    assert all(isinstance(entry.eco, str) and entry.name for entry in book.values())
    # The header is a header, not a row.
    assert "epd" not in book


def test_a_position_the_book_names() -> None:
    named = openings.find(KINGS_PAWN)
    assert named is not None
    assert (named.eco, named.name) == ("C20", "King's Pawn Game")


def test_the_initial_array_is_not_an_opening() -> None:
    assert openings.find(AFTER_E4) is None


def test_a_position_the_book_has_never_heard_of() -> None:
    assert openings.find("8/8/8/4k3/8/8/4K3/8 w - -") is None


def test_the_deepest_named_position_on_a_line_wins() -> None:
    found = openings.deepest(epds(RAGOZIN))
    assert found is not None
    assert (found.index, found.eco) == (8, "D38")
    assert found.name == "Queen's Gambit Declined: Ragozin Defense"


def test_a_line_past_the_book_still_names_its_ancestor() -> None:
    found = openings.deepest(epds(DEEPER))
    assert found is not None
    # Sixteen plies in, named from the eighth — which is the whole point of the helper.
    assert found.index == 8
    assert found.name == "Queen's Gambit Declined: Ragozin Defense"


def test_a_line_the_book_names_nowhere_is_none() -> None:
    assert openings.deepest([AFTER_E4]) is None
    assert openings.deepest([]) is None
