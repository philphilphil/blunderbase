"""a missing policy is SQL NULL, not the JSON literal `null`

`MoveEval.maia_policy` and `MoveEval.best_lines` are JSON columns, and a JSON column
stores Python `None` as the four-byte literal `null` unless it is built with
`none_as_null=True` — which they now are. Every row written before that holds a value
where it means to hold nothing: it answers `IS NOT NULL` and then decodes to `None`.

That is not cosmetic. `_settled_maia_levels` picks one representative eval row per run
with `min(id) WHERE maia_policy IS NOT NULL`, and a run whose first ply was never asked
about — the opponent's move, under `maia_both_sides` off, or a ply Maia skipped — hands
back a representative that decodes to nothing, so the whole run reports no Maia levels.
The fill button then re-queues work the library already has.

The predicate is a plain string comparison rather than `json_valid(...) AND
json_type(...) = 'null'`. Both are correct on the SQLite this project targets, and the
JSON1 functions say what is meant more clearly — but a migration is the one place that
must not be able to fail on somebody's build, and `null` is exactly what the serialiser
writes for `None`, with no whitespace and no other spelling. A JSON string `"null"` is
stored with its quotes and so is left alone.

The downgrade is deliberately empty: writing honest NULLs back as `'null'` would restore
the bug this revision exists to clear, and nothing reads the difference — every reader
either sees NULL or decodes the value and finds None.

Revision ID: 0011_json_null_evals
Revises: 0010_run_maia_flag
Create Date: 2026-08-28 21:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0011_json_null_evals'
down_revision = '0010_run_maia_flag'
branch_labels = None
depends_on = None

# The literal a JSON column wrote where it meant to write nothing.
JSON_NULL = 'null'


def upgrade() -> None:
    connection = op.get_bind()
    for column in ('maia_policy', 'best_lines'):
        connection.execute(
            sa.text(f"UPDATE move_evals SET {column} = NULL WHERE {column} = :literal"),
            {'literal': JSON_NULL},
        )


def downgrade() -> None:
    """Nothing to undo: see the module docstring."""
