from __future__ import annotations

import json
from typing import Any

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import bindparam, inspect, text
from sqlalchemy.engine import Engine

from backend.config import Settings
from backend.db.base import Base
from backend.db.fts import NOTES_FTS, include_name, is_fts_object, notes_fts_exists
from backend.db.migrate import alembic_config, upgrade_to_head
from backend.db.session import get_engine


def test_upgrade_head_builds_the_tables_the_models_declare(settings: Settings) -> None:
    upgrade_to_head(settings)
    inspector = inspect(get_engine(settings))

    tables = {
        name
        for name in inspector.get_table_names()
        if name != "alembic_version" and not is_fts_object(name)
    }
    assert tables == set(Base.metadata.tables)

    for name, table in Base.metadata.tables.items():
        columns = {column["name"] for column in inspector.get_columns(name)}
        assert columns == set(table.columns.keys())


def test_revision_0001_leaves_no_drift(settings: Settings) -> None:
    """What Alembic would autogenerate on top of 0001 has to be nothing at all."""
    upgrade_to_head(settings)
    with get_engine(settings).connect() as connection:
        context = MigrationContext.configure(
            connection,
            opts={
                "compare_type": True,
                "render_as_batch": True,
                # The notes index is not a table any model declares; `env.py` hands
                # autogenerate the same filter, and this is the check that it is honest.
                "include_name": include_name,
            },
        )
        assert compare_metadata(context, Base.metadata) == []


def test_indexes_the_hot_queries_need_exist(settings: Settings) -> None:
    upgrade_to_head(settings)
    inspector = inspect(get_engine(settings))

    def indexed(table: str) -> set[tuple[str, ...]]:
        return {tuple(index["column_names"]) for index in inspector.get_indexes(table)}

    def unique(table: str) -> set[tuple[str, ...]]:
        return {
            tuple(constraint["column_names"])
            for constraint in inspector.get_unique_constraints(table)
        }

    assert ("source", "source_id") in unique("games")
    assert ("fen",) in unique("positions")
    assert ("game_id", "ply") in unique("game_positions")
    assert ("run_id", "ply") in unique("move_evals")
    assert ("position_id",) in indexed("game_positions")
    assert ("game_id",) in indexed("lines")
    assert ("runner_id",) in indexed("engines")
    assert ("name",) in unique("runners")
    assert ("token_hash",) in unique("runners")
    assert ("name",) in unique("mcp_keys")
    assert ("key_hash",) in unique("mcp_keys")


def test_the_queue_claim_order_is_served_entirely_by_its_index(settings: Settings) -> None:
    """A library-sized queue must not be sorted into a temporary B-tree for every claim."""
    upgrade_to_head(settings)
    with get_engine(settings).connect() as connection:
        plan = connection.execute(
            text(
                "EXPLAIN QUERY PLAN SELECT id FROM analysis_runs "
                "WHERE status = 'queued' "
                "ORDER BY priority DESC, created_at ASC, id ASC LIMIT 1"
            )
        ).all()

    assert not any("TEMP B-TREE" in str(detail).upper() for row in plan for detail in row)


def test_sqlite_runs_in_wal_mode(settings: Settings) -> None:
    upgrade_to_head(settings)
    with get_engine(settings).connect() as connection:
        assert connection.execute(text("PRAGMA journal_mode")).scalar_one() == "wal"
        assert connection.execute(text("PRAGMA foreign_keys")).scalar_one() == 1


def test_the_notes_index_is_built_and_kept_by_triggers(settings: Settings) -> None:
    """FTS5 is what makes note search an index lookup; the triggers are what keep it true."""
    upgrade_to_head(settings)
    engine = get_engine(settings)
    with engine.begin() as connection:
        assert notes_fts_exists(connection)
        connection.execute(
            text(
                "INSERT INTO notes (text, tags, created_at, updated_at, source) "
                "VALUES ('the Berlin wall again', '[]', :now, :now, 'web')"
            ),
            {"now": "2026-08-01 12:00:00"},
        )

    with engine.connect() as connection:
        matched = connection.execute(
            text(f"SELECT rowid FROM {NOTES_FTS} WHERE {NOTES_FTS} MATCH 'berlin'")
        ).all()
        assert len(matched) == 1

    with engine.begin() as connection:
        connection.execute(text("UPDATE notes SET text = 'rook endings' WHERE id = 1"))
    with engine.connect() as connection:
        assert not connection.execute(
            text(f"SELECT rowid FROM {NOTES_FTS} WHERE {NOTES_FTS} MATCH 'berlin'")
        ).all()
        assert connection.execute(
            text(f"SELECT rowid FROM {NOTES_FTS} WHERE {NOTES_FTS} MATCH 'rook'")
        ).all()

    with engine.begin() as connection:
        connection.execute(text("DELETE FROM notes WHERE id = 1"))
    with engine.connect() as connection:
        assert not connection.execute(
            text(f"SELECT rowid FROM {NOTES_FTS} WHERE {NOTES_FTS} MATCH 'rook'")
        ).all()


def test_the_run_maia_flag_arrives_true_over_the_runs_that_predate_it(
    settings: Settings,
) -> None:
    """Every existing row keeps the behaviour it was analysed with, and the flag undoes.

    The revision is named rather than counted from the head, so that the next migration to
    land cannot quietly turn this into a downgrade of something else.
    """
    upgrade_to_head(settings)
    config = alembic_config(settings)
    command.downgrade(config, "0009_mcp_keys")

    engine = get_engine(settings)
    assert "maia" not in _columns(engine, "analysis_runs")
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO analysis_runs "
                "(tier, status, multipv, priority, maia_only, attempts, created_at) "
                "VALUES ('quick', 'done', 1, 0, 0, 1, :now)"
            ),
            {"now": "2026-08-01 12:00:00"},
        )

    command.upgrade(config, "head")

    with engine.connect() as connection:
        # A run analysed before the flag existed was analysed with a Maia pass: the row says
        # what it was produced under, not what a run queued today would carry.
        assert connection.execute(text("SELECT maia FROM analysis_runs")).scalar_one() == 1

    command.downgrade(config, "0009_mcp_keys")

    assert "maia" not in _columns(engine, "analysis_runs")


def test_a_json_null_eval_becomes_a_real_null(settings: Settings) -> None:
    """`'null'` is a value: it answers `IS NOT NULL` and then decodes to None.

    Both columns, because both were written by a JSON column that had no `none_as_null`,
    and a policy that is really there has to survive the sweep untouched.
    """
    upgrade_to_head(settings)
    config = alembic_config(settings)
    command.downgrade(config, "0010_run_maia_flag")

    engine = get_engine(settings)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO analysis_runs "
                "(tier, status, multipv, priority, maia, maia_only, attempts, created_at) "
                "VALUES ('quick', 'done', 1, 0, 1, 0, 1, :now)"
            ),
            {"now": "2026-08-01 12:00:00"},
        )
        connection.execute(
            text(
                "INSERT INTO move_evals (run_id, ply, maia_policy, best_lines) "
                "VALUES (1, 0, 'null', 'null'), (1, 1, :policy, :lines)"
            ),
            {"policy": '{"1500": []}', "lines": "[]"},
        )

    command.upgrade(config, "head")

    with engine.connect() as connection:
        rows = connection.execute(
            text("SELECT ply, maia_policy, best_lines FROM move_evals ORDER BY ply")
        ).all()
    assert rows == [(0, None, None), (1, '{"1500": []}', "[]")]

    # The downgrade is a no-op on purpose: writing `'null'` back would restore the bug.
    command.downgrade(config, "0010_run_maia_flag")

    with engine.connect() as connection:
        assert connection.execute(
            text("SELECT count(*) FROM move_evals WHERE maia_policy IS NULL")
        ).scalar_one() == 1


def _columns(engine: Engine, table: str) -> set[str]:
    return {column["name"] for column in inspect(engine).get_columns(table)}


def test_every_runner_that_predates_the_browser_flag_is_a_machine(settings: Settings) -> None:
    """A registered runner was a process on a machine until a tab could be one too, and the
    flag is what buys a run orphaned by a tab its attempt back — so the default has to be
    the strict answer."""
    upgrade_to_head(settings)
    config = alembic_config(settings)
    command.downgrade(config, "0011_json_null_evals")

    engine = get_engine(settings)
    assert "browser" not in _columns(engine, "runners")
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO runners (name, token_hash, slots, connected, created_at) "
                "VALUES ('gpu-box', 'deadbeef', 2, 0, :now)"
            ),
            {"now": "2026-08-01 12:00:00"},
        )

    command.upgrade(config, "head")

    with engine.connect() as connection:
        assert connection.execute(text("SELECT browser FROM runners")).scalar_one() == 0

    command.downgrade(config, "0011_json_null_evals")

    assert "browser" not in _columns(engine, "runners")


def test_every_engine_that_predates_the_streams_flag_drives_a_board(settings: Settings) -> None:
    """The flag is a host's own word about `stream_open`, and nothing said it before.

    A binary on this host advertises nothing at all, so the only answer that keeps every
    existing row behaving as it did is the permissive one — the strict default would take
    the analysis board off the owner's own Stockfish on the next upgrade.
    """
    upgrade_to_head(settings)
    config = alembic_config(settings)
    command.downgrade(config, "0012_runner_browser")

    engine = get_engine(settings)
    assert "streams" not in _columns(engine, "engines")
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO engines (name, kind, path, options, enabled, created_at) "
                "VALUES ('stockfish', 'uci', '/usr/bin/stockfish', '{}', 1, :now)"
            ),
            {"now": "2026-08-01 12:00:00"},
        )

    command.upgrade(config, "head")

    with engine.connect() as connection:
        assert connection.execute(text("SELECT streams FROM engines")).scalar_one() == 1

    command.downgrade(config, "0012_runner_browser")

    assert "streams" not in _columns(engine, "engines")


def _add_engine(connection: Any, name: str, **columns: Any) -> None:
    row = {
        "name": name,
        "kind": "uci",
        "path": f"/usr/bin/{name}",
        "options": "{}",
        "enabled": 1,
        "streams": 1,
        "default_tier": None,
        "runner_id": None,
        "now": "2026-08-01 12:00:00",
        **columns,
    }
    connection.execute(
        text(
            "INSERT INTO engines "
            "(name, kind, path, options, enabled, streams, default_tier, runner_id, created_at) "
            "VALUES "
            "(:name, :kind, :path, :options, :enabled, :streams, :default_tier, :runner_id, :now)"
        ),
        row,
    )


def _settings_of(engine: Engine, keys: tuple[str, ...]) -> dict[str, Any]:
    with engine.connect() as connection:
        rows = connection.execute(
            text("SELECT key, value FROM app_settings WHERE key IN :keys").bindparams(
                bindparam("keys", expanding=True)
            ),
            {"keys": list(keys)},
        ).all()
    # `app_settings.value` is a JSON column, and SQLite gives an unknown type name numeric
    # affinity — so a stored `2` comes back as an int here rather than as the text `'2'`.
    return {key: json.loads(value) if isinstance(value, str) else value for key, value in rows}


ROLE_KEYS = ("quick_engine_id", "deep_engine_id", "human_engine_id")


def test_the_roles_are_seeded_from_what_each_tier_resolved_to(settings: Settings) -> None:
    """An install that upgrades goes on running exactly the engines it was running.

    Which is not the same as "what claimed the tier": a tier nobody claimed fell back to
    the first enabled UCI engine, and that fallback is what the owner has been watching
    work, so it is what gets written down.
    """
    upgrade_to_head(settings)
    config = alembic_config(settings)
    command.downgrade(config, "0013_engine_streams")

    engine = get_engine(settings)
    assert "default_tier" in _columns(engine, "engines")
    with engine.begin() as connection:
        # A switched-off engine claiming quick: it was serving nothing, and must win nothing.
        _add_engine(connection, "retired", enabled=0, default_tier="quick")
        _add_engine(connection, "sf-first")
        _add_engine(connection, "sf-deep", default_tier="deep")
        _add_engine(connection, "maia", kind="maia")

    command.upgrade(config, "head")

    assert "default_tier" not in _columns(engine, "engines")
    with engine.connect() as connection:
        ids = dict(connection.execute(text("SELECT name, id FROM engines")).all())
    assert _settings_of(engine, ROLE_KEYS) == {
        "quick_engine_id": ids["sf-first"],
        "deep_engine_id": ids["sf-deep"],
        "human_engine_id": ids["maia"],
    }

    command.downgrade(config, "0013_engine_streams")

    with engine.connect() as connection:
        tiers = dict(connection.execute(text("SELECT name, default_tier FROM engines")).all())
    assert (tiers["sf-first"], tiers["sf-deep"]) == ("quick", "deep")
    assert _settings_of(engine, ROLE_KEYS) == {}


def test_a_role_nothing_resolved_to_is_written_as_nothing(settings: Settings) -> None:
    """The absence of the row is "unassigned", here as everywhere in `app_settings`."""
    upgrade_to_head(settings)
    config = alembic_config(settings)
    command.downgrade(config, "0013_engine_streams")

    engine = get_engine(settings)
    with engine.begin() as connection:
        _add_engine(connection, "sf-only")

    command.upgrade(config, "head")

    assert set(_settings_of(engine, ROLE_KEYS)) == {"quick_engine_id", "deep_engine_id"}


def test_the_human_role_prefers_the_model_on_this_host(settings: Settings) -> None:
    """`maia_engine_for_host(None)` is what a run started here used to reach for."""
    upgrade_to_head(settings)
    config = alembic_config(settings)
    command.downgrade(config, "0013_engine_streams")

    engine = get_engine(settings)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO runners (name, token_hash, slots, connected, browser, created_at) "
                "VALUES ('gpu-box', 'deadbeef', 2, 0, 0, :now)"
            ),
            {"now": "2026-08-01 12:00:00"},
        )
        runner_id = connection.execute(text("SELECT id FROM runners")).scalar_one()
        _add_engine(connection, "maia-remote", kind="maia", runner_id=runner_id)
        _add_engine(connection, "maia-here", kind="maia")

    command.upgrade(config, "head")

    with engine.connect() as connection:
        ids = dict(connection.execute(text("SELECT name, id FROM engines")).all())
    assert _settings_of(engine, ("human_engine_id",)) == {"human_engine_id": ids["maia-here"]}
