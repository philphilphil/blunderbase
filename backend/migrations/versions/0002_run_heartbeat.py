"""analysis run heartbeat

Revision ID: 0002
Revises: 0001
Create Date: 2026-08-26 09:12:44.115200

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('analysis_runs', schema=None) as batch_op:
        batch_op.add_column(sa.Column('heartbeat_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('analysis_runs', schema=None) as batch_op:
        batch_op.drop_column('heartbeat_at')
