"""maia levels, and the runs that fill them in

The single `maia_target_elo` setting becomes the list `maia_elos`, and a run row learns to
say "ask Maia only, and only about these levels" — which is what filling in a level the
library was never analysed at queues, without searching every game a second time.

The setting is converted rather than defaulted: a deployment aiming at 1700 keeps aiming
at 1700, as the only entry of its list, and the old row goes so the two keys cannot
disagree about what is in force.

Revision ID: 0008_maia_elos
Revises: 0007_notes_lines
Create Date: 2026-08-27 16:40:00.000000

"""
from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = '0008_maia_elos'
down_revision = '0007_notes_lines'
branch_labels = None
depends_on = None

MAIA_MIN_RATING = 1100
MAIA_MAX_RATING = 2000


def upgrade() -> None:
    with op.batch_alter_table('analysis_runs', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('maia_only', sa.Boolean(), nullable=False, server_default='0')
        )
        batch_op.add_column(sa.Column('maia_elos', sa.JSON(), nullable=True))

    _convert_the_target_elo()


def downgrade() -> None:
    _restore_the_target_elo()

    with op.batch_alter_table('analysis_runs', schema=None) as batch_op:
        batch_op.drop_column('maia_elos')
        batch_op.drop_column('maia_only')


def _convert_the_target_elo() -> None:
    """`maia_target_elo: 1700` becomes `maia_elos: [1700]`, and the old row goes."""
    connection = op.get_bind()
    row = connection.execute(
        sa.text("SELECT value FROM app_settings WHERE key = 'maia_target_elo'")
    ).first()
    level = _rating(None if row is None else row[0])
    connection.execute(sa.text("DELETE FROM app_settings WHERE key = 'maia_target_elo'"))
    if level is None:
        # Nobody had configured one, so nobody has configured a list either: the absence of
        # the row is the default, here as everywhere in `app_settings`.
        return
    connection.execute(
        sa.text(
            "INSERT OR REPLACE INTO app_settings (key, value, updated_at) "
            "VALUES ('maia_elos', :value, CURRENT_TIMESTAMP)"
        ),
        {"value": json.dumps([level])},
    )


def _restore_the_target_elo() -> None:
    """Going back, the first level is the target elo again; the rest are dropped."""
    connection = op.get_bind()
    row = connection.execute(
        sa.text("SELECT value FROM app_settings WHERE key = 'maia_elos'")
    ).first()
    levels = _levels(None if row is None else row[0])
    connection.execute(sa.text("DELETE FROM app_settings WHERE key = 'maia_elos'"))
    if not levels:
        return
    connection.execute(
        sa.text(
            "INSERT OR REPLACE INTO app_settings (key, value, updated_at) "
            "VALUES ('maia_target_elo', :value, CURRENT_TIMESTAMP)"
        ),
        {"value": json.dumps(levels[0])},
    )


def _levels(value: object) -> list[int]:
    """A stored `maia_elos` value as the ratings in it, in order, ignoring the rest."""
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return []
    if not isinstance(value, list):
        return []
    return [rating for rating in (_rating(entry) for entry in value) if rating is not None]


def _rating(value: object) -> int | None:
    """One stored JSON number as a Maia level, clamped, or None where it is not one."""
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return None
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return int(max(MAIA_MIN_RATING, min(MAIA_MAX_RATING, value)))
