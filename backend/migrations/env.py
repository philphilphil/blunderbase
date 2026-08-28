from __future__ import annotations

from alembic import context
from sqlalchemy import Connection

from backend.config import get_settings
from backend.db import (
    fts,
    models,  # noqa: F401  (importing registers every table on Base.metadata)
)
from backend.db.base import Base
from backend.db.session import create_db_engine

config = context.config
target_metadata = Base.metadata


def _database_url() -> str:
    return config.get_main_option("sqlalchemy.url") or get_settings().database_url


def _disable_foreign_keys(connection: Connection) -> None:
    """SQLite has no ALTER, so Alembic's batch mode copies, drops and renames.

    `backend.db.session` turns `foreign_keys=ON` on for every SQLite connection, and
    dropping a referenced table then fails on the rows pointing at it. PRAGMA is a no-op
    inside a transaction, so it goes on the raw DBAPI connection before Alembic opens one.
    """
    dbapi_connection = connection.connection.dbapi_connection
    dbapi_connection.execute("PRAGMA foreign_keys=OFF")
    if dbapi_connection.execute("PRAGMA foreign_keys").fetchone()[0]:
        raise RuntimeError("could not disable foreign keys on the migration connection")


def _check_foreign_keys(connection: Connection) -> None:
    """With enforcement off a batch recreate can orphan a reference silently, so say so loudly."""
    dbapi_connection = connection.connection.dbapi_connection
    violations = dbapi_connection.execute("PRAGMA foreign_key_check").fetchall()
    if violations:
        orphans = ", ".join(
            f"{table} rowid {rowid} -> {parent}" for table, rowid, parent, _ in violations
        )
        raise RuntimeError(f"migration left orphaned rows: {orphans}")


def run_migrations_offline() -> None:
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
        include_name=fts.include_name,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = create_db_engine(_database_url())
    with connectable.connect() as connection:
        _disable_foreign_keys(connection)
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
            include_name=fts.include_name,
        )
        with context.begin_transaction():
            context.run_migrations()
        _check_foreign_keys(connection)
    connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
