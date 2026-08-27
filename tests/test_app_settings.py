"""The one app setting there is: the Maia target elo, stored rather than exported.

The service half runs against the in-memory database. The HTTP half drives the real app,
because the point of the setting being a row is that a PUT changes what the *next* thing
the deployment does is asked at — which is only checkable through the app.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.api.app import create_app
from backend.config import MAIA_MAX_RATING, MAIA_MIN_RATING, Settings
from backend.db.enums import Color, EngineKind, Result, Source, Tier
from backend.db.models import AnalysisRun, AppSetting, Engine, Game
from backend.db.session import get_sessionmaker
from backend.services import analysis, app_settings
from tests.conftest import running_app

# --- the service ----------------------------------------------------------


def test_nothing_is_configured_until_somebody_configures_it(session: Session) -> None:
    """An install that never opened the Settings page is the legacy Maia behaviour."""
    assert app_settings.get_maia_target_elo(session) is None


def test_a_stored_target_is_what_comes_back(session: Session) -> None:
    assert app_settings.set_maia_target_elo(session, 1700) == 1700
    assert app_settings.get_maia_target_elo(session) == 1700


def test_setting_it_twice_leaves_one_row(session: Session) -> None:
    app_settings.set_maia_target_elo(session, 1700)
    app_settings.set_maia_target_elo(session, 1300)

    assert app_settings.get_maia_target_elo(session) == 1300
    assert len(session.scalars(select(AppSetting)).all()) == 1


@pytest.mark.parametrize(
    ("given", "expected"),
    [(1700, 1700), (2400, MAIA_MAX_RATING), (800, MAIA_MIN_RATING)],
)
def test_a_target_outside_what_maia_was_trained_on_is_clamped(
    session: Session, given: int, expected: int
) -> None:
    """An owner aiming at 2200 gets Maia's top level, not a form that will not save."""
    assert app_settings.set_maia_target_elo(session, given) == expected
    assert app_settings.get_maia_target_elo(session) == expected


def test_clearing_it_removes_the_row_rather_than_writing_a_null(session: Session) -> None:
    """"Unset" and "set to nothing" have to stay the same state: there is one fallback."""
    app_settings.set_maia_target_elo(session, 1700)

    assert app_settings.set_maia_target_elo(session, None) is None
    assert app_settings.get_maia_target_elo(session) is None
    assert session.scalars(select(AppSetting)).all() == []


def test_clearing_something_nobody_set_is_not_an_error(session: Session) -> None:
    assert app_settings.set_maia_target_elo(session, None) is None


def test_a_row_edited_by_hand_cannot_break_a_caller(session: Session) -> None:
    """The value is JSON in a database a person can open; every reader is downstream."""
    session.add(AppSetting(key=app_settings.MAIA_TARGET_ELO, value="not a rating"))
    session.commit()

    assert app_settings.get_maia_target_elo(session) is None

    session.get(AppSetting, app_settings.MAIA_TARGET_ELO).value = 9000
    session.commit()

    assert app_settings.get_maia_target_elo(session) == MAIA_MAX_RATING


# --- the endpoint ----------------------------------------------------------


@pytest.fixture()
def api(settings: Settings) -> Iterator[TestClient]:
    settings.analysis_workers = False
    with running_app(create_app(settings)) as client:
        yield client


def test_an_unconfigured_deployment_answers_null(api: TestClient) -> None:
    assert api.get("/api/settings").json() == {"maia_target_elo": None}


def test_a_put_stores_the_level_and_answers_with_it(api: TestClient) -> None:
    response = api.put("/api/settings", json={"maia_target_elo": 1700})

    assert response.status_code == 200, response.text
    assert response.json() == {"maia_target_elo": 1700}
    assert api.get("/api/settings").json() == {"maia_target_elo": 1700}


def test_an_out_of_range_level_is_clamped_rather_than_refused(api: TestClient) -> None:
    """The same rule as everywhere else Maia is given a rating; the answer is what is in
    force, which is not always what was sent."""
    assert api.put("/api/settings", json={"maia_target_elo": 2400}).json() == {
        "maia_target_elo": MAIA_MAX_RATING
    }
    assert api.put("/api/settings", json={"maia_target_elo": 800}).json() == {
        "maia_target_elo": MAIA_MIN_RATING
    }


def test_null_clears_it_back_to_the_default_behaviour(api: TestClient) -> None:
    api.put("/api/settings", json={"maia_target_elo": 1700})

    assert api.put("/api/settings", json={"maia_target_elo": None}).json() == {
        "maia_target_elo": None
    }
    assert api.get("/api/settings").json() == {"maia_target_elo": None}


def test_a_value_that_is_not_a_rating_is_a_422(api: TestClient) -> None:
    response = api.put("/api/settings", json={"maia_target_elo": "seventeen hundred"})

    assert response.status_code == 422


def test_a_field_nobody_declared_is_a_422(api: TestClient) -> None:
    """Request bodies are strict, so a typo is refused rather than silently ignored."""
    assert api.put("/api/settings", json={"maia_target_leo": 1700}).status_code == 422


def test_the_bootstrap_payload_moves_with_the_setting(api: TestClient) -> None:
    """`/auth/status` is what every screen renders from, so it reads the same row."""
    api.put("/api/settings", json={"maia_target_elo": 1700})

    assert api.get("/api/auth/status").json()["maia_target_elo"] == 1700


def test_a_plan_built_after_a_put_carries_the_new_level(
    api: TestClient, settings: Settings
) -> None:
    """The point of the setting being a row: no restart between changing it and using it."""
    api.put("/api/settings", json={"maia_target_elo": 1700})

    with get_sessionmaker(settings)() as session:
        session.add(
            Engine(
                name="Stockfish",
                kind=EngineKind.UCI,
                path="/usr/bin/stockfish",
                default_tier=Tier.QUICK,
            )
        )
        game = Game(
            source=Source.PGN,
            dedup_hash="settings-plan",
            white_name="blunderbase",
            black_name="opponent",
            result=Result.BLACK_WIN,
            owner_color=Color.WHITE,
            white_rating=1712,
            pgn="1. e4 e5",
            moves_uci=["e2e4", "e7e5"],
            moves_san=["e4", "e5"],
            ply_count=2,
        )
        session.add(game)
        session.commit()

        run_id = analysis.request_analysis(session, game_id=game.id, settings=settings).id

    # A session apiece, the way the worker builds a plan: one per pass, not one per process.
    with get_sessionmaker(settings)() as session:
        plan = analysis.build_plan(session, session.get(AnalysisRun, run_id), settings)

        assert plan.maia_target_elo == 1700
        # One level for both sides, which is what a target elo means for a run.
        assert plan.maia_plies() == [0, 1]

    api.put("/api/settings", json={"maia_target_elo": None})

    with get_sessionmaker(settings)() as session:
        cleared = analysis.build_plan(session, session.get(AnalysisRun, run_id), settings)

        assert cleared.maia_target_elo is None
        assert cleared.maia_plies() == [0]
