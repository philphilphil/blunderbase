from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import inspect

from backend.api.app import create_app
from backend.config import Settings
from backend.db.session import get_engine
from tests.conftest import running_app

INDEX = "<!doctype html><title>Blunderbase</title><div id=root></div>"
ASSET = "console.log('blunderbase')"


@pytest.fixture()
def built(settings: Settings) -> Path:
    """A stand-in for `pnpm build`: an index and one hashed asset under `web_dist`."""
    assert settings.web_dist is not None
    dist = settings.web_dist
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text(INDEX)
    (dist / "assets" / "app-1234.js").write_text(ASSET)
    return dist


def test_health_is_served_and_the_database_is_migrated(settings: Settings) -> None:
    with running_app(create_app(settings)) as client:
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


# --- the web app -----------------------------------------------------------


def test_the_routers_answer_under_the_api_prefix(settings: Settings) -> None:
    """What the browser asks for: the dev proxy's prefix, served by the backend itself."""
    with running_app(create_app(settings)) as client:
        assert client.get("/api/games").json() == client.get("/games").json()
        assert client.get("/api/games").status_code == 200


def test_an_unknown_api_path_is_not_answered_with_the_page(
    settings: Settings, built: Path
) -> None:
    response_with_a_build = None
    with running_app(create_app(settings)) as client:
        response_with_a_build = client.get("/api/nope")
    assert response_with_a_build.status_code == 404
    assert INDEX not in response_with_a_build.text


def test_the_web_build_is_served_with_a_fallback_to_the_index(
    settings: Settings, built: Path
) -> None:
    app = create_app(settings)
    assert app.state.web is True
    with running_app(app) as client:
        assert client.get("/").text == INDEX
        assert client.get("/assets/app-1234.js").text == ASSET
        # A client-side route: no file of its own, and a reload has to reach the app.
        assert client.get("/games/7").text == INDEX
        # Spelled like a router, and still the page's: the client reads `/api/games`.
        assert client.get("/games").text == INDEX


def test_the_api_keeps_the_paths_it_reserved(settings: Settings, built: Path) -> None:
    with running_app(create_app(settings)) as client:
        assert client.get("/health").json() == {"status": "ok"}
        assert client.get("/api/games").status_code == 200
        assert client.get("/openapi.json").json()["info"]["title"] == "Blunderbase"
        # Nothing the page could claim: a POST is never the static build's.
        assert client.post("/notes", json={"text": "written by hand"}).status_code == 201


def test_nothing_is_served_when_the_web_app_was_never_built(settings: Settings) -> None:
    """Development: `pnpm dev` has the page and proxies `/api` here."""
    app = create_app(settings)
    assert app.state.web is False
    with running_app(app) as client:
        assert client.get("/").status_code == 404
        assert client.get("/games").status_code == 200
