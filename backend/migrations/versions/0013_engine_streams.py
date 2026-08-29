"""an engine records whether its host answers stream_open

`RunnerEngine.streams` used to be computed from the engine's *kind* — `kind == "uci"` —
which reads as "a Maia answers with a policy, so it never drives a board" and is true as
far as it goes. It is not the whole question. A runner advertises `streams` in its `hello`,
and a host may honestly say it runs queue work and nothing else: the browser runner does,
because a tab implements `run_dispatch` and answers no `stream_open`. That value was
accepted, validated and thrown away, so the API went on reporting `true` for every UCI
engine and the analysis-board picker offered one that would never answer.

So the answer is a column: the runner's own word, written on every advertisement. Every
existing row is a binary on this host, which advertises nothing and drives a board as it
always has — which is what the default says.

Revision ID: 0013_engine_streams
Revises: 0012_runner_browser
Create Date: 2026-08-29 12:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0013_engine_streams'
down_revision = '0012_runner_browser'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('engines', schema=None) as batch_op:
        batch_op.add_column(sa.Column('streams', sa.Boolean(), nullable=False, server_default='1'))


def downgrade() -> None:
    with op.batch_alter_table('engines', schema=None) as batch_op:
        batch_op.drop_column('streams')
