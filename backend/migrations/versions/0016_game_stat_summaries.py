"""precomputed per-game stat summaries

Every stats dimension was a scan of every analysed ply of every game — 194k rows on a
9.5k-game library, seconds per answer, and the same seconds again for the next filter. A
game's contribution to those aggregations only changes when a run finishes over it, so it
is written down then: `stat_summary` is the fold, and the three scalars beside it are what
a query wants without opening the JSON. The index is for the worst-moments ranking.

Nothing is backfilled here. The columns arrive NULL over an existing library and the
scan stays as the fallback until the sweep (`blunderbase db rebuild-stats`, and the one
the server starts for itself) has been over it.

Revision ID: 0016_game_stat_summaries
Revises: 0015_queue_claim_index
Create Date: 2026-08-30 09:00:00.000000

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0016_game_stat_summaries"
down_revision = "0015_queue_claim_index"
branch_labels = None
depends_on = None

INDEX = "ix_games_stat_worst_win_loss"
COLUMNS = ("stat_summary", "stat_owner_moves", "stat_blunders", "stat_worst_win_loss")


def upgrade() -> None:
    with op.batch_alter_table("games", schema=None) as batch_op:
        batch_op.add_column(sa.Column("stat_summary", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("stat_owner_moves", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("stat_blunders", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("stat_worst_win_loss", sa.Float(), nullable=True))
        batch_op.create_index(INDEX, ["stat_worst_win_loss"])


def downgrade() -> None:
    with op.batch_alter_table("games", schema=None) as batch_op:
        batch_op.drop_index(INDEX)
        for column in COLUMNS:
            batch_op.drop_column(column)
