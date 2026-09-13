"""games: whether the engine's verdict is held back until the owner asks for it

`games.engine_hidden`, off for every game already stored — those games showed their
evaluations the moment a pass finished, and keep doing so. A game imported while the
`hide_engine_new_games` setting is on arrives with it set, and "Show the engine" on the
game clears it.

Revision ID: 0027_games_engine_hidden
Revises: 0026_correspondence_no_days_per_move
Create Date: 2026-09-13 10:00:00.000000

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0027_games_engine_hidden"
down_revision = "0026_correspondence_no_days_per_move"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("games") as batch:
        batch.add_column(
            sa.Column(
                "engine_hidden", sa.Boolean(), nullable=False, server_default=sa.false()
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("games") as batch:
        batch.drop_column("engine_hidden")
