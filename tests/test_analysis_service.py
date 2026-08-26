"""The rules of a run: win percentages, classification, the queue and its transitions."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.config import Settings
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
from backend.services import analysis, explorer
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


def test_thresholds_come_from_configuration(tmp_path: Any) -> None:
    settings = Settings(root=tmp_path, inaccuracy_threshold=5, mistake_threshold=8)
    thresholds = analysis.Thresholds.from_settings(settings)

    assert thresholds.inaccuracy == 5.0
    assert (
        analysis.classify_move(6.0, played_best=False, thresholds=thresholds)
        is Classification.INACCURACY
    )


def test_thresholds_that_do_not_rise_are_refused(tmp_path: Any) -> None:
    with pytest.raises(ValueError, match="thresholds must rise"):
        Settings(root=tmp_path, mistake_threshold=40, blunder_threshold=30)


# --- Maia rating levels ---------------------------------------------------


def test_maia_levels_sit_around_the_owners_rating() -> None:
    assert analysis.maia_levels(1600, (-100, 0, 100)) == [1500, 1600, 1700]


def test_maia_levels_are_clamped_to_what_the_model_can_answer() -> None:
    assert analysis.maia_levels(1150, (-100, 0, 100)) == [1100, 1150, 1250]
    assert analysis.maia_levels(2000, (-100, 0, 100)) == [1900, 2000]


def test_an_unrated_owner_falls_back_to_the_configured_default() -> None:
    assert analysis.maia_levels(None, (0,), default=1400) == [1400]


# --- enqueueing -----------------------------------------------------------


def test_a_quick_run_carries_the_configured_budget(session: Session, tmp_path: Any) -> None:
    _engine(session)
    game = _game(session)
    settings = Settings(root=tmp_path, quick_nodes=1234)

    run = analysis.request_analysis(session, game_id=game.id, settings=settings)

    assert run.tier is Tier.QUICK
    assert run.status is RunStatus.QUEUED
    assert (run.nodes, run.multipv) == (1234, 1)
    assert run.priority == analysis.QUICK_PRIORITY
    assert (run.ply_start, run.ply_end) == (None, None)


def test_a_deep_run_gets_multiple_lines_and_jumps_the_queue(
    session: Session, tmp_path: Any
) -> None:
    _engine(session)
    game = _game(session)
    settings = Settings(root=tmp_path, deep_nodes=999_999, deep_multipv=5)

    run = analysis.request_analysis(
        session, game_id=game.id, tier=Tier.DEEP, ply_range=(2, 5), settings=settings
    )

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
