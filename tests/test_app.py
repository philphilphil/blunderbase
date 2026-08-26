from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import inspect

from backend.api.app import create_app
from backend.config import Settings
from backend.db.session import get_engine


def test_health_is_served_and_the_database_is_migrated(settings: Settings) -> None:
    with TestClient(create_app(settings)) as client:
        assert client.get("/health").json() == {"status": "ok"}
    assert inspect(get_engine(settings)).has_table("games")


def test_the_analysis_workers_run_for_as_long_as_the_server_does(settings: Settings) -> None:
    app = create_app(settings)
    with TestClient(app):
        assert app.state.workers.running
    assert not app.state.workers.running


def test_the_workers_can_be_switched_off(settings: Settings) -> None:
    """A deployment that drives the queue from `blunderbase analyze` instead."""
    settings.analysis_workers = False
    app = create_app(settings)
    with TestClient(app):
        assert not app.state.workers.running
