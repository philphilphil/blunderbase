"""collections say whether the rail shows them

`collections.pinned` is the owner's own choice of which collections sit under Collections in
the rail. Until now the rail pinned the first two by name, so the upgrade pins exactly those
(the first one only would be as right while correspondence mode is on, but the owner's
screen is not known here, and two is what most of them saw) and the rail looks as it did.

Adding a column is a plain `ALTER TABLE` in SQLite, so the table is not rebuilt; the
`sqlite_autoincrement` 0034 put on it is passed along anyway, in case a later Alembic
decides to recreate it.

Revision ID: 0035_collection_pinned
Revises: 0034_game_ply_offset
Create Date: 2026-09-29 12:00:00.000000

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0035_collection_pinned"
down_revision = "0034_game_ply_offset"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table(
        "collections", schema=None, table_kwargs={"sqlite_autoincrement": True}
    ) as batch_op:
        batch_op.add_column(
            sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.false())
        )
    op.execute(
        "UPDATE collections SET pinned = 1 WHERE id IN "
        "(SELECT id FROM collections ORDER BY lower(name), id LIMIT 2)"
    )


def downgrade() -> None:
    with op.batch_alter_table(
        "collections", schema=None, table_kwargs={"sqlite_autoincrement": True}
    ) as batch_op:
        batch_op.drop_column("pinned")
