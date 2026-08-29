"""a run says whether it asks Maia at all

The Maia pass used to be part of what a run *is*: every pass searched, then asked the
human-move model over every ply of both sides. It is 40-70% of a quick run's cost, and a
deep run spent it recomputing a policy the quick run had already stored. So a run now
carries whether it wants one, written at enqueue from the tier's setting the way its node
budget is.

Existing rows default to 1: they were analysed with a Maia pass, and the row is what the
game's evaluations were produced under. `maia_only` rows are true under that default
already, which is the invariant — a fill pass with no Maia is nothing at all.

Revision ID: 0010_run_maia_flag
Revises: 0009_mcp_keys
Create Date: 2026-08-28 20:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0010_run_maia_flag'
down_revision = '0009_mcp_keys'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('analysis_runs', schema=None) as batch_op:
        batch_op.add_column(sa.Column('maia', sa.Boolean(), nullable=False, server_default='1'))


def downgrade() -> None:
    with op.batch_alter_table('analysis_runs', schema=None) as batch_op:
        batch_op.drop_column('maia')
