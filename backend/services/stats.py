from __future__ import annotations

import threading
import time
from collections.abc import Callable, Iterable, Mapping, Sequence
from concurrent.futures import Future
from dataclasses import dataclass, fields, is_dataclass, replace
from datetime import UTC, datetime, timedelta
from enum import Enum
from typing import Any, NamedTuple

from sqlalchemy import Integer, and_, func, or_, select
from sqlalchemy.orm import Session, undefer

from backend.db.enums import Classification, Color, EngineKind, RunStatus
from backend.db.models import AnalysisRun, Engine, Game, GamePosition, MoveEval, Position
from backend.services import games as games_service
from backend.services.games import (
    DRAW,
    LOSS,
    WIN,
    GameFilters,
    game_conditions,
    game_summary,
    outcome_from,
    owner_move_condition,
)

# The dimensions `get_stats` knows how to aggregate over.
DIMENSIONS = (
    "blunders_by_phase",
    "blunders_by_piece",
    "performance_by_speed",
    "performance_by_hour",
    "time_trouble_loss",
    "rating_trend",
)

# Named in the design spec, waiting on tactical motif detection that the engine pipeline
# does not produce yet. Asked for by name it says so, rather than pretending to answer.
PLANNED_DIMENSIONS = ("blunders_by_motif",)

PHASES = ("opening", "middlegame", "endgame")
PIECES = ("pawn", "knight", "bishop", "rook", "queen", "king")

# Phase heuristic. Non-pawn material is counted over both sides from the FEN (a full board
# is 62), so a queenless four-piece position is an endgame on move 15 and a game with both
# queens on is not one on move 60.
PIECE_VALUES = {"q": 9, "r": 5, "b": 3, "n": 3}
ENDGAME_MATERIAL = 14
OPENING_PLIES = 24

# Seconds left on the mover's own clock, before the move. The bands below are what
# "time trouble" means here; a caller with a different idea passes its own.
TIME_TROUBLE_THRESHOLDS: tuple[float, ...] = (10.0, 30.0, 60.0)

# How many of a game's own worst moments its summary keeps. The dashboard asks for five and
# the coach for a handful more, and a moment only reaches that list by being among the worst
# in the whole library — so a game would have to hold twenty-four of the library's worst
# moments by itself before the twenty-fifth could ever be wanted. The cap trims the mildest,
# which are the ones nothing ranks anyway.
STAT_SUMMARY_WORST_MOMENTS = 24

# How many games a summary backfill folds before it commits and lets go of the write lock.
STAT_SUMMARY_BACKFILL_CHUNK = 100

# How long the "every summary is current" answer is trusted while it is still False. True is
# kept forever — `analysis.complete_run` is what keeps it true — so this is only the cost of
# noticing that a backfill has finished, paid once a minute for as long as one is running.
SUMMARIES_READY_RECHECK_SECONDS = 60.0

# How many extra games the worst-moments ranking reads past the ones it needs. A game's
# stored maximum is only its own worst moment, so a game can hold several of the answer;
# the margin is what absorbs that.
WORST_MOMENT_GAME_MARGIN = 8

# How the ranking breaks a tie, in SQL and in Python alike. Ties are the common case rather
# than the exotic one — every blunder into a forced mate gives away the same 99.88 — and
# "whatever the scan happened to reach first" is both unstable between refreshes and
# something the folded path could not reproduce. Oldest game first, then earliest ply.
WORST_MOMENT_ORDER = (MoveEval.win_loss.desc(), AnalysisRun.game_id.asc(), MoveEval.ply.asc())

BUCKETS = ("day", "week", "month", "year")

SAN_PIECES = {"N": "knight", "B": "bishop", "R": "rook", "Q": "queen", "K": "king"}
FEN_PIECES = {"p": "pawn", "n": "knight", "b": "bishop", "r": "rook", "q": "queen", "k": "king"}

LOSS_CLASSIFICATIONS = (
    Classification.INACCURACY,
    Classification.MISTAKE,
    Classification.BLUNDER,
)
# The same three as they are read off a row and written into a summary: strings.
LOSS_CLASSIFICATION_NAMES = tuple(str(value) for value in LOSS_CLASSIFICATIONS)

# Fields that are a level rather than a count, so summing them across buckets is wrong.
NON_ADDITIVE = frozenset({"key", "end_rating", "rating"})

# How long a computed payload is handed out again before the library is read afresh.
#
# Every aggregation here is a scan: `_eval_rows` hydrates every analysed ply of every game
# that matches, and the dashboard asks for six dimensions at once. The frontend invalidates
# on a three-second cooldown while an analysis batch runs, so those scans were re-running
# every three seconds to produce the answer they had just produced — and each one holds a
# pooled connection for as long as it takes. Ten seconds is the trade: during a batch the
# numbers lag by at most that, and in exchange the scans stop competing with the batch for
# the pool. Anything that is not a batch (a filter changed, a dimension opened) is a new
# key and is computed immediately.
STATS_CACHE_TTL_SECONDS = 10.0
# Distinct filter sets are unbounded — the games table narrows by opponent, by ECO, by free
# text — so entries are capped and the oldest goes when the cap is reached, rather than the
# cache growing with everything anyone ever asked for.
STATS_CACHE_MAX_ENTRIES = 64
# How many of these scans may be in the database at once, across all keys. Each one holds a
# threadpool thread and a pooled connection for its whole length, and the dashboard asks for
# a dozen keys at a time: letting every expired key scan at once is precisely the pile-up
# that wedged the pool during a backfill. Two, because one would serialise a genuinely cold
# dashboard behind a single slot and the box this runs on has no more scans than that in it.
STATS_CACHE_MAX_CONCURRENT_COMPUTES = 2

# The clock the TTL is measured on. Monotonic, so a system clock adjustment cannot strand
# an entry in the future; named here so a test can hand the cache a clock of its own.
_clock = time.monotonic

_CACHE_LOCK = threading.Lock()
_CACHE: dict[tuple[Any, ...], tuple[float, Any]] = {}
# The key currently being computed, and the future its computer will fill. Guarded by
# `_CACHE_LOCK` — a slot appears and disappears in the same critical section that reads and
# writes the entry beside it, so nobody ever sees a key with neither.
_INFLIGHT: dict[tuple[Any, ...], Future[Any]] = {}
_COMPUTE_SLOTS = threading.Semaphore(STATS_CACHE_MAX_CONCURRENT_COMPUTES)

# Whether every game with a primary run has a summary of that run, and when that was last
# asked. Guarded by `_READY_LOCK`, which is never held across the query itself: two callers
# that both look are two identical reads, and the answer they write is the same one.
_READY_LOCK = threading.Lock()
_SUMMARIES_READY = False
_SUMMARIES_CHECKED_AT: float | None = None


class UnknownDimensionError(ValueError):
    """The requested stats dimension is not one this service can compute."""


class EvalRow(NamedTuple):
    """One analysed ply of one of the owner's games, with the position it was played in."""

    game_id: int
    ply: int
    move_san: str | None
    move_uci: str | None
    classification: str | None
    win_loss: float | None
    best_move_uci: str | None
    fen: str | None
    run_id: int
    tier: str


@dataclass(slots=True)
class GameRow:
    """One of the owner's games, reduced to what an aggregation actually reads."""

    id: int
    played_at: datetime | None
    speed: str | None
    time_control: str | None
    outcome: str | None
    rating: int | None
    opponent_rating: int | None
    eco: str | None
    # The game's own folded counts over its primary run, or None where it has no summary.
    # Read here rather than through a second grouped query over every eval in the library.
    owner_moves: int | None = None
    blunders: int | None = None


def reset_stats_cache() -> None:
    """Forget every cached payload.

    The cache is keyed by what was asked for and by nothing that says which library
    answered, which is what makes it a cache in a process serving one database and a leak
    anywhere a second one appears. Tests call this between libraries.

    The in-flight slots go too: a test that left one behind would hand the next library's
    first caller the previous one's answer — and so does the memo of whether the per-game
    summaries are complete, which is a fact about the database rather than about the
    process, and is emphatically not a fact about the *next* one.
    """
    with _CACHE_LOCK:
        _CACHE.clear()
        _INFLIGHT.clear()
    reset_summaries_ready()


def reset_summaries_ready() -> None:
    """Ask the library again whether every game with a run has a current summary.

    For a writer that can make a folded library unfolded: `accounts.reconcile_games`
    throwing away the folds of games it has just learned the owner's colour for. Without
    this the memo would go on saying the folds were complete and those games would be
    quietly left out of every aggregation until the process restarted; with it the
    dimensions go back to the scan, which is the slow answer rather than the wrong one,
    until the sweep has folded them again.
    """
    global _SUMMARIES_READY, _SUMMARIES_CHECKED_AT
    with _READY_LOCK:
        _SUMMARIES_READY = False
        _SUMMARIES_CHECKED_AT = None


def get_stats(
    session: Session,
    dimension: str,
    *,
    since: datetime | None = None,
    until: datetime | None = None,
    filters: GameFilters | None = None,
    **options: Any,
) -> dict[str, Any]:
    """One aggregation over the owner's games. `dimension` must be one of `DIMENSIONS`.

    `since` / `until` are shorthand for the same fields on `filters`, so the coach can ask
    for one dimension over one window without building a filter object, and the UI can
    pass the filter set the games table is already showing.

    The answer is cached for `STATS_CACHE_TTL_SECONDS` and handed out past that for as long
    as its replacement is being computed; an unknown dimension is still rejected before
    anything is looked up, and a handler that raises caches nothing.
    """
    if dimension in PLANNED_DIMENSIONS:
        raise UnknownDimensionError(
            f"{dimension!r} is not implemented yet; known dimensions: {', '.join(DIMENSIONS)}"
        )
    handler = _HANDLERS.get(dimension)
    if handler is None:
        raise UnknownDimensionError(
            f"unknown stats dimension {dimension!r}; known dimensions: {', '.join(DIMENSIONS)}"
        )

    scope = _scope(filters, since, until)

    def compute() -> dict[str, Any]:
        payload = handler(session, scope, options)
        payload["dimension"] = dimension
        payload["since"] = _stamp(scope.since)
        payload["until"] = _stamp(scope.until)
        return payload

    # `options` is part of the key as much as the scope is: `tz_offset` and `thresholds`
    # change the buckets, and two calls that differ only there are two different answers.
    return _cached(_cache_key("get_stats", dimension, scope, options), compute)


def get_dashboard(
    session: Session,
    *,
    days: int | None = None,
    filters: GameFilters | None = None,
) -> dict[str, Any]:
    """All Stats-page dimensions over one stable, newest-game-anchored window.

    This is deliberately not six calls to :func:`get_stats`: the three game dimensions
    share one game-row read and the three move dimensions share one summary read. Besides
    removing five HTTP round trips, that prevents the page from repeating the same scans.
    """
    if days is not None and days <= 0:
        raise ValueError("days must be positive")

    base = replace(filters) if filters is not None else GameFilters()
    # The endpoint owns its time window; all the other GameFilters still narrow it.
    base.since = None
    base.until = None

    def compute() -> dict[str, Any]:
        latest = session.scalar(
            select(func.max(Game.played_at)).where(
                Game.owner_color.is_not(None), *game_conditions(base)
            )
        )
        anchor = _utc(latest) if latest is not None else datetime.now(UTC)
        scope = replace(
            base,
            since=None if days is None else anchor - timedelta(days=days),
            until=anchor,
        )

        game_rows = _game_rows(session, scope)
        moves, blunders = _analysed_counts(session, scope, game_rows)

        speed = _performance_buckets(
            game_rows, blunders, moves, lambda row: row.speed or "unknown"
        )
        hour = _performance_by_hour_rows(game_rows, moves, blunders, 0.0)
        trend = _rating_trend_rows(game_rows, moves, blunders, "month")

        clock_order = _clock_bucket_order(
            _normalised_thresholds(TIME_TROUBLE_THRESHOLDS)
        )
        if _summaries_ready(session):
            summaries = list(
                session.scalars(
                    select(Game.stat_summary).where(
                        Game.stat_summary.is_not(None), *game_conditions(scope)
                    )
                )
            )
            phase = _classification_from_summaries(summaries, "phases", PHASES)
            piece = _classification_from_summaries(summaries, "pieces", PIECES)
            clock = _classification_from_summaries(summaries, "clock", clock_order)
        else:
            eval_rows = _eval_rows(session, scope)
            phase = _classification_buckets(
                eval_rows, PHASES, lambda row: phase_of(row.fen, row.ply)
            )
            piece = _classification_buckets(
                eval_rows,
                PIECES,
                lambda row: piece_of(row.move_san, row.move_uci, row.fen),
            )
            clocks = _clock_index(session, scope)
            clock = _classification_buckets(
                eval_rows,
                clock_order,
                lambda row: _clock_bucket(
                    _remaining_clock(clocks.get(row.game_id), row.ply),
                    TIME_TROUBLE_THRESHOLDS,
                ),
            )
        clock["thresholds"] = list(TIME_TROUBLE_THRESHOLDS)

        payloads = {
            "performance_by_speed": speed,
            "blunders_by_phase": phase,
            "blunders_by_piece": piece,
            "time_trouble_loss": clock,
            "performance_by_hour": hour,
            "rating_trend": trend,
        }
        for dimension, payload in payloads.items():
            payload["dimension"] = dimension
            payload["since"] = _stamp(scope.since)
            payload["until"] = _stamp(scope.until)
        return {
            "anchor": _stamp(anchor),
            "since": _stamp(scope.since),
            "until": _stamp(scope.until),
            "dimensions": payloads,
        }

    return _cached(_cache_key("get_dashboard", days, base), compute)


def compare_periods(
    session: Session,
    dimension: str,
    then: tuple[datetime, datetime],
    now: tuple[datetime, datetime],
    *,
    filters: GameFilters | None = None,
    **options: Any,
) -> dict[str, Any]:
    """The same dimension across two windows: "am I getting better at X?"."""
    before = get_stats(
        session, dimension, since=then[0], until=then[1], filters=filters, **options
    )
    after = get_stats(session, dimension, since=now[0], until=now[1], filters=filters, **options)
    return {
        "dimension": dimension,
        "then": before,
        "now": after,
        "delta": _delta(before, after),
    }


def get_player_profile(session: Session, **options: Any) -> dict[str, Any]:
    """Ratings over time per platform, volume and platforms.

    Defined in `backend.services.games`, where the game row it reads lives; re-exposed
    here because the coach asks for it alongside the other aggregations — and cached here,
    because it hydrates every owned game in the library and `/stats/profile` is refetched
    on the same cooldown as the dimensions beside it.
    """
    return _cached(
        _cache_key("get_player_profile", options),
        lambda: games_service.get_player_profile(session, **options),
    )


def get_worst_recent_moments(
    session: Session,
    *,
    days: int | None = None,
    amount: int = 5,
    filters: GameFilters | None = None,
    classifications: Sequence[Classification] = (Classification.BLUNDER,),
) -> list[dict[str, Any]]:
    """Recent blunders ranked by eval swing, with the position and the better move.

    Ranked by win percentage given away rather than by centipawns, so a swing from +8 to
    +4 does not outrank one from equal to lost.

    ONE MOMENT PER GAME, and it is the worst one. A game that fell apart holds the top of
    this ranking on its own otherwise — a missed mate in one, missed again on the next move
    and the one after that, is three moments that give away 99.9% each and are the same
    mistake seen three times. Whoever reads this list, the dashboard or the coach, is asking
    what to work on next; three views of one collapse answer that once and crowd out the two
    other games that would have answered it differently. The rest of a bad game is not lost,
    it is one click away on the game itself.

    Cached like the dimensions are, and keyed on `days` rather than on the moment that
    window starts at: the start moves with every call and the ranking does not, so keying
    on the derived timestamp would be a key that never repeats.

    Blunders — what everyone but a caller that says otherwise asks for — are ranked off the
    games' own stored worst move once the library is folded. Any other set of
    classifications is a question the folds do not answer, and takes the scan.
    """
    if amount <= 0:
        return []

    def compute() -> list[dict[str, Any]]:
        # A game keeps its own worst `STAT_SUMMARY_WORST_MOMENTS` and no more, so a caller
        # asking for more moments than that could be asking for one the fold trimmed.
        foldable = (
            tuple(classifications) == (Classification.BLUNDER,)
            and amount <= STAT_SUMMARY_WORST_MOMENTS
        )
        if foldable and _summaries_ready(session):
            return _worst_moments_from_summaries(session, days, amount, filters)
        return _worst_recent_moments(session, days, amount, filters, classifications)

    return _cached(
        _cache_key("get_worst_recent_moments", days, amount, filters, classifications),
        compute,
    )


def _worst_recent_moments(
    session: Session,
    days: int | None,
    amount: int,
    filters: GameFilters | None,
    classifications: Sequence[Classification],
) -> list[dict[str, Any]]:
    """The ranking off the evals themselves, for a question the folds cannot answer.

    One game can hold any number of the top rows, and only the first of them is kept, so
    the number of rows to read is not the number of moments wanted. The window widens until
    it holds `amount` distinct games or the query runs out of rows to give — normally one
    pass, and a game that blundered its way through fifty plies costs a doubling rather
    than a short answer.
    """
    since = None
    if days is not None:
        since = datetime.now(UTC) - timedelta(days=days)
    scope = _scope(filters, since, None)

    conditions = [MoveEval.win_loss.is_not(None)]
    if classifications:
        conditions.append(MoveEval.classification.in_(list(classifications)))

    wanted = max(amount, 0)
    if wanted == 0:
        return []
    limit = wanted + WORST_MOMENT_GAME_MARGIN
    while True:
        rows = _eval_rows(
            session,
            scope,
            extra_conditions=conditions,
            order_by=WORST_MOMENT_ORDER,
            limit=limit,
        )
        best = _first_per_game(rows)
        # Enough distinct games, or there were no more rows to read: either way this is the
        # whole answer and a wider window would return the same one.
        if len(best) >= wanted or len(rows) < limit:
            break
        limit *= 2
    if not best:
        return []

    stored = {
        game.id: game
        for game in session.scalars(select(Game).where(Game.id.in_({row.game_id for row in best})))
    }
    moments = []
    for row in best[:wanted]:
        game = stored.get(row.game_id)
        if game is None:
            continue
        moments.append(_moment_of(game, _worst_entry(row), row.run_id))
    return moments


def _first_per_game(rows: Sequence[EvalRow]) -> list[EvalRow]:
    """The first row of each game, in the order they arrived — which is the ranking's own,
    so the row kept for a game is that game's worst moment."""
    seen: set[int] = set()
    kept = []
    for row in rows:
        if row.game_id in seen:
            continue
        seen.add(row.game_id)
        kept.append(row)
    return kept


def _worst_moments_from_summaries(
    session: Session, days: int | None, amount: int, filters: GameFilters | None
) -> list[dict[str, Any]]:
    """The same ranking, off the games' own worst move rather than off every eval there is.

    `stat_worst_win_loss` is the worst blunder in a game, which — now that a game may only
    contribute its worst blunder — is exactly the moment this ranking would keep for it. So
    ordering the games by `(that column desc, id asc)`, the tie-break the ranking itself
    uses, orders the moments, and the first `amount` games hold the whole answer. The margin
    past that costs a few rows and is there for the arithmetic being wrong.
    """
    since = None if days is None else datetime.now(UTC) - timedelta(days=days)
    scope = _scope(filters, since, None)
    statement = (
        select(Game)
        # `stat_summary` is deferred for every other reader; this is the one that wants it,
        # and asking for it here is one fetch for the whole page rather than one per game.
        .options(undefer(Game.stat_summary))
        .where(Game.stat_worst_win_loss.is_not(None), *game_conditions(scope))
        .order_by(Game.stat_worst_win_loss.desc(), Game.id.asc())
        .limit(amount + WORST_MOMENT_GAME_MARGIN)
    )
    ranked = []
    for game in session.scalars(statement):
        summary = game.stat_summary or {}
        blunders = [
            entry
            for entry in summary.get("worst", ())
            if entry["classification"] == str(Classification.BLUNDER)
        ]
        if not blunders:
            continue
        # By the ranking's own key rather than by the order the summary happens to be
        # stored in, so a summary written before that order was settled still ranks right.
        entry = min(
            blunders,
            key=lambda row: _worst_moment_key(row["win_loss"], game.id, row["ply"]),
        )
        key = _worst_moment_key(entry["win_loss"], game.id, entry["ply"])
        ranked.append((key, _moment_of(game, entry, summary["run_id"])))
    ranked.sort(key=lambda pair: pair[0])
    return [moment for _key, moment in ranked[:amount]]


def _worst_moment_key(win_loss: float, game_id: int, ply: int) -> tuple[float, int, int]:
    """`WORST_MOMENT_ORDER` as a sort key, for the ranking that reads the folds."""
    return (-win_loss, game_id, ply)


def _worst_entry(row: EvalRow) -> dict[str, Any]:
    """One move a game gave something away on, in the fields a summary keeps of it."""
    return {
        "ply": row.ply,
        "san": row.move_san,
        "uci": row.move_uci,
        "classification": row.classification,
        "win_loss": row.win_loss,
        "fen": row.fen,
        "best_move_uci": row.best_move_uci,
        "tier": row.tier,
    }


def _moment_of(game: Game, entry: Mapping[str, Any], run_id: int) -> dict[str, Any]:
    """One ranked moment as every caller reads it, built from those same fields.

    The board-derived halves — the phase, the piece, the engine's move in SAN — are worked
    out here rather than stored, because they are a pure function of the FEN and cost
    nothing for the handful of moments that are actually handed out.
    """
    return {
        "game": game_summary(game),
        "ply": entry["ply"],
        "move_number": entry["ply"] // 2 + 1,
        "san": entry["san"],
        "uci": entry["uci"],
        "classification": entry["classification"],
        "win_loss": entry["win_loss"],
        "phase": phase_of(entry["fen"], entry["ply"]),
        "piece": piece_of(entry["san"], entry["uci"], entry["fen"]),
        "fen": entry["fen"],
        "best_move_uci": entry["best_move_uci"],
        "best_move_san": best_move_san(entry["fen"], entry["best_move_uci"]),
        "run_id": run_id,
        "tier": entry["tier"],
    }


def phase_of(fen: str | None, ply: int) -> str:
    """opening / middlegame / endgame, by ply and by what is left on the board."""
    if fen:
        placement = fen.split(" ", 1)[0].lower()
        material = sum(value * placement.count(piece) for piece, value in PIECE_VALUES.items())
        if material <= ENDGAME_MATERIAL:
            return "endgame"
    return "opening" if ply < OPENING_PLIES else "middlegame"


def piece_of(san: str | None, uci: str | None, fen: str | None) -> str:
    """Which piece was moved. SAN says so directly; a FEN answers when it does not."""
    if san:
        if san.startswith("O-O") or san.startswith("0-0"):
            return "king"
        head = san[0]
        if head in SAN_PIECES:
            return SAN_PIECES[head]
        if head.isalpha() and head.islower():
            return "pawn"
    if uci and fen and len(uci) >= 4:
        piece = _piece_at(fen, uci[:2])
        if piece is not None:
            return piece
    return "unknown"


def best_move_san(fen: str | None, uci: str | None) -> str | None:
    """The engine's move in the notation a human reads. None when it cannot be played."""
    if not fen or not uci:
        return None
    import chess

    board = chess.Board(chess960=True)
    try:
        board.set_fen(fen)
        return board.san(board.parse_uci(uci))
    except ValueError:
        return None


def _blunders_by_phase(
    session: Session, scope: GameFilters, options: dict[str, Any]
) -> dict[str, Any]:
    if _summaries_ready(session):
        return _summary_classification_buckets(session, scope, "phases", PHASES)
    rows = _eval_rows(session, scope)
    return _classification_buckets(rows, PHASES, lambda row: phase_of(row.fen, row.ply))


def _blunders_by_piece(
    session: Session, scope: GameFilters, options: dict[str, Any]
) -> dict[str, Any]:
    if _summaries_ready(session):
        return _summary_classification_buckets(session, scope, "pieces", PIECES)
    rows = _eval_rows(session, scope)
    return _classification_buckets(
        rows, PIECES, lambda row: piece_of(row.move_san, row.move_uci, row.fen)
    )


def _performance_by_speed(
    session: Session, scope: GameFilters, options: dict[str, Any]
) -> dict[str, Any]:
    rows = _game_rows(session, scope)
    moves, blunders = _analysed_counts(session, scope, rows)
    return _performance_buckets(rows, blunders, moves, lambda row: row.speed or "unknown")


def _performance_by_hour(
    session: Session, scope: GameFilters, options: dict[str, Any]
) -> dict[str, Any]:
    """Time of day, bucketed in Python.

    The hour is read off the timestamp here rather than in SQL: the interesting hour is
    the owner's local one, which the database does not know at all. `tz_offset` is in
    hours east of UTC.
    """
    tz_offset = float(options.get("tz_offset", 0.0))
    rows = _game_rows(session, scope)
    moves, blunders = _analysed_counts(session, scope, rows)
    return _performance_by_hour_rows(rows, moves, blunders, tz_offset)


def _performance_by_hour_rows(
    rows: Sequence[GameRow],
    moves: dict[int, int],
    blunders: dict[int, int],
    tz_offset: float,
) -> dict[str, Any]:
    offset = timedelta(hours=tz_offset)
    dated = [row for row in rows if row.played_at is not None]
    payload = _performance_buckets(
        dated,
        blunders,
        moves,
        lambda row: f"{(row.played_at + offset).hour:02d}",
        order=None,
    )
    payload["buckets"].sort(key=lambda bucket: bucket["key"])
    payload["tz_offset"] = tz_offset
    return payload


def _time_trouble_loss(
    session: Session, scope: GameFilters, options: dict[str, Any]
) -> dict[str, Any]:
    """Eval given away by how much clock the mover had left when they moved.

    A summary carries the default bands and only those, so a caller asking about bands of
    its own is asking a question the folds cannot answer and gets the scan. Which is the
    right trade: the dashboard asks the default question, and a custom one is asked by hand.
    """
    thresholds = _normalised_thresholds(options.get("thresholds", TIME_TROUBLE_THRESHOLDS))
    order = _clock_bucket_order(thresholds)
    default = thresholds == _normalised_thresholds(TIME_TROUBLE_THRESHOLDS)
    if default and _summaries_ready(session):
        payload = _summary_classification_buckets(session, scope, "clock", order)
    else:
        rows = _eval_rows(session, scope)
        clocks = _clock_index(session, scope)
        payload = _classification_buckets(
            rows,
            order,
            lambda row: _clock_bucket(
                _remaining_clock(clocks.get(row.game_id), row.ply), thresholds
            ),
        )
    payload["thresholds"] = list(thresholds)
    return payload


def _normalised_thresholds(values: Iterable[float]) -> tuple[float, ...]:
    """Time-trouble bands as they are compared and labelled: floats, ascending."""
    return tuple(sorted(float(value) for value in values))


def _clock_bucket_order(thresholds: Sequence[float]) -> tuple[str, ...]:
    """The bands' labels, tightest first, with the catch-alls last."""
    order = [f"<{_seconds(threshold)}" for threshold in thresholds]
    if thresholds:
        order.append(f">={_seconds(thresholds[-1])}")
    order.append("unknown")
    return tuple(order)


def _clock_bucket(remaining: float | None, thresholds: Sequence[float]) -> str:
    """Which band a move played with `remaining` seconds left belongs in."""
    if remaining is None:
        return "unknown"
    for threshold in thresholds:
        if remaining < threshold:
            return f"<{_seconds(threshold)}"
    return f">={_seconds(thresholds[-1])}" if thresholds else "any"


def _rating_trend(
    session: Session, scope: GameFilters, options: dict[str, Any]
) -> dict[str, Any]:
    """Rating and blunder rate over time, in whatever period the caller asked for."""
    period = str(options.get("bucket", "month"))
    if period not in BUCKETS:
        raise ValueError(f"unknown bucket {period!r}; known buckets: {', '.join(BUCKETS)}")

    rows = _game_rows(session, scope)
    moves, blunders = _analysed_counts(session, scope, rows)
    return _rating_trend_rows(rows, moves, blunders, period)


def _rating_trend_rows(
    rows: Sequence[GameRow],
    moves: dict[int, int],
    blunders: dict[int, int],
    period: str,
) -> dict[str, Any]:
    dated = [row for row in rows if row.played_at is not None]

    buckets: dict[str, dict[str, Any]] = {}
    for row in dated:
        key = _period_key(row.played_at, period)
        bucket = buckets.setdefault(
            key,
            {
                "key": key,
                "games": 0,
                "wins": 0,
                "draws": 0,
                "losses": 0,
                "ratings": [],
                "end_rating": None,
                "owner_moves": 0,
                "blunders": 0,
                "analyzed_games": 0,
            },
        )
        bucket["games"] += 1
        if row.outcome == WIN:
            bucket["wins"] += 1
        elif row.outcome == DRAW:
            bucket["draws"] += 1
        elif row.outcome == LOSS:
            bucket["losses"] += 1
        if row.rating is not None:
            bucket["ratings"].append(row.rating)
            bucket["end_rating"] = row.rating
        if row.id in moves:
            bucket["analyzed_games"] += 1
            bucket["owner_moves"] += moves[row.id]
            bucket["blunders"] += blunders.get(row.id, 0)

    ordered = []
    for key in sorted(buckets):
        bucket = buckets.pop(key)
        ratings = bucket.pop("ratings")
        ordered.append(
            {
                **bucket,
                "score": _score(bucket),
                "avg_rating": _mean(sum(ratings), len(ratings)),
                "blunders_per_100_moves": _rate(bucket["blunders"] * 100, bucket["owner_moves"]),
            }
        )
    return {"bucket": period, "buckets": ordered, "total": _totals_of(ordered)}


_HANDLERS = {
    "blunders_by_phase": _blunders_by_phase,
    "blunders_by_piece": _blunders_by_piece,
    "performance_by_speed": _performance_by_speed,
    "performance_by_hour": _performance_by_hour,
    "time_trouble_loss": _time_trouble_loss,
    "rating_trend": _rating_trend,
}


def _scope(
    filters: GameFilters | None, since: datetime | None, until: datetime | None
) -> GameFilters:
    scope = replace(filters) if filters is not None else GameFilters()
    if since is not None:
        scope.since = since
    if until is not None:
        scope.until = until
    return scope


def _cached(key: tuple[Any, ...], compute: Callable[[], Any]) -> Any:
    """`compute()`'s answer, computed by one caller at a time and stale-served to the rest.

    Every caller is handed the *same* object rather than a copy. That is safe because
    everything cached here is built out of plain dicts, lists and scalars — no ORM row
    survives into a payload — and because nothing downstream writes to what it was given:
    the routes hand the payload to a response model, and the MCP tools copy the fields they
    want into a payload of their own.

    An entry is kept past its TTL rather than treated as absent, which is the whole point.
    A payload inside the window is simply returned. Past it, exactly one caller recomputes,
    on its own request thread, and everyone else arriving meanwhile is handed the entry it
    is replacing — slightly out of date, immediately, off no connection at all. Expiry used
    to mean "absent", so every request that arrived during a scan started a scan of its
    own; with a dozen live keys, a ten-second TTL and a multi-second scan apiece, the
    dashboard's refetch storm during a backfill kept dozens of them running at once, each
    pinning a threadpool thread and a pooled connection until both pools wedged. That is
    the failure this shape exists to make impossible.

    A key nobody has ever computed has nothing to serve stale, so those callers do queue —
    on the one future, not on a scan each. `STATS_CACHE_MAX_CONCURRENT_COMPUTES` then caps
    how many *distinct* keys may scan at once, which is the same bound across the dimensions
    the dashboard opens together.

    A compute that raises leaves the stale entry exactly where it was, still servable, and
    reaches only the caller that ran it (and anyone queued on that first computation). The
    slot is freed either way, so the next caller may try again.

    Deadlock is avoided by never nesting the three: a compute slot is taken only after the
    lock is dropped, and a caller waiting on someone else's future holds neither.
    """
    now = _clock()
    with _CACHE_LOCK:
        entry = _CACHE.get(key)
        if entry is not None and entry[0] > now:
            return entry[1]
        ticket = _INFLIGHT.get(key)
        ours = ticket is None
        if ticket is None:
            ticket = _INFLIGHT[key] = Future()
    if ours:
        return _refresh(key, compute, ticket)
    if entry is not None:
        return entry[1]
    return ticket.result()


def _refresh(key: tuple[Any, ...], compute: Callable[[], Any], ticket: Future[Any]) -> Any:
    """Run the one computation for `key`, publish it and free the slot.

    The caller has already claimed `key` by putting `ticket` in `_INFLIGHT`; this is the
    claim being honoured, outside the lock.
    """
    try:
        with _COMPUTE_SLOTS:
            payload = compute()
    except BaseException as error:
        with _CACHE_LOCK:
            _INFLIGHT.pop(key, None)
        ticket.set_exception(error)
        raise
    with _CACHE_LOCK:
        # The entry and the slot move together, so a caller under the lock sees either a
        # computation in flight beside the payload it is replacing, or a fresh payload and
        # no computation — never a key with neither.
        _INFLIGHT.pop(key, None)
        # Re-inserted rather than assigned, so a refreshed entry goes to the back of the
        # queue and the cap drops what has genuinely been idle longest.
        _CACHE.pop(key, None)
        _CACHE[key] = (_clock() + STATS_CACHE_TTL_SECONDS, payload)
        while len(_CACHE) > STATS_CACHE_MAX_ENTRIES:
            _CACHE.pop(next(iter(_CACHE)))
    ticket.set_result(payload)
    return payload


def _cache_key(name: str, *parts: Any) -> tuple[Any, ...]:
    """The name of what was computed, and a stable reading of everything it was given."""
    return (name, *(_hashable(part) for part in parts))


def _hashable(value: Any) -> Any:
    """A key's worth of a value: hashable, stable across calls, different when it differs.

    A dataclass goes in field by field, so two `GameFilters` that narrow the same way key
    the same whichever call built them. A datetime goes in as its ISO form and an enum as
    its string value, so the key does not depend on a tzinfo object's identity. The
    mapping and sequence arms are for `**options`, which arrives as whatever a caller
    passed — `thresholds=[150]` is a list, and a list cannot be part of a dict key.
    """
    if isinstance(value, Enum):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if is_dataclass(value) and not isinstance(value, type):
        return tuple(_hashable(getattr(value, field.name)) for field in fields(value))
    if isinstance(value, Mapping):
        return tuple((key, _hashable(item)) for key, item in sorted(value.items()))
    # Before the sequence arm: a string is a sequence, and unrolling it into characters
    # would key `eco="C6"` the same as `eco=("C", "6")`.
    if isinstance(value, str | bytes):
        return value
    if isinstance(value, Sequence):
        return tuple(_hashable(item) for item in value)
    return value


def primary_runs(game_id: int | None = None) -> Any:
    """The one run per game that stats read: the newest done full-game UCI pass.

    A run over a ply range is deliberately excluded — a deep pass over the endgame would
    otherwise shadow the quick pass for the plies it covers and leave the game's numbers
    half from one engine budget and half from another. Maia runs are excluded too: they
    predict a human move, they do not judge one. That is two conditions and not one, because
    a Maia pass wears the engine it was queued under: a `maia_only` fill runs on the quick
    tier's Stockfish row, so only the flag says it stored policies and no evaluations. Were
    it allowed to become primary, filling in a level would silently empty out every number
    folded from the search that came before it.

    `game_id` narrows the same definition to one game, which is what turns a fold of one
    game's summary from a grouped pass over every run in the library into an index lookup.
    Only a narrowing: what it selects for that game is exactly what the unrestricted form
    selects for it.
    """
    conditions = [] if game_id is None else [AnalysisRun.game_id == game_id]
    return (
        select(func.max(AnalysisRun.id))
        .select_from(AnalysisRun)
        .outerjoin(Engine, AnalysisRun.engine_id == Engine.id)
        .where(
            AnalysisRun.status == RunStatus.DONE,
            AnalysisRun.game_id.is_not(None),
            AnalysisRun.ply_start.is_(None),
            AnalysisRun.ply_end.is_(None),
            AnalysisRun.maia_only.is_(False),
            or_(Engine.id.is_(None), Engine.kind == EngineKind.UCI),
            *conditions,
        )
        .group_by(AnalysisRun.game_id)
        .scalar_subquery()
    )


def primary_run_id(session: Session, game_id: int) -> int | None:
    """Which run a game's stats are read from, or None when no pass has finished over it."""
    return session.scalar(select(primary_runs(game_id)))


def _eval_rows(
    session: Session,
    scope: GameFilters,
    *,
    game: int | None = None,
    extra_conditions: Sequence[Any] = (),
    order_by: Sequence[Any] = (),
    limit: int | None = None,
) -> list[EvalRow]:
    """The owner's own analysed moves, with the FEN each was played in.

    `game` restricts the whole thing to one game — the primary-run subquery included, so
    the narrow form costs a lookup rather than a grouped pass over every run there is. It
    is what a summary is folded from, which is what makes a summary and a scan of the same
    library agree about which rows count: there is one query here, not two.

    The position comes from the eval row where the engine recorded one and from the game's
    own position index where it did not, so a run written before that column was filled in
    still answers "what did the board look like".

    The aggregation itself happens in Python. The bucket a move belongs to depends on the
    board (phase) or on the game's clock list (time trouble), and neither is something
    SQL could work out at all — narrow tuples over a personal archive are the cheaper
    half of that trade.
    """
    position_id = func.coalesce(MoveEval.position_id, GamePosition.position_id)
    statement = (
        select(
            AnalysisRun.game_id,
            MoveEval.ply,
            MoveEval.move_san,
            MoveEval.move_uci,
            MoveEval.classification,
            MoveEval.win_loss,
            MoveEval.best_move_uci,
            Position.fen,
            AnalysisRun.id,
            AnalysisRun.tier,
        )
        .select_from(MoveEval)
        .join(AnalysisRun, MoveEval.run_id == AnalysisRun.id)
        .join(Game, AnalysisRun.game_id == Game.id)
        .outerjoin(
            GamePosition,
            and_(GamePosition.game_id == Game.id, GamePosition.ply == MoveEval.ply),
        )
        .outerjoin(Position, Position.id == position_id)
        .where(
            AnalysisRun.id.in_(primary_runs(game)),
            owner_move_condition(),
            *([] if game is None else [Game.id == game]),
            *game_conditions(scope),
            *extra_conditions,
        )
    )
    if order_by:
        statement = statement.order_by(*order_by)
    if limit:
        statement = statement.limit(limit)

    return [
        EvalRow(
            game_id=row[0],
            ply=row[1],
            move_san=row[2],
            move_uci=row[3],
            classification=str(row[4]) if row[4] else None,
            win_loss=row[5],
            best_move_uci=row[6],
            fen=row[7],
            run_id=row[8],
            tier=str(row[9]),
        )
        for row in session.execute(statement)
    ]


# ----------------------------------------------------------- the per-game summaries
#
# What a game contributes to every aggregation above, folded once and kept on the game row.
# The fold is the same query the scan uses, narrowed to one game, so the two can never
# disagree about which plies count; the reading paths above merge the folds instead of
# hydrating the plies, and fall back to the scan whenever the library is not fully folded.


def refresh_game_stats(session: Session, game: Game) -> dict[str, Any] | None:
    """Recompute a game's stored stat summary, leaving the commit to the caller.

    Deliberately without one, exactly as `games.refresh_card` is: this belongs inside the
    transaction that changed the game's finished runs, so the summary and the evals it
    describes become visible together and no reader can catch one without the other.

    A game whose primary run has gone — the whole library re-imported, say — is written
    back to nothing rather than left describing a run that no longer answers for it.
    """
    run_id = primary_run_id(session, game.id)
    rows = [] if run_id is None else _eval_rows(session, GameFilters(), game=game.id)
    summary = None if run_id is None else _summarise(game, run_id, rows)
    given_away = [
        row.win_loss
        for row in rows
        if row.win_loss is not None and row.classification == str(Classification.BLUNDER)
    ]
    game.stat_summary = summary
    game.stat_owner_moves = None if summary is None else summary["owner_moves"]
    game.stat_blunders = (
        None if summary is None else summary["counts"][str(Classification.BLUNDER)]
    )
    game.stat_worst_win_loss = max(given_away) if given_away else None
    return summary


def _summarise(game: Game, run_id: int, rows: Sequence[EvalRow]) -> dict[str, Any]:
    """One game's analysed owner moves, added up every way a dimension asks for.

    Every group a dimension buckets by is here — phase, piece, clock band — because the
    bucket a move belongs to is a property of the move, and a game's own moves do not move
    between buckets when the filters change. What the filters choose is which games are
    added up, and that is a predicate over game rows.

    The clock bands are the default `TIME_TROUBLE_THRESHOLDS` ones. A caller with its own
    idea of time trouble is asking a question these buckets cannot answer, and gets the
    scan.
    """
    clocks = (game.clocks, game.initial_clock)
    counts = dict.fromkeys(LOSS_CLASSIFICATION_NAMES, 0)
    summary: dict[str, Any] = {
        "run_id": run_id,
        "owner_moves": 0,
        "evaluated": 0,
        "loss_sum": 0.0,
        "counts": counts,
        "phases": {},
        "pieces": {},
        "clock": {},
    }
    worst: list[dict[str, Any]] = []
    for row in rows:
        summary["owner_moves"] += 1
        if row.win_loss is not None:
            summary["evaluated"] += 1
            summary["loss_sum"] += row.win_loss
        if row.classification in counts:
            counts[row.classification] += 1
        for group, name in (
            ("phases", phase_of(row.fen, row.ply)),
            ("pieces", piece_of(row.move_san, row.move_uci, row.fen)),
            (
                "clock",
                _clock_bucket(
                    _remaining_clock(clocks, row.ply),
                    _normalised_thresholds(TIME_TROUBLE_THRESHOLDS),
                ),
            ),
        ):
            _count_into(summary[group].setdefault(name, _summary_bucket()), row)
        if row.win_loss is not None and row.classification in counts:
            worst.append(_worst_entry(row))
    # Ranked the way the library-wide ranking ranks, so the cap trims the moments that
    # ranking would have reached last.
    worst.sort(key=lambda moment: _worst_moment_key(moment["win_loss"], game.id, moment["ply"]))
    summary["worst"] = worst[:STAT_SUMMARY_WORST_MOMENTS]
    return summary


def _summary_bucket() -> dict[str, Any]:
    """One group of one game's moves, in the fields an aggregate is built out of."""
    return {
        "moves": 0,
        "evaluated": 0,
        "loss_sum": 0.0,
        **dict.fromkeys(LOSS_CLASSIFICATION_NAMES, 0),
    }


def _count_into(bucket: dict[str, Any], row: EvalRow) -> None:
    """Add one move to a group, counting exactly what `_classification_buckets` counts."""
    bucket["moves"] += 1
    if row.win_loss is not None:
        bucket["evaluated"] += 1
        bucket["loss_sum"] += row.win_loss
    if row.classification in LOSS_CLASSIFICATION_NAMES:
        bucket[row.classification] += 1


def _stale_summary_ids(session: Session, limit: int) -> list[int]:
    """Games whose stored summary is missing, or describes a run that is no longer theirs.

    The one definition of "not folded yet": the readiness check asks it for one row and the
    backfill asks it for a chunk, so a library the sweep says it has finished is a library
    the dimensions are allowed to read the fold of.

    Deliberately unordered. Which games come back does not matter — every chunk fixes the
    ones it is handed, so any order finishes — and an ORDER BY would make the readiness
    check sort the whole library to answer a question about its first row.
    """
    described = func.json_extract(Game.stat_summary, "$.run_id").cast(Integer)
    statement = (
        select(Game.id)
        .select_from(AnalysisRun)
        .join(Game, AnalysisRun.game_id == Game.id)
        .where(
            AnalysisRun.id.in_(primary_runs()),
            or_(Game.stat_summary.is_(None), described != AnalysisRun.id),
        )
        .limit(max(limit, 1))
    )
    return list(session.scalars(statement))


def _summaries_ready(session: Session) -> bool:
    """Whether every game with a primary run has a summary of that run.

    Which is the whole precondition for reading the folds instead of the plies: a game
    missing its summary would simply be left out of the answer, and one describing an older
    run would be counted at the wrong budget.

    Memoised, in two halves, because the answer changes in one direction only. Once true it
    is true forever: `analysis.complete_run` writes the summary inside the same commit that
    makes the run primary, so nothing this process can do makes a folded library unfolded
    again. While it is false — a library imported before the columns existed, with the
    backfill still walking it — the question costs a query, so it is asked at most once
    every `SUMMARIES_READY_RECHECK_SECONDS` and every dimension in between takes the scan
    it was taking anyway.
    """
    global _SUMMARIES_READY, _SUMMARIES_CHECKED_AT
    with _READY_LOCK:
        if _SUMMARIES_READY:
            return True
        checked = _SUMMARIES_CHECKED_AT
    if checked is not None and _clock() - checked < SUMMARIES_READY_RECHECK_SECONDS:
        return False
    ready = not _stale_summary_ids(session, limit=1)
    with _READY_LOCK:
        _SUMMARIES_READY = _SUMMARIES_READY or ready
        _SUMMARIES_CHECKED_AT = _clock()
        return _SUMMARIES_READY


def rebuild_stat_summaries(
    session: Session, *, limit: int = STAT_SUMMARY_BACKFILL_CHUNK
) -> int:
    """Fold up to `limit` games that have not been folded yet; how many were. 0 means done.

    Only a library analysed before the summaries existed needs this — from then on every
    finished run folds its own game — and it is a convenience rather than a requirement:
    the dimensions scan the evals until it has finished, so an un-swept library is slow,
    not wrong.

    One chunk per call rather than a sweep with a loop inside it, so the caller decides
    when to stop: the one the server starts at boot is cancelled between chunks at
    shutdown, and each chunk is a committed step nothing has to redo. Committing per chunk
    is also what lets it run beside a live server, SQLite having one writer.
    """
    rebuilt = 0
    for game_id in _stale_summary_ids(session, limit=limit):
        game = session.get(Game, game_id)
        if game is not None:
            refresh_game_stats(session, game)
            rebuilt += 1
    session.commit()
    # Nothing here needs the games again, and a sweep over a large library would otherwise
    # keep every one of them — PGN and all — in the identity map.
    session.expunge_all()
    return rebuilt


def _game_rows(session: Session, scope: GameFilters) -> list[GameRow]:
    statement = (
        select(
            Game.id,
            Game.played_at,
            Game.speed,
            Game.time_control,
            Game.owner_color,
            Game.result,
            Game.white_rating,
            Game.black_rating,
            Game.eco,
            Game.stat_owner_moves,
            Game.stat_blunders,
        )
        .where(Game.owner_color.is_not(None), *game_conditions(scope))
        .order_by(Game.played_at.asc().nulls_last(), Game.id.asc())
    )
    rows = []
    for (
        game_id,
        played_at,
        speed,
        time_control,
        owner_color,
        result,
        white_rating,
        black_rating,
        eco,
        owner_moves,
        blunders,
    ) in session.execute(statement):
        owner_white = owner_color == Color.WHITE
        rows.append(
            GameRow(
                id=game_id,
                played_at=played_at,
                speed=str(speed) if speed else None,
                time_control=time_control,
                outcome=outcome_from(owner_color, result),
                rating=white_rating if owner_white else black_rating,
                opponent_rating=black_rating if owner_white else white_rating,
                eco=eco,
                owner_moves=owner_moves,
                blunders=blunders,
            )
        )
    return rows


def _analysed_counts(
    session: Session, scope: GameFilters, rows: Sequence[GameRow]
) -> tuple[dict[int, int], dict[int, int]]:
    """Analysed owner moves and owner blunders per game: `(moves, blunders)`.

    Off the game rows already in hand where the library is folded, and off two grouped
    queries over every eval in it where it is not.

    A game is in both dicts or in neither, and it is in them only when its primary run
    actually holds an owner move — which is what a grouped count over the evals emits, and
    what `analyzed_games` means downstream. A folded game with no owner move in its run is
    therefore left out exactly as the group-by leaves it out.
    """
    if not _summaries_ready(session):
        return _owner_move_counts(session, scope), _blunder_counts(session, scope)
    moves = {row.id: row.owner_moves for row in rows if row.owner_moves}
    blunders = {row.id: row.blunders or 0 for row in rows if row.owner_moves}
    return moves, blunders


def _blunder_counts(session: Session, scope: GameFilters) -> dict[int, int]:
    """Owner blunders per game, over the runs stats read."""
    statement = (
        select(AnalysisRun.game_id, func.count(MoveEval.id))
        .select_from(MoveEval)
        .join(AnalysisRun, MoveEval.run_id == AnalysisRun.id)
        .join(Game, AnalysisRun.game_id == Game.id)
        .where(
            AnalysisRun.id.in_(primary_runs()),
            MoveEval.classification == Classification.BLUNDER,
            owner_move_condition(),
            *game_conditions(scope),
        )
        .group_by(AnalysisRun.game_id)
    )
    return {game_id: count for game_id, count in session.execute(statement)}


def _owner_move_counts(session: Session, scope: GameFilters) -> dict[int, int]:
    """Analysed owner moves per game, which is what a rate is per."""
    statement = (
        select(AnalysisRun.game_id, func.count(MoveEval.id))
        .select_from(MoveEval)
        .join(AnalysisRun, MoveEval.run_id == AnalysisRun.id)
        .join(Game, AnalysisRun.game_id == Game.id)
        .where(
            AnalysisRun.id.in_(primary_runs()),
            owner_move_condition(),
            *game_conditions(scope),
        )
        .group_by(AnalysisRun.game_id)
    )
    return {game_id: count for game_id, count in session.execute(statement)}


def _clock_index(session: Session, scope: GameFilters) -> dict[int, tuple[Any, int | None]]:
    statement = select(Game.id, Game.clocks, Game.initial_clock).where(
        Game.clocks.is_not(None), *game_conditions(scope)
    )
    return {
        game_id: (clocks, initial) for game_id, clocks, initial in session.execute(statement)
    }


def _remaining_clock(entry: tuple[Any, int | None] | None, ply: int) -> float | None:
    """What the mover had left before playing `ply`: their own previous reading."""
    if entry is None:
        return None
    clocks, initial = entry
    if not clocks:
        return None
    previous = ply - 2
    if previous < 0:
        return float(initial) if initial is not None else None
    if previous >= len(clocks):
        return None
    value = clocks[previous]
    return float(value) if value is not None else None


def _classification_buckets(
    rows: Iterable[EvalRow], order: Sequence[str], key: Any
) -> dict[str, Any]:
    buckets: dict[str, dict[str, Any]] = {}
    overall = _empty_classification_bucket("total")
    for row in rows:
        name = key(row)
        for bucket in (buckets.setdefault(name, _empty_classification_bucket(name)), overall):
            bucket["moves"] += 1
            if row.win_loss is not None:
                bucket["evaluated"] += 1
                bucket["loss_sum"] += row.win_loss
            if row.classification in bucket["counts"]:
                bucket["counts"][row.classification] += 1

    return _finish_classification_buckets(buckets, overall, order)


def _summary_classification_buckets(
    session: Session, scope: GameFilters, group: str, order: Sequence[str]
) -> dict[str, Any]:
    """The payload `_classification_buckets` builds, added up out of the stored folds.

    One row per game instead of one per analysed ply, and the same finishing arithmetic on
    the way out, so which path answered is not something a caller can tell. A game with no
    summary has no primary run and so contributed no rows to the scan either.
    """
    statement = select(Game.stat_summary).where(
        Game.stat_summary.is_not(None), *game_conditions(scope)
    )
    return _classification_from_summaries(session.scalars(statement), group, order)


def _classification_from_summaries(
    summaries: Iterable[Mapping[str, Any]], group: str, order: Sequence[str]
) -> dict[str, Any]:
    buckets: dict[str, dict[str, Any]] = {}
    overall = _empty_classification_bucket("total")
    for summary in summaries:
        for name, counted in summary[group].items():
            _merge_classification_bucket(
                buckets.setdefault(name, _empty_classification_bucket(name)), counted
            )
            _merge_classification_bucket(overall, counted)
    return _finish_classification_buckets(buckets, overall, order)


def _merge_classification_bucket(bucket: dict[str, Any], counted: Mapping[str, Any]) -> None:
    """Add one game's group to a bucket the aggregate is accumulating."""
    bucket["moves"] += counted["moves"]
    bucket["evaluated"] += counted["evaluated"]
    bucket["loss_sum"] += counted["loss_sum"]
    for name in LOSS_CLASSIFICATION_NAMES:
        bucket["counts"][name] += counted[name]


def _finish_classification_buckets(
    buckets: dict[str, dict[str, Any]], overall: dict[str, Any], order: Sequence[str]
) -> dict[str, Any]:
    """The known buckets in the order they are named, then whatever else turned up."""
    ordered = [
        _finish_classification_bucket(buckets[name])
        for name in list(order) + [name for name in sorted(buckets) if name not in order]
        if name in buckets
    ]
    return {"buckets": ordered, "total": _finish_classification_bucket(overall)}


def _empty_classification_bucket(name: str) -> dict[str, Any]:
    return {
        "key": name,
        "moves": 0,
        "evaluated": 0,
        "loss_sum": 0.0,
        "counts": {str(value): 0 for value in LOSS_CLASSIFICATIONS},
    }


def _finish_classification_bucket(bucket: dict[str, Any]) -> dict[str, Any]:
    counts = bucket["counts"]
    return {
        "key": bucket["key"],
        "moves": bucket["moves"],
        "evaluated": bucket["evaluated"],
        **counts,
        "blunder_rate": _rate(counts[str(Classification.BLUNDER)], bucket["moves"]),
        "avg_win_loss": _mean(bucket["loss_sum"], bucket["evaluated"]),
    }


def _performance_buckets(
    rows: Iterable[GameRow],
    blunders: dict[int, int],
    moves: dict[int, int],
    key: Any,
    *,
    order: Sequence[str] | None = (),
) -> dict[str, Any]:
    """Games grouped by `key`, scored from the owner's side.

    `analyzed_games` counts the games an engine has been over, not the ones it found
    something in, so a bucket of clean games reads as 0 blunders per game rather than as
    no data.
    """
    buckets: dict[str, dict[str, Any]] = {}
    for row in rows:
        name = key(row)
        bucket = buckets.setdefault(
            name,
            {
                "key": name,
                "games": 0,
                "wins": 0,
                "draws": 0,
                "losses": 0,
                "blunders": 0,
                "analyzed_games": 0,
                "_ratings": [],
                "_opponents": [],
            },
        )
        bucket["games"] += 1
        if row.outcome == WIN:
            bucket["wins"] += 1
        elif row.outcome == DRAW:
            bucket["draws"] += 1
        elif row.outcome == LOSS:
            bucket["losses"] += 1
        if row.rating is not None:
            bucket["_ratings"].append(row.rating)
        if row.opponent_rating is not None:
            bucket["_opponents"].append(row.opponent_rating)
        if row.id in moves:
            bucket["analyzed_games"] += 1
            bucket["blunders"] += blunders.get(row.id, 0)

    names = sorted(buckets, key=lambda name: -buckets[name]["games"])
    if order:
        names = [name for name in order if name in buckets] + [
            name for name in names if name not in order
        ]
    ordered = []
    for name in names:
        bucket = buckets[name]
        ratings = bucket.pop("_ratings")
        opponents = bucket.pop("_opponents")
        ordered.append(
            {
                **bucket,
                "score": _score(bucket),
                "avg_rating": _mean(sum(ratings), len(ratings)),
                "avg_opponent_rating": _mean(sum(opponents), len(opponents)),
                "blunders_per_game": _mean(bucket["blunders"], bucket["analyzed_games"]),
            }
        )
    return {"buckets": ordered, "total": _totals_of(ordered)}


def _totals_of(buckets: Sequence[dict[str, Any]]) -> dict[str, Any]:
    """The same fields summed, so a caller never has to add the buckets up itself.

    Counts add up; a rating does not, so anything that is a level rather than a count is
    recomputed below or left out.
    """
    total: dict[str, Any] = {"key": "total"}
    for bucket in buckets:
        for field, value in bucket.items():
            if field in NON_ADDITIVE:
                continue
            if isinstance(value, int) and not isinstance(value, bool):
                total[field] = total.get(field, 0) + value
    if "wins" in total:
        total["score"] = _score(total)
    if total.get("moves"):
        total["blunder_rate"] = _rate(total.get("blunder", 0), total["moves"])
    if total.get("analyzed_games"):
        total["blunders_per_game"] = _mean(total.get("blunders", 0), total["analyzed_games"])
    if total.get("owner_moves"):
        total["blunders_per_100_moves"] = _rate(
            total.get("blunders", 0) * 100, total["owner_moves"]
        )
    return total


def _delta(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    """Bucket-for-bucket movement between two windows, keyed the way the buckets are."""
    then_buckets = {bucket["key"]: bucket for bucket in before.get("buckets", ())}
    now_buckets = {bucket["key"]: bucket for bucket in after.get("buckets", ())}
    buckets = []
    for key in list(now_buckets) + [key for key in then_buckets if key not in now_buckets]:
        buckets.append(
            {"key": key, **_numeric_delta(then_buckets.get(key, {}), now_buckets.get(key, {}))}
        )
    return {
        "buckets": buckets,
        "total": _numeric_delta(before.get("total", {}), after.get("total", {})),
    }


def _numeric_delta(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    """Field-for-field movement, with a bucket missing from one window read as zero.

    Only for counts: no games in a window is genuinely zero blunders, but it is not a
    score of zero or an average of zero, so a rate that one side does not have stays
    `None` rather than inventing a drop to nothing.
    """
    delta: dict[str, Any] = {}
    for field in sorted(set(before) | set(after)):
        if field == "key":
            continue
        old, new = before.get(field), after.get(field)
        if not _is_number(old) and not _is_number(new):
            continue
        if old is None and isinstance(new, int):
            old = 0
        elif new is None and isinstance(old, int):
            new = 0
        if old is None or new is None:
            delta[field] = None
            continue
        delta[field] = round(new - old, 4)
    return delta


def _piece_at(fen: str, square: str) -> str | None:
    """The piece standing on a square, read straight off the FEN's placement field."""
    if len(square) != 2 or not square[1].isdigit():
        return None
    file_index = ord(square[0].lower()) - ord("a")
    rank_index = int(square[1]) - 1
    if not 0 <= file_index <= 7 or not 0 <= rank_index <= 7:
        return None
    ranks = fen.split(" ", 1)[0].split("/")
    if len(ranks) != 8:
        return None
    row = ranks[7 - rank_index]
    index = 0
    for character in row:
        if character.isdigit():
            index += int(character)
        else:
            if index == file_index:
                return FEN_PIECES.get(character.lower())
            index += 1
        if index > file_index:
            return None
    return None


def _period_key(moment: datetime, period: str) -> str:
    if period == "year":
        return f"{moment.year:04d}"
    if period == "month":
        return f"{moment.year:04d}-{moment.month:02d}"
    if period == "week":
        year, week, _day = moment.isocalendar()
        return f"{year:04d}-W{week:02d}"
    return moment.date().isoformat()


def _score(bucket: dict[str, Any]) -> float | None:
    decided = bucket.get("wins", 0) + bucket.get("draws", 0) + bucket.get("losses", 0)
    if not decided:
        return None
    points = bucket.get("wins", 0) + 0.5 * bucket.get("draws", 0)
    return round(points / decided, 4)


def _seconds(value: float) -> str:
    return f"{int(value)}s" if float(value).is_integer() else f"{value}s"


def _rate(numerator: float, denominator: float) -> float | None:
    return round(numerator / denominator, 4) if denominator else None


def _mean(total: float, count: int) -> float | None:
    return round(total / count, 4) if count else None


def _is_number(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)


def _stamp(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _utc(value: datetime) -> datetime:
    """SQLite returns stored UTC datetimes without tzinfo; normalise both DB backends."""
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)
