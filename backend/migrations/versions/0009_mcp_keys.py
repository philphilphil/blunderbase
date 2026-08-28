"""mcp keys

Owner-minted bearer keys for `/mcp`, one per client, so the password does not have to be
pasted into every coach configuration and a leaked key is one row to delete. Only the
SHA-256 of a key is stored, as with runner tokens.

Revision ID: 0009_mcp_keys
Revises: 0008_maia_elos
Create Date: 2026-08-28 10:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0009_mcp_keys'
down_revision = '0008_maia_elos'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('mcp_keys',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=64), nullable=False),
    sa.Column('key_hash', sa.String(length=64), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('last_used_at', sa.DateTime(), nullable=True),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_mcp_keys')),
    sa.UniqueConstraint('name', name=op.f('uq_mcp_keys_name')),
    sa.UniqueConstraint('key_hash', name=op.f('uq_mcp_keys_key_hash'))
    )


def downgrade() -> None:
    op.drop_table('mcp_keys')
