from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool, StaticPool

from backend.config import Settings, get_settings
from backend.db import models  # noqa: F401  (importing registers every table on Base.metadata)
from backend.db.base import Base
from backend.db.session import create_db_engine, reset_engines

FIXTURES = Path(__file__).parent / "fixtures"

# The PostgreSQL escape hatch is only honest if the suite runs against it. Set this to a
# SQLAlchemy URL and every test that takes a database — the `engine` fixture's in-memory
# one and the `settings` fixture's migrated one — uses that server instead of SQLite. CI
# runs the suite both ways; the database is emptied around each test either way.
TEST_DATABASE_URL = os.environ.get("BLUNDERBASE_TEST_DATABASE_URL", "").strip()


def _empty(engine: Engine) -> None:
    """Take the database back to nothing at all, migrations bookkeeping included."""
    Base.metadata.drop_all(engine)
    with engine.begin() as connection:
        connection.execute(text("DROP TABLE IF EXISTS alembic_version"))


def _empty_url(url: str) -> None:
    engine = create_db_engine(url, poolclass=NullPool)
    try:
        _empty(engine)
    finally:
        engine.dispose()


@pytest.fixture()
def engine() -> Iterator[Engine]:
    """One in-memory database per test, or the configured PostgreSQL one.

    StaticPool hands every connection in the test the same one, which is what keeps an
    in-memory database alive across Sessions and across the threads a worker may use.
    """
    if TEST_DATABASE_URL:
        engine = create_db_engine(TEST_DATABASE_URL, poolclass=NullPool)
        _empty(engine)
        Base.metadata.create_all(engine)
        yield engine
        _empty(engine)
        engine.dispose()
        return

    engine = create_db_engine(
        "sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture()
def sessions(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


@pytest.fixture()
def session(sessions: sessionmaker[Session]) -> Iterator[Session]:
    with sessions() as session:
        yield session


@pytest.fixture()
def settings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Settings]:
    """A file-backed database under `tmp_path`, for anything that needs real migrations."""
    monkeypatch.setenv("BLUNDERBASE_ROOT", str(tmp_path))
    monkeypatch.setenv("BLUNDERBASE_DB_PATH", str(tmp_path / "blunderbase.db"))
    # An operator's own exported environment must not decide what the suite tests.
    monkeypatch.delenv("BLUNDERBASE_MCP_BEARER_KEY", raising=False)
    monkeypatch.delenv("BLUNDERBASE_ANALYSIS_CONCURRENCY", raising=False)
    monkeypatch.delenv("BLUNDERBASE_DATABASE_URL", raising=False)
    if TEST_DATABASE_URL:
        monkeypatch.setenv("BLUNDERBASE_DATABASE_URL", TEST_DATABASE_URL)
    get_settings.cache_clear()
    reset_engines()
    resolved = get_settings()
    if TEST_DATABASE_URL:
        _empty_url(TEST_DATABASE_URL)
    yield resolved
    if TEST_DATABASE_URL:
        _empty_url(TEST_DATABASE_URL)
    get_settings.cache_clear()
    reset_engines()


@pytest.fixture()
def fixtures_dir() -> Path:
    return FIXTURES


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """Keep the default run free of real engine binaries, and of SQLite-only assertions
    when the suite is pointed at PostgreSQL.

    Engine adapters are covered by scripted fake UCI processes; the `engine` marker is for
    the suite that wants a real Stockfish or Maia, and `-m engine` is how it is asked for.
    """
    if TEST_DATABASE_URL:
        elsewhere = pytest.mark.skip(reason="the suite is running against PostgreSQL")
        for item in items:
            if "sqlite" in item.keywords:
                item.add_marker(elsewhere)
    if "engine" in (config.getoption("-m") or ""):
        return
    skip = pytest.mark.skip(reason="needs a real engine binary; run with -m engine")
    for item in items:
        if "engine" in item.keywords:
            item.add_marker(skip)
