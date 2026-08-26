"""remote engine runners

Revision ID: 0004
Revises: 0003
Create Date: 2026-08-26 12:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('runners',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=64), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('slots', sa.Integer(), nullable=False),
    sa.Column('version', sa.String(length=32), nullable=True),
    sa.Column('connected', sa.Boolean(), nullable=False),
    sa.Column('last_seen_at', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_runners')),
    sa.UniqueConstraint('name', name=op.f('uq_runners_name')),
    sa.UniqueConstraint('token_hash', name=op.f('uq_runners_token_hash'))
    )
    with op.batch_alter_table('engines', schema=None) as batch_op:
        batch_op.add_column(sa.Column('runner_id', sa.Integer(), nullable=True))
        batch_op.create_index(batch_op.f('ix_engines_runner_id'), ['runner_id'], unique=False)
        batch_op.create_foreign_key(
            batch_op.f('fk_engines_runner_id_runners'), 'runners', ['runner_id'], ['id']
        )

    with op.batch_alter_table('analysis_runs', schema=None) as batch_op:
        batch_op.add_column(sa.Column('attempt_token', sa.String(length=32), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('analysis_runs', schema=None) as batch_op:
        batch_op.drop_column('attempt_token')

    with op.batch_alter_table('engines', schema=None) as batch_op:
        batch_op.drop_constraint(batch_op.f('fk_engines_runner_id_runners'), type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_engines_runner_id'))
        batch_op.drop_column('runner_id')

    op.drop_table('runners')
