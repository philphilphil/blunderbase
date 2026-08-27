"""The rules of a run: win percentages, classification, the queue and its transitions."""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

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
from backend.services import analysis, app_settings, explorer
from backend.services.engines import TierUnavailableError

THRESHOLDS = analysis.Thresholds(inaccuracy=10.0, mistake=20.0, blunder=30.0)


def _engine(session: Session, **changes: Any) -> Engine:
    engine = Engine(
        name=changes.pop("name", "Stockfish"),
        kind=changes.pop("kind", EngineKind.UCI),
        path=changes.pop("path", "/usr/bin/stockfish"),
        default_tier=changes.pop("default_tier", Tier.QUICK),
        enabled=changes.pop("enabled", True),
        **changes,
    )
    session.add(engine)
    session.commit()
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
    assert analysis.Thresholds.from_session(session) == analysis.Thresholds(
        inaccuracy=10.0, mistake=20.0, blunder=30.0
    )


# --- Maia rating levels ---------------------------------------------------


def test_the_level_is_the_owners_rating_in_that_game() -> None:
    assert analysis.maia_levels(1600) == [1600]


def test_the_level_is_clamped_to_what_the_model_can_answer() -> None:
    assert analysis.maia_levels(900) == [1100]
    assert analysis.maia_levels(2400) == [2000]


def test_an_unrated_owner_falls_back_to_the_configured_default() -> None:
    assert analysis.maia_levels(None, default=1400) == [1400]


def test_a_target_elo_is_the_level_instead(session: Session) -> None:
    """The rating the game was played at is exactly what a target elo replaces."""
    assert analysis.maia_levels(1200, target=1700) == [1700]


def test_a_target_elo_is_still_clamped_to_what_the_build_declares() -> None:
    assert analysis.maia_levels(None, target=1900, low=1100, high=1500) == [1500]
    assert analysis.maia_levels(None, target=900) == [1100]


def _plan(session: Session, **changes: Any) -> analysis.RunPlan:
    _engine(session)
    game = _game(session)
    run = analysis.request_analysis(session, game_id=game.id, **changes)
    return analysis.build_plan(session, run)


def test_without_a_target_maia_is_only_asked_about_the_owners_own_moves(
    session: Session,
) -> None:
    plan = _plan(session)

    assert plan.maia_target_elo is None
    # The owner has White in `_game`, so the even plies are theirs.
    assert plan.maia_plies() == [0, 2, 4]


def test_a_target_elo_asks_about_every_ply_of_both_sides(session: Session) -> None:
    """The "what will a human opposite me fall into" half is a question about their moves."""
    app_settings.set_maia_target_elo(session, 1700)
    plan = _plan(session)

    assert plan.maia_target_elo == 1700
    assert plan.maia_plies() == [0, 1, 2, 3, 4, 5]


def test_a_game_with_no_owner_covers_every_ply_either_way(tmp_path: Any) -> None:
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


def test_a_position_run_asks_about_the_one_position_it_has(session: Session) -> None:
    _engine(session)
    app_settings.set_maia_target_elo(session, 1700)
    run = analysis.request_analysis(
        session, fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
    )
    plan = analysis.build_plan(session, run)

    assert plan.maia_target_elo == 1700
    assert plan.maia_plies() == [0]


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
    _remote_engine(session, "maia-remote", kind=EngineKind.MAIA, default_tier=None)
    game = _game(session)

    with pytest.raises(analysis.AnalysisRequestError) as refused:
        analysis.request_analysis(session, game_id=game.id)

    message = str(refused.value)
    assert "must be on one machine" in message
    assert "'stockfish' is on this host" in message
    assert "'maia-remote', is on runner 'gpu-box'" in message


def test_a_search_on_a_runner_and_the_only_maia_here_is_refused(session: Session) -> None:
    remote = _remote_engine(session, "sf-remote", default_tier=Tier.DEEP)
    _engine(session, name="maia", kind=EngineKind.MAIA, default_tier=None)
    game = _game(session)

    with pytest.raises(analysis.AnalysisRequestError, match="must be on one machine"):
        analysis.request_analysis(session, game_id=game.id, engine_id=remote.id, tier=Tier.DEEP)


def test_a_host_with_its_own_maia_is_not_mixed(session: Session) -> None:
    remote = _remote_engine(session, "sf-remote", default_tier=Tier.DEEP)
    _remote_engine(session, "maia-remote", kind=EngineKind.MAIA, default_tier=None)
    _engine(session, name="stockfish")
    _engine(session, name="maia", kind=EngineKind.MAIA, default_tier=None)
    game = _game(session)

    remote_run = analysis.request_analysis(session, game_id=game.id, engine_id=remote.id)
    local_run = analysis.request_analysis(session, game_id=game.id)

    assert remote_run.engine_id == remote.id
    assert local_run.status is RunStatus.QUEUED


def test_a_deployment_with_no_maia_at_all_has_nothing_to_mix(session: Session) -> None:
    """The pass simply does not happen, which is exactly today's behaviour."""
    _remote_engine(session, "sf-remote", default_tier=Tier.DEEP)
    game = _game(session)

    assert analysis.request_analysis(session, game_id=game.id, tier=Tier.DEEP).id


def test_a_maia_that_is_switched_off_strands_nobody(session: Session) -> None:
    _remote_engine(session, "sf-remote", default_tier=Tier.DEEP)
    _engine(session, name="maia", kind=EngineKind.MAIA, default_tier=None, enabled=False)
    game = _game(session)

    assert analysis.request_analysis(session, game_id=game.id, tier=Tier.DEEP).id


def test_a_run_on_the_maia_itself_is_not_a_mixed_host_run(session: Session) -> None:
    """Nothing is stranded when the engine named *is* the model."""
    maia = _remote_engine(session, "maia-remote", kind=EngineKind.MAIA, default_tier=None)
    _engine(session, name="maia", kind=EngineKind.MAIA, default_tier=None)
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
    theirs = _engine(session, name="theirs", default_tier=None)
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
    remote = _engine(session, name="remote", default_tier=None)
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
