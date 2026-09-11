"""correspondence tasks: what an expansion still owes, and what a search actually reached

Two small additions, both in service of the bounded half of correspondence mode.

`correspondence_searches` gains `expand_width` and `expand_stages`. A task is queued now
and absorbed hours later, possibly on another machine, and the only thing that survives
that gap is the row — so what the expansion that queued it still has left to do is written
on it and copied, one stage lower, onto each child it produces.

`move_evals` gains `depth` and `nodes`: where the search behind a row actually got to, as
the engine reported it, rather than the budget it was given. Without them a task's verdict
cannot be compared with the one already in `correspondence_evals`, and "a shallower result
never overwrites a deeper one" — the rule that makes a three-day search worth anything —
would have nothing to read.

All four are plain nullable columns, so SQLite adds each one in place rather than
rebuilding a table. That matters most for `move_evals`, which is the largest table in the
library, and for the mixed-direction claim index a rebuild of `analysis_runs` would
silently flatten.

Revision ID: 0024_correspondence_tasks
Revises: 0023_correspondence
Create Date: 2026-09-11 12:00:00.000000

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0024_correspondence_tasks"
down_revision = "0023_correspondence"
branch_labels = None
depends_on = None

SEARCH_COLUMNS = ("expand_width", "expand_stages")
EVAL_COLUMNS = ("depth", "nodes")


def upgrade() -> None:
    for name in SEARCH_COLUMNS:
        op.add_column("correspondence_searches", sa.Column(name, sa.Integer(), nullable=True))
    for name in EVAL_COLUMNS:
        op.add_column("move_evals", sa.Column(name, sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("move_evals", schema=None) as batch_op:
        for name in EVAL_COLUMNS:
            batch_op.drop_column(name)
    with op.batch_alter_table("correspondence_searches", schema=None) as batch_op:
        for name in SEARCH_COLUMNS:
            batch_op.drop_column(name)
