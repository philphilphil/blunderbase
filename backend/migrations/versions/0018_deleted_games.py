"""remember deleted games so an import cannot bring them back

Deleting a game deleted the only record of it, and the importer deduplicates by looking in
`games` — so the next sync stored it again as a new game. chess.com re-reads the month that
is still being played on every sync, which made that the ordinary case rather than a corner
one. `deleted_games` is the tombstone the importer checks beside its duplicate lookup, and
`import_jobs.games_blocked` is how a run says how many games it left alone for that reason.

Nothing is backfilled: games deleted before this existed were not written down and cannot
be. The table starts empty and fills from the next delete on.

Revision ID: 0018_deleted_games
Revises: 0017_explorer_book
Create Date: 2026-09-01 11:00:00.000000

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0018_deleted_games"
down_revision = "0017_explorer_book"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "deleted_games",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("source_id", sa.String(length=64), nullable=True),
        sa.Column("dedup_hash", sa.String(length=64), nullable=False),
        sa.Column("white_name", sa.String(length=128), nullable=False),
        sa.Column("black_name", sa.String(length=128), nullable=False),
        sa.Column("played_at", sa.DateTime(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_deleted_games_dedup_hash", "deleted_games", ["dedup_hash"])
    op.create_index(
        "ix_deleted_games_source_source_id", "deleted_games", ["source", "source_id"]
    )
    with op.batch_alter_table("import_jobs", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("games_blocked", sa.Integer(), nullable=False, server_default="0")
        )


def downgrade() -> None:
    with op.batch_alter_table("import_jobs", schema=None) as batch_op:
        batch_op.drop_column("games_blocked")
    op.drop_index("ix_deleted_games_source_source_id", table_name="deleted_games")
    op.drop_index("ix_deleted_games_dedup_hash", table_name="deleted_games")
    op.drop_table("deleted_games")
