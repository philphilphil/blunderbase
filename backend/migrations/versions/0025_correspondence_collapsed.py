"""correspondence nodes: a line can be folded away, and the fold belongs to the line

`correspondence_nodes` gains `collapsed`. Whether the lines under a move are shown or folded
is a view preference, but it is kept on the row rather than in a browser: a tree the owner
tidied on one machine arrives tidy on the next, and a finished game's tree keeps the shape
it was left in. One boolean, NOT NULL with a false default, added in place — no rebuild.

Revision ID: 0025_correspondence_collapsed
Revises: 0024_correspondence_tasks
Create Date: 2026-09-11 20:00:00.000000

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0025_correspondence_collapsed"
down_revision = "0024_correspondence_tasks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "correspondence_nodes",
        sa.Column("collapsed", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    with op.batch_alter_table("correspondence_nodes", schema=None) as batch_op:
        batch_op.drop_column("collapsed")
