from __future__ import annotations

import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from backend.config import Settings, get_settings

# Sized for worker threads rather than HTTP concurrency: every Session owns its own
# connection, and an analysis run holds one for as long as it buffers its MoveEvals.
POOL_SIZE = 10
MAX_OVERFLOW = 50

SQLITE_PREFIX = "sqlite+pysqlite:///"
BUSY_TIMEOUT_MS = 5000


def sqlite_path(url: str) -> Path | None:
    """The file a SQLite URL points at, or None for PostgreSQL and for `:memory:`."""
    if not url.startswith(SQLITE_PREFIX):
        return None
    tail = url[len(SQLITE_PREFIX) :]
    return Path(tail) if tail and tail != ":memory:" else None


def _install_sqlite_pragmas(engine: Engine) -> None:
    """WAL, foreign keys and a busy timeout, on this engine's connections only.

    WAL is what lets the analysis workers read while a run commits, and the pragmas are
    per-connection, so they have to be set on every one the pool opens. The listener is
    bound to the engine rather than to the `Engine` class so a PostgreSQL engine in the
    same process never sees it.
    """

    @event.listens_for(engine, "connect")
    def _configure(dbapi_connection: Any, _record: Any) -> None:
        if not isinstance(dbapi_connection, sqlite3.Connection):
            return
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute(f"PRAGMA busy_timeout={BUSY_TIMEOUT_MS}")
        cursor.close()


def create_db_engine(url: str, **kwargs: Any) -> Engine:
    """Build an engine for `url`, applying the SQLite pragmas when that is what it is."""
    path = sqlite_path(url)
    if path is not None:
        path.parent.mkdir(parents=True, exist_ok=True)
    options: dict[str, Any] = {"future": True}
    if "poolclass" not in kwargs:
        options |= {"pool_size": POOL_SIZE, "max_overflow": MAX_OVERFLOW}
    options |= kwargs
    engine = create_engine(url, **options)
    if engine.dialect.name == "sqlite":
        _install_sqlite_pragmas(engine)
    return engine


_LOCK = threading.Lock()
_ENGINES: dict[str, Engine] = {}
_SESSIONMAKERS: dict[str, sessionmaker[Session]] = {}


def get_engine(settings: Settings | None = None) -> Engine:
    url = (settings or get_settings()).database_url
    with _LOCK:
        engine = _ENGINES.get(url)
        if engine is None:
            engine = _ENGINES[url] = create_db_engine(url)
        return engine


def get_sessionmaker(settings: Settings | None = None) -> sessionmaker[Session]:
    url = (settings or get_settings()).database_url
    with _LOCK:
        factory = _SESSIONMAKERS.get(url)
    if factory is not None:
        return factory
    engine = get_engine(settings)
    with _LOCK:
        return _SESSIONMAKERS.setdefault(
            url, sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)
        )


def reset_engines() -> None:
    """Drop every cached engine. Tests call this when they point at a new database."""
    with _LOCK:
        engines = list(_ENGINES.values())
        _ENGINES.clear()
        _SESSIONMAKERS.clear()
    for engine in engines:
        engine.dispose()


def get_session() -> Iterator[Session]:
    """FastAPI dependency: one Session per request, rolled back on the way out."""
    with get_sessionmaker()() as session:
        yield session


@contextmanager
def session_scope(settings: Settings | None = None) -> Iterator[Session]:
    """One transaction for a CLI command or a worker task: commit on success, roll back on error."""
    with get_sessionmaker(settings)() as session:
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
