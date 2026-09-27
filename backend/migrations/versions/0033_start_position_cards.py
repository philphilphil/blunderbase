"""the cards of games set up from a position are folded again

A game's stored card (`games.card`) names its worst moments by move number and keeps only
the owner's plies. Both used to be read off ply parity, as if every game began with White's
first move; a game set up from a position — Black to move, or a start at move 20 — got the
opponent's moves as the owner's worst moments, and wrong move numbers on all of them.
`build_card` now numbers from the game's own start, but a card is only rebuilt when the
game's runs change, so the ones already stored would keep the old answer.

This clears the card of every game whose start FEN shifts the numbering — Black to move,
or a fullmove number past 1 — and only those. A chess960 game or a set-up game with White
to move at move 1 was numbered right all along, and a NULL card is not free: `game_card`
folds it live on every list render and the library's "worst" sort, which reads the stored
card, ranks it as a game without a mistake until the next run over it or `blunderbase db
rebuild-cards`. So the few games that were wrong pay that, and nobody else does. The
cards are not refolded here: that is `games.build_card` over the current models, which a
migration cannot rely on staying importable against this revision's schema.

The FEN is read the way `games.start_fen` reads it, and the shift is `games.ply_offset`'s,
both copied rather than imported for the same reason. The downgrade has nothing to put
back.

Revision ID: 0033_start_position_cards
Revises: 0032_import_job_unfinished
Create Date: 2026-09-27 20:00:00.000000

"""

from __future__ import annotations

import re

import sqlalchemy as sa
from alembic import op

revision = "0033_start_position_cards"
down_revision = "0032_import_job_unfinished"
branch_labels = None
depends_on = None

_FEN_HEADER = re.compile(r'^\s*\[FEN\s+"([^"]*)"\s*\]', re.MULTILINE)


def _shifted(pgn: str | None) -> bool:
    """Whether a game from this PGN's start FEN is numbered off ply parity."""
    match = _FEN_HEADER.search(pgn or "")
    if match is None:
        return False
    fields = match.group(1).split()
    if len(fields) > 1 and fields[1].lower() == "b":
        return True
    try:
        return len(fields) > 5 and int(fields[5]) > 1
    except ValueError:
        return False


def upgrade() -> None:
    bind = op.get_bind()
    stale = [
        {"id": row[0]}
        for row in bind.execute(
            sa.text("SELECT id, pgn FROM games WHERE card IS NOT NULL AND pgn LIKE '%[FEN %'")
        )
        if _shifted(row[1])
    ]
    if stale:
        bind.execute(sa.text("UPDATE games SET card = NULL WHERE id = :id"), stale)


def downgrade() -> None:
    pass
