"""The notes full-text index: an FTS5 mirror of `notes.text`, kept by triggers.

Coach memory is searched by phrase far more often than it is written, and `LIKE '%…%'`
over every row is the one query in this database that gets slower the more the owner
writes. FTS5 turns it into an index lookup, and an external-content table (`content=notes`)
means the text lives in `notes` exactly once — the index stores only the tokens, and three
triggers keep it honest on insert, update and delete.

Two things make this a module rather than four lines of DDL in a migration:

* **The virtual table is not part of `Base.metadata`.** SQLAlchemy has no construct for
  it, so it is created by the same function from two places — the migration, and an
  `after_create` hook so that `create_all` (which every test uses instead of migrating)
  produces the same database. `is_fts_object` is what lets the drift checks tell "not in
  the models" from "not supposed to be".
* **FTS5 is a compile-time option.** A SQLite without it is unusual but real, and a
  deployment on one must still work: creating the index is skipped with a warning, and
  `backend.services.notes` falls back to `LIKE`. Nothing here ever raises on the way past.
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import Connection, event, text

from backend.db.base import Base

logger = logging.getLogger(__name__)

NOTES_FTS = "notes_fts"

# `content=notes` with `content_rowid=id`: the index is an index, not a second copy. The
# triggers carry `text` along because a `delete` command has to be given the tokens it is
# removing — an external-content table cannot look them up itself once the row is gone.
_CREATE = (
    f"CREATE VIRTUAL TABLE IF NOT EXISTS {NOTES_FTS} "
    f"USING fts5(text, content='notes', content_rowid='id')",
    f"CREATE TRIGGER IF NOT EXISTS {NOTES_FTS}_ai AFTER INSERT ON notes BEGIN "
    f"INSERT INTO {NOTES_FTS}(rowid, text) VALUES (new.id, new.text); END",
    f"CREATE TRIGGER IF NOT EXISTS {NOTES_FTS}_ad AFTER DELETE ON notes BEGIN "
    f"INSERT INTO {NOTES_FTS}({NOTES_FTS}, rowid, text) VALUES ('delete', old.id, old.text); END",
    f"CREATE TRIGGER IF NOT EXISTS {NOTES_FTS}_au AFTER UPDATE ON notes BEGIN "
    f"INSERT INTO {NOTES_FTS}({NOTES_FTS}, rowid, text) VALUES ('delete', old.id, old.text); "
    f"INSERT INTO {NOTES_FTS}(rowid, text) VALUES (new.id, new.text); END",
)

# Whatever was already in `notes` when the index arrived.
_BACKFILL = f"INSERT INTO {NOTES_FTS}(rowid, text) SELECT id, text FROM notes"

_DROP = (
    f"DROP TRIGGER IF EXISTS {NOTES_FTS}_au",
    f"DROP TRIGGER IF EXISTS {NOTES_FTS}_ad",
    f"DROP TRIGGER IF EXISTS {NOTES_FTS}_ai",
    f"DROP TABLE IF EXISTS {NOTES_FTS}",
)

_PROBE = "blunderbase_fts5_probe"


def is_fts_object(name: str) -> bool:
    """Whether a table name belongs to the notes index — the table or a shadow of it.

    FTS5 keeps its own `_data`, `_idx`, `_docsize` and `_config` tables beside the virtual
    one. None of them is in `Base.metadata`, so every place that compares the database
    against the models has to know they are expected.
    """
    return name == NOTES_FTS or name.startswith(f"{NOTES_FTS}_")


def include_name(name: str | None, type_: str, _parent_names: Any) -> bool:
    """Alembic's filter for which database objects may be compared against the models.

    The index and its shadows are real tables no model declares, so a comparison that sees
    them wants to drop them. They are owned by this module, and this is where that
    ownership is spelled — `migrations/env.py` passes this straight through.
    """
    if type_ == "table" and name is not None:
        return not is_fts_object(name)
    return True


def fts5_available(connection: Connection) -> bool:
    """Whether this SQLite was built with FTS5. Asked by creating a throwaway table."""
    if connection.dialect.name != "sqlite":
        return False
    try:
        connection.exec_driver_sql(f"CREATE VIRTUAL TABLE temp.{_PROBE} USING fts5(x)")
    except Exception:
        return False
    connection.exec_driver_sql(f"DROP TABLE temp.{_PROBE}")
    return True


def create_notes_fts(connection: Connection) -> bool:
    """Build the index and its triggers, and fill it from `notes`. Idempotent.

    Returns whether the index is there afterwards — False on a SQLite without FTS5, which
    is a deployment that searches notes with `LIKE` and is otherwise unaffected.
    """
    if connection.dialect.name != "sqlite":
        return False
    if notes_fts_exists(connection):
        return True
    if not fts5_available(connection):
        logger.warning("sqlite has no FTS5; note search falls back to a scan")
        return False
    for statement in _CREATE:
        connection.exec_driver_sql(statement)
    connection.exec_driver_sql(_BACKFILL)
    return True


def drop_notes_fts(connection: Connection) -> None:
    """Take the index and its triggers away. Leaves `notes` untouched."""
    if connection.dialect.name != "sqlite":
        return
    for statement in _DROP:
        connection.exec_driver_sql(statement)


def notes_fts_exists(connection: Connection) -> bool:
    """Whether this database carries the index right now."""
    if connection.dialect.name != "sqlite":
        return False
    found = connection.execute(
        text("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = :name"),
        {"name": NOTES_FTS},
    ).first()
    return found is not None


@event.listens_for(Base.metadata, "after_create")
def _create_with_the_tables(_target: Any, connection: Connection, **_kw: Any) -> None:
    """`create_all` builds the index too, so a test database is the migrated one."""
    if "notes" not in Base.metadata.tables:
        return
    create_notes_fts(connection)
