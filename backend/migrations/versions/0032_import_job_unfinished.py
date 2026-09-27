"""a sync remembers the games it saw still being played

The Lichess export filters on when a game began, and its cursor moves past a correspondence
game that began before a newer, already stored game. A sync therefore writes down the IDs of
the games it saw still running, and the next one asks for those by ID. Nullable, and null on
every existing row: a job from before this has nothing to hand on, and the first sync after
it asks Lichess for the account's running games directly.

Revision ID: 0032_import_job_unfinished
Revises: 0031_collection_rule_set_at
Create Date: 2026-09-27 18:00:00.000000

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0032_import_job_unfinished"
down_revision = "0031_collection_rule_set_at"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("import_jobs", schema=None) as batch_op:
        batch_op.add_column(sa.Column("unfinished", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("import_jobs", schema=None) as batch_op:
        batch_op.drop_column("unfinished")
