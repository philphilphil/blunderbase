from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import Any, NamedTuple

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

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

BUCKETS = ("day", "week", "month", "year")

SAN_PIECES = {"N": "knight", "B": "bishop", "R": "rook", "Q": "queen", "K": "king"}
FEN_PIECES = {"p": "pawn", "n": "knight", "b": "bishop", "r": "rook", "q": "queen", "k": "king"}

LOSS_CLASSIFICATIONS = (
    Classification.INACCURACY,
    Classification.MISTAKE,
    Classification.BLUNDER,
)

# Fields that are a level rather than a count, so summing them across buckets is wrong.
NON_ADDITIVE = frozenset({"key", "end_rating", "rating"})


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
    payload = handler(session, scope, options)
    payload["dimension"] = dimension
    payload["since"] = _stamp(scope.since)
    payload["until"] = _stamp(scope.until)
    return payload


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
    here because the coach asks for it alongside the other aggregations.
    """
    return games_service.get_player_profile(session, **options)


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
    """
    if amount <= 0:
        return []
    since = None
    if days is not None:
        since = datetime.now(UTC) - timedelta(days=days)
    scope = _scope(filters, since, None)

    conditions = [MoveEval.win_loss.is_not(None)]
    if classifications:
        conditions.append(MoveEval.classification.in_(list(classifications)))
    rows = _eval_rows(
        session,
        scope,
        extra_conditions=conditions,
        order_by=MoveEval.win_loss.desc(),
        limit=max(amount, 0),
    )
    if not rows:
        return []

    stored = {
        game.id: game
        for game in session.scalars(select(Game).where(Game.id.in_({row.game_id for row in rows})))
    }
    moments = []
    for row in rows:
        game = stored.get(row.game_id)
        if game is None:
            continue
        moments.append(
            {
                "game": game_summary(game),
                "ply": row.ply,
                "move_number": row.ply // 2 + 1,
                "san": row.move_san,
                "uci": row.move_uci,
                "classification": row.classification,
                "win_loss": row.win_loss,
                "phase": phase_of(row.fen, row.ply),
                "piece": piece_of(row.move_san, row.move_uci, row.fen),
                "fen": row.fen,
                "best_move_uci": row.best_move_uci,
                "best_move_san": best_move_san(row.fen, row.best_move_uci),
                "run_id": row.run_id,
                "tier": row.tier,
            }
        )
    return moments


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
    rows = _eval_rows(session, scope)
    return _classification_buckets(rows, PHASES, lambda row: phase_of(row.fen, row.ply))


def _blunders_by_piece(
    session: Session, scope: GameFilters, options: dict[str, Any]
) -> dict[str, Any]:
    rows = _eval_rows(session, scope)
    return _classification_buckets(
        rows, PIECES, lambda row: piece_of(row.move_san, row.move_uci, row.fen)
    )


def _performance_by_speed(
    session: Session, scope: GameFilters, options: dict[str, Any]
) -> dict[str, Any]:
    rows = _game_rows(session, scope)
    return _performance_buckets(
        rows,
        _blunder_counts(session, scope),
        _owner_move_counts(session, scope),
        lambda row: row.speed or "unknown",
    )


def _performance_by_hour(
    session: Session, scope: GameFilters, options: dict[str, Any]
) -> dict[str, Any]:
    """Time of day, bucketed in Python.

    The hour is read off the timestamp here rather than in SQL: the interesting hour is
    the owner's local one, which the database does not know at all. `tz_offset` is in
    hours east of UTC.
    """
    offset = timedelta(hours=float(options.get("tz_offset", 0.0)))
    rows = [row for row in _game_rows(session, scope) if row.played_at is not None]
    payload = _performance_buckets(
        rows,
        _blunder_counts(session, scope),
        _owner_move_counts(session, scope),
        lambda row: f"{(row.played_at + offset).hour:02d}",
        order=None,
    )
    payload["buckets"].sort(key=lambda bucket: bucket["key"])
    payload["tz_offset"] = float(options.get("tz_offset", 0.0))
    return payload


def _time_trouble_loss(
    session: Session, scope: GameFilters, options: dict[str, Any]
) -> dict[str, Any]:
    """Eval given away by how much clock the mover had left when they moved."""
    thresholds = tuple(
        sorted(float(value) for value in options.get("thresholds", TIME_TROUBLE_THRESHOLDS))
    )
    rows = _eval_rows(session, scope)
    clocks = _clock_index(session, scope)

    def bucket(row: EvalRow) -> str:
        remaining = _remaining_clock(clocks.get(row.game_id), row.ply)
        if remaining is None:
            return "unknown"
        for threshold in thresholds:
            if remaining < threshold:
                return f"<{_seconds(threshold)}"
        return f">={_seconds(thresholds[-1])}" if thresholds else "any"

    order = [f"<{_seconds(threshold)}" for threshold in thresholds]
    if thresholds:
        order.append(f">={_seconds(thresholds[-1])}")
    order.append("unknown")
    payload = _classification_buckets(rows, tuple(order), bucket)
    payload["thresholds"] = list(thresholds)
    return payload


def _rating_trend(
    session: Session, scope: GameFilters, options: dict[str, Any]
) -> dict[str, Any]:
    """Rating and blunder rate over time, in whatever period the caller asked for."""
    period = str(options.get("bucket", "month"))
    if period not in BUCKETS:
        raise ValueError(f"unknown bucket {period!r}; known buckets: {', '.join(BUCKETS)}")

    rows = [row for row in _game_rows(session, scope) if row.played_at is not None]
    blunders = _blunder_counts(session, scope)
    moves = _owner_move_counts(session, scope)

    buckets: dict[str, dict[str, Any]] = {}
    for row in rows:
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


def primary_runs() -> Any:
    """The one run per game that stats read: the newest done full-game UCI pass.

    A run over a ply range is deliberately excluded — a deep pass over the endgame would
    otherwise shadow the quick pass for the plies it covers and leave the game's numbers
    half from one engine budget and half from another. Maia runs are excluded too: they
    predict a human move, they do not judge one.
    """
    return (
        select(func.max(AnalysisRun.id))
        .select_from(AnalysisRun)
        .outerjoin(Engine, AnalysisRun.engine_id == Engine.id)
        .where(
            AnalysisRun.status == RunStatus.DONE,
            AnalysisRun.game_id.is_not(None),
            AnalysisRun.ply_start.is_(None),
            AnalysisRun.ply_end.is_(None),
            or_(Engine.id.is_(None), Engine.kind == EngineKind.UCI),
        )
        .group_by(AnalysisRun.game_id)
        .scalar_subquery()
    )


def _eval_rows(
    session: Session,
    scope: GameFilters,
    *,
    extra_conditions: Sequence[Any] = (),
    order_by: Any = None,
    limit: int | None = None,
) -> list[EvalRow]:
    """The owner's own analysed moves, with the FEN each was played in.

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
            AnalysisRun.id.in_(primary_runs()),
            owner_move_condition(),
            *game_conditions(scope),
            *extra_conditions,
        )
    )
    if order_by is not None:
        statement = statement.order_by(order_by)
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
            )
        )
    return rows


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

