"""The settings that are stored rather than exported: what they mean, and what a PUT does.

The service half runs against the in-memory database. The HTTP half drives the real app,
because the point of a setting being a row is that a PUT changes what the *next* thing the
deployment does is asked at — which is only checkable through the app.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from alembic import command
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from backend.api.app import create_app
from backend.config import MAIA_MAX_RATING, MAIA_MIN_RATING, Settings
from backend.db.enums import Color, EngineKind, Result, Source, Tier
from backend.db.migrate import alembic_config, upgrade_to_head
from backend.db.models import AnalysisRun, AppSetting, Engine, Game
from backend.db.session import get_sessionmaker
from backend.services import analysis, app_settings
from backend.services import engines as engines_service
from tests.conftest import running_app

# Every key cleared, which is what an install that never opened the page has stored.
NOTHING_SET: dict[str, None] = {key: None for key in app_settings.KEYS}

# The same install as the endpoint answers it. The Maia levels are the one setting answered
# with what is in force rather than with the row, because Maia is always asked at a rating.
UNCONFIGURED: dict[str, Any] = {
    **NOTHING_SET,
    app_settings.MAIA_TARGET_ELO: MAIA_MAX_RATING,
    app_settings.MAIA_ELOS: [MAIA_MAX_RATING],
}

# --- the service ----------------------------------------------------------


def test_nothing_is_configured_until_somebody_configures_it(session: Session) -> None:
    """An install that never opened the Settings page runs on the defaults."""
    assert app_settings.read(session) == NOTHING_SET
    assert app_settings.get_maia_target_elo(session) == MAIA_MAX_RATING
    assert app_settings.get_quick_nodes(session) == app_settings.QUICK_NODES_DEFAULT
    assert app_settings.get_deep_nodes(session) == app_settings.DEEP_NODES_DEFAULT
    assert app_settings.get_deep_multipv(session) == app_settings.DEEP_MULTIPV_DEFAULT
    assert app_settings.get_thresholds(session) == (5.0, 10.0, 15.0)
    # The quick pass pays for Maia and the deep pass does not, over both sides of the board.
    assert app_settings.get_maia_on_quick(session) is True
    assert app_settings.get_maia_on_deep(session) is False
    assert app_settings.get_maia_both_sides(session) is True


def test_which_tier_a_maia_pass_belongs_to_is_the_tiers_own_setting(session: Session) -> None:
    assert app_settings.maia_for_tier(session, Tier.QUICK) is True
    assert app_settings.maia_for_tier(session, Tier.DEEP) is False

    app_settings.set_value(session, app_settings.MAIA_ON_QUICK, 0)
    app_settings.set_value(session, app_settings.MAIA_ON_DEEP, 1)

    assert app_settings.maia_for_tier(session, Tier.QUICK) is False
    assert app_settings.maia_for_tier(session, Tier.DEEP) is True


@pytest.mark.parametrize(
    ("key", "given", "expected"),
    [
        (app_settings.MAIA_TARGET_ELO, 1700, 1700),
        (app_settings.QUICK_NODES, 50_000, 50_000),
        (app_settings.DEEP_NODES, 5_000_000, 5_000_000),
        (app_settings.DEEP_MULTIPV, 6, 6),
        (app_settings.INACCURACY_THRESHOLD, 7.5, 7.5),
        (app_settings.MISTAKE_THRESHOLD, 21, 21.0),
        (app_settings.BLUNDER_THRESHOLD, 44, 44.0),
        (app_settings.MAIA_ON_QUICK, 0, 0),
        (app_settings.MAIA_ON_DEEP, 1, 1),
        (app_settings.MAIA_BOTH_SIDES, 0, 0),
    ],
)
def test_a_stored_value_is_what_comes_back(
    session: Session, key: str, given: float, expected: float
) -> None:
    assert app_settings.set_value(session, key, given) == expected
    assert app_settings.stored(session, key) == expected


@pytest.mark.parametrize(
    ("key", "given", "expected"),
    [
        # An owner aiming at 2200 gets Maia's top level, not a form that will not save.
        (app_settings.MAIA_TARGET_ELO, 2400, MAIA_MAX_RATING),
        (app_settings.MAIA_TARGET_ELO, 800, MAIA_MIN_RATING),
        # A budget of no nodes at all is not a cheaper pass, it is no pass.
        (app_settings.QUICK_NODES, 0, app_settings.MIN_NODES),
        (app_settings.DEEP_NODES, -5, app_settings.MIN_NODES),
        (app_settings.DEEP_MULTIPV, 99, app_settings.MAX_MULTIPV),
        (app_settings.DEEP_MULTIPV, 0, app_settings.MIN_MULTIPV),
        # Win percentage is the whole of the scale, either way.
        (app_settings.INACCURACY_THRESHOLD, -3, app_settings.MIN_THRESHOLD),
        (app_settings.BLUNDER_THRESHOLD, 250, app_settings.MAX_THRESHOLD),
        # A flag is off, on, and nothing in between for a stray number to land on.
        (app_settings.MAIA_ON_QUICK, 7, app_settings.FLAG_ON),
        (app_settings.MAIA_ON_DEEP, -1, app_settings.FLAG_OFF),
    ],
)
def test_a_value_outside_what_a_setting_can_mean_is_clamped(
    session: Session, key: str, given: float, expected: float
) -> None:
    assert app_settings.set_value(session, key, given) == expected
    assert app_settings.stored(session, key) == expected


def test_setting_one_twice_leaves_one_row(session: Session) -> None:
    app_settings.set_value(session, app_settings.MAIA_TARGET_ELO, 1700)
    app_settings.set_value(session, app_settings.MAIA_TARGET_ELO, 1300)

    assert app_settings.get_maia_target_elo(session) == 1300
    assert len(session.scalars(select(AppSetting)).all()) == 1


def test_clearing_one_removes_the_row_rather_than_writing_a_null(session: Session) -> None:
    """"Unset" and "set to nothing" have to stay the same state: there is one fallback."""
    app_settings.set_value(session, app_settings.QUICK_NODES, 50_000)

    assert app_settings.set_value(session, app_settings.QUICK_NODES, None) is None
    assert app_settings.stored(session, app_settings.QUICK_NODES) is None
    assert app_settings.get_quick_nodes(session) == app_settings.QUICK_NODES_DEFAULT
    assert session.scalars(select(AppSetting)).all() == []


def test_clearing_the_target_elo_puts_it_back_to_the_default_level(session: Session) -> None:
    """None is not a third state: there is one level, and clearing chooses the default."""
    app_settings.set_maia_target_elo(session, 1700)

    assert app_settings.set_maia_target_elo(session, None) == MAIA_MAX_RATING
    assert app_settings.stored(session, app_settings.MAIA_TARGET_ELO) is None
    assert app_settings.get_maia_target_elo(session) == MAIA_MAX_RATING


def test_a_row_edited_by_hand_cannot_break_a_caller(session: Session) -> None:
    """The value is JSON in a database a person can open; every reader is downstream."""
    session.add(AppSetting(key=app_settings.MAIA_TARGET_ELO, value="not a rating"))
    session.add(AppSetting(key=app_settings.QUICK_NODES, value=True))
    session.commit()

    assert app_settings.get_maia_target_elo(session) == MAIA_MAX_RATING
    assert app_settings.get_quick_nodes(session) == app_settings.QUICK_NODES_DEFAULT

    session.get(AppSetting, app_settings.MAIA_TARGET_ELO).value = 9000
    session.commit()

    assert app_settings.get_maia_target_elo(session) == MAIA_MAX_RATING


# --- the Maia levels -------------------------------------------------------


def test_an_install_that_configured_nothing_asks_maia_at_its_top_level(session: Session) -> None:
    assert app_settings.get_maia_elos(session) == [MAIA_MAX_RATING]
    assert app_settings.get_maia_target_elo(session) == MAIA_MAX_RATING


def test_the_levels_come_back_sorted_deduped_and_clamped(session: Session) -> None:
    """Out of range is pulled in, not refused, and the order is the one a column reads in."""
    assert app_settings.set_maia_elos(session, [1900, 800, 1500, 1900, 2400]) == [
        MAIA_MIN_RATING,
        1500,
        1900,
        MAIA_MAX_RATING,
    ]
    assert app_settings.get_maia_elos(session) == [MAIA_MIN_RATING, 1500, 1900, MAIA_MAX_RATING]
    # The first of them is what a caller that shows one level reads.
    assert app_settings.get_maia_target_elo(session) == MAIA_MIN_RATING


def test_more_levels_than_a_deployment_may_carry_keeps_the_lowest(session: Session) -> None:
    given = [1100, 1200, 1300, 1400, 1500, 1600, 1700]

    assert app_settings.set_maia_elos(session, given) == given[: app_settings.MAX_MAIA_ELOS]


def test_levels_that_are_not_ratings_are_dropped_rather_than_refused(session: Session) -> None:
    assert app_settings.clean_maia_elos(["1500", None, True, 1500]) == [1500]
    assert app_settings.clean_maia_elos([]) == [MAIA_MAX_RATING]
    assert app_settings.clean_maia_elos("all of them") == [MAIA_MAX_RATING]


def test_clearing_the_levels_puts_them_back_to_the_default(session: Session) -> None:
    app_settings.set_maia_elos(session, [1500, 1900])

    assert app_settings.set_maia_elos(session, None) == [MAIA_MAX_RATING]
    assert session.scalars(select(AppSetting)).all() == []


def test_the_target_elo_is_the_list_of_one_it_means(session: Session) -> None:
    """The single-level setter and the list are one state, not two that can disagree."""
    assert app_settings.set_maia_target_elo(session, 1700) == 1700
    assert app_settings.get_maia_elos(session) == [1700]

    app_settings.set_maia_elos(session, [1300, 1700])

    assert app_settings.get_maia_target_elo(session) == 1300


def test_a_target_elo_row_from_before_the_list_is_still_read(session: Session) -> None:
    """A row written by hand, or by a version that only knew one level."""
    session.add(AppSetting(key=app_settings.MAIA_TARGET_ELO, value=1700))
    session.commit()

    assert app_settings.get_maia_elos(session) == [1700]


def test_a_levels_row_edited_by_hand_cannot_break_a_caller(session: Session) -> None:
    session.add(AppSetting(key=app_settings.MAIA_ELOS, value="1500 and 1900"))
    session.commit()

    assert app_settings.get_maia_elos(session) == [MAIA_MAX_RATING]

    session.get(AppSetting, app_settings.MAIA_ELOS).value = [9000, 1500]
    session.commit()

    assert app_settings.get_maia_elos(session) == [1500, MAIA_MAX_RATING]


def test_the_migration_turns_the_old_target_elo_into_the_list(settings: Settings) -> None:
    """A deployment aiming at 1700 keeps aiming at 1700, as the only entry of its list.

    Driven through the real migrations both ways: back to the state a deployment from
    before the list was in, then up again.

    The revision is named rather than counted from the head. `-1` was one behind the list
    migration only for as long as it was the newest one; the next migration to land moved
    it, and the test went on passing over a downgrade that no longer undid what it meant to
    (`test_auth` names its revision for the same reason).
    """
    upgrade_to_head(settings)
    config = alembic_config(settings)
    command.downgrade(config, "0007_notes_lines")
    with get_sessionmaker(settings)() as session:
        session.execute(text("DELETE FROM app_settings"))
        session.execute(
            text(
                "INSERT INTO app_settings (key, value, updated_at) "
                "VALUES ('maia_target_elo', '1700', :now)"
            ),
            {"now": "2026-08-01 12:00:00"},
        )
        session.commit()

    command.upgrade(config, "head")

    with get_sessionmaker(settings)() as session:
        assert app_settings.get_maia_elos(session) == [1700]
        # The old key is gone, so the two can never disagree about what is in force.
        assert session.get(AppSetting, app_settings.MAIA_TARGET_ELO) is None
        assert session.get(AppSetting, app_settings.MAIA_ELOS).value == [1700]


def test_the_migration_leaves_an_unconfigured_deployment_unconfigured(
    settings: Settings,
) -> None:
    upgrade_to_head(settings)

    with get_sessionmaker(settings)() as session:
        assert session.scalars(select(AppSetting)).all() == []
        assert app_settings.get_maia_elos(session) == [MAIA_MAX_RATING]


def test_a_whole_replacement_clears_what_it_leaves_out(session: Session) -> None:
    app_settings.set_value(session, app_settings.DEEP_NODES, 5_000_000)

    assert app_settings.replace(session, {app_settings.QUICK_NODES: 1000}) == {
        **NOTHING_SET,
        app_settings.QUICK_NODES: 1000,
    }
    assert app_settings.get_deep_nodes(session) == app_settings.DEEP_NODES_DEFAULT


@pytest.mark.parametrize(
    "values",
    [
        {"inaccuracy_threshold": 30, "mistake_threshold": 20, "blunder_threshold": 10},
        {"inaccuracy_threshold": 10, "mistake_threshold": 10, "blunder_threshold": 30},
        # The two given are fine; it is the third, left to its default 30, that is not.
        {"inaccuracy_threshold": 40, "mistake_threshold": 50},
    ],
    ids=["falling", "equal", "against the default underneath"],
)
def test_thresholds_that_do_not_rise_are_refused(
    session: Session, values: dict[str, float]
) -> None:
    """The one thing no clamp rescues: an inaccuracy that costs more than a blunder."""
    with pytest.raises(app_settings.SettingsError, match="have to rise"):
        app_settings.replace(session, values)


def test_a_refused_set_of_thresholds_writes_nothing(session: Session) -> None:
    app_settings.set_value(session, app_settings.QUICK_NODES, 1000)

    with pytest.raises(app_settings.SettingsError):
        app_settings.replace(
            session,
            {
                app_settings.QUICK_NODES: 2000,
                app_settings.INACCURACY_THRESHOLD: 40,
                app_settings.MISTAKE_THRESHOLD: 20,
            },
        )

    assert app_settings.get_quick_nodes(session) == 1000


# --- the endpoint ----------------------------------------------------------


@pytest.fixture()
def api(settings: Settings) -> Iterator[TestClient]:
    settings.analysis_workers = False
    with running_app(create_app(settings)) as client:
        yield client


def test_an_unconfigured_deployment_answers_null_for_everything_but_the_level(
    api: TestClient,
) -> None:
    """Null is "nobody set this one" — except for the level Maia is always asked at."""
    assert api.get("/api/settings").json() == UNCONFIGURED


def test_a_put_stores_the_values_and_answers_with_them(api: TestClient) -> None:
    body: dict[str, Any] = {
        "maia_target_elo": 1700,
        "quick_nodes": 50_000,
        "deep_nodes": 5_000_000,
        "deep_multipv": 6,
        "inaccuracy_threshold": 5,
        "mistake_threshold": 15,
        "blunder_threshold": 25,
    }
    response = api.put("/api/settings", json=body)

    assert response.status_code == 200, response.text
    # The one level asked for is the whole of the levels in force. Every key the body left
    # out is cleared, which is what a PUT means, so they answer null.
    assert response.json() == {
        **NOTHING_SET,
        **body,
        "inaccuracy_threshold": 5.0,
        "maia_elos": [1700],
    }
    assert api.get("/api/settings").json()["deep_multipv"] == 6


def test_a_put_is_the_whole_of_the_settings_rather_than_a_patch(api: TestClient) -> None:
    api.put("/api/settings", json={"quick_nodes": 50_000, "deep_nodes": 5_000_000})

    assert api.put("/api/settings", json={"quick_nodes": 60_000}).json() == {
        **UNCONFIGURED,
        "quick_nodes": 60_000,
    }


def test_an_out_of_range_value_is_clamped_rather_than_refused(api: TestClient) -> None:
    """The answer is what is in force, which is not always what was sent."""
    answered = api.put(
        "/api/settings", json={"maia_target_elo": 2400, "deep_multipv": 99, "quick_nodes": 0}
    ).json()

    assert answered["maia_target_elo"] == MAIA_MAX_RATING
    assert answered["deep_multipv"] == app_settings.MAX_MULTIPV
    assert answered["quick_nodes"] == app_settings.MIN_NODES


def test_null_puts_the_level_back_to_the_default(api: TestClient) -> None:
    api.put("/api/settings", json={"maia_target_elo": 1700})

    assert api.put("/api/settings", json={"maia_target_elo": None}).json() == UNCONFIGURED
    assert api.get("/api/settings").json()["maia_target_elo"] == MAIA_MAX_RATING


def test_a_put_stores_the_whole_list_of_levels(api: TestClient) -> None:
    answered = api.put("/api/settings", json={"maia_elos": [1900, 1500, 1500]}).json()

    assert answered["maia_elos"] == [1500, 1900]
    assert answered["maia_target_elo"] == 1500
    assert api.get("/api/settings").json()["maia_elos"] == [1500, 1900]


def test_a_put_that_names_only_the_old_target_elo_means_that_one_level(api: TestClient) -> None:
    """The field a client from before the list sent still says what it always said."""
    assert api.put("/api/settings", json={"maia_target_elo": 1700}).json()["maia_elos"] == [1700]


def test_a_put_that_names_neither_clears_the_levels(api: TestClient) -> None:
    api.put("/api/settings", json={"maia_elos": [1500, 1900]})

    assert api.put("/api/settings", json={"quick_nodes": 1000}).json()["maia_elos"] == [
        MAIA_MAX_RATING
    ]


def test_the_bootstrap_payload_carries_every_level(api: TestClient) -> None:
    api.put("/api/settings", json={"maia_elos": [1500, 1900]})

    status = api.get("/api/auth/status").json()

    assert status["maia_elos"] == [1500, 1900]
    assert status["maia_target_elo"] == 1500


def test_thresholds_that_do_not_rise_are_a_422(api: TestClient) -> None:
    response = api.put(
        "/api/settings",
        json={"inaccuracy_threshold": 30, "mistake_threshold": 20, "blunder_threshold": 10},
    )

    assert response.status_code == 422
    body = response.json()
    assert body["error"] == "invalid_settings"
    assert "inaccuracy < mistake < blunder" in body["detail"]
    # Refused whole: the deployment is exactly as it was.
    assert api.get("/api/settings").json() == UNCONFIGURED


def test_a_value_that_is_not_a_number_is_a_422(api: TestClient) -> None:
    response = api.put("/api/settings", json={"maia_target_elo": "seventeen hundred"})

    assert response.status_code == 422


def test_a_field_nobody_declared_is_a_422(api: TestClient) -> None:
    """Request bodies are strict, so a typo is refused rather than silently ignored."""
    assert api.put("/api/settings", json={"maia_target_leo": 1700}).status_code == 422


def test_the_bootstrap_payload_moves_with_the_setting(api: TestClient) -> None:
    """`/auth/status` is what every screen renders from, so it reads the same row."""
    api.put("/api/settings", json={"maia_target_elo": 1700})

    assert api.get("/api/auth/status").json()["maia_target_elo"] == 1700


def _seed(session: Session) -> Game:
    engine = Engine(name="Stockfish", kind=EngineKind.UCI, path="/usr/bin/stockfish")
    session.add(engine)
    session.commit()
    engines_service.assign_default_roles(session, engine)
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
    return game


def test_a_plan_built_after_a_put_carries_the_new_level(
    api: TestClient, settings: Settings
) -> None:
    """The point of the setting being a row: no restart between changing it and using it."""
    api.put("/api/settings", json={"maia_target_elo": 1700})

    with get_sessionmaker(settings)() as session:
        run_id = analysis.request_analysis(session, game_id=_seed(session).id).id

    # A session apiece, the way the worker builds a plan: one per pass, not one per process.
    with get_sessionmaker(settings)() as session:
        plan = analysis.build_plan(session, session.get(AnalysisRun, run_id))

        assert plan.maia_target_elo == 1700
        # One level for both sides, which is what a target elo means for a run.
        assert plan.maia_plies() == [0, 1]

    api.put("/api/settings", json={"maia_target_elo": None})

    with get_sessionmaker(settings)() as session:
        cleared = analysis.build_plan(session, session.get(AnalysisRun, run_id))

        # Cleared is the default level, not a different kind of run.
        assert cleared.maia_target_elo == MAIA_MAX_RATING
        assert cleared.maia_plies() == [0, 1]


def test_a_run_queued_after_a_put_carries_the_new_budget(
    api: TestClient, settings: Settings
) -> None:
    """A budget is baked into the run when it is queued, not looked up when it runs."""
    api.put("/api/settings", json={"quick_nodes": 4321, "deep_nodes": 8765, "deep_multipv": 7})

    with get_sessionmaker(settings)() as session:
        game = _seed(session)
        quick = analysis.request_analysis(session, game_id=game.id)
        deep = analysis.request_analysis(session, game_id=game.id, tier=Tier.DEEP)

        assert (quick.nodes, quick.multipv) == (4321, 1)
        assert (deep.nodes, deep.multipv) == (8765, 7)


def test_a_run_queued_after_a_put_carries_the_maia_pass_its_tier_was_given(
    api: TestClient, settings: Settings
) -> None:
    """Whether Maia runs is settled at enqueue, alongside the budget, and lives on the row."""
    api.put("/api/settings", json={"maia_on_quick": 0, "maia_on_deep": 1})

    with get_sessionmaker(settings)() as session:
        game = _seed(session)
        quick = analysis.request_analysis(session, game_id=game.id)
        deep = analysis.request_analysis(session, game_id=game.id, tier=Tier.DEEP)

        assert (quick.maia, deep.maia) == (False, True)


def test_a_plan_built_after_a_put_asks_maia_about_the_owners_moves_only(
    api: TestClient, settings: Settings
) -> None:
    """Both sides is a live setting, not a column: the next plan built is the new answer."""
    with get_sessionmaker(settings)() as session:
        run_id = analysis.request_analysis(session, game_id=_seed(session).id).id

    api.put("/api/settings", json={"maia_both_sides": 0})

    with get_sessionmaker(settings)() as session:
        plan = analysis.build_plan(session, session.get(AnalysisRun, run_id))

        # The owner has White in `_seed`, so their own move is the one even ply.
        assert plan.maia_plies() == [0]


def test_a_plan_built_after_a_put_carries_the_new_thresholds(
    api: TestClient, settings: Settings
) -> None:
    api.put(
        "/api/settings",
        json={"inaccuracy_threshold": 4, "mistake_threshold": 12, "blunder_threshold": 25},
    )

    with get_sessionmaker(settings)() as session:
        run = analysis.request_analysis(session, game_id=_seed(session).id)
        plan = analysis.build_plan(session, run)

        assert plan.thresholds == analysis.Thresholds(inaccuracy=4.0, mistake=12.0, blunder=25.0)


def test_a_game_with_no_rating_says_so_rather_than_inventing_one(
    api: TestClient, settings: Settings
) -> None:
    """What the plan says the owner was rated where the game itself does not say.

    Nothing: an OTB PGN carries no rating, and a number nobody measured standing in for it
    would be a fact about the player invented by the importer.
    """
    with get_sessionmaker(settings)() as session:
        game = _seed(session)
        game.white_rating = None
        session.commit()
        plan = analysis.build_plan(session, analysis.request_analysis(session, game_id=game.id))

        assert plan.owner_rating is None
        # Which is not the level Maia is asked at: that is the deployment's, not the game's.
        assert plan.maia_target_elo == MAIA_MAX_RATING
