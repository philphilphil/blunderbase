from __future__ import annotations

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect, text

from backend.config import Settings
from backend.db.base import Base
from backend.db.fts import NOTES_FTS, include_name, is_fts_object, notes_fts_exists
from backend.db.migrate import upgrade_to_head
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
