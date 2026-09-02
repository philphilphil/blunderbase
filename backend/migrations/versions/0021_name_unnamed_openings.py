"""name the games no source named

A game whose source says nothing about its opening — a PGN without ECO tags, a game from
the masters archive — used to be stored with no ECO and no name, and the library showed
"Unknown opening" for it. The importer now names such a game from the vendored book
(`adapters.openings`, the deepest position on its line the book knows, the rule the
explorer names positions by). This does the same once for the games already stored.

Only games with neither an ECO nor a name are touched: a source that named the game is
believed as it was. The line is read from `game_positions`, which every stored game has.

Revision ID: 0021_name_unnamed_openings
Revises: 0020_reference_games
Create Date: 2026-09-02 10:00:00.000000

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

from backend.adapters import openings

revision = "0021_name_unnamed_openings"
down_revision = "0020_reference_games"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    unnamed = [
        row[0]
        for row in bind.execute(
            sa.text("SELECT id FROM games WHERE eco IS NULL AND opening_name IS NULL")
        )
    ]
    if not unnamed:
        return
    line = sa.text(
        "SELECT positions.fen FROM game_positions JOIN positions "
        "ON positions.id = game_positions.position_id "
        "WHERE game_positions.game_id = :game_id ORDER BY game_positions.ply"
    )
    name = sa.text("UPDATE games SET eco = :eco, opening_name = :name WHERE id = :game_id")
    for game_id in unnamed:
        epds = [row[0] for row in bind.execute(line, {"game_id": game_id})]
        found = openings.deepest(epds)
        if found is not None:
            bind.execute(name, {"eco": found.eco, "name": found.name, "game_id": game_id})


def downgrade() -> None:
    # The names are what the importer would give the same games now; nothing to undo.
    pass
