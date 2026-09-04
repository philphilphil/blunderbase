from __future__ import annotations

import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.exc import OperationalError
from sqlalchemy.exc import TimeoutError as PoolTimeoutError
from sqlalchemy.orm import Session, sessionmaker

from backend.config import Settings, get_settings

# Shared by HTTP, imports, MCP and both kinds of analysis host. Local queue work is bounded
# to one connection in `workers.analysis_queue`; this pool supplies foreground headroom and
# short bursts elsewhere rather than being the queue's concurrency control.
#
# The ceiling is deliberately generous. A SQLite connection is a file handle, not a seat on
# a server, so an idle one costs a few kilobytes and no remote resource at all; what really
# bounds how much work is in flight is anyio's worker threadpool — 40 tokens, which every
# `def` handler and every `to_thread.run_sync` queues for — plus the bounded background
# users. So the ceiling is here to make a connection *leak* fail loudly rather than to
# ration connections, and it is sized so that sessions which are merely finished cannot
# reach it: `get_session` holds its connection until the generator's cleanup gets a thread,
# so under saturation many more sessions than there are running requests are each holding
# one while they queue for a slot to let go in.
POOL_SIZE = 10
MAX_OVERFLOW = 150
# What a caller waits for a connection before it is told there is none. Deliberately short:
# a pool with nothing left is a server that is already overloaded, and the useful answer is
# an error the caller sees in seconds rather than sixty request threads each hanging for
# half a minute on a queue that is not moving.
POOL_TIMEOUT_SECONDS = 5

SQLITE_PREFIX = "sqlite+pysqlite:///"
BUSY_TIMEOUT_MS = 5000


def database_backpressure(exc: BaseException) -> bool:
    """Whether retrying the same transaction later is the correct response.

    Lives here rather than with either caller because both the analysis workers and the
    import pipeline have to tell "the one writer is busy" apart from "this work is wrong",
    and a second copy of the answer is how the two drift. A full pool and SQLite's
    busy/locked answer are the whole list: a missing table or an invalid statement is a bug
    and must reach the caller on the first try.
    """
    if isinstance(exc, PoolTimeoutError):
        return True
    if not isinstance(exc, OperationalError):
        return False
    message = str(exc).lower()
    return "database is locked" in message or "database is busy" in message


def sqlite_path(url: str) -> Path | None:
    """The file a SQLite URL points at, or None for the in-memory ones."""
    if not url.startswith(SQLITE_PREFIX):
        return None
    tail = url[len(SQLITE_PREFIX) :]
    return Path(tail) if tail and tail != ":memory:" else None


def _install_sqlite_pragmas(engine: Engine) -> None:
    """WAL, foreign keys and a busy timeout, on this engine's connections only.

    WAL is what lets the analysis workers read while a run commits, and the pragmas are
    per-connection, so they have to be set on every one the pool opens. The listener is
    bound to the engine rather than to the `Engine` class, so it reaches this engine's
    connections and nobody else's.

    `synchronous=NORMAL` is the pairing WAL is designed for: a commit no longer waits on an
    fsync, and what that costs is the last few transactions if the *machine* loses power —
    a process that crashes takes nothing with it, because the WAL is already on disk. For a
    database of chess games that is the right side of the trade, and it is what stops a
    burst of small writes serialising into a queue nobody drains in time.
    """

    @event.listens_for(engine, "connect")
    def _configure(dbapi_connection: Any, _record: Any) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute(f"PRAGMA busy_timeout={BUSY_TIMEOUT_MS}")
        cursor.close()


def create_db_engine(url: str, **kwargs: Any) -> Engine:
    """Build an engine for `url`, with the pragmas installed and its directory made."""
    path = sqlite_path(url)
    if path is not None:
        path.parent.mkdir(parents=True, exist_ok=True)
    options: dict[str, Any] = {"future": True}
    if "poolclass" not in kwargs:
        options |= {
            "pool_size": POOL_SIZE,
            "max_overflow": MAX_OVERFLOW,
            "pool_timeout": POOL_TIMEOUT_SECONDS,
        }
    options |= kwargs
    engine = create_engine(url, **options)
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
