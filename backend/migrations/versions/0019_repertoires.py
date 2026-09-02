"""the owner's two opening repertoires

What the owner *intends* to play had nowhere to live: `games` is what they have played and
`lines` are variations off one game, and neither answers "what is my move here". This is
that — one tree per colour, a node per move, ordered among its siblings by `rank` with 0
meaning the main line, and a PGN-comment-style `comment` on any of them.

`epd` is the normalised position after the move, keyed the way `positions.fen` is, so a
repertoire node can be found from a board rather than by walking the path to it — which is
what keeps a transposition findable and what the deviation comparison will read later.

Deliberately no foreign key to `games` or `positions`: a repertoire is a plan, and joining
it to the library would put intentions into the explorer's counts.

Revision ID: 0019_repertoires
Revises: 0018_deleted_games
Create Date: 2026-09-01 12:00:00.000000

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0019_repertoires"
down_revision = "0018_deleted_games"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "repertoire_moves",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("color", sa.String(length=32), nullable=False),
        sa.Column("parent_id", sa.Integer(), nullable=True),
        sa.Column("move_uci", sa.String(length=8), nullable=False),
        sa.Column("move_san", sa.String(length=16), nullable=False),
        sa.Column("epd", sa.String(length=120), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False, server_default=""),
        sa.Column("rank", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["parent_id"], ["repertoire_moves.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_repertoire_moves_color_parent_id", "repertoire_moves", ["color", "parent_id"]
    )
    op.create_index("ix_repertoire_moves_color_epd", "repertoire_moves", ["color", "epd"])


def downgrade() -> None:
    op.drop_index("ix_repertoire_moves_color_epd", table_name="repertoire_moves")
    op.drop_index("ix_repertoire_moves_color_parent_id", table_name="repertoire_moves")
    op.drop_table("repertoire_moves")
