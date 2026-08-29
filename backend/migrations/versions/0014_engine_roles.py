"""the owner assigns the roles; an engine no longer claims one

`engines.default_tier` was a *preference*: `engine_for_tier` honoured it when something
claimed the tier and fell back to the first enabled UCI engine when nothing did. So the
engine actually serving a tier was frequently one that said nothing about it, the fallback
was invisible in the UI, and switching an engine off silently handed its work to another.

Roles replace it. Three settings — `quick_engine_id`, `deep_engine_id`, `human_engine_id`
— name the engine the owner chose for each job, and nothing falls back: an unassigned or
unavailable role does not run and says why. An engine advertises what kind of thing it is
and nothing more, which is why the column goes.

The three settings are seeded from what this deployment resolves to *today*, so an install
that upgrades goes on running exactly the engines it was running.

Revision ID: 0014_engine_roles
Revises: 0013_engine_streams
Create Date: 2026-08-29 14:00:00.000000

"""
from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = '0014_engine_roles'
down_revision = '0013_engine_streams'
branch_labels = None
depends_on = None

QUICK_KEY = 'quick_engine_id'
DEEP_KEY = 'deep_engine_id'
HUMAN_KEY = 'human_engine_id'
ROLE_KEYS = (QUICK_KEY, DEEP_KEY, HUMAN_KEY)


def upgrade() -> None:
    # Seeded before the column goes, because the column is what the seed reads.
    _seed_the_roles()

    with op.batch_alter_table('engines', schema=None) as batch_op:
        batch_op.drop_column('default_tier')


def downgrade() -> None:
    with op.batch_alter_table('engines', schema=None) as batch_op:
        batch_op.add_column(sa.Column('default_tier', sa.String(length=32), nullable=True))

    _restore_the_tiers()


def _seed_the_roles() -> None:
    """Write down the engine each role resolves to now, so nothing changes on upgrade."""
    connection = op.get_bind()
    for key, engine_id in (
        (QUICK_KEY, _tier_engine(connection, 'quick')),
        (DEEP_KEY, _tier_engine(connection, 'deep')),
        (HUMAN_KEY, _human_engine(connection)),
    ):
        if engine_id is None:
            # A role that resolves to nothing is written as nothing: the absence of the row
            # is "unassigned", here as everywhere in `app_settings`.
            continue
        connection.execute(
            sa.text(
                'INSERT OR REPLACE INTO app_settings (key, value, updated_at) '
                'VALUES (:key, :value, CURRENT_TIMESTAMP)'
            ),
            {'key': key, 'value': json.dumps(engine_id)},
        )


def _tier_engine(connection: sa.Connection, tier: str) -> int | None:
    """`engine_for_tier`, as it was: the engine claiming the tier, else any enabled UCI one."""
    claimed = connection.execute(
        sa.text(
            'SELECT id FROM engines WHERE enabled = 1 AND default_tier = :tier '
            'ORDER BY id LIMIT 1'
        ),
        {'tier': tier},
    ).first()
    if claimed is not None:
        return int(claimed[0])
    fallback = connection.execute(
        sa.text("SELECT id FROM engines WHERE enabled = 1 AND kind = 'uci' ORDER BY id LIMIT 1")
    ).first()
    return None if fallback is None else int(fallback[0])


def _human_engine(connection: sa.Connection) -> int | None:
    """`maia_engine_for_host(None)`, else the Maia on a runner that was doing the work."""
    local = connection.execute(
        sa.text(
            "SELECT id FROM engines WHERE enabled = 1 AND kind = 'maia' "
            'AND runner_id IS NULL ORDER BY id LIMIT 1'
        )
    ).first()
    if local is not None:
        return int(local[0])
    remote = connection.execute(
        sa.text("SELECT id FROM engines WHERE enabled = 1 AND kind = 'maia' ORDER BY id LIMIT 1")
    ).first()
    return None if remote is None else int(remote[0])


def _restore_the_tiers() -> None:
    """Going back, the two tier assignments become the claims they used to be.

    Best effort by construction: the human role has no column to go back to, and an engine
    serving a tier only because it was the first enabled UCI one now says so out loud. The
    old resolution keeps working either way, which is what the downgrade owes.
    """
    connection = op.get_bind()
    for key, tier in ((QUICK_KEY, 'quick'), (DEEP_KEY, 'deep')):
        engine_id = _stored_id(connection, key)
        if engine_id is None:
            continue
        connection.execute(
            sa.text('UPDATE engines SET default_tier = :tier WHERE id = :id'),
            {'tier': tier, 'id': engine_id},
        )
    connection.execute(
        sa.text('DELETE FROM app_settings WHERE key IN (:quick, :deep, :human)'),
        {'quick': QUICK_KEY, 'deep': DEEP_KEY, 'human': HUMAN_KEY},
    )


def _stored_id(connection: sa.Connection, key: str) -> int | None:
    """One stored setting as the engine id in it, or None where it is not one."""
    row = connection.execute(
        sa.text('SELECT value FROM app_settings WHERE key = :key'), {'key': key}
    ).first()
    value = None if row is None else row[0]
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return None
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return int(value)
