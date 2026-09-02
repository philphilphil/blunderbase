"""games added from the reference books

A model game from the masters archive or the rated pools can now be added to the library
(`services.reference.import_game`) to be analysed and annotated like any other. What it
must not do is count: none of its moves are the owner's, so `is_owner_game` marks it and
every statistic, the explorer's tree and the default games list leave it out.

Every game already stored is the owner's — a sync or a PGN presumes so even before the
owner's side is known — so the column is true for all of them.

Revision ID: 0020_reference_games
Revises: 0019_repertoires
Create Date: 2026-09-02 08:00:00.000000

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0020_reference_games"
down_revision = "0019_repertoires"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("games") as batch:
        batch.add_column(
            sa.Column(
                "is_owner_game", sa.Boolean(), nullable=False, server_default=sa.true()
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("games") as batch:
        batch.drop_column("is_owner_game")
