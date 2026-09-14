"""one analysis pass: a run carries its own limits, and the quick/deep tiers go

Analysis came in two budgets, quick and deep, each with its own engine role, node budget
and Maia flag. It is one pass now: every imported game gets it at `analysis_nodes`, and a
person who wants more asks for it through the Analyse dialog with an explicit limit —
nodes, depth, or seconds per move — which is written on the run.

`analysis_runs` gains `seconds`, the per-move time limit, beside the `nodes` and `depth`
columns it already had. A plain nullable column, added in place.

`analysis_runs.tier` becomes nullable, because nothing writes it any more. It stays at all
because every run queued before this still says `quick` or `deep`, and the column is how
those rows remain readable. Changing nullability is the one thing here SQLite cannot do in
place, so the table is rebuilt — and a rebuild would flatten the mixed-direction claim
index, so the index is dropped first and re-created by hand afterwards exactly as 0015
made it.

The settings move the way an owner would expect nothing to change that they chose:

- `analysis_engine_id` takes `quick_engine_id` (the engine the import pass ran on), else
  `deep_engine_id` when only that one was assigned.
- `maia_on_analysis` takes `maia_on_quick`, the flag that governed imported games.
- The budgets are not carried over: `quick_nodes` and `deep_nodes` were two ends of a
  trade the single pass no longer makes, so everyone starts from the new default.

Stored game cards and stat summaries are deliberately left alone. Clearing them would make
every game refold on the next read — the full stats scan behind the 2026-08-30 meltdown —
and the readers ignore the `deep`/`tier` keys an old one still carries. The downgrade is
the other direction: the old code reads those keys without a default, so the downgrade
clears just the cards and summaries folded since the upgrade — the ones that lack them —
and those few games refold under the old code.

Two things an old library carries would read wrong under the new rules, and are put right:

- `depth` on a run is now the limit it was asked for. A run that carried a node budget and
  a depth beside it — every run the old demo seed wrote said `depth=18` — would badge as
  "d18" for a search that stopped on its nodes, so the depth is cleared where a node budget
  stands next to it.
- A queued deep full-game run is what the old deep backfill left behind (the old Deep button
  queued the same row). The old Stop dropped them by tier; the new Stop drops import-priority
  runs, and only those may move to the analysis role's engine when theirs is gone. They are
  lowered to import priority so both still reach them, exactly as the old code would have.

Revision ID: 0028_single_analysis_pass
Revises: 0027_games_engine_hidden
Create Date: 2026-09-14 10:00:00.000000

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0028_single_analysis_pass"
down_revision = "0027_games_engine_hidden"
branch_labels = None
depends_on = None

INDEX = "ix_analysis_runs_status_priority_created_at"

# Literal key names rather than `app_settings` constants: a migration is a record of what
# the database looked like then, and must not move when the service renames something.
ANALYSIS_ENGINE_ID = "analysis_engine_id"
QUICK_ENGINE_ID = "quick_engine_id"
DEEP_ENGINE_ID = "deep_engine_id"
MAIA_ON_ANALYSIS = "maia_on_analysis"
MAIA_ON_QUICK = "maia_on_quick"
NEW_KEYS = (ANALYSIS_ENGINE_ID, MAIA_ON_ANALYSIS, "analysis_nodes", "analysis_multipv")
OLD_KEYS = (
    QUICK_ENGINE_ID,
    DEEP_ENGINE_ID,
    "quick_nodes",
    "deep_nodes",
    "deep_multipv",
    MAIA_ON_QUICK,
    "maia_on_deep",
)
# What an old run's priority meant: a deep run jumped the queue at 10, a quick one sat at 0,
# and correspondence tasks in between were deep-tier FEN runs.
DEEP_PRIORITY_FLOOR = 1


def upgrade() -> None:
    op.add_column("analysis_runs", sa.Column("seconds", sa.Float(), nullable=True))

    op.drop_index(INDEX, table_name="analysis_runs")
    with op.batch_alter_table("analysis_runs", schema=None) as batch_op:
        batch_op.alter_column("tier", existing_type=sa.String(length=32), nullable=True)
    _create_claim_index()

    connection = op.get_bind()
    _copy_first(connection, ANALYSIS_ENGINE_ID, (QUICK_ENGINE_ID, DEEP_ENGINE_ID))
    _copy_first(connection, MAIA_ON_ANALYSIS, (MAIA_ON_QUICK,))
    _delete_keys(connection, OLD_KEYS)

    connection.execute(
        sa.text(
            "UPDATE analysis_runs SET depth = NULL "
            "WHERE depth IS NOT NULL AND nodes IS NOT NULL"
        )
    )
    connection.execute(
        sa.text(
            "UPDATE analysis_runs SET priority = 0 "
            "WHERE tier = 'deep' AND status = 'queued' AND game_id IS NOT NULL "
            "AND correspondence_search_id IS NULL AND ply_start IS NULL AND ply_end IS NULL "
            "AND maia_only = 0"
        )
    )


def downgrade() -> None:
    connection = op.get_bind()
    # Folded since the upgrade, in the shape the old readers cannot read: a card with no
    # `deep`, a summary whose worst moments have no `tier`. Only those — the rest still
    # carry both keys and clearing them would refold the whole library.
    connection.execute(
        sa.text(
            "UPDATE games SET card = NULL "
            "WHERE card IS NOT NULL AND json_type(card, '$.deep') IS NULL"
        )
    )
    connection.execute(
        sa.text(
            "UPDATE games SET stat_summary = NULL "
            "WHERE stat_summary IS NOT NULL "
            "AND json_type(stat_summary, '$.worst[0]') IS NOT NULL "
            "AND json_type(stat_summary, '$.worst[0].tier') IS NULL"
        )
    )

    # Both tiers served by the one engine the owner had for analysis, and the quick flag
    # the one that governed imported games. The budgets fall back to the old defaults.
    _copy_first(connection, QUICK_ENGINE_ID, (ANALYSIS_ENGINE_ID,))
    _copy_first(connection, DEEP_ENGINE_ID, (ANALYSIS_ENGINE_ID,))
    _copy_first(connection, MAIA_ON_QUICK, (MAIA_ON_ANALYSIS,))
    _delete_keys(connection, NEW_KEYS)

    # A run queued after the upgrade has no tier; the nearest old one is read off its
    # priority, since a person-requested run jumped the queue the way a deep run did.
    connection.execute(
        sa.text(
            "UPDATE analysis_runs SET tier = CASE WHEN priority >= :floor "
            "THEN 'deep' ELSE 'quick' END WHERE tier IS NULL"
        ),
        {"floor": DEEP_PRIORITY_FLOOR},
    )

    op.drop_index(INDEX, table_name="analysis_runs")
    with op.batch_alter_table("analysis_runs", schema=None) as batch_op:
        batch_op.alter_column("tier", existing_type=sa.String(length=32), nullable=False)
        batch_op.drop_column("seconds")
    _create_claim_index()


def _create_claim_index() -> None:
    """The claim index with its directions, which only raw SQL spells on SQLite (see 0015)."""
    op.execute(
        sa.text(
            f"CREATE INDEX {INDEX} ON analysis_runs (status, priority DESC, created_at ASC, id ASC)"
        )
    )


def _copy_first(connection: sa.Connection, target: str, sources: tuple[str, ...]) -> None:
    """Store under `target` the value of the first of `sources` that has a row.

    The value is copied as the JSON text it is stored as, so an engine id stays an id and a
    flag stays a flag without being parsed. No source row, no target row: an absent row is
    "nobody chose", which is what the new key should say too.
    """
    for source in sources:
        row = connection.execute(
            sa.text("SELECT value FROM app_settings WHERE key = :key"), {"key": source}
        ).first()
        if row is None:
            continue
        connection.execute(
            sa.text(
                "INSERT OR REPLACE INTO app_settings (key, value, updated_at) "
                "VALUES (:key, :value, CURRENT_TIMESTAMP)"
            ),
            {"key": target, "value": row[0]},
        )
        return


def _delete_keys(connection: sa.Connection, keys: tuple[str, ...]) -> None:
    connection.execute(
        sa.text("DELETE FROM app_settings WHERE key IN :keys").bindparams(
            sa.bindparam("keys", expanding=True)
        ),
        {"keys": list(keys)},
    )
