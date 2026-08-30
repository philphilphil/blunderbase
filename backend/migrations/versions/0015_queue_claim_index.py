"""serve the queue's mixed-direction claim order from its index

The old `(status, priority, created_at)` index was ascending throughout. Claims order by
priority descending, then creation time and id ascending, so SQLite filtered by status and
sorted every queued row into a temporary B-tree for every claim. A library backfill paid
that sort thousands of times while its workers were contending for the same writer.

Revision ID: 0015_queue_claim_index
Revises: 0014_engine_roles
Create Date: 2026-08-29 22:00:00.000000

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0015_queue_claim_index"
down_revision = "0014_engine_roles"
branch_labels = None
depends_on = None

INDEX = "ix_analysis_runs_status_priority_created_at"


def upgrade() -> None:
    op.drop_index(INDEX, table_name="analysis_runs")
    op.execute(
        sa.text(
            f"CREATE INDEX {INDEX} ON analysis_runs "
            "(status, priority DESC, created_at ASC, id ASC)"
        )
    )


def downgrade() -> None:
    op.drop_index(INDEX, table_name="analysis_runs")
    op.create_index(INDEX, "analysis_runs", ["status", "priority", "created_at"])
