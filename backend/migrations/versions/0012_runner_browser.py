"""a runner says whether it is a browser tab

An engine runner used to be a process on a machine somebody administers: it stays up, it
is restarted on purpose, and a link that drops is worth treating as a fault. A browser tab
is a runner too now, and it is none of those things — a closed laptop, a phone locking, a
backgrounded tab whose timers are throttled past the detach window all take one away with
no fault anywhere.

So the row records which it is, and `analysis.requeue_stale_runs` reads it: a run orphaned
by a browser goes back to the queue with its attempt refunded, where one orphaned by a
machine spends an attempt and is failed when the budget runs out. Every existing row is a
process, which is what the default says.

Revision ID: 0012_runner_browser
Revises: 0011_json_null_evals
Create Date: 2026-08-29 09:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0012_runner_browser'
down_revision = '0011_json_null_evals'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('runners', schema=None) as batch_op:
        batch_op.add_column(sa.Column('browser', sa.Boolean(), nullable=False, server_default='0'))


def downgrade() -> None:
    with op.batch_alter_table('runners', schema=None) as batch_op:
        batch_op.drop_column('browser')
