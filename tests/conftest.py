from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.auth import COOKIE_NAME
from backend.config import Settings, get_settings
from backend.db import models  # noqa: F401  (importing registers every table on Base.metadata)
from backend.db.base import Base
from backend.db.session import create_db_engine, reset_engines
from backend.services.stats import reset_stats_cache

FIXTURES = Path(__file__).parent / "fixtures"

# The app has one user and every route is behind it, so a test that drives the API signs
# in first. `running_app` is the whole of that ceremony.
OWNER_PASSWORD = "correct-horse-battery"
# Loopback rather than `testserver`: the session cookie carries `Secure` anywhere else,
# and a `Secure` cookie is never sent back over the plain HTTP the test transport speaks.
API_BASE_URL = "http://127.0.0.1:8765"

@pytest.fixture(autouse=True)
def _fresh_stats_cache() -> Iterator[None]:
    """No test is answered out of another test's library.

    The stats service keeps its payloads for a few seconds, keyed by the dimension and the
    filters and by nothing that says which database produced them. One process serves one
    library, so that is a cache; a suite where every test builds its own is the one place
    it would be a leak, and this is where it is closed.
    """
    reset_stats_cache()
    yield
    reset_stats_cache()


@pytest.fixture()
def engine() -> Iterator[Engine]:
    """One in-memory database per test.

    StaticPool hands every connection in the test the same one, which is what keeps an
    in-memory database alive across Sessions and across the threads a worker may use.
    """
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
    get_settings.cache_clear()
    reset_engines()
    yield get_settings()
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
    """Keep the default run free of real engine binaries and of real waiting.

    Two markers, deselected the same way and for the same reason — the default run is the
    one someone types between edits, and it should answer in seconds.

    `engine` wants a real Stockfish or Maia; engine adapters are otherwise covered by
    scripted fake UCI processes. `slow` is the handful that wait on a wall clock rather
    than on an event — a reconnect window running out, a shutdown grace period — which is
    forty of the suite's hundred-odd seconds in seven tests. Neither is optional: CI runs
    `-m slow` beside the default run, and `release.yml` runs CI before it deploys, so a tag
    that ships is a tag both passed on. What you lose locally is the runner client's
    reconnect and shutdown behaviour, so `-m slow` is worth typing before a release or
    after touching `backend/runners/`.
    """
    asked = config.getoption("-m") or ""
    for marker, why in (
        ("engine", "needs a real engine binary; run with -m engine"),
        ("slow", "waits on a real clock; run with -m slow"),
    ):
        if marker in asked:
            continue
        skip = pytest.mark.skip(reason=why)
        for item in items:
            if marker in item.keywords:
                item.add_marker(skip)
