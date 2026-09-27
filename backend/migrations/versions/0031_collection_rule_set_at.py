"""a collection remembers when its rule took the form it has now

A game whose side is learned after it was imported — its account registered later, or a
reference game that turns out to be the owner's — is offered to the collection rules then,
the way the import would have offered it had it known. Only to the rules that already stood,
in their current form, when the game arrived: a rule written or rewritten since would be
reaching back into the library, and that is only ever the explicit "apply to existing".
`rule_set_at` is what answers "stood when it arrived".

Existing rows are backfilled with `created_at`. A rule edited between this collection's
creation and this migration is dated a little early by that, which is the only date there
is to give it.

Revision ID: 0031_collection_rule_set_at
Revises: 0030_collections
Create Date: 2026-09-27 12:00:00.000000

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0031_collection_rule_set_at"
down_revision = "0030_collections"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("collections", schema=None) as batch_op:
        batch_op.add_column(sa.Column("rule_set_at", sa.DateTime(), nullable=True))
    op.execute("UPDATE collections SET rule_set_at = created_at")
    with op.batch_alter_table("collections", schema=None) as batch_op:
        batch_op.alter_column("rule_set_at", existing_type=sa.DateTime(), nullable=False)


def downgrade() -> None:
    with op.batch_alter_table("collections", schema=None) as batch_op:
        batch_op.drop_column("rule_set_at")
