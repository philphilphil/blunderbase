"""game collections: named, coloured groups of games, filled by hand or by a rule

A league, a club season, the games against one rival: the owner wanted to group games by
something no column says, and to narrow the library, Stats and the explorer to that group.
`collections` is the group — a name unique regardless of case (the service enforces that; the
constraint here is the exact-case backstop), a palette key rather than a colour so a theme
change recolours it, an optional description, and an optional `rule`: a subset of the
library's filter vocabulary that every newly imported game is matched against.

`game_collections` is the membership, a plain join table keyed by the pair, with `added_by`
saying whether a hand or the rule put the game there. Both keys cascade, so deleting a game
or a collection takes its memberships along; the collection side is indexed because "the
games in this collection" is the query every filter by it runs.

Nothing here hides a game. A collection is a grouping and a filter dimension, and a game in
one is counted everywhere exactly as it was before.

Revision ID: 0030_collections
Revises: 0029_engine_declared_options
Create Date: 2026-09-26 12:00:00.000000

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0030_collections"
down_revision = "0029_engine_declared_options"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "collections",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=40), nullable=False),
        sa.Column("color", sa.String(length=16), nullable=False, server_default="accent"),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("rule", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="uq_collections_name"),
    )
    op.create_table(
        "game_collections",
        sa.Column("game_id", sa.Integer(), nullable=False),
        sa.Column("collection_id", sa.Integer(), nullable=False),
        sa.Column("added_by", sa.String(length=16), nullable=False),
        sa.Column("added_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["game_id"], ["games.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["collection_id"], ["collections.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("game_id", "collection_id"),
    )
    op.create_index("ix_game_collections_collection_id", "game_collections", ["collection_id"])


def downgrade() -> None:
    op.drop_index("ix_game_collections_collection_id", table_name="game_collections")
    op.drop_table("game_collections")
    op.drop_table("collections")
