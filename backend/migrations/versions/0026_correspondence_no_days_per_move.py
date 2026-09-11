"""correspondence games: the deadline is the owner's, not computed

`correspondence_games` loses `days_per_move`. The column fed a guess — "your move is due
now plus n days" — that no correspondence server's clock actually works like (ICCF banks
days and adds increments per move), and a wrong deadline sorts the list and the task queue
wrongly. `reply_due` stays: what the owner types off the server's page.

Revision ID: 0026_correspondence_no_days_per_move
Revises: 0025_correspondence_collapsed
Create Date: 2026-09-11 22:00:00.000000

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0026_correspondence_no_days_per_move"
down_revision = "0025_correspondence_collapsed"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("correspondence_games", schema=None) as batch_op:
        batch_op.drop_column("days_per_move")


def downgrade() -> None:
    op.add_column(
        "correspondence_games",
        sa.Column("days_per_move", sa.Integer(), nullable=False, server_default="10"),
    )
