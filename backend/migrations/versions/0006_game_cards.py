"""precomputed game cards

Revision ID: 0006
Revises: 0005
Create Date: 2026-08-27 14:20:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('games', schema=None) as batch_op:
        batch_op.add_column(sa.Column('card', sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('games', schema=None) as batch_op:
        batch_op.drop_column('card')
