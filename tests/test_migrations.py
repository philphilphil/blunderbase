from __future__ import annotations

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect, text

from backend.config import Settings
from backend.db.base import Base
from backend.db.migrate import upgrade_to_head
from backend.db.session import get_engine


def test_upgrade_head_builds_the_tables_the_models_declare(settings: Settings) -> None:
    upgrade_to_head(settings)
    inspector = inspect(get_engine(settings))

    tables = set(inspector.get_table_names()) - {"alembic_version"}
    assert tables == set(Base.metadata.tables)

    for name, table in Base.metadata.tables.items():
        columns = {column["name"] for column in inspector.get_columns(name)}
        assert columns == set(table.columns.keys())


def test_revision_0001_leaves_no_drift(settings: Settings) -> None:
    """What Alembic would autogenerate on top of 0001 has to be nothing at all."""
    upgrade_to_head(settings)
    with get_engine(settings).connect() as connection:
        context = MigrationContext.configure(
            connection, opts={"compare_type": True, "render_as_batch": True}
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
    assert ("runner_id",) in indexed("engines")
    assert ("name",) in unique("runners")
    assert ("token_hash",) in unique("runners")


def test_sqlite_runs_in_wal_mode(settings: Settings) -> None:
    upgrade_to_head(settings)
    with get_engine(settings).connect() as connection:
        assert connection.execute(text("PRAGMA journal_mode")).scalar_one() == "wal"
        assert connection.execute(text("PRAGMA foreign_keys")).scalar_one() == 1
