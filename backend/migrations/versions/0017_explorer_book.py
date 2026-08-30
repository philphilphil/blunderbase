"""precomputed explorer book

Every explorer request folded `game_positions` from scratch: the initial array is 9.5k
join rows on the owner's library, and the book walk narrowed a candidate set of game ids
down the line one chunked IN list at a time — 71 queries and 390ms for one warm page.
What makes that affordable is that almost nothing is hot: of 463k positions, 452k are
reached by exactly one game and only 1.1k by ten or more. So the fold is written down for
the few that carry the cost — `position_moves` per continuation, `position_totals` for the
position itself, both per owner colour so "both" is one row plus the other — and the long
tail keeps folding live, where it costs microseconds.

`position_totals` is not the sum of `position_moves`: the explorer counts a game once per
position, and a game that visits one twice and plays two different moves is under both
moves. `ended_here` is the same story from the other end.

`positions.book_state` says which side of the cut a position is on, and is the sweep's
work queue: 0 dirty, 1 built, 2 deliberately cold.

Nothing is backfilled here. Every position arrives dirty and the live path stays as the
fallback for each one until the sweep (`blunderbase db rebuild-book`, and the one the
server starts for itself) has settled it, so an un-swept library is slow rather than wrong.

Revision ID: 0017_explorer_book
Revises: 0016_game_stat_summaries
Create Date: 2026-08-30 12:00:00.000000

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0017_explorer_book"
down_revision = "0016_game_stat_summaries"
branch_labels = None
depends_on = None

BOOK_STATE_INDEX = "ix_positions_book_state"


def upgrade() -> None:
    op.create_table(
        "position_moves",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("position_id", sa.Integer(), nullable=False),
        sa.Column("owner_color", sa.String(length=32), nullable=False),
        sa.Column("move_uci", sa.String(length=8), nullable=False),
        sa.Column("move_san", sa.String(length=16), nullable=True),
        sa.Column("next_position_id", sa.Integer(), nullable=True),
        sa.Column("games", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("occurrences", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("owner_moves", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("evaluated", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("blunders", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("wins", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("draws", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("losses", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("loss_sum", sa.Float(), nullable=False, server_default="0"),
        sa.Column("ply_sum", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_played", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(
            ["next_position_id"],
            ["positions.id"],
            name=op.f("fk_position_moves_next_position_id_positions"),
        ),
        sa.ForeignKeyConstraint(
            ["position_id"],
            ["positions.id"],
            name=op.f("fk_position_moves_position_id_positions"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_position_moves")),
        sa.UniqueConstraint(
            "position_id",
            "owner_color",
            "move_uci",
            name=op.f("uq_position_moves_position_id_owner_color_move_uci"),
        ),
    )
    op.create_table(
        "position_totals",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("position_id", sa.Integer(), nullable=False),
        sa.Column("owner_color", sa.String(length=32), nullable=False),
        sa.Column("games", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("wins", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("draws", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("losses", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ended_here", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ply_counts", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(
            ["position_id"],
            ["positions.id"],
            name=op.f("fk_position_totals_position_id_positions"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_position_totals")),
        sa.UniqueConstraint(
            "position_id",
            "owner_color",
            name=op.f("uq_position_totals_position_id_owner_color"),
        ),
    )
    with op.batch_alter_table("positions", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("book_state", sa.Integer(), nullable=False, server_default="0")
        )
        batch_op.create_index(BOOK_STATE_INDEX, ["book_state"])


def downgrade() -> None:
    with op.batch_alter_table("positions", schema=None) as batch_op:
        batch_op.drop_index(BOOK_STATE_INDEX)
        batch_op.drop_column("book_state")
    op.drop_table("position_totals")
    op.drop_table("position_moves")
