from __future__ import annotations

import asyncio
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import inspect

from backend.api.app import create_app
from backend.config import Settings
from backend.db.enums import Color, Result, RunStatus, Source, Tier
from backend.db.migrate import upgrade_to_head
from backend.db.models import AnalysisRun, Game, MoveEval
from backend.db.session import get_engine, get_sessionmaker
from tests.conftest import running_app

INDEX = "<!doctype html><title>Blunderbase</title><div id=root></div>"
ASSET = "console.log('blunderbase')"
# Comfortably over `GZIP_MINIMUM_SIZE`, and repetitive the way a real bundle is.
BIG_ASSET = "console.log('blunderbase');\n" * 200


@pytest.fixture()
def built(settings: Settings) -> Path:
    """A stand-in for `pnpm build`: an index, one hashed asset, and the engine's glue."""
    assert settings.web_dist is not None
    dist = settings.web_dist
    (dist / "assets").mkdir(parents=True)
    (dist / "engine").mkdir(parents=True)
    (dist / "index.html").write_text(INDEX)
    (dist / "assets" / "app-1234.js").write_text(ASSET)
    (dist / "engine" / "sf_18_smallnet.js").write_text(ASSET)
    return dist


def test_health_is_served_and_the_database_is_migrated(settings: Settings) -> None:
    with running_app(create_app(settings)) as client:
        assert client.get("/health").json() == {"status": "ok"}
    assert inspect(get_engine(settings)).has_table("games")


def test_health_is_answered_on_the_event_loop(settings: Settings) -> None:
    """A `def` here would queue behind a saturated threadpool and time the healthcheck out.

    Asserted on the endpoint rather than by filling the pool: what keeps the check honest
    is that the function is a coroutine one, and that it asks the database nothing.
    """
    routes = [
        route for route in create_app(settings).routes if getattr(route, "path", None) == "/health"
    ]
    assert routes, "no /health route"
    assert all(asyncio.iscoroutinefunction(route.endpoint) for route in routes)


def test_the_analysis_workers_run_for_as_long_as_the_server_does(settings: Settings) -> None:
    app = create_app(settings)
    with TestClient(app):
        assert app.state.workers.running
    assert not app.state.workers.running


def test_the_server_folds_the_stat_summaries_a_library_is_missing(settings: Settings) -> None:
    """A library analysed before the summaries existed is folded without anyone asking.

    Polled rather than waited on: the fold runs in a thread off the lifespan's own task, so
    the assertion is that it happens, not that it has happened by the time startup returns.
    """
    upgrade_to_head(settings)
    with get_sessionmaker(settings)() as session:
        game = Game(
            source=Source.PGN,
            dedup_hash="folded-by-the-server",
            white_name="owner",
            black_name="opponent",
            owner_color=Color.WHITE,
            result=Result.WHITE_WIN,
            pgn="1. e4",
            moves_uci=["e2e4"],
            moves_san=["e4"],
            ply_count=1,
        )
        session.add(game)
        session.commit()
        run = AnalysisRun(game_id=game.id, tier=Tier.QUICK, status=RunStatus.DONE)
        session.add(run)
        session.flush()
        session.add(MoveEval(run_id=run.id, ply=0, win_loss=40.0))
        session.commit()
        game_id, run_id = game.id, run.id

    with TestClient(create_app(settings)):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            with get_sessionmaker(settings)() as session:
                folded = session.get(Game, game_id)
                assert folded is not None
                if folded.stat_summary is not None:
                    assert folded.stat_summary["run_id"] == run_id
                    assert folded.stat_owner_moves == 1
                    break
            time.sleep(0.05)
        else:
            raise AssertionError("the server never folded the library")


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


# --- cross-origin isolation -------------------------------------------------
#
# A multi-threaded WASM engine in a tab needs `SharedArrayBuffer`, and a browser gives the
# page one only when the document arrived cross-origin isolated.


def test_the_document_is_served_cross_origin_isolated(settings: Settings, built: Path) -> None:
    with running_app(create_app(settings)) as client:
        for path in ("/", "/games/7"):
            page = client.get(path)
            assert page.headers["cross-origin-opener-policy"] == "same-origin", path
            assert page.headers["cross-origin-embedder-policy"] == "require-corp", path

        # An ordinary asset needs nothing of its own, and the API, the socket and the
        # transport have no window to isolate.
        asset = client.get("/assets/app-1234.js")
        api = client.get("/api/games")

    assert "cross-origin-opener-policy" not in asset.headers
    assert "cross-origin-embedder-policy" not in api.headers


def test_the_engine_glue_carries_coep_so_its_workers_are_isolated(
    settings: Settings, built: Path
) -> None:
    """The one asset that is not an ordinary asset: it is loaded as a *worker* script.

    A dedicated worker is cross-origin isolated only if its own response asks to be — the
    document's headers do not reach it — and a worker without isolation has no
    `SharedArrayBuffer`. The browser engine is emscripten pthreads, so without this its
    workers die at load, and the failure arrives as an `ErrorEvent` whose message, filename
    and line number are all empty. This test exists because that happened.

    COEP but not COOP: COOP is a property of a browsing context, and a worker has none.
    """
    with running_app(create_app(settings)) as client:
        glue = client.get("/engine/sf_18_smallnet.js")

    assert glue.headers["cross-origin-embedder-policy"] == "require-corp"
    assert glue.headers["cross-origin-resource-policy"] == "same-origin"
    assert "cross-origin-opener-policy" not in glue.headers


def test_isolation_can_be_switched_off(settings: Settings, built: Path) -> None:
    """For a proxy that rewrites the headers, or a page that has to load a cross-origin
    asset: `require-corp` blocks every one that does not opt in with CORP."""
    settings.cross_origin_isolation = False

    with running_app(create_app(settings)) as client:
        page = client.get("/")

    assert page.text == INDEX
    assert "cross-origin-opener-policy" not in page.headers
    assert "cross-origin-embedder-policy" not in page.headers


def test_a_large_response_is_compressed_for_a_client_that_asks(
    settings: Settings, built: Path
) -> None:
    """API JSON and the build's assets both, which is what the middleware's place buys.

    The bytes matter less than the seconds: the connection a handler holds is given back
    only once the body has gone out, so a payload that is a tenth the size is a pooled
    connection held a tenth as long.
    """
    (built / "assets" / "big-1234.js").write_text(BIG_ASSET)
    with running_app(create_app(settings)) as client:
        for path in ("/openapi.json", "/assets/big-1234.js"):
            response = client.get(path, headers={"accept-encoding": "gzip"})
            assert response.status_code == 200, path
            assert response.headers["content-encoding"] == "gzip", path
            # The transport decodes for us, so the header is the compressed length and
            # the body is the original one.
            assert int(response.headers["content-length"]) < len(response.content), path


def test_nothing_is_served_when_the_web_app_was_never_built(settings: Settings) -> None:
    """Development: `pnpm dev` has the page and proxies `/api` here."""
    app = create_app(settings)
    assert app.state.web is False
    with running_app(app) as client:
        assert client.get("/").status_code == 404
        assert client.get("/games").status_code == 200
