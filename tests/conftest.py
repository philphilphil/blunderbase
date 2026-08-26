from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool, StaticPool

from backend.api.auth import COOKIE_NAME
from backend.config import Settings, get_settings
from backend.db import models  # noqa: F401  (importing registers every table on Base.metadata)
from backend.db.base import Base
from backend.db.session import create_db_engine, reset_engines

FIXTURES = Path(__file__).parent / "fixtures"

# The app has one user and every route is behind it, so a test that drives the API signs
# in first. `running_app` is the whole of that ceremony.
OWNER_PASSWORD = "correct-horse-battery"
# Loopback rather than `testserver`: the session cookie carries `Secure` anywhere else,
# and a `Secure` cookie is never sent back over the plain HTTP the test transport speaks.
API_BASE_URL = "http://127.0.0.1:8765"

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


@contextmanager
def running_app(
    app: FastAPI, *, password: str | None = OWNER_PASSWORD, **kwargs: Any
) -> Iterator[TestClient]:
    """The app under a `TestClient`, through first-run setup and signed in.

    `password=None` leaves the deployment unconfigured, which is what the auth tests want
    and nothing else does.
    """
    with TestClient(app, base_url=API_BASE_URL, **kwargs) as client:
        if password is not None:
            response = client.post("/auth/setup", json={"password": password})
            assert response.status_code == 200, response.text
        yield client


def socket_headers(client: TestClient) -> dict[str, str]:
    """The session cookie, spelled out for `websocket_connect`.

    A browser offers its cookies on a WebSocket handshake to the same origin; the test
    transport hardcodes `ws://testserver` and therefore offers nothing the jar collected
    under the loopback host the HTTP calls used. Handing it over explicitly is the
    difference, and it is the test's, not the app's.
    """
    return {"cookie": f"{COOKIE_NAME}={client.cookies[COOKIE_NAME]}"}


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
