"""The rules of a run: win percentages, classification, the queue and its transitions."""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

import pytest
from sqlalchemy import event as sa_event
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from backend.adapters.maia import PolicyMove
from backend.adapters.pool import EngineSpec
from backend.adapters.stockfish import UciOption
from backend.config import MAIA_MAX_RATING, Settings
from backend.db.enums import (
    Classification,
    Color,
    EngineKind,
    Result,
    RunStatus,
    Source,
    Tier,
)
from backend.db.models import AnalysisRun, Engine, Game, MoveEval
from backend.db.types import utcnow
from backend.services import analysis, app_settings, explorer, stats
from backend.services import engines as engines_service
from backend.services import games as games_service
from backend.services.engines import TierUnavailableError

THRESHOLDS = analysis.Thresholds(inaccuracy=10.0, mistake=20.0, blunder=30.0)


def _engine(session: Session, **changes: Any) -> Engine:
    engine = Engine(
        name=changes.pop("name", "Stockfish"),
        kind=changes.pop("kind", EngineKind.UCI),
        path=changes.pop("path", "/usr/bin/stockfish"),
        enabled=changes.pop("enabled", True),
        **changes,
    )
    session.add(engine)
    session.commit()
    # As `add_engine` does: the first engine of a kind takes the roles it fits, so a test
    # that registers one engine has a deployment that can run something.
    engines_service.assign_default_roles(session, engine)
    return engine


def _game(session: Session, plies: int = 6) -> Game:
    moves = ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6"][:plies]
    game = Game(
        source=Source.PGN,
        dedup_hash=f"hash-{plies}",
        white_name="blunderbase",
        black_name="opponent",
        result=Result.BLACK_WIN,
        owner_color=Color.WHITE,
        white_rating=1712,
        pgn="1. e4 e5",
        moves_uci=moves,
        moves_san=["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"][:plies],
        ply_count=len(moves),
    )
    session.add(game)
    session.commit()
    return game


def _went_quiet(session: Session, run: AnalysisRun) -> None:
    """Age a claimed run's heartbeat: the process working on it is gone."""
    run.heartbeat_at = utcnow() - timedelta(seconds=analysis.STALE_AFTER_SECONDS * 2)
    session.commit()


# --- win percentage -------------------------------------------------------


def test_an_equal_position_is_a_coin_flip() -> None:
    assert analysis.win_percent(0, None) == 50.0


@pytest.mark.parametrize(
    ("cp", "expected"),
    [
        (100, 59.10),
        (-100, 40.90),
        (300, 75.11),
        (-300, 24.89),
        (50, 54.59),
        (-150, 36.53),
        (350, 78.39),
    ],
)
def test_win_percent_follows_the_lichess_curve(cp: int, expected: float) -> None:
    """100 / (1 + exp(-0.00368208 * cp)), computed by hand for each of these."""
    assert analysis.win_percent(cp, None) == expected


def test_a_huge_advantage_is_clamped_before_the_curve() -> None:
    """+10 pawns and +40 pawns are the same kind of winning, so they read the same."""
    assert analysis.win_percent(1000, None) == analysis.win_percent(4000, None)


def test_mate_is_worth_more_the_sooner_it_comes() -> None:
    soon = analysis.win_percent(None, 1)
    later = analysis.win_percent(None, 8)
    assert 99.0 < later < soon < 100.0
    assert analysis.win_percent(None, -1) == round(100 - soon, 2)


def test_a_delivered_mate_takes_its_sign_from_the_folded_score() -> None:
    """`mate 0` is both "is mated" and "has mated"; only the centipawn side says which."""
    assert analysis.win_percent(-10_000, 0) < 1.0
    assert analysis.win_percent(10_000, 0) > 99.0


def test_a_position_with_no_score_at_all_reads_as_equal() -> None:
    assert analysis.win_percent(None, None) == 50.0


# --- classification -------------------------------------------------------


@pytest.mark.parametrize(
    ("win_loss", "expected"),
    [
        (0.0, Classification.GOOD),
        (9.99, Classification.GOOD),
        (10.0, Classification.INACCURACY),
        (19.99, Classification.INACCURACY),
        (20.0, Classification.MISTAKE),
        (29.99, Classification.MISTAKE),
        (30.0, Classification.BLUNDER),
        (75.0, Classification.BLUNDER),
    ],
)
def test_the_thresholds_are_inclusive_lower_bounds(
    win_loss: float, expected: Classification
) -> None:
    assert analysis.classify_move(win_loss, played_best=False, thresholds=THRESHOLDS) is expected


def test_the_engines_own_first_choice_is_never_a_blunder() -> None:
    """A top move that still shows a big drop is two search depths disagreeing."""
    assert (
        analysis.classify_move(40.0, played_best=True, thresholds=THRESHOLDS) is Classification.BEST
    )


def test_thresholds_come_from_the_app_settings(session: Session) -> None:
    app_settings.set_value(session, app_settings.INACCURACY_THRESHOLD, 5)
    app_settings.set_value(session, app_settings.MISTAKE_THRESHOLD, 8)
    thresholds = analysis.Thresholds.from_session(session)

    assert (thresholds.inaccuracy, thresholds.mistake) == (5.0, 8.0)
    # The one nobody moved is still the default the store names.
    assert thresholds.blunder == app_settings.BLUNDER_DEFAULT
    assert (
        analysis.classify_move(6.0, played_best=False, thresholds=thresholds)
        is Classification.INACCURACY
    )


def test_an_unconfigured_deployment_classifies_by_the_defaults(session: Session) -> None:
    # Lichess's cuts on the shared win% curve: 5 / 10 / 15 points.
    assert analysis.Thresholds.from_session(session) == analysis.Thresholds(
        inaccuracy=5.0, mistake=10.0, blunder=15.0
    )


# --- Maia rating levels ---------------------------------------------------


def test_the_level_is_the_target_and_nothing_else() -> None:
    """The deployment's levels are what makes two games comparable at all."""
    assert analysis.maia_levels(1700) == [1700]


def test_every_configured_level_is_asked_about_sorted_and_deduped() -> None:
    assert analysis.maia_levels([1900, 1500, 1900]) == [1500, 1900]


def test_several_levels_are_each_clamped_to_what_the_build_declares() -> None:
    assert analysis.maia_levels([1200, 1900], low=1300, high=1700) == [1300, 1700]
    # Two levels that clamp onto each other are one level, not the same column twice.
    assert analysis.maia_levels([1800, 1900], low=1100, high=1500) == [1500]


def test_the_level_is_clamped_to_what_the_model_can_answer() -> None:
    assert analysis.maia_levels(900) == [1100]
    assert analysis.maia_levels(2400) == [2000]


def test_the_level_is_clamped_to_what_the_build_declares_too() -> None:
    assert analysis.maia_levels(1900, low=1100, high=1500) == [1500]


def _plan(session: Session, **changes: Any) -> analysis.RunPlan:
    _engine(session)
    game = _game(session)
    run = analysis.request_analysis(session, game_id=game.id, **changes)
    return analysis.build_plan(session, run)


def test_a_deployment_nobody_configured_is_pinned_to_maias_top_level(
    session: Session,
) -> None:
    """No target elo was ever set here, and the plan still carries one."""
    plan = _plan(session)

    assert plan.maia_target_elo == MAIA_MAX_RATING
    # Both sides, at that one level, without anyone having asked for it.
    assert plan.maia_plies() == [0, 1, 2, 3, 4, 5]


def test_maia_is_asked_about_every_ply_of_both_sides(session: Session) -> None:
    """The "what will a human opposite me fall into" half is a question about their moves."""
    app_settings.set_maia_target_elo(session, 1700)
    plan = _plan(session)

    assert plan.maia_target_elo == 1700
    # The owner has White in `_game`, and the odd plies are asked about just the same.
    assert plan.maia_plies() == [0, 1, 2, 3, 4, 5]


def test_a_game_with_no_owner_is_asked_about_the_same_way(tmp_path: Any) -> None:
    plan = analysis.RunPlan(
        run_id=1,
        tier=Tier.QUICK,
        game_id=7,
        fen=None,
        variant="standard",
        initial_fen=None,
        moves_uci=("e2e4", "e7e5"),
        moves_san=("e4", "e5"),
        position_ids=(None, None, None),
        ply_start=0,
        ply_end=2,
        nodes=1,
        depth=None,
        multipv=1,
        thresholds=THRESHOLDS,
    )
    assert plan.maia_plies() == [0, 1]


def test_a_plan_carries_every_configured_level(session: Session) -> None:
    app_settings.set_maia_elos(session, [1500, 1900])
    plan = _plan(session)

    assert plan.maia_elos == (1500, 1900)
    assert plan.maia_ratings() == [1500, 1900]
    # The single-level field is the first of them, which is what crosses the wire.
    assert plan.maia_target_elo == 1500


def test_a_run_queued_for_particular_levels_keeps_them(session: Session) -> None:
    """An override belongs to the run, not to the deployment: the settings do not move."""
    _engine(session)
    game = _game(session)
    app_settings.set_maia_elos(session, [1900])

    run = analysis.request_analysis(session, game_id=game.id, elos=[1300, 900])

    # Cleaned on the way in, exactly as the setting is.
    assert run.maia_elos == [1100, 1300]
    assert analysis.build_plan(session, run).maia_ratings() == [1100, 1300]
    assert app_settings.get_maia_elos(session) == [1900]


def test_a_run_that_names_no_levels_is_analysed_at_the_configured_ones(
    session: Session,
) -> None:
    """The point of a setting: a run queued before it moved is analysed the way it is now."""
    _engine(session)
    game = _game(session)
    run = analysis.request_analysis(session, game_id=game.id)
    app_settings.set_maia_elos(session, [1500, 1900])

    assert run.maia_elos is None
    assert analysis.build_plan(session, run).maia_ratings() == [1500, 1900]


def test_a_position_run_asks_about_the_one_position_it_has(session: Session) -> None:
    _engine(session)
    app_settings.set_maia_target_elo(session, 1700)
    run = analysis.request_analysis(
        session, fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
    )
    plan = analysis.build_plan(session, run)

    assert plan.maia_target_elo == 1700
    assert plan.maia_plies() == [0]


# --- whether there is a Maia pass at all ----------------------------------


def test_a_quick_run_carries_a_maia_pass_and_a_deep_run_does_not(session: Session) -> None:
    """The defaults: the import pass pays for Maia, the deep pass would only repeat it."""
    _engine(session)
    game = _game(session)

    quick = analysis.request_analysis(session, game_id=game.id)
    deep = analysis.request_analysis(session, game_id=game.id, tier=Tier.DEEP)

    assert (quick.maia, deep.maia) == (True, False)
    assert analysis.build_plan(session, quick).maia is True
    assert analysis.build_plan(session, deep).maia is False


def test_a_run_records_the_tiers_setting_at_the_moment_it_was_queued(
    session: Session,
) -> None:
    """Settled at enqueue, like the budget: a setting that moves afterwards moves nothing."""
    _engine(session)
    game = _game(session)
    app_settings.set_value(session, app_settings.MAIA_ON_QUICK, 0)
    app_settings.set_value(session, app_settings.MAIA_ON_DEEP, 1)

    quick = analysis.request_analysis(session, game_id=game.id)
    deep = analysis.request_analysis(session, game_id=game.id, tier=Tier.DEEP)

    assert (quick.maia, deep.maia) == (False, True)

    app_settings.set_value(session, app_settings.MAIA_ON_QUICK, 1)

    assert analysis.build_plan(session, quick).maia is False


def test_a_caller_may_ask_for_a_maia_pass_the_tier_is_not_configured_for(
    session: Session,
) -> None:
    """An override belongs to the run; the deployment's own setting does not move."""
    _engine(session)
    game = _game(session)

    asked = analysis.request_analysis(session, game_id=game.id, tier=Tier.DEEP, maia=True)
    refused = analysis.request_analysis(session, game_id=game.id, maia=False)

    assert (asked.maia, refused.maia) == (True, False)
    assert app_settings.get_maia_on_deep(session) is False
    assert app_settings.get_maia_on_quick(session) is True


def test_a_batch_queues_every_run_with_the_maia_pass_it_was_asked_for(
    session: Session,
) -> None:
    _engine(session)
    games = [_game(session, plies=plies) for plies in (2, 4)]

    queued, refused = analysis.request_analysis_batch(
        session, [game.id for game in games], maia=False
    )

    assert refused == []
    assert [run.maia for run in queued] == [False, False]


def test_a_run_without_a_maia_pass_asks_about_no_level_at_all(session: Session) -> None:
    """Not "the default level": no question is put, so nothing is stored and nothing asked."""
    app_settings.set_maia_elos(session, [1500, 1900])
    plan = _plan(session, maia=False)
    rows = [MoveEval(run_id=plan.run_id, ply=ply) for ply in plan.plies]
    adapter = _FakeMaia()

    assert plan.maia_ratings() == []
    assert analysis.apply_maia(plan, rows, adapter) == 0  # type: ignore[arg-type]
    assert adapter.asked == []
    assert not rows[0].maia_policy


def test_maia_is_asked_about_the_owners_own_moves_when_both_sides_is_off(
    session: Session,
) -> None:
    """Half the plies is half the cost of the pass, and the half kept is the owner's."""
    _engine(session)
    game = _game(session)
    app_settings.set_value(session, app_settings.MAIA_BOTH_SIDES, 0)
    run = analysis.request_analysis(session, game_id=game.id)

    # The owner has White in `_game`, so the even plies are the ones they moved in.
    assert analysis.build_plan(session, run).maia_plies() == [0, 2, 4]

    game.owner_color = Color.BLACK
    session.commit()

    assert analysis.build_plan(session, run).maia_plies() == [1, 3, 5]


def test_a_game_with_no_owner_is_asked_about_both_sides_either_way(session: Session) -> None:
    """There is no colour to filter on, so the filter is not a way to ask for nothing."""
    _engine(session)
    game = _game(session)
    game.owner_color = None
    session.commit()
    app_settings.set_value(session, app_settings.MAIA_BOTH_SIDES, 0)
    run = analysis.request_analysis(session, game_id=game.id)

    assert analysis.build_plan(session, run).maia_plies() == [0, 1, 2, 3, 4, 5]


def test_both_sides_is_read_per_plan_rather_than_baked_into_the_run(
    session: Session,
) -> None:
    """A live setting, like the thresholds: the next plan built is the one the owner chose."""
    _engine(session)
    game = _game(session)
    run = analysis.request_analysis(session, game_id=game.id)
    app_settings.set_value(session, app_settings.MAIA_BOTH_SIDES, 0)

    assert analysis.build_plan(session, run).maia_plies() == [0, 2, 4]


def test_a_fill_pass_carries_its_maia_pass_whatever_the_tier_is_configured_for(
    session: Session,
) -> None:
    """A fill with no human-move pass would search nothing and ask nothing: no pass at all."""
    _engine(session)
    _engine(session, name="maia", kind=EngineKind.MAIA)
    game = _game(session)
    app_settings.set_value(session, app_settings.MAIA_ON_QUICK, 0)
    analysis.complete_run(session, analysis.request_analysis(session, game_id=game.id), [])

    receipt = analysis.queue_maia_fill(session)

    assert receipt["queued"] == 1
    assert [(run.maia, run.maia_only) for run in receipt["runs"]] == [(True, True)]


def test_a_plan_cannot_be_a_fill_pass_with_the_maia_pass_switched_off() -> None:
    """The invariant, wherever a plan comes from — a row, a wire frame, a test."""
    plan = analysis.RunPlan(
        run_id=1,
        tier=Tier.QUICK,
        game_id=7,
        fen=None,
        variant="standard",
        initial_fen=None,
        moves_uci=("e2e4", "e7e5"),
        moves_san=("e4", "e5"),
        position_ids=(None, None, None),
        ply_start=0,
        ply_end=2,
        nodes=1,
        depth=None,
        multipv=1,
        thresholds=THRESHOLDS,
        maia=False,
        maia_only=True,
    )

    assert plan.maia is True
    assert plan.maia_ratings() == [MAIA_MAX_RATING]


# --- asking Maia about the plies ------------------------------------------


class _FakeMaia:
    """A Maia adapter with no process behind it: exactly what `apply_maia` leans on.

    `asked` records the levels of every query, which is how "one query per ply, carrying
    every level" and "a fixed-weights build is asked for one" are checkable at all.
    """

    def __init__(
        self,
        *,
        supports_rating: bool = True,
        name: str = "lc0 maia-2",
        bounds: tuple[int, int] | None = None,
    ) -> None:
        self.name = name
        self._supports = supports_rating
        self._bounds = bounds
        self.asked: list[list[int]] = []

    def declared_options(self) -> tuple[UciOption, ...]:
        if not self._supports or self._bounds is None:
            return ()
        low, high = self._bounds
        return (UciOption(name="SelfElo", type="spin", default=low, min=low, max=high),)

    @property
    def supports_rating(self) -> bool:
        return self._supports

    def policy_at(
        self, board: Any, ratings: Any, *, multipv: int | None = None
    ) -> dict[str, list[PolicyMove]]:
        levels = [int(rating) for rating in ratings]
        self.asked.append(levels)
        assert self._supports or len(levels) == 1, "one rating only, or the real one raises"
        return {
            str(level): [PolicyMove(rank=1, uci="e2e4", san="e4", probability=level / 10_000)]
            for level in levels
        }


def _rows(plan: analysis.RunPlan) -> list[MoveEval]:
    return [MoveEval(run_id=plan.run_id, ply=ply) for ply in plan.maia_plies()]


def test_every_configured_level_is_stored_on_every_ply(session: Session) -> None:
    app_settings.set_maia_elos(session, [1500, 1900])
    plan = _plan(session)
    rows = _rows(plan)
    adapter = _FakeMaia()

    assert analysis.apply_maia(plan, rows, adapter) == 6  # type: ignore[arg-type]
    assert sorted(rows[0].maia_policy) == ["1500", "1900"]
    assert rows[0].maia_policy["1900"][0]["p"] == 0.19
    # One query per ply, carrying both levels — not one pass of the game per level.
    assert adapter.asked == [[1500, 1900]] * 6


def test_the_levels_asked_for_are_clamped_to_what_the_build_declares(
    session: Session,
) -> None:
    app_settings.set_maia_elos(session, [1500, 1900])
    plan = _plan(session)
    rows = _rows(plan)
    adapter = _FakeMaia(bounds=(1100, 1500))

    analysis.apply_maia(plan, rows, adapter)  # type: ignore[arg-type]

    assert sorted(rows[0].maia_policy) == ["1500"]
    assert adapter.asked[0] == [1500]


def test_a_fixed_weights_build_computes_its_own_level_and_skips_the_rest(
    session: Session, caplog: pytest.LogCaptureFixture
) -> None:
    """One rating is what it is. The run does not fail over it; it says so once."""
    app_settings.set_maia_elos(session, [1100, 1500, 1900])
    plan = _plan(session)
    rows = _rows(plan)
    adapter = _FakeMaia(supports_rating=False, name="lc0 maia-1500")

    with caplog.at_level(logging.WARNING, logger="backend.services.analysis"):
        assert analysis.apply_maia(plan, rows, adapter) == 6  # type: ignore[arg-type]

    assert sorted(rows[0].maia_policy) == ["1500"]
    assert adapter.asked == [[1500]] * 6
    # One warning for the run, not one per ply.
    warnings = [record for record in caplog.records if record.levelno == logging.WARNING]
    assert len(warnings) == 1
    assert "1100, 1900" in warnings[0].getMessage()


def test_a_fixed_weights_build_that_names_no_level_stores_nothing(
    session: Session,
) -> None:
    """Nothing names the rating it plays, so every level would be a guess at a label."""
    app_settings.set_maia_elos(session, [1500, 1900])
    plan = _plan(session)
    rows = _rows(plan)
    adapter = _FakeMaia(supports_rating=False, name="lc0")

    assert analysis.apply_maia(plan, rows, adapter) == 0  # type: ignore[arg-type]

    assert not rows[0].maia_policy
    assert adapter.asked == []


def test_a_fixed_weights_build_reads_its_level_off_the_engine_it_was_started_from(
    session: Session,
) -> None:
    """The UCI id says nothing; the weights file on the command line says 1500."""
    app_settings.set_maia_elos(session, [1500, 1900])
    plan = _plan(session)
    rows = _rows(plan)
    adapter = _FakeMaia(supports_rating=False, name="lc0")
    spec = EngineSpec.build(
        "/usr/bin/lc0", options={"WeightsFile": "/opt/maia/maia-1500.pb.gz"}, name="Maia"
    )

    analysis.apply_maia(plan, rows, adapter, spec)  # type: ignore[arg-type]

    assert sorted(rows[0].maia_policy) == ["1500"]
    assert adapter.asked == [[1500]] * 6


def test_one_foreign_level_on_a_fixed_weights_build_is_skipped_not_relabelled(
    session: Session, caplog: pytest.LogCaptureFixture
) -> None:
    """What a fill run asks: only the missing level, which this build cannot play.

    Storing its own 1500 policy under "1900" would be a column the reader cannot see
    through and no later run would correct, since the key looks present forever.
    """
    app_settings.set_maia_elos(session, [1500, 1900])
    plan = _plan(session, elos=[1900])
    rows = _rows(plan)
    adapter = _FakeMaia(supports_rating=False, name="lc0 maia-1500")

    with caplog.at_level(logging.WARNING, logger="backend.services.analysis"):
        assert analysis.apply_maia(plan, rows, adapter) == 0  # type: ignore[arg-type]

    assert not rows[0].maia_policy
    assert adapter.asked == []
    warnings = [record for record in caplog.records if record.levelno == logging.WARNING]
    assert len(warnings) == 1
    assert "1900" in warnings[0].getMessage()


def test_a_pass_adds_its_levels_to_the_ones_a_row_already_carries(session: Session) -> None:
    """What makes a fill run additive: the levels it did not compute stay where they are."""
    app_settings.set_maia_elos(session, [1900])
    plan = _plan(session)
    rows = _rows(plan)
    rows[0].maia_policy = {"1100": [{"uci": "d2d4", "rank": 1}]}

    analysis.apply_maia(plan, rows, _FakeMaia())  # type: ignore[arg-type]

    assert sorted(rows[0].maia_policy) == ["1100", "1900"]
    assert rows[0].maia_policy["1100"][0]["uci"] == "d2d4"


def test_the_rows_of_a_maia_only_pass_carry_no_evaluation(session: Session) -> None:
    plan = _plan(session)
    rows = analysis.policy_rows(plan)

    assert [row.ply for row in rows] == [0, 1, 2, 3, 4, 5]
    assert [row.move_uci for row in rows[:2]] == ["e2e4", "e7e5"]
    # Nothing about the move itself, which is what keeps the merge treating these rows as
    # carriers for a policy rather than as an answer that displaces the run that searched.
    assert all(row.eval_before_cp is None and row.best_move_uci is None for row in rows)
    assert all(row.win_loss is None and row.classification is None for row in rows)


# --- filling in the missing levels ----------------------------------------


def _maia(session: Session) -> Engine:
    return _engine(
        session, name="Maia", kind=EngineKind.MAIA, path="/usr/bin/lc0"
    )


def _analysed(
    session: Session,
    game: Game,
    levels: tuple[str, ...] = ("2000",),
    *,
    maia_only: bool = False,
    status: RunStatus = RunStatus.DONE,
    elos: list[int] | None = None,
) -> AnalysisRun:
    """A finished run over `game` whose rows carry a policy at each of `levels`.

    `elos` is what the run was *asked* for, which is not always what it managed to store.
    """
    run = AnalysisRun(
        game_id=game.id,
        tier=Tier.QUICK,
        status=status,
        nodes=1,
        multipv=1,
        maia_only=maia_only,
        maia_elos=elos,
    )
    session.add(run)
    session.flush()
    session.add(
        MoveEval(
            run_id=run.id,
            ply=0,
            move_uci="e2e4",
            eval_before_cp=None if maia_only else 12,
            maia_policy={level: [{"uci": "e2e4", "rank": 1}] for level in levels} or None,
        )
    )
    session.commit()
    return run


def test_the_status_counts_the_games_missing_a_configured_level(session: Session) -> None:
    _engine(session)
    _maia(session)
    _analysed(session, _game(session))
    app_settings.set_maia_elos(session, [1500, 2000])

    assert analysis.maia_fill_status(session) == {
        "missing_games": 1,
        "configured": [1500, 2000],
    }


def test_a_fill_queues_a_maia_only_pass_for_the_levels_that_are_missing(
    session: Session,
) -> None:
    _engine(session)
    _maia(session)
    game = _game(session)
    analysed = _analysed(session, game)
    app_settings.set_maia_elos(session, [1500, 2000])

    receipt = analysis.queue_maia_fill(session)

    assert (receipt["queued"], receipt["already_complete"]) == (1, 0)
    queued = session.scalars(select(AnalysisRun).where(AnalysisRun.id != analysed.id)).one()
    assert queued.maia_only is True
    # Only the missing level: the one the game already carries is not recomputed.
    assert queued.maia_elos == [1500]
    assert queued.status is RunStatus.QUEUED
    assert (queued.ply_start, queued.ply_end) == (None, None)
    # And the pass that was already done is left exactly as it was.
    assert session.scalars(select(MoveEval).where(MoveEval.run_id == analysed.id)).one()


def test_a_game_that_carries_every_level_is_left_alone(session: Session) -> None:
    _engine(session)
    _maia(session)
    _analysed(session, _game(session), ("1500", "2000"))
    app_settings.set_maia_elos(session, [1500, 2000])

    assert analysis.maia_fill_status(session)["missing_games"] == 0
    assert analysis.queue_maia_fill(session) == {
        "queued": 0,
        "already_complete": 1,
        "runs": [],
    }


def test_pressing_the_button_twice_queues_the_work_once(session: Session) -> None:
    _engine(session)
    _maia(session)
    _analysed(session, _game(session))
    app_settings.set_maia_elos(session, [1500, 2000])
    analysis.queue_maia_fill(session)

    again = analysis.queue_maia_fill(session)

    assert (again["queued"], again["already_complete"]) == (0, 1)
    assert analysis.maia_fill_status(session)["missing_games"] == 0


def test_a_fill_can_be_narrowed_to_named_games(session: Session) -> None:
    _engine(session)
    _maia(session)
    first = _game(session, plies=6)
    second = _game(session, plies=4)
    _analysed(session, first)
    _analysed(session, second)
    app_settings.set_maia_elos(session, [1500])

    assert analysis.queue_maia_fill(session, [second.id])["queued"] == 1
    queued = session.scalars(
        select(AnalysisRun).where(AnalysisRun.status == RunStatus.QUEUED)
    ).one()
    assert queued.game_id == second.id


def test_a_finished_fill_settles_the_level_it_went_looking_for(session: Session) -> None:
    """The guard against the button re-queueing the whole library on every press.

    A deployment whose Maia plays one rating cannot store 1900 however often it is asked,
    so a level that a finished fill run went after counts as settled whether it landed or
    not — otherwise the count never falls and each press queues the identical work again.
    """
    _engine(session)
    _maia(session)
    game = _game(session)
    _analysed(session, game, ("1500",))
    _analysed(session, game, (), maia_only=True, elos=[1900])
    app_settings.set_maia_elos(session, [1500, 1900])

    assert analysis.maia_fill_status(session)["missing_games"] == 0
    assert analysis.queue_maia_fill(session)["queued"] == 0


def test_a_full_run_that_stored_no_policy_is_still_a_fill(session: Session) -> None:
    """Asking is only settling for a fill run: a pass whose Maia was down still needs one."""
    _engine(session)
    _maia(session)
    _analysed(session, _game(session), (), elos=[1500])
    app_settings.set_maia_elos(session, [1500])

    assert analysis.maia_fill_status(session)["missing_games"] == 1


def test_a_game_nobody_has_analysed_is_not_a_fill(session: Session) -> None:
    """A game with no pass at all needs a whole pass, which is what a backfill is for."""
    _engine(session)
    _maia(session)
    _game(session)
    app_settings.set_maia_elos(session, [1500])

    assert analysis.maia_fill_status(session)["missing_games"] == 0
    assert analysis.queue_maia_fill(session)["queued"] == 0


def test_a_fill_with_no_human_move_model_is_refused_whole(session: Session) -> None:
    _engine(session)
    _analysed(session, _game(session))
    app_settings.set_maia_elos(session, [1500])

    with pytest.raises(analysis.AnalysisRequestError, match="no human-move model"):
        analysis.queue_maia_fill(session)

    assert (
        session.scalars(select(AnalysisRun).where(AnalysisRun.status == RunStatus.QUEUED)).all()
        == []
    )


def test_a_filled_level_is_merged_over_the_pass_that_was_already_there(
    session: Session,
) -> None:
    """The whole point: the game reads as though both levels had been analysed at once."""
    _engine(session)
    _maia(session)
    game = _game(session)
    searched = _analysed(session, game, ("2000",))
    filled = _analysed(session, game, ("1500",), maia_only=True)

    evals, maia = games_service.merge_run_evals(session, [searched, filled])

    assert sorted(maia[0]) == ["1500", "2000"]
    # The carrier row never displaces the run that said something about the move.
    assert evals[0].run_id == searched.id
    assert evals[0].eval_before_cp == 12


def test_a_fill_says_it_is_one_and_counts_only_the_other_fills(session: Session) -> None:
    """The event a client draws the queue from: a fill is not a quick pass over the library.

    Both share the quick tier, so the tier alone cannot tell them apart; `maia_only` can,
    and `outstanding` is the fill's own depth rather than a number an unrelated backfill
    running alongside it would move.
    """
    _engine(session)
    _maia(session)
    _analysed(session, _game(session))
    analysis.request_analysis(session, game_id=_game(session).id)
    app_settings.set_maia_elos(session, [1500])
    seen: list[dict[str, Any]] = []
    cancel = analysis.subscribe(seen.append)

    try:
        analysis.queue_maia_fill(session)
    finally:
        cancel()

    assert seen == [
        {
            "event": analysis.EVENT_BACKFILL,
            "tier": "quick",
            "queued": 1,
            "outstanding": 1,
            "maia_only": True,
        }
    ]


def test_a_queued_fill_announces_itself_as_one(session: Session) -> None:
    """A run row's own events carry it too, which is what the queue widget reads."""
    _engine(session)
    _maia(session)
    _analysed(session, _game(session))
    app_settings.set_maia_elos(session, [1500])
    fill = analysis.queue_maia_fill(session)["runs"][0]
    ordinary = analysis.request_analysis(session, game_id=_game(session).id)

    assert analysis.run_event(analysis.EVENT_RUN_QUEUED, fill)["maia_only"] is True
    assert analysis.run_event(analysis.EVENT_RUN_QUEUED, ordinary)["maia_only"] is False


def test_a_fill_is_not_the_quick_pass_a_backfill_owes_the_game(session: Session) -> None:
    """A fill searches nothing, so a game whose only quick row is one is still unanalysed."""
    _engine(session)
    _maia(session)
    game = _game(session)
    # Analysed at one phase only, which is not coverage either, and then filled.
    _analysed(session, game, ("2000",), maia_only=True)
    app_settings.set_maia_elos(session, [1500])
    analysis.queue_maia_fill(session)

    assert analysis.count_missing(session) == 1
    assert [run.game_id for run in analysis.enqueue_missing(session)] == [game.id]


def test_stopping_a_backfill_leaves_the_queued_fills_alone(session: Session) -> None:
    """`cancel_queued` is one tier's stop button; the fill belongs to a pass of its own."""
    _engine(session)
    _maia(session)
    _analysed(session, _game(session))
    app_settings.set_maia_elos(session, [1500])
    fill = analysis.queue_maia_fill(session)["runs"][0]
    # A game nobody has analysed, so the backfill has something of its own to drop.
    _game(session, plies=6)
    assert len(analysis.enqueue_missing(session)) == 1

    dropped = analysis.cancel_queued(session)

    assert dropped == 1
    left = set(
        session.scalars(select(AnalysisRun.id).where(AnalysisRun.status == RunStatus.QUEUED))
    )
    assert left == {fill.id}
    # And the two counts stay each other's business.
    assert analysis.outstanding_runs(session) == 0
    assert analysis.outstanding_runs(session, maia_only=True) == 1


# --- skipping the pass a game already has ---------------------------------


def _asks_maia(session: Session) -> None:
    """A deployment with a Maia, two configured levels, and both tiers asking for them."""
    _engine(session)
    _maia(session)
    app_settings.set_maia_elos(session, [1500, 1900])
    app_settings.set_value(session, app_settings.MAIA_ON_DEEP, 1)


def test_a_game_that_carries_every_level_is_queued_without_a_maia_pass(
    session: Session,
) -> None:
    """The deep pass of an imported game: the quick one already asked, so this one does not."""
    _asks_maia(session)
    game = _game(session)
    _analysed(session, game, ("1500", "1900"))

    run = analysis.request_analysis(session, game_id=game.id, tier=Tier.DEEP)

    assert run.maia is False
    assert app_settings.get_maia_on_deep(session) is True


def test_one_missing_level_is_still_worth_a_maia_pass(session: Session) -> None:
    _asks_maia(session)
    game = _game(session)
    _analysed(session, game, ("1500",))

    assert analysis.request_analysis(session, game_id=game.id, tier=Tier.DEEP).maia is True


def test_the_levels_a_run_names_are_the_ones_it_is_skipped_for(session: Session) -> None:
    """`elos` moves the levels this run would ask about, so it moves what settles it."""
    _asks_maia(session)
    game = _game(session)
    _analysed(session, game, ("1500",))

    asked = analysis.request_analysis(session, game_id=game.id, elos=[1500])
    both = analysis.request_analysis(session, game_id=game.id, elos=[1500, 1900])

    assert (asked.maia, both.maia) == (False, True)


def test_a_caller_who_asks_for_maia_outright_gets_it_anyway(session: Session) -> None:
    """The skip is what the setting would have said, not an override of the caller."""
    _asks_maia(session)
    game = _game(session)
    _analysed(session, game, ("1500", "1900"))

    assert analysis.request_analysis(session, game_id=game.id, maia=True).maia is True


def test_a_run_over_a_bare_position_has_no_game_to_be_settled_by(session: Session) -> None:
    _asks_maia(session)
    _analysed(session, _game(session), ("1500", "1900"))

    run = analysis.request_analysis(
        session,
        fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        tier=Tier.DEEP,
    )

    assert run.maia is True


def test_a_backfill_skips_the_maia_pass_game_by_game(session: Session) -> None:
    """One batch query for the bite, and the flag still lands per row."""
    _asks_maia(session)
    settled, missing = _game(session, plies=4), _game(session, plies=6)
    _analysed(session, settled, ("1500", "1900"))
    _analysed(session, missing, ("1500",))

    queued = analysis.enqueue_missing(session, Tier.DEEP)

    assert {run.game_id: run.maia for run in queued} == {settled.id: False, missing.id: True}


# --- enqueueing -----------------------------------------------------------


def test_a_quick_run_carries_the_configured_budget(session: Session) -> None:
    _engine(session)
    game = _game(session)
    app_settings.set_value(session, app_settings.QUICK_NODES, 1234)

    run = analysis.request_analysis(session, game_id=game.id)

    assert run.tier is Tier.QUICK
    assert run.status is RunStatus.QUEUED
    assert (run.nodes, run.multipv) == (1234, 1)
    assert run.priority == analysis.QUICK_PRIORITY
    assert (run.ply_start, run.ply_end) == (None, None)


def test_an_unconfigured_deployment_queues_the_default_budget(session: Session) -> None:
    _engine(session)
    game = _game(session)

    run = analysis.request_analysis(session, game_id=game.id)

    assert run.nodes == app_settings.QUICK_NODES_DEFAULT


def test_a_deep_run_gets_multiple_lines_and_jumps_the_queue(session: Session) -> None:
    _engine(session)
    game = _game(session)
    app_settings.set_value(session, app_settings.DEEP_NODES, 999_999)
    app_settings.set_value(session, app_settings.DEEP_MULTIPV, 5)

    run = analysis.request_analysis(session, game_id=game.id, tier=Tier.DEEP, ply_range=(2, 5))

    assert (run.nodes, run.multipv) == (999_999, 5)
    assert run.priority == analysis.DEEP_PRIORITY > analysis.QUICK_PRIORITY
    assert (run.ply_start, run.ply_end) == (2, 5)


def test_a_run_needs_exactly_one_target(session: Session) -> None:
    _engine(session)
    with pytest.raises(analysis.AnalysisRequestError):
        analysis.request_analysis(session)
    with pytest.raises(analysis.AnalysisRequestError):
        analysis.request_analysis(session, game_id=1, fen="8/8/8/8/8/8/8/K6k w - -")


def test_a_run_over_a_bare_fen_stores_the_normalised_position(session: Session) -> None:
    """The same key the position table uses: no move counters, no unplayable en passant."""
    _engine(session)
    run = analysis.request_analysis(
        session, fen="rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"
    )

    assert run.game_id is None
    assert run.fen == "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -"


def test_a_chess960_position_is_keyed_the_way_the_position_table_keys_it(
    session: Session,
) -> None:
    """The explorer finds a chess960 position by FEN, so a pass over it has to be
    requestable — and has to land on the same key. Read by a plain board, `HFhf` castling
    rights are dropped silently and the run would point at a position no game reached."""
    _engine(session)
    fen = "bqnb1rkr/pp3ppp/3ppn2/2p5/5P2/P2P4/NPP1P1PP/BQ1BNRKR w HFhf - 2 9"

    run = analysis.request_analysis(session, fen=fen)

    assert run.fen == explorer.normalize_fen(fen)[0]
    assert run.fen.endswith(" w KQkq -")


def test_a_bad_fen_is_refused_before_it_reaches_the_queue(session: Session) -> None:
    _engine(session)
    with pytest.raises(analysis.AnalysisRequestError, match="not a valid FEN"):
        analysis.request_analysis(session, fen="not a position")


def test_a_ply_range_is_clamped_to_the_game(session: Session) -> None:
    _engine(session)
    game = _game(session)

    run = analysis.request_analysis(session, game_id=game.id, ply_range=(0, 400))
    assert (run.ply_start, run.ply_end) == (0, game.ply_count)

    with pytest.raises(analysis.AnalysisRequestError, match="empty"):
        analysis.request_analysis(session, game_id=game.id, ply_range=(9, 12))


def test_a_run_over_a_position_has_no_ply_range(session: Session) -> None:
    _engine(session)
    with pytest.raises(analysis.AnalysisRequestError):
        analysis.request_analysis(session, fen="8/8/8/8/8/8/8/K6k w - -", ply_range=(0, 2))


def test_an_unknown_game_is_refused(session: Session) -> None:
    _engine(session)
    with pytest.raises(analysis.AnalysisRequestError, match="no game with id"):
        analysis.request_analysis(session, game_id=999)


def test_no_engine_at_all_is_a_tier_that_degrades(session: Session) -> None:
    game = _game(session)
    with pytest.raises(TierUnavailableError):
        analysis.request_analysis(session, game_id=game.id)


# --- one run, one machine ---------------------------------------------------
#
# A run's evaluation and its human-move passes share a process, so the two engines have to
# share a host. The refusal is at enqueue, where an owner can still do something about it.


def _remote_engine(session: Session, name: str, **changes: Any) -> Engine:
    """An engine bound to a runner, as an advertisement would have written it."""
    from backend.services import runners as runners_service

    runner = runners_service.runner_by_name(session, "gpu-box")
    if runner is None:
        runner, _token = runners_service.create_runner(session, "gpu-box", slots=2)
    engine = _engine(session, name=name, **changes)
    engine.runner_id = runner.id
    session.commit()
    return engine


def test_a_search_here_and_the_only_maia_on_a_runner_is_refused(session: Session) -> None:
    _engine(session, name="stockfish")
    _remote_engine(session, "maia-remote", kind=EngineKind.MAIA)
    game = _game(session)

    with pytest.raises(analysis.AnalysisRequestError) as refused:
        analysis.request_analysis(session, game_id=game.id)

    message = str(refused.value)
    assert "must be on one machine" in message
    assert "'stockfish' is on this host" in message
    assert "'maia-remote', is on runner 'gpu-box'" in message


def test_a_search_on_a_runner_and_the_only_maia_here_is_refused(session: Session) -> None:
    remote = _remote_engine(session, "sf-remote")
    _engine(session, name="maia", kind=EngineKind.MAIA)
    game = _game(session)

    with pytest.raises(analysis.AnalysisRequestError, match="must be on one machine"):
        analysis.request_analysis(
            session, game_id=game.id, engine_id=remote.id, tier=Tier.DEEP, maia=True
        )


def test_a_run_that_asks_for_no_maia_has_nothing_to_strand(session: Session) -> None:
    """The rule is about a run whose two passes would land on two machines.

    A run with one pass has one host. Refusing it would put every engine that cannot host a
    human-move model — a browser tab's WASM build most of all — out of reach the moment a
    Maia is enabled anywhere else in the deployment.
    """
    remote = _remote_engine(session, "sf-remote")
    _engine(session, name="maia", kind=EngineKind.MAIA)
    game = _game(session)

    run = analysis.request_analysis(
        session, game_id=game.id, engine_id=remote.id, tier=Tier.DEEP, maia=False
    )

    assert run.status is RunStatus.QUEUED
    assert run.maia is False


def test_a_host_with_its_own_maia_is_not_mixed(session: Session) -> None:
    remote = _remote_engine(session, "sf-remote")
    _remote_engine(session, "maia-remote", kind=EngineKind.MAIA)
    _engine(session, name="stockfish")
    _engine(session, name="maia", kind=EngineKind.MAIA)
    game = _game(session)

    remote_run = analysis.request_analysis(session, game_id=game.id, engine_id=remote.id)
    local_run = analysis.request_analysis(session, game_id=game.id)

    assert remote_run.engine_id == remote.id
    assert local_run.status is RunStatus.QUEUED


def test_a_deployment_with_no_maia_at_all_has_nothing_to_mix(session: Session) -> None:
    """The pass simply does not happen, which is exactly today's behaviour."""
    _remote_engine(session, "sf-remote")
    game = _game(session)

    assert analysis.request_analysis(session, game_id=game.id, tier=Tier.DEEP).id


def test_a_maia_that_is_switched_off_strands_nobody(session: Session) -> None:
    _remote_engine(session, "sf-remote")
    _engine(session, name="maia", kind=EngineKind.MAIA, enabled=False)
    game = _game(session)

    assert analysis.request_analysis(session, game_id=game.id, tier=Tier.DEEP).id


def test_a_run_on_the_maia_itself_is_not_a_mixed_host_run(session: Session) -> None:
    """Nothing is stranded when the engine named *is* the model."""
    maia = _remote_engine(session, "maia-remote", kind=EngineKind.MAIA)
    _engine(session, name="maia", kind=EngineKind.MAIA)
    game = _game(session)

    assert analysis.request_analysis(session, game_id=game.id, engine_id=maia.id).id


def test_re_analysis_is_a_new_run_and_keeps_the_old_one(session: Session) -> None:
    _engine(session)
    game = _game(session)

    first = analysis.request_analysis(session, game_id=game.id)
    analysis.complete_run(session, first, [])
    second = analysis.request_analysis(session, game_id=game.id, tier=Tier.DEEP)

    assert second.id != first.id
    assert [run.id for run in analysis.list_runs(session, game.id)] == [second.id, first.id]
    assert [run.id for run in analysis.list_runs(session, game.id, Tier.QUICK)] == [first.id]


def test_a_batch_queues_every_game_in_one_transaction(session: Session) -> None:
    """The point of the batch: sixty selected games are one commit, not sixty."""
    _engine(session)
    games = [_game(session, plies=plies) for plies in (4, 6, 4)]
    commits = 0

    @sa_event.listens_for(session, "after_commit")
    def _count(_session: Session) -> None:
        nonlocal commits
        commits += 1

    queued, refused = analysis.request_analysis_batch(
        session, [game.id for game in games], tier=Tier.DEEP
    )

    assert [run.game_id for run in queued] == [game.id for game in games]
    assert refused == []
    assert commits == 1
    stored = session.scalars(select(AnalysisRun.id).order_by(AnalysisRun.id)).all()
    assert list(stored) == [run.id for run in queued]


def test_a_batch_queues_what_it_can_and_names_what_it_would_not(session: Session) -> None:
    _engine(session)
    game = _game(session)

    queued, refused = analysis.request_analysis_batch(session, [game.id, 999])

    assert [run.game_id for run in queued] == [game.id]
    assert refused == [analysis.BatchRefusal(game_id=999, reason="no game with id 999")]
    # The refusal took itself out of the batch; it did not roll the queued run back.
    assert list(session.scalars(select(AnalysisRun.game_id))) == [game.id]


def test_a_batch_announces_each_run_once_the_batch_has_committed(session: Session) -> None:
    """Per-run events, after the commit: the queue widget counts runs, not batches."""
    _engine(session)
    games = [_game(session, plies=plies) for plies in (4, 6)]
    seen: list[dict[str, Any]] = []
    cancel = analysis.subscribe(seen.append)

    try:
        queued, _refused = analysis.request_analysis_batch(
            session, [games[0].id, 999, games[1].id], tier=Tier.DEEP
        )
    finally:
        cancel()

    assert [event["event"] for event in seen] == [analysis.EVENT_RUN_QUEUED] * 2
    assert [event["run_id"] for event in seen] == [run.id for run in queued]
    assert [event["game_id"] for event in seen] == [games[0].id, games[1].id]


def test_a_batch_with_nothing_to_queue_commits_nothing(session: Session) -> None:
    _engine(session)
    seen: list[dict[str, Any]] = []
    cancel = analysis.subscribe(seen.append)

    try:
        queued, refused = analysis.request_analysis_batch(session, [998, 999])
    finally:
        cancel()

    assert queued == []
    assert [item.game_id for item in refused] == [998, 999]
    assert seen == []


def test_a_batch_refuses_as_a_whole_when_no_engine_serves_the_tier(session: Session) -> None:
    """Not per game: the reason is the deployment's, and it is the same for every id."""
    game = _game(session)

    with pytest.raises(TierUnavailableError):
        analysis.request_analysis_batch(session, [game.id])


def test_enqueue_missing_covers_every_game_once(session: Session) -> None:
    _engine(session)
    first, second = _game(session, plies=4), _game(session, plies=6)

    queued = analysis.enqueue_missing(session)
    assert {run.game_id for run in queued} == {first.id, second.id}
    assert analysis.enqueue_missing(session) == []


def test_enqueue_missing_retries_nothing_that_failed_twice(session: Session) -> None:
    _engine(session)
    game = _game(session)
    run = analysis.request_analysis(session, game_id=game.id)
    run.attempts = analysis.MAX_ATTEMPTS
    analysis.fail_run(session, run, "engine died")

    assert [again.game_id for again in analysis.enqueue_missing(session)] == [game.id]


# --- backfilling a whole library ------------------------------------------


def test_the_backfill_preview_counts_exactly_what_the_backfill_takes(session: Session) -> None:
    """The number on the button and the rows the button writes are one statement.

    A finished pass covers a game; a pass that gave up and a deep look at one phase do not.
    """
    _engine(session)
    done, spent, windowed, fresh = (_game(session, plies=plies) for plies in (4, 6, 6, 4))
    analysis.complete_run(session, analysis.request_analysis(session, game_id=done.id), [])
    failed = analysis.request_analysis(session, game_id=spent.id)
    failed.attempts = analysis.MAX_ATTEMPTS
    analysis.fail_run(session, failed, "engine died")
    analysis.request_analysis(session, game_id=windowed.id, ply_range=(0, 4))

    assert analysis.count_missing(session) == 3

    queued = analysis.enqueue_missing(session)

    assert {run.game_id for run in queued} == {spent.id, windowed.id, fresh.id}
    assert analysis.count_missing(session) == 0


def test_a_backfill_of_one_tier_says_nothing_about_the_other(session: Session) -> None:
    _engine(session)
    _game(session)

    analysis.enqueue_missing(session)

    assert analysis.count_missing(session, Tier.QUICK) == 0
    assert analysis.count_missing(session, Tier.DEEP) == 1


def test_a_backfill_can_take_a_bite_of_the_backlog(session: Session) -> None:
    """What `blunderbase analyze --limit` is: the oldest few, and the rest still pending."""
    _engine(session)
    games = [_game(session, plies=plies) for plies in (4, 6, 4)]

    queued = analysis.enqueue_missing(session, limit=2)

    assert [run.game_id for run in queued] == [games[0].id, games[1].id]
    assert analysis.count_missing(session) == 1


def test_a_backfill_writes_the_whole_library_in_one_commit(session: Session) -> None:
    _engine(session)
    games = [_game(session, plies=plies) for plies in (4, 6, 4)]
    commits = 0

    @sa_event.listens_for(session, "after_commit")
    def _count(_session: Session) -> None:
        nonlocal commits
        commits += 1

    queued = analysis.enqueue_missing(session)

    assert len(queued) == len(games)
    assert commits == 1


def test_a_backfill_announces_the_write_once_and_never_a_run(session: Session) -> None:
    """The whole point of the summary event: ten thousand frames in a burst is the storm."""
    _engine(session)
    [_game(session, plies=plies) for plies in (4, 6, 4)]
    seen: list[dict[str, Any]] = []
    cancel = analysis.subscribe(seen.append)

    try:
        analysis.enqueue_missing(session)
    finally:
        cancel()

    assert seen == [
        {
            "event": analysis.EVENT_BACKFILL,
            "tier": "quick",
            "queued": 3,
            "outstanding": 3,
            "maia_only": False,
        }
    ]


def test_a_run_asked_for_on_its_own_still_announces_itself(session: Session) -> None:
    """The opt-out is the bulk path's; one game queued by hand is one `analysis.queued`."""
    _engine(session)
    game = _game(session)
    seen: list[dict[str, Any]] = []
    cancel = analysis.subscribe(seen.append)

    try:
        run = analysis.request_analysis(session, game_id=game.id)
    finally:
        cancel()

    assert [event["event"] for event in seen] == [analysis.EVENT_RUN_QUEUED]
    assert seen[0]["run_id"] == run.id


def test_a_backfill_with_nothing_to_queue_commits_nothing(session: Session) -> None:
    _engine(session)
    _game(session)
    analysis.enqueue_missing(session)
    seen: list[dict[str, Any]] = []
    cancel = analysis.subscribe(seen.append)

    try:
        assert analysis.enqueue_missing(session) == []
    finally:
        cancel()

    assert seen == []


def test_cancelling_a_backfill_leaves_running_and_windowed_runs_alone(session: Session) -> None:
    """The stop button shortens the queue; it does not reach into what is already working."""
    _engine(session)
    games = [_game(session, plies=plies) for plies in (4, 6, 4)]
    analysis.enqueue_missing(session)
    windowed = analysis.request_analysis(session, game_id=games[1].id, ply_range=(0, 4))
    position = analysis.request_analysis(
        session, fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
    )
    running = analysis.claim_next_run(session)
    assert running is not None and running.ply_start is None
    seen: list[dict[str, Any]] = []
    cancel = analysis.subscribe(seen.append)

    try:
        dropped = analysis.cancel_queued(session)
    finally:
        cancel()

    assert dropped == 2
    left = set(session.scalars(select(AnalysisRun.id)))
    assert left == {running.id, windowed.id, position.id}
    assert analysis.outstanding_runs(session) == 1
    assert seen == [
        {
            "event": analysis.EVENT_BACKFILL,
            "tier": "quick",
            "queued": 0,
            "outstanding": 1,
            "maia_only": False,
        }
    ]


def test_cancelling_with_nothing_queued_says_nothing(session: Session) -> None:
    _engine(session)
    _game(session)
    seen: list[dict[str, Any]] = []
    cancel = analysis.subscribe(seen.append)

    try:
        assert analysis.cancel_queued(session) == 0
    finally:
        cancel()

    assert seen == []


def test_clearing_the_queue_drops_every_tier_windowed_and_fill_alike(session: Session) -> None:
    """The reset button reaches further than `cancel_queued`: nothing queued survives it."""
    _engine(session)
    _maia(session)
    games = [_game(session, plies=plies) for plies in (4, 6, 4, 4)]
    analysis.request_analysis(session, game_id=games[0].id)
    analysis.request_analysis(session, game_id=games[1].id, tier=Tier.DEEP)
    analysis.request_analysis(session, game_id=games[2].id, ply_range=(0, 4))
    _analysed(session, games[3])
    app_settings.set_maia_elos(session, [1500])
    fill = analysis.queue_maia_fill(session)["runs"][0]
    assert fill.maia_only is True
    # One of the four queued rows is claimed, whichever the priority order picks; the
    # point of this test is that `clear_queue` does not care which shape the rest are.
    running = analysis.claim_next_run(session)
    assert running is not None
    assert analysis.queue_depth(session) == {"queued": 3, "running": 1}
    seen: list[dict[str, Any]] = []
    cancel = analysis.subscribe(seen.append)

    try:
        dropped = analysis.clear_queue(session)
    finally:
        cancel()

    assert dropped == 3
    assert analysis.queue_depth(session) == {"queued": 0, "running": 1}
    survivors = set(
        session.scalars(select(AnalysisRun.id).where(AnalysisRun.status != RunStatus.DONE))
    )
    assert survivors == {running.id}
    assert seen == [
        {
            "event": analysis.EVENT_BACKFILL,
            "tier": "quick",
            "queued": 0,
            "outstanding": 1,
            "maia_only": False,
        }
    ]


def test_clearing_an_empty_queue_says_nothing(session: Session) -> None:
    _engine(session)
    _game(session)
    seen: list[dict[str, Any]] = []
    cancel = analysis.subscribe(seen.append)

    try:
        assert analysis.clear_queue(session) == 0
    finally:
        cancel()

    assert seen == []


# --- the queue ------------------------------------------------------------


def test_deep_runs_jump_the_queue_and_quick_runs_stay_fifo(session: Session) -> None:
    _engine(session)
    first, second = _game(session, plies=4), _game(session, plies=6)
    early = analysis.request_analysis(session, game_id=first.id)
    late = analysis.request_analysis(session, game_id=second.id)
    deep = analysis.request_analysis(session, game_id=second.id, tier=Tier.DEEP)

    claimed = [analysis.claim_next_run(session) for _ in range(3)]

    assert [run.id for run in claimed] == [deep.id, early.id, late.id]
    assert analysis.claim_next_run(session) is None


def test_claiming_marks_the_run_running_and_spends_an_attempt(session: Session) -> None:
    _engine(session)
    game = _game(session)
    analysis.request_analysis(session, game_id=game.id)

    run = analysis.claim_next_run(session)

    assert run is not None
    assert run.status is RunStatus.RUNNING
    assert run.attempts == 1
    assert run.started_at is not None


def test_the_queue_reports_its_depth(session: Session) -> None:
    _engine(session)
    game = _game(session)
    analysis.request_analysis(session, game_id=game.id)
    analysis.request_analysis(session, game_id=game.id, tier=Tier.DEEP)
    analysis.claim_next_run(session)

    assert analysis.queue_depth(session) == {"queued": 1, "running": 1}


def test_a_paused_queue_is_not_claimed_from_and_a_resumed_one_is(session: Session) -> None:
    """The whole of the pause: the rows stay queued and nothing picks them up."""
    _engine(session)
    game = _game(session)
    analysis.request_analysis(session, game_id=game.id)
    analysis.request_analysis(session, game_id=game.id, tier=Tier.DEEP)

    assert analysis.set_queue_paused(session, True) is True
    assert analysis.claim_next_run(session) is None
    assert analysis.queue_depth(session) == {"queued": 2, "running": 0}

    assert analysis.set_queue_paused(session, False) is False
    assert analysis.claim_next_run(session) is not None
    assert analysis.queue_depth(session) == {"queued": 1, "running": 1}


def test_pausing_the_queue_announces_it_once_with_the_depth(session: Session) -> None:
    _engine(session)
    game = _game(session)
    analysis.request_analysis(session, game_id=game.id)
    seen: list[dict[str, Any]] = []
    cancel = analysis.subscribe(seen.append)

    try:
        analysis.set_queue_paused(session, True)
    finally:
        cancel()

    assert seen == [
        {"event": analysis.EVENT_QUEUE_PAUSED, "paused": True, "queued": 1, "running": 0}
    ]


def test_pausing_the_queue_survives_a_save_of_the_analysis_settings(session: Session) -> None:
    """`replace` rewrites every key it knows; `queue_paused` is deliberately not one."""
    _engine(session)
    game = _game(session)
    analysis.request_analysis(session, game_id=game.id)
    analysis.set_queue_paused(session, True)

    app_settings.replace(session, {app_settings.QUICK_NODES: 100_000})

    assert analysis.get_queue_paused(session) is True
    assert analysis.claim_next_run(session) is None


def test_a_whole_run_lands_in_one_transaction(session: Session) -> None:
    _engine(session)
    game = _game(session)
    run = analysis.request_analysis(session, game_id=game.id)
    rows = [MoveEval(ply=ply, win_loss=float(ply)) for ply in range(3)]

    commits = _CountingCommits(session)
    with commits:
        analysis.complete_run(session, run, rows)

    assert commits.count == 1
    assert run.status is RunStatus.DONE
    assert run.finished_at is not None
    assert [row.ply for row in analysis.get_move_evals(session, run.id)] == [0, 1, 2]
    assert [row.run_id for row in analysis.get_move_evals(session, run.id)] == [run.id] * 3


def test_a_retried_run_replaces_the_rows_of_its_first_attempt(session: Session) -> None:
    _engine(session)
    game = _game(session)
    run = analysis.request_analysis(session, game_id=game.id)
    analysis.complete_run(session, run, [MoveEval(ply=0, win_loss=1.0)])

    analysis.complete_run(session, run, [MoveEval(ply=0, win_loss=2.0)])

    rows = analysis.get_move_evals(session, run.id)
    assert [row.win_loss for row in rows] == [2.0]


def test_move_evals_can_be_read_back_over_a_window(session: Session) -> None:
    _engine(session)
    game = _game(session)
    run = analysis.request_analysis(session, game_id=game.id)
    analysis.complete_run(session, run, [MoveEval(ply=ply) for ply in range(6)])

    assert [row.ply for row in analysis.get_move_evals(session, run.id, (2, 5))] == [2, 3, 4]


# --- the game card a finished run leaves behind ----------------------------


def test_finishing_a_run_stores_the_game_card_in_the_same_commit(session: Session) -> None:
    _engine(session)
    game = _game(session)
    run = analysis.request_analysis(session, game_id=game.id)
    rows = [
        MoveEval(ply=0, win_after=52.0, win_loss=4.0),
        MoveEval(ply=2, win_after=12.0, win_loss=40.0, classification=Classification.BLUNDER),
    ]

    commits = _CountingCommits(session)
    with commits:
        analysis.complete_run(session, run, rows)

    assert commits.count == 1
    assert game.card is not None
    assert game.card["analyzed"] is True
    assert game.card["deep"] is False
    assert game.card["eval_curve"] == [{"ply": 0, "win": 52.0}, {"ply": 2, "win": 12.0}]
    assert [moment["ply"] for moment in game.card["worst_moments"]] == [2, 0]


def test_the_card_a_run_stores_covers_every_run_over_the_game(session: Session) -> None:
    _engine(session)
    game = _game(session)
    quick = analysis.request_analysis(session, game_id=game.id)
    analysis.complete_run(session, quick, [MoveEval(ply=0, win_after=52.0, win_loss=4.0)])
    deep = analysis.request_analysis(session, game_id=game.id, tier=Tier.DEEP)

    analysis.complete_run(session, deep, [MoveEval(ply=2, win_after=12.0, win_loss=40.0)])

    assert game.card is not None
    assert game.card["deep"] is True
    assert game.card["eval_curve"] == [{"ply": 0, "win": 52.0}, {"ply": 2, "win": 12.0}]


def test_replacing_a_finished_run_rewrites_the_card_it_left(session: Session) -> None:
    """`complete_run` is also the only path that drops a done run's evals — its own retry."""
    _engine(session)
    game = _game(session)
    run = analysis.request_analysis(session, game_id=game.id)
    analysis.complete_run(session, run, [MoveEval(ply=0, win_after=52.0, win_loss=40.0)])

    analysis.complete_run(session, run, [MoveEval(ply=2, win_after=12.0, win_loss=4.0)])

    assert game.card is not None
    assert game.card["eval_curve"] == [{"ply": 2, "win": 12.0}]
    assert [moment["ply"] for moment in game.card["worst_moments"]] == [2]


def test_a_failed_run_leaves_the_card_of_the_passes_that_did_finish(session: Session) -> None:
    _engine(session)
    game = _game(session)
    first = analysis.request_analysis(session, game_id=game.id)
    analysis.complete_run(session, first, [MoveEval(ply=0, win_after=52.0, win_loss=4.0)])
    stored = game.card
    second = analysis.request_analysis(session, game_id=game.id, tier=Tier.DEEP)

    analysis.fail_run(session, second, "engine died", retry=False)

    assert game.card == stored


def test_a_run_over_a_bare_position_has_no_card_to_store(session: Session) -> None:
    _engine(session)
    game = _game(session)
    run = analysis.request_analysis(
        session, fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
    )

    analysis.complete_run(session, run, [MoveEval(ply=0, win_after=50.0)])

    assert run.game_id is None
    assert game.card is None
    assert session.scalars(select(Game.card)).all() == [None]


# --- the stat summary a finished run leaves behind -------------------------


def test_finishing_a_run_stores_the_stat_summary_in_the_same_commit(session: Session) -> None:
    """What every stats dimension reads instead of the game's evals, written where the
    evals are: one commit, so nothing can ever see one without the other."""
    _engine(session)
    game = _game(session)
    run = analysis.request_analysis(session, game_id=game.id)
    rows = [
        MoveEval(ply=0, win_after=52.0, win_loss=4.0, classification=Classification.INACCURACY),
        MoveEval(ply=2, win_after=12.0, win_loss=40.0, classification=Classification.BLUNDER),
        # The opponent's move: theirs to learn from, not the owner's.
        MoveEval(ply=1, win_loss=60.0, classification=Classification.BLUNDER),
    ]

    commits = _CountingCommits(session)
    with commits:
        analysis.complete_run(session, run, rows)

    assert commits.count == 1
    assert game.stat_summary is not None
    assert game.stat_summary["run_id"] == run.id
    assert game.stat_owner_moves == 2
    assert game.stat_blunders == 1
    assert game.stat_worst_win_loss == 40.0
    assert [moment["ply"] for moment in game.stat_summary["worst"]] == [2, 0]
    assert stats.rebuild_stat_summaries(session) == 0


def test_a_newer_pass_replaces_the_summary_the_last_one_left(session: Session) -> None:
    """The summary describes the game's primary run, and a full pass becomes that run."""
    _engine(session)
    game = _game(session)
    first = analysis.request_analysis(session, game_id=game.id)
    analysis.complete_run(
        session, first, [MoveEval(ply=0, win_loss=40.0, classification=Classification.BLUNDER)]
    )
    second = analysis.request_analysis(session, game_id=game.id, tier=Tier.DEEP)

    analysis.complete_run(
        session,
        second,
        [MoveEval(ply=0, win_loss=4.0, classification=Classification.INACCURACY)],
    )

    assert game.stat_summary is not None
    assert game.stat_summary["run_id"] == second.id
    assert game.stat_blunders == 0
    assert game.stat_worst_win_loss is None
    # Which leaves the backfill sweep nothing to catch up on.
    assert stats.rebuild_stat_summaries(session) == 0


# --- failure and retry ----------------------------------------------------


def test_the_first_failure_buys_a_retry_and_keeps_the_stderr(session: Session) -> None:
    _engine(session)
    game = _game(session)
    analysis.request_analysis(session, game_id=game.id)
    run = analysis.claim_next_run(session)
    assert run is not None

    status = analysis.fail_run(session, run, "engine died", "Segmentation fault")

    assert status is RunStatus.QUEUED
    assert run.stderr == "Segmentation fault"
    assert run.error == "engine died"
    assert run.started_at is None


def test_the_second_failure_gives_up(session: Session) -> None:
    _engine(session)
    game = _game(session)
    analysis.request_analysis(session, game_id=game.id)
    for _ in range(analysis.MAX_ATTEMPTS):
        run = analysis.claim_next_run(session)
        assert run is not None
        status = analysis.fail_run(session, run, "engine died", "boom")

    assert status is RunStatus.FAILED
    assert run.attempts == analysis.MAX_ATTEMPTS
    assert run.finished_at is not None
    assert analysis.claim_next_run(session) is None


def test_a_failure_that_will_never_work_is_not_retried(session: Session) -> None:
    _engine(session)
    game = _game(session)
    analysis.request_analysis(session, game_id=game.id)
    run = analysis.claim_next_run(session)
    assert run is not None

    assert analysis.fail_run(session, run, "no binary", retry=False) is RunStatus.FAILED


def test_a_run_that_succeeds_after_a_retry_forgets_the_failure(session: Session) -> None:
    _engine(session)
    game = _game(session)
    analysis.request_analysis(session, game_id=game.id)
    first = analysis.claim_next_run(session)
    assert first is not None
    analysis.fail_run(session, first, "engine died", "boom")

    second = analysis.claim_next_run(session)
    assert second is not None
    analysis.complete_run(session, second, [])

    assert (second.error, second.stderr) == (None, None)


# --- restart --------------------------------------------------------------


def test_a_dead_processes_running_rows_go_back_in_the_queue(session: Session) -> None:
    _engine(session)
    game = _game(session)
    analysis.request_analysis(session, game_id=game.id)
    stranded = analysis.claim_next_run(session)
    assert stranded is not None
    _went_quiet(session, stranded)

    requeued = analysis.requeue_stale_runs(session)

    assert [run.id for run in requeued] == [stranded.id]
    assert stranded.status is RunStatus.QUEUED
    assert stranded.started_at is None
    assert stranded.error == analysis.STALE_RUN_MESSAGE


def test_a_run_another_process_is_still_working_on_is_left_alone(session: Session) -> None:
    """A second worker set — `blunderbase analyze` while the server is up — must take
    nothing off the first: both would search the same game, and each theft would spend an
    attempt on a run that never failed."""
    _engine(session)
    game = _game(session)
    analysis.request_analysis(session, game_id=game.id)
    claimed = analysis.claim_next_run(session)
    assert claimed is not None

    assert analysis.requeue_stale_runs(session) == []
    assert claimed.status is RunStatus.RUNNING
    assert claimed.attempts == 1


def test_a_run_that_has_spent_its_retry_is_not_requeued_forever(session: Session) -> None:
    _engine(session)
    game = _game(session)
    analysis.request_analysis(session, game_id=game.id)
    for _ in range(analysis.MAX_ATTEMPTS):
        run = analysis.claim_next_run(session)
        assert run is not None
        run.status = RunStatus.RUNNING
        session.commit()
        _went_quiet(session, run)
        analysis.requeue_stale_runs(session)

    assert run.status is RunStatus.FAILED


def test_nothing_running_means_nothing_to_collect(session: Session) -> None:
    assert analysis.requeue_stale_runs(session) == []


def _browser_engine(session: Session, name: str = "wasm-sf") -> Engine:
    """An engine advertised by a browser tab: not a binary, and not a machine."""
    from backend.services import runners as runners_service

    runner, _token = runners_service.create_runner(session, "this-browser", slots=1)
    runner.browser = True
    engine = _engine(session, name=name, path="wasm:stockfish-18")
    engine.runner_id = runner.id
    session.commit()
    return engine


def test_a_browser_tab_that_flaps_twice_does_not_fail_the_run(session: Session) -> None:
    """A tab is expected to vanish; two of those must not be two spent attempts.

    Closing it, locking the phone it is on, or leaving it in the background long enough for
    its timers to be throttled past the detach window are all ordinary, and none of them
    says anything about the run — where a machine that has stopped answering twice has
    broken.
    """
    engine = _browser_engine(session)
    game = _game(session)
    run = analysis.request_analysis(
        session, game_id=game.id, engine_id=engine.id, maia=False
    )

    for _ in range(analysis.MAX_ATTEMPTS + 1):
        claimed = analysis.claim_next_run(session, engine_ids=[engine.id])
        assert claimed is not None and claimed.id == run.id
        _went_quiet(session, claimed)

        assert [collected.id for collected in analysis.requeue_stale_runs(session)] == [run.id]
        assert run.status is RunStatus.QUEUED
        assert run.attempts == 0, "the tab went away; that is not a try the run spent"
        assert run.error == analysis.BROWSER_GONE_MESSAGE


def test_a_browser_engine_that_really_fails_still_spends_its_attempts(session: Session) -> None:
    """The refund is for "the host went away", not for "the work went wrong"."""
    engine = _browser_engine(session)
    game = _game(session)
    analysis.request_analysis(session, game_id=game.id, engine_id=engine.id, maia=False)

    for _ in range(analysis.MAX_ATTEMPTS):
        run = analysis.claim_next_run(session, engine_ids=[engine.id])
        assert run is not None
        status = analysis.fail_run(session, run, "the engine rejected the position")

    assert status is RunStatus.FAILED
    assert run.attempts == analysis.MAX_ATTEMPTS


# --- events ---------------------------------------------------------------


def test_the_lifecycle_is_published_to_subscribers(session: Session) -> None:
    _engine(session)
    game = _game(session)
    events: list[dict[str, Any]] = []
    cancel = analysis.subscribe(events.append)
    try:
        run = analysis.request_analysis(session, game_id=game.id)
        analysis.claim_next_run(session)
        analysis.fail_run(session, run, "engine died", "boom")
        analysis.claim_next_run(session)
        analysis.complete_run(session, run, [])
    finally:
        cancel()

    assert [event["event"] for event in events] == [
        analysis.EVENT_RUN_QUEUED,
        analysis.EVENT_RUN_STARTED,
        analysis.EVENT_RUN_FAILED,
        analysis.EVENT_RUN_STARTED,
        analysis.EVENT_RUN_DONE,
    ]
    assert {event["run_id"] for event in events} == {run.id}
    assert events[2]["will_retry"] is True
    assert events[2]["stderr"] == "boom"
    assert events[-1]["evals"] == 0
    assert all(event["game_id"] == game.id for event in events)
    assert all("at" in event and "tier" in event for event in events)


def test_a_queued_event_waits_for_the_transaction_that_created_the_run(
    session: Session,
) -> None:
    """The import pipeline queues the quick pass inside the transaction that stores the
    game. Announcing it before that commit hands the UI a run id a rolled-back import
    never created, and polling it answers 404."""
    _engine(session)
    game = _game(session)
    events: list[dict[str, Any]] = []
    cancel = analysis.subscribe(events.append)
    try:
        analysis.request_analysis(session, game_id=game.id, commit=False)
        assert events == []
        session.rollback()
        assert events == []

        run = analysis.request_analysis(session, game_id=game.id, commit=False)
        assert events == []
        session.commit()
    finally:
        cancel()

    assert [(event["event"], event["run_id"]) for event in events] == [
        (analysis.EVENT_RUN_QUEUED, run.id)
    ]


def test_unsubscribing_stops_the_feed(session: Session) -> None:
    _engine(session)
    game = _game(session)
    events: list[dict[str, Any]] = []
    cancel = analysis.subscribe(events.append)
    cancel()

    analysis.request_analysis(session, game_id=game.id)

    assert events == []


def test_a_subscriber_that_raises_cannot_break_a_run(session: Session) -> None:
    _engine(session)
    game = _game(session)
    seen: list[str] = []

    def angry(event: dict[str, Any]) -> None:
        raise RuntimeError("no")

    cancel_angry = analysis.subscribe(angry)
    cancel_calm = analysis.subscribe(lambda event: seen.append(event["event"]))
    try:
        analysis.request_analysis(session, game_id=game.id)
    finally:
        cancel_angry()
        cancel_calm()

    assert seen == [analysis.EVENT_RUN_QUEUED]


# --- reading --------------------------------------------------------------


def test_the_worst_moments_are_ranked_by_win_percentage_given_away(session: Session) -> None:
    _engine(session)
    game = _game(session)
    run = analysis.request_analysis(session, game_id=game.id)
    analysis.complete_run(
        session,
        run,
        [
            MoveEval(ply=0, win_loss=12.0),
            MoveEval(ply=1, win_loss=44.0),
            MoveEval(ply=2, win_loss=None),
            MoveEval(ply=3, win_loss=31.0),
        ],
    )

    worst = analysis.get_worst_moments(session, amount=2)

    assert [row.win_loss for row in worst] == [44.0, 31.0]
    assert analysis.get_worst_moments(session, amount=0) == []


def test_only_finished_runs_contribute_worst_moments(session: Session) -> None:
    _engine(session)
    game = _game(session)
    run = analysis.request_analysis(session, game_id=game.id)
    session.add(MoveEval(run_id=run.id, ply=0, win_loss=90.0))
    session.commit()

    assert analysis.get_worst_moments(session) == []


def test_an_unknown_run_is_a_typed_lookup_error(session: Session) -> None:
    assert analysis.get_run(session, 404) is None
    with pytest.raises(analysis.UnknownRunError):
        analysis.require_run(session, 404)


class _CountingCommits:
    """Counts commits on a Session, which is how "one transaction per run" is checked."""

    def __init__(self, session: Session) -> None:
        self.session = session
        self.count = 0
        self._original = session.commit

    def __enter__(self) -> _CountingCommits:
        def counted() -> None:
            self.count += 1
            self._original()

        self.session.commit = counted  # type: ignore[method-assign]
        return self

    def __exit__(self, *_: object) -> None:
        self.session.commit = self._original  # type: ignore[method-assign]


def test_every_run_of_a_game_is_listed_newest_first(session: Session) -> None:
    _engine(session)
    game = _game(session)
    runs = [analysis.request_analysis(session, game_id=game.id) for _ in range(3)]

    assert [run.id for run in analysis.list_runs(session, game.id)] == [
        run.id for run in reversed(runs)
    ]
    assert session.scalar(select(AnalysisRun.id).limit(1)) == runs[0].id


# --- the attempt token ----------------------------------------------------


def _queued(session: Session, engine_id: int | None) -> AnalysisRun:
    """A queued run bound to whatever engine — including none at all."""
    run = AnalysisRun(engine_id=engine_id, tier=Tier.QUICK, status=RunStatus.QUEUED)
    session.add(run)
    session.commit()
    return run


def test_every_claim_writes_a_fresh_attempt_token(session: Session) -> None:
    _engine(session)
    game = _game(session)
    analysis.request_analysis(session, game_id=game.id)

    first = analysis.claim_next_run(session)
    assert first is not None
    one = first.attempt_token
    analysis.fail_run(session, first, "engine died")
    second = analysis.claim_next_run(session)
    assert second is not None

    assert one is not None and len(one) == analysis.ATTEMPT_TOKEN_BYTES * 2
    assert second.attempt_token != one


def test_a_result_under_the_dispatching_token_is_stored(session: Session) -> None:
    _engine(session)
    game = _game(session)
    analysis.request_analysis(session, game_id=game.id)
    run = analysis.claim_next_run(session)
    assert run is not None

    analysis.complete_run(session, run, [MoveEval(ply=0)], attempt_token=run.attempt_token)

    assert run.status is RunStatus.DONE
    assert len(analysis.get_move_evals(session, run.id)) == 1


def test_a_result_for_an_attempt_that_is_over_is_dropped(session: Session) -> None:
    """The run was taken away and re-claimed; the first runner's answer must not land on
    the attempt that replaced it."""
    _engine(session)
    game = _game(session)
    analysis.request_analysis(session, game_id=game.id)
    first = analysis.claim_next_run(session)
    assert first is not None
    stale_token = first.attempt_token
    _went_quiet(session, first)
    analysis.requeue_stale_runs(session)
    second = analysis.claim_next_run(session)
    assert second is not None

    with pytest.raises(analysis.StaleResultError) as dropped:
        analysis.complete_run(session, second, [MoveEval(ply=0)], attempt_token=stale_token)

    assert dropped.value.run_id == second.id
    assert dropped.value.presented == stale_token
    assert second.status is RunStatus.RUNNING
    assert analysis.get_move_evals(session, second.id) == []


def test_a_dropped_result_never_writes_the_live_token_to_the_log(
    session: Session, caplog: pytest.LogCaptureFixture
) -> None:
    """The token on the row is the capability guarding the attempt that is running now, and
    anyone who can make this line be written is by definition somebody without it."""
    _engine(session)
    game = _game(session)
    analysis.request_analysis(session, game_id=game.id)
    run = analysis.claim_next_run(session)
    assert run is not None
    live_token = run.attempt_token

    with caplog.at_level(logging.INFO, logger="backend.services.analysis"):
        with pytest.raises(analysis.StaleResultError):
            analysis.complete_run(session, run, [MoveEval(ply=0)], attempt_token="f" * 32)

    written = caplog.text
    assert "f" * 32 in written, "the presented token is the one worth naming"
    assert live_token not in written


def test_a_duplicate_result_is_dropped_rather_than_rewriting_the_run(session: Session) -> None:
    _engine(session)
    game = _game(session)
    analysis.request_analysis(session, game_id=game.id)
    run = analysis.claim_next_run(session)
    assert run is not None
    token = run.attempt_token
    analysis.complete_run(session, run, [MoveEval(ply=0, win_loss=1.0)], attempt_token=token)

    with pytest.raises(analysis.StaleResultError):
        analysis.complete_run(session, run, [MoveEval(ply=0, win_loss=2.0)], attempt_token=token)

    assert [row.win_loss for row in analysis.get_move_evals(session, run.id)] == [1.0]


def test_a_run_that_is_not_running_accepts_nothing(session: Session) -> None:
    _engine(session)
    game = _game(session)
    run = analysis.request_analysis(session, game_id=game.id)
    run.attempt_token = "f" * 32
    session.commit()

    with pytest.raises(analysis.StaleResultError):
        analysis.complete_run(session, run, [], attempt_token="f" * 32)


def test_a_row_claimed_before_the_token_existed_cannot_be_vouched_for(session: Session) -> None:
    _engine(session)
    game = _game(session)
    analysis.request_analysis(session, game_id=game.id)
    run = analysis.claim_next_run(session)
    assert run is not None
    run.attempt_token = None
    session.commit()

    with pytest.raises(analysis.StaleResultError):
        analysis.complete_run(session, run, [], attempt_token="f" * 32)


def test_a_local_caller_completes_exactly_as_it_always_did(session: Session) -> None:
    _engine(session)
    game = _game(session)
    run = analysis.request_analysis(session, game_id=game.id)

    analysis.complete_run(session, run, [MoveEval(ply=0)])

    assert run.status is RunStatus.DONE


def test_a_failure_from_an_attempt_that_is_over_is_dropped(session: Session) -> None:
    _engine(session)
    game = _game(session)
    analysis.request_analysis(session, game_id=game.id)
    run = analysis.claim_next_run(session)
    assert run is not None

    with pytest.raises(analysis.StaleResultError):
        analysis.fail_run(session, run, "engine died", attempt_token="f" * 32)

    assert run.status is RunStatus.RUNNING
    assert run.error is None


def test_the_guard_names_the_run_it_could_not_find(session: Session) -> None:
    with pytest.raises(analysis.UnknownRunError):
        analysis.guard_attempt(session, 4242, "f" * 32)


def test_the_guard_hands_back_the_run_the_token_still_owns(session: Session) -> None:
    _engine(session)
    game = _game(session)
    analysis.request_analysis(session, game_id=game.id)
    run = analysis.claim_next_run(session)
    assert run is not None

    assert analysis.guard_attempt(session, run.id, run.attempt_token).id == run.id


def test_a_beat_from_the_runner_holding_the_run_lands(session: Session) -> None:
    _engine(session)
    game = _game(session)
    analysis.request_analysis(session, game_id=game.id)
    run = analysis.claim_next_run(session)
    assert run is not None
    run.heartbeat_at = None
    session.commit()

    assert analysis.heartbeat_run(session, run.id, run.attempt_token) is True

    session.refresh(run)
    assert run.heartbeat_at is not None


def test_a_beat_for_a_run_that_was_taken_away_says_so(session: Session) -> None:
    _engine(session)
    game = _game(session)
    analysis.request_analysis(session, game_id=game.id)
    run = analysis.claim_next_run(session)
    assert run is not None

    assert analysis.heartbeat_run(session, run.id, "f" * 32) is False
    assert analysis.heartbeat_run(session, 4242, run.attempt_token) is False


# --- claiming for one host ------------------------------------------------


def test_a_claim_can_be_narrowed_to_one_hosts_engines(session: Session) -> None:
    mine = _engine(session, name="mine")
    theirs = _engine(session, name="theirs")
    ours = _queued(session, mine.id)
    _queued(session, theirs.id)

    claimed = analysis.claim_next_run(session, engine_ids=[mine.id])

    assert claimed is not None and claimed.id == ours.id
    assert analysis.claim_next_run(session, engine_ids=[mine.id]) is None


def test_a_claim_for_no_engines_at_all_takes_nothing(session: Session) -> None:
    engine = _engine(session)
    _queued(session, engine.id)

    assert analysis.claim_next_run(session, engine_ids=[]) is None


def test_a_run_with_no_engine_belongs_to_nobody_in_particular(session: Session) -> None:
    """It stays claimable under an exclusion — the local fallback will find it one — and is
    not claimable under an inclusion."""
    engine = _engine(session)
    orphan = _queued(session, None)

    assert analysis.claim_next_run(session, engine_ids=[engine.id]) is None
    claimed = analysis.claim_next_run(session, exclude_engine_ids=[engine.id])
    assert claimed is not None and claimed.id == orphan.id


def test_an_excluded_engines_run_is_left_where_it_is(session: Session) -> None:
    local = _engine(session, name="local")
    remote = _engine(session, name="remote")
    _queued(session, remote.id)
    mine = _queued(session, local.id)

    claimed = analysis.claim_next_run(session, exclude_engine_ids=[remote.id])

    assert claimed is not None and claimed.id == mine.id
    assert analysis.claim_next_run(session, exclude_engine_ids=[remote.id]) is None


# --- handing a run back ---------------------------------------------------


def test_an_abandoned_run_goes_back_with_its_attempt_refunded(session: Session) -> None:
    _engine(session)
    game = _game(session)
    analysis.request_analysis(session, game_id=game.id)
    run = analysis.claim_next_run(session)
    assert run is not None

    assert analysis.abandon_run(session, run) is True

    assert run.status is RunStatus.QUEUED
    assert run.attempts == 0
    assert run.started_at is None
    assert run.heartbeat_at is None
    assert run.error == analysis.STALE_RUN_MESSAGE


def test_an_abandoned_run_can_be_made_to_pay_for_its_attempt(session: Session) -> None:
    _engine(session)
    game = _game(session)
    analysis.request_analysis(session, game_id=game.id)
    run = analysis.claim_next_run(session)
    assert run is not None

    analysis.abandon_run(session, run, reason="the runner was revoked", refund_attempt=False)

    assert run.attempts == 1
    assert run.error == "the runner was revoked"


def test_there_is_nothing_to_abandon_about_a_finished_run(session: Session) -> None:
    _engine(session)
    game = _game(session)
    run = analysis.request_analysis(session, game_id=game.id)
    analysis.complete_run(session, run, [])

    assert analysis.abandon_run(session, run) is False
    assert run.status is RunStatus.DONE


def test_abandoning_a_run_announces_that_it_is_queued_again(session: Session) -> None:
    _engine(session)
    game = _game(session)
    analysis.request_analysis(session, game_id=game.id)
    run = analysis.claim_next_run(session)
    assert run is not None
    events: list[dict[str, Any]] = []
    cancel = analysis.subscribe(events.append)
    try:
        analysis.abandon_run(session, run)
    finally:
        cancel()

    assert [event["event"] for event in events] == [analysis.EVENT_RUN_QUEUED]


# --- what the library has been analysed with ------------------------------


def _finished(
    session: Session,
    game: Game,
    tier: Tier = Tier.QUICK,
    *,
    status: RunStatus = RunStatus.DONE,
    seconds: float = 6.0,
    nodes: int | None = None,
    multipv: int | None = None,
    maia_only: bool = False,
    elos: list[int] | None = None,
) -> AnalysisRun:
    """A full-game run over `game` that took `seconds`, at today's budget unless told otherwise."""
    started = utcnow()
    deep = Tier(tier) is Tier.DEEP
    run = AnalysisRun(
        game_id=game.id,
        tier=tier,
        status=status,
        nodes=nodes
        if nodes is not None
        else (app_settings.DEEP_NODES_DEFAULT if deep else app_settings.QUICK_NODES_DEFAULT),
        multipv=multipv
        if multipv is not None
        else (app_settings.DEEP_MULTIPV_DEFAULT if deep else 1),
        maia_only=maia_only,
        maia_elos=elos,
        started_at=started,
        finished_at=started + timedelta(seconds=seconds),
    )
    session.add(run)
    session.commit()
    return run


def test_a_run_whose_first_row_holds_a_json_null_still_reports_its_levels(
    session: Session,
) -> None:
    """The defect 0011 cleared: `'null'` is a value, and it answers `IS NOT NULL`.

    A ply nobody asked Maia about — the opponent's move under `maia_both_sides` off — was
    written by a JSON column as the literal `null` rather than as SQL NULL. The run's
    representative row is the first one carrying a policy, and picking that one made the
    whole run report no levels, so the fill button re-queued work the library already had.
    """
    _engine(session)
    _maia(session)
    game = _game(session)
    run = AnalysisRun(
        game_id=game.id, tier=Tier.QUICK, status=RunStatus.DONE, nodes=1, multipv=1
    )
    session.add(run)
    session.flush()
    session.add_all(
        [
            MoveEval(run_id=run.id, ply=0, move_uci="e2e4"),
            MoveEval(
                run_id=run.id,
                ply=1,
                move_uci="e7e5",
                maia_policy={"1500": [{"uci": "e7e5", "rank": 1}]},
            ),
        ]
    )
    session.commit()
    # What the column used to write where it meant to write nothing.
    session.execute(
        text("UPDATE move_evals SET maia_policy = 'null' WHERE run_id = :run AND ply = 0"),
        {"run": run.id},
    )
    session.commit()
    app_settings.set_maia_elos(session, [1500])

    assert analysis.maia_fill_status(session)["missing_games"] == 0
    assert analysis.queue_maia_fill(session)["queued"] == 0


def test_a_policy_that_is_not_there_is_stored_as_sql_null(session: Session) -> None:
    """The column half of the same fix: no row written from here on needs the migration."""
    _engine(session)
    game = _game(session)
    run = AnalysisRun(
        game_id=game.id, tier=Tier.QUICK, status=RunStatus.DONE, nodes=1, multipv=1
    )
    session.add(run)
    session.flush()
    session.add(MoveEval(run_id=run.id, ply=0, move_uci="e2e4"))
    session.commit()

    stored = session.execute(
        text("SELECT maia_policy, best_lines FROM move_evals WHERE run_id = :run"),
        {"run": run.id},
    ).one()

    assert stored == (None, None)


def test_coverage_splits_the_library_by_the_pass_each_game_has(session: Session) -> None:
    """Every field of the page's picture, over a library with one game of each shape."""
    _engine(session)
    quick_only = _game(session, plies=6)
    deep = _game(session, plies=4)
    _game(session, plies=2)
    failed = _game(session, plies=6)
    run = _finished(session, quick_only)
    _finished(session, deep, Tier.DEEP)
    _finished(session, failed, status=RunStatus.FAILED)
    # A level nobody asks about any more: Maia used to be centred on the game's own rating.
    session.add(
        MoveEval(run_id=run.id, ply=0, move_uci="e2e4", maia_policy={"1234": [{"uci": "e2e4"}]})
    )
    session.commit()

    assert analysis.coverage(session, settings=Settings(analysis_concurrency=3)) == {
        "total": 4,
        "no_pass": 2,
        "quick_only": 1,
        "deep": 1,
        # Not the complement of the split: the deep-only game is missing a quick pass, and
        # a failed run leaves its game as unanalysed as it was.
        "missing": {"quick": 3, "deep": 3},
        "failed": 1,
        "maia": {
            "configured": [MAIA_MAX_RATING],
            "games_with_any": 1,
            "per_level": [{"elo": MAIA_MAX_RATING, "games": 0}],
            "missing_games": 2,
            "orphan_levels": [{"elo": 1234, "games": 1}],
        },
        "estimates": {
            "quick_seconds": None,
            "deep_seconds": None,
            "maia_seconds": None,
            "concurrency": 3,
        },
    }


def test_the_estimate_averages_only_the_budget_that_is_configured_now(session: Session) -> None:
    """The 447 deep runs from an experiment at 500 nodes are not what a pass costs today."""
    _engine(session)
    for _ in range(analysis.ESTIMATE_MIN_SAMPLES):
        _finished(session, _game(session, plies=6), seconds=6.0)
    for _ in range(analysis.ESTIMATE_MIN_SAMPLES):
        _finished(session, _game(session, plies=6), seconds=60.0, nodes=500)
    _game(session, plies=4)

    estimate = analysis.coverage(session)["estimates"]["quick_seconds"]

    # A second per ply over the four plies with no pass — not the 5.5 the two budgets
    # averaged together would have promised.
    assert estimate == pytest.approx(4.0)


def test_the_estimate_includes_work_of_that_tier_already_in_the_queue(session: Session) -> None:
    """After Backfill is pressed, its remaining time must not collapse to zero."""
    _engine(session)
    for _ in range(analysis.ESTIMATE_MIN_SAMPLES):
        _finished(session, _game(session, plies=6), seconds=6.0)
    _finished(session, _game(session, plies=4), status=RunStatus.QUEUED)
    _game(session, plies=2)

    estimate = analysis.coverage(session)["estimates"]["quick_seconds"]

    # A second per ply over four already queued plies plus two not queued yet.
    assert estimate == pytest.approx(6.0)


def test_coverage_scans_each_library_wide_source_once(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The missing-work and settled-level scans used to repeat during one page load."""
    _engine(session)
    _finished(session, _game(session))
    settled_original = analysis._settled_maia_levels
    missing_original = analysis._missing_games
    settled_calls = 0
    missing_calls: list[Tier] = []

    def counted_settled(*args: Any, **kwargs: Any) -> dict[int, set[str]]:
        nonlocal settled_calls
        settled_calls += 1
        return settled_original(*args, **kwargs)

    def counted_missing(tier: Tier, **kwargs: Any) -> Any:
        missing_calls.append(Tier(tier))
        return missing_original(tier, **kwargs)

    monkeypatch.setattr(analysis, "_settled_maia_levels", counted_settled)
    monkeypatch.setattr(analysis, "_missing_games", counted_missing)

    analysis.coverage(session)

    assert settled_calls == 1
    assert missing_calls == [Tier.QUICK, Tier.DEEP]


def test_the_estimate_is_none_until_there_is_history_worth_averaging(session: Session) -> None:
    _engine(session)
    for _ in range(analysis.ESTIMATE_MIN_SAMPLES - 1):
        _finished(session, _game(session, plies=6), seconds=6.0)
    _game(session, plies=4)

    assert analysis.coverage(session)["estimates"] == {
        "quick_seconds": None,
        "deep_seconds": None,
        "maia_seconds": None,
        "concurrency": analysis.get_settings().analysis_concurrency,
    }


def test_the_fill_is_priced_off_the_fills_this_deployment_has_finished(
    session: Session,
) -> None:
    """The third button's estimate: fill seconds per ply, over the plies still missing a level.

    A fill searches nothing, so the quick tier's per-ply cost is no guide to it at all —
    the sample is `maia_only` runs and the games priced are the ones `maia_fill_targets`
    would queue.
    """
    _engine(session)
    _maia(session)
    app_settings.set_maia_elos(session, [1500])
    for _ in range(analysis.ESTIMATE_MIN_SAMPLES):
        filled = _game(session, plies=6)
        _finished(session, filled, seconds=60.0)
        _finished(session, filled, seconds=3.0, maia_only=True, elos=[1500])
    # Analysed, never filled: four plies of work the button still has in front of it.
    _finished(session, _game(session, plies=4), seconds=60.0)
    # Another two plies are already in the fill queue and must remain in its estimate.
    queued = _game(session, plies=2)
    _finished(session, queued, seconds=60.0)
    _finished(
        session,
        queued,
        status=RunStatus.QUEUED,
        maia_only=True,
        elos=[1500],
    )

    estimate = analysis.coverage(session)["estimates"]["maia_seconds"]

    # Half a second a ply over four new and two queued plies — not the ten a quick pass costs.
    assert estimate == pytest.approx(3.0)


def test_the_fill_estimate_ignores_the_passes_that_searched(session: Session) -> None:
    """Five finished quick passes and no fill measure nothing about what a fill costs."""
    _engine(session)
    _maia(session)
    app_settings.set_maia_elos(session, [1500])
    for _ in range(analysis.ESTIMATE_MIN_SAMPLES):
        _finished(session, _game(session, plies=6), seconds=6.0)

    assert analysis.coverage(session)["estimates"]["maia_seconds"] is None


# --- picking the failures back up -----------------------------------------


def test_the_failed_runs_can_be_listed_without_naming_a_game(session: Session) -> None:
    """The listing that did not exist: a failed run is invisible once the socket frames pass."""
    _engine(session)
    first = _finished(session, _game(session), status=RunStatus.FAILED)
    second = _finished(session, _game(session), status=RunStatus.FAILED)
    _finished(session, _game(session))

    listed = analysis.list_runs(session, status=RunStatus.FAILED)

    assert [run.id for run in listed] == [second.id, first.id]
    assert [run.id for run in analysis.list_runs(session, status=RunStatus.FAILED, limit=1)] == [
        second.id
    ]


def test_a_run_listing_has_to_narrow_by_something(session: Session) -> None:
    with pytest.raises(analysis.AnalysisRequestError, match="a game or a status"):
        analysis.list_runs(session)


def test_a_retry_is_a_new_run_under_the_tier_that_failed(session: Session) -> None:
    _engine(session)
    game = _game(session)
    failed = _finished(session, game, Tier.DEEP, status=RunStatus.FAILED)

    assert analysis.retry_failed(session) == {"queued": 1, "skipped": 0}

    queued = session.scalars(
        select(AnalysisRun).where(AnalysisRun.status == RunStatus.QUEUED)
    ).one()
    assert queued.id != failed.id
    assert (queued.game_id, queued.tier) == (game.id, Tier.DEEP)
    # The failure stays where it is: it is the record of what went wrong.
    assert session.get(AnalysisRun, failed.id).status is RunStatus.FAILED


def test_a_retry_skips_a_game_that_already_has_a_live_run(session: Session) -> None:
    _engine(session)
    game = _game(session)
    _finished(session, game, status=RunStatus.FAILED)
    _finished(session, game)

    assert analysis.retry_failed(session) == {"queued": 0, "skipped": 1}
    assert analysis.list_runs(session, game.id, status=RunStatus.QUEUED) == []


def test_a_retry_can_be_narrowed_to_the_runs_that_were_named(session: Session) -> None:
    _engine(session)
    wanted = _finished(session, _game(session), status=RunStatus.FAILED)
    _finished(session, _game(session), status=RunStatus.FAILED)

    assert analysis.retry_failed(session, [wanted.id]) == {"queued": 1, "skipped": 0}

    queued = session.scalars(
        select(AnalysisRun).where(AnalysisRun.status == RunStatus.QUEUED)
    ).one()
    assert queued.game_id == wanted.game_id


def test_a_retry_announces_every_run_it_queued(session: Session) -> None:
    """Same announcement a batch makes: the queue widgets fold these in one at a time."""
    _engine(session)
    _finished(session, _game(session), status=RunStatus.FAILED)
    _finished(session, _game(session), status=RunStatus.FAILED)
    events: list[dict[str, Any]] = []
    cancel = analysis.subscribe(events.append)
    try:
        analysis.retry_failed(session)
    finally:
        cancel()

    assert [event["event"] for event in events] == [analysis.EVENT_RUN_QUEUED] * 2
