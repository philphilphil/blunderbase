"""an engine keeps the options it declared at its last probe

Every write path probes the binary (or reads a runner's own probe) and validates the stored
options against what came back, and then threw the list away. Practice needs it after the
fact: whether an engine can be told to play at a rating (`UCI_LimitStrength` and `UCI_Elo`)
and between which ratings is the engine's own word, and a picker that guessed would offer a
slider Stockfish 11 cannot honour.

NULL means "not probed since this column existed". A runner's row is rewritten on its next
connect; a binary on this host is probed the first time practice asks about it.

Revision ID: 0029_engine_declared_options
Revises: 0028_single_analysis_pass
Create Date: 2026-09-15 12:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0029_engine_declared_options'
down_revision = '0028_single_analysis_pass'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('engines', schema=None) as batch_op:
        batch_op.add_column(sa.Column('declared_options', sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('engines', schema=None) as batch_op:
        batch_op.drop_column('declared_options')
