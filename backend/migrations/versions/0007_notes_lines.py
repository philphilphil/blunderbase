"""notes on lines and plies, and a full-text index over them

Revision ID: 0007_notes_lines
Revises: 0006
Create Date: 2026-08-27 16:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

from backend.db import fts


revision = '0007_notes_lines'
down_revision = '0006'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('lines',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('game_id', sa.Integer(), nullable=False),
    sa.Column('base_ply', sa.Integer(), nullable=False),
    sa.Column('moves', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['game_id'], ['games.id'], name=op.f('fk_lines_game_id_games'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_lines'))
    )
    with op.batch_alter_table('lines', schema=None) as batch_op:
        batch_op.create_index('ix_lines_game_id', ['game_id'], unique=False)

    with op.batch_alter_table('notes', schema=None) as batch_op:
        batch_op.add_column(sa.Column('line_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('ply', sa.Integer(), nullable=True))
        batch_op.add_column(
            sa.Column('source', sa.String(length=32), nullable=False, server_default='web')
        )
        batch_op.create_foreign_key(
            batch_op.f('fk_notes_line_id_lines'), 'lines', ['line_id'], ['id'], ondelete='SET NULL'
        )

    # The batch above recreated `notes`, which would have dropped the triggers; the index
    # is built after it for that reason and no other.
    fts.create_notes_fts(op.get_bind())


def downgrade() -> None:
    fts.drop_notes_fts(op.get_bind())

    with op.batch_alter_table('notes', schema=None) as batch_op:
        batch_op.drop_constraint(batch_op.f('fk_notes_line_id_lines'), type_='foreignkey')
        batch_op.drop_column('source')
        batch_op.drop_column('ply')
        batch_op.drop_column('line_id')

    with op.batch_alter_table('lines', schema=None) as batch_op:
        batch_op.drop_index('ix_lines_game_id')
    op.drop_table('lines')
