"""Enforce one owner, retaining the credential previous versions used to authenticate."""

import sqlalchemy as sa
from alembic import op

revision = "0022_single_owner"
down_revision = "0021_name_unnamed_openings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    ids = list(bind.execute(sa.text("SELECT id FROM credentials ORDER BY id")).scalars())
    if len(ids) > 1:
        # Old setup races could mint sessions for multiple callers. Retain the first
        # credential (the one login already reads), but trust none of those sessions.
        bind.execute(sa.text("DELETE FROM auth_sessions"))
        bind.execute(sa.text("DELETE FROM credentials WHERE id != :id"), {"id": ids[0]})
    if ids:
        bind.execute(sa.text("UPDATE credentials SET id = 1 WHERE id = :id"), {"id": ids[0]})
    with op.batch_alter_table("credentials") as batch:
        batch.create_check_constraint("singleton", "id = 1")


def downgrade() -> None:
    with op.batch_alter_table("credentials") as batch:
        batch.drop_constraint("singleton", type_="check")
