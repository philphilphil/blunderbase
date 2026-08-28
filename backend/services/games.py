from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import ColumnElement, Delete, and_, delete, exists, func, or_, select
from sqlalchemy.orm import Session

from backend.db.enums import (
    Classification,
    Color,
    Platform,
    Result,
    RunStatus,
    Source,
    Speed,
    Tier,
)
from backend.db.models import (
    Account,
    AnalysisRun,
    Game,
    GamePosition,
    ImportJob,
    MoveEval,
    Note,
)

# What a game was for the owner. `None` for a game no account of theirs played in.
WIN = "win"
LOSS = "loss"
DRAW = "draw"
OUTCOMES = (WIN, LOSS, DRAW)

# Which platform a game's source implies when no account row claims it.
PLATFORM_FOR_SOURCE: dict[Source, Platform] = {
    Source.LICHESS: Platform.LICHESS,
    Source.CHESSCOM: Platform.CHESSCOM,
}

# A deep pass is the better answer wherever it reaches; a quick pass fills in the rest.
TIER_RANK: dict[Tier, int] = {Tier.QUICK: 0, Tier.DEEP: 1}

# Rating series are read by a chat model as often as by a chart, so they are downsampled
# before they are handed over rather than after.
PROFILE_MAX_POINTS = 200

# Downsampling never touches the last year of a series, however dense, so a chart's
# 30d/90d windows always have enough points to draw a line rather than a lone dot.
PROFILE_RECENT_WINDOW_DAYS = 365

# However little budget the recent window leaves behind, the older prefix still gets to
# keep at least this many points, so ancient history never fully vanishes from the chart.
PROFILE_MIN_OLD_POINTS = 20

# How many worst moments a stored card keeps. The games table shows three and the coach
# asks for three by default; the few callers that want more than this are served by
# reading the evals, which is what the card exists to avoid for everyone else.
CARD_WORST_MOMENTS = 5

# How many games a card backfill rebuilds before it commits and lets go of the write lock.
CARD_BACKFILL_CHUNK = 200


@dataclass(slots=True)
class GameFilters:
    """Everything `search_games` can narrow by. All fields are optional and AND-ed."""

    since: datetime | None = None
    until: datetime | None = None
    source: Source | None = None
    color: Color | None = None
    eco: str | None = None
    result: Result | None = None
    # The same game from the owner's side: "win" / "loss" / "draw", whichever colour.
    outcome: str | None = None
    speed: Speed | None = None
    time_control: str | None = None
    opponent: str | None = None
    variant: str | None = None
    has_blunders: bool | None = None
    deep_analyzed: bool | None = None
    text: str | None = None


def search_games(
    session: Session, filters: GameFilters, limit: int = 50, offset: int = 0
) -> list[Game]:
    """Games matching `filters`, newest first."""
    statement = select(Game).where(*game_conditions(filters))
    statement = statement.order_by(Game.played_at.desc().nulls_last(), Game.id.desc())
    return list(session.scalars(statement.limit(limit).offset(offset)))


def count_games(session: Session, filters: GameFilters) -> int:
    """How many games match `filters`, for pagination."""
    statement = select(func.count(Game.id)).select_from(Game).where(*game_conditions(filters))
    return int(session.scalar(statement) or 0)


@dataclass(slots=True)
class Wiped:
    """What `delete_all_games` removed, in rows."""

    games: int = 0
    runs: int = 0
    notes: int = 0
    import_jobs: int = 0


def delete_all_games(session: Session) -> Wiped:
    """Empty the library: every game, and everything that only exists because of one.

    The schema already cascades — `game_positions`, `analysis_runs` and a game's notes name
    `ondelete="CASCADE"`, and `move_evals` follow their run — but the deletes are spelled
    out child-first anyway. It is what makes the counts real rather than guessed, it is what
    a database whose foreign keys are not enforced needs, and it is the order that drops a
    queued run *before* its game rather than trusting a worker not to claim it in between.

    Three things deliberately survive. `positions` is the shared dictionary every game
    points into, and a position note points at it too, so it stays whether or not a game
    ever reached it again. Accounts, engines and runners are configuration, not library.
    Notes with no `game_id` are the coach's memory about a position rather than about a
    game, and the owner asked to lose their games, not their notes.

    `import_jobs` does not survive, and that is the point rather than an oversight:
    `import_service.latest_cursor` reads the cursor of the last finished sync off those
    rows, so a wipe that kept them would leave the next sync resuming from where the games
    that are gone left off — importing nothing. Dropping the history is what makes the next
    sync a fresh one.
    """
    wiped = Wiped()
    of_a_game = select(AnalysisRun.id).where(AnalysisRun.game_id.is_not(None))
    _deleted(session, delete(MoveEval).where(MoveEval.run_id.in_(of_a_game)))
    wiped.runs = _deleted(session, delete(AnalysisRun).where(AnalysisRun.game_id.is_not(None)))
    wiped.notes = _deleted(session, delete(Note).where(Note.game_id.is_not(None)))
    # Every `game_positions` row names a game, and every game is going.
    _deleted(session, delete(GamePosition))
    wiped.games = _deleted(session, delete(Game))
    wiped.import_jobs = _deleted(session, delete(ImportJob))
    session.commit()
    return wiped


def _deleted(session: Session, statement: Delete) -> int:
    """Run one bulk delete and say how many rows it took."""
    return int(session.execute(statement.execution_options(synchronize_session=False)).rowcount)


def game_conditions(filters: GameFilters) -> list[ColumnElement[bool]]:
    """`filters` as WHERE clauses over `games`, for anything that selects games.

    Every one of them is either a column comparison or a correlated EXISTS, so the list
    can be dropped into a `select(Game)`, a `select(count)` or a join without a subquery
    of its own and without changing the row count.
    """
    conditions: list[ColumnElement[bool]] = []
    if filters.since is not None:
        conditions.append(Game.played_at >= filters.since)
    if filters.until is not None:
        conditions.append(Game.played_at <= filters.until)
    if filters.source is not None:
        conditions.append(Game.source == filters.source)
    if filters.color is not None:
        conditions.append(Game.owner_color == filters.color)
    if filters.eco:
        conditions.append(_starts_with(Game.eco, filters.eco))
    if filters.result is not None:
        conditions.append(Game.result == filters.result)
    if filters.outcome:
        conditions.append(outcome_condition(filters.outcome))
    if filters.speed is not None:
        conditions.append(Game.speed == filters.speed)
    if filters.time_control:
        conditions.append(Game.time_control == filters.time_control)
    if filters.variant:
        conditions.append(func.lower(Game.variant) == filters.variant.strip().casefold())
    if filters.opponent:
        conditions.append(_opponent_condition(filters.opponent))
    if filters.has_blunders is not None:
        blunders = _has_classification(Classification.BLUNDER)
        conditions.append(blunders if filters.has_blunders else ~blunders)
    if filters.deep_analyzed is not None:
        deep = _has_deep_run()
        conditions.append(deep if filters.deep_analyzed else ~deep)
    if filters.text:
        conditions.append(_text_condition(filters.text))
    return conditions


def outcome_condition(outcome: str) -> ColumnElement[bool]:
    """"win" / "loss" / "draw" from the owner's side, whichever colour they had."""
    normalised = outcome.strip().casefold()
    if normalised == DRAW:
        return and_(Game.owner_color.is_not(None), Game.result == Result.DRAW)
    if normalised == WIN:
        wins_as = {Color.WHITE: Result.WHITE_WIN, Color.BLACK: Result.BLACK_WIN}
    elif normalised == LOSS:
        wins_as = {Color.WHITE: Result.BLACK_WIN, Color.BLACK: Result.WHITE_WIN}
    else:
        raise ValueError(f"unknown outcome {outcome!r}; known outcomes: {', '.join(OUTCOMES)}")
    return or_(
        *(
            and_(Game.owner_color == color, Game.result == result)
            for color, result in wins_as.items()
        )
    )


def owner_move_condition() -> ColumnElement[bool]:
    """The plies of `move_evals` that are the owner's own moves.

    White moves on even plies. A game whose owner is unknown contributes every ply, which
    is the only honest answer when there is no "you" to filter by.
    """
    return or_(
        and_(Game.owner_color == Color.WHITE, MoveEval.ply % 2 == 0),
        and_(Game.owner_color == Color.BLACK, MoveEval.ply % 2 == 1),
        Game.owner_color.is_(None),
    )


def get_game(session: Session, game_id: int) -> Game | None:
    """One game with its move lists; evals are fetched through `get_game_detail`."""
    return session.get(Game, game_id)


def get_game_detail(
    session: Session,
    game_id: int,
    *,
    ply_range: tuple[int, int] | None = None,
    include_notes: bool = True,
) -> dict[str, Any] | None:
    """One game as the coach reads it: moves, evals, Maia predictions and notes.

    Every ply carries the eval of the newest run that reaches it, a deep run beating a
    quick one for the plies it covers, so a deep pass over the endgame shows up as deep
    evals for the endgame and quick evals everywhere else. Maia's policy is merged the
    same way but separately, because it usually arrives from a run of its own.
    """
    game = session.get(Game, game_id)
    if game is None:
        return None

    runs = analysis_runs(session, game_id)
    evals, maia = merge_run_evals(session, runs, ply_range=ply_range)

    start, end = _ply_bounds(game, ply_range)
    moves = [
        _move_row(game, ply, evals.get(ply), maia.get(ply))
        for ply in range(start, min(end, game.ply_count - 1) + 1)
    ]

    detail: dict[str, Any] = {
        "game": game_summary(game),
        "ply_range": [start, end] if ply_range is not None else None,
        "moves": moves,
        "runs": [_run_summary(run) for run in runs],
    }
    if include_notes:
        detail["notes"] = game_notes(session, game_id)
    return detail


def analysis_runs(session: Session, game_id: int, done_only: bool = True) -> list[AnalysisRun]:
    """Every run over a game, oldest first, quick before deep at the same age."""
    statement = select(AnalysisRun).where(AnalysisRun.game_id == game_id)
    if done_only:
        statement = statement.where(AnalysisRun.status == RunStatus.DONE)
    runs = list(session.scalars(statement))
    runs.sort(key=lambda run: (TIER_RANK.get(run.tier, 0), run.created_at, run.id))
    return runs


def merge_run_evals(
    session: Session,
    runs: Sequence[AnalysisRun],
    *,
    ply_range: tuple[int, int] | None = None,
) -> tuple[dict[int, MoveEval], dict[int, dict[str, Any]]]:
    """Fold a game's runs into one eval per ply and one Maia policy per ply.

    `runs` is applied in order, so whatever comes last wins; a run that only covers a ply
    window only overwrites that window. A run that carries no Maia policy leaves the
    policy from an earlier run in place, which is what makes a Stockfish pass over a game
    Maia has already seen additive rather than destructive — and a run that carries only
    some of the levels adds those levels rather than dropping the rest.
    """
    if not runs:
        return {}, {}
    statement = select(MoveEval).where(MoveEval.run_id.in_([run.id for run in runs]))
    if ply_range is not None:
        statement = statement.where(MoveEval.ply >= ply_range[0], MoveEval.ply <= ply_range[1])

    by_run: dict[int, list[MoveEval]] = {}
    for row in session.scalars(statement):
        by_run.setdefault(row.run_id, []).append(row)

    evals: dict[int, MoveEval] = {}
    maia: dict[int, dict[str, Any]] = {}
    for run in runs:
        for row in by_run.get(run.id, ()):
            if _carries_eval(row) or row.ply not in evals:
                evals[row.ply] = row
            if row.maia_policy:
                # Merged by level rather than replaced: a later run that computed only the
                # levels the game was missing — what `analysis.queue_maia_fill` queues —
                # adds its columns to the ones an older run already stored, and a run that
                # recomputed a level it shares wins that level alone.
                maia[row.ply] = {**maia.get(row.ply, {}), **row.maia_policy}
    return evals, maia


def _carries_eval(row: MoveEval) -> bool:
    """Whether a row says anything about the move, or is only a carrier for a policy."""
    return any(
        value is not None
        for value in (
            row.eval_before_cp,
            row.eval_before_mate,
            row.eval_after_cp,
            row.eval_after_mate,
            row.win_after,
            row.classification,
            row.best_move_uci,
        )
    )


def game_notes(session: Session, game_id: int) -> list[dict[str, Any]]:
    """Notes on the game, plus notes on any position the game reached.

    A note that names a ply or a variation carries them here too: the move list draws a
    marker where a note hangs, and it has no second call to find out where that is.
    """
    rows: list[dict[str, Any]] = []
    for note in session.scalars(select(Note).where(Note.game_id == game_id)):
        scope = "line" if note.line_id is not None else "game"
        rows.append(_note_row(note, scope=scope, ply=note.ply))

    attached = (
        select(Note, func.min(GamePosition.ply))
        .join(GamePosition, GamePosition.position_id == Note.position_id)
        .where(
            GamePosition.game_id == game_id,
            Note.position_id.is_not(None),
            or_(Note.game_id.is_(None), Note.game_id != game_id),
        )
        .group_by(Note.id)
    )
    for note, reached in session.execute(attached):
        # `reached` and not `note.ply`: the query above excludes this game's own notes, so
        # the note's ply counts half-moves into *another* game and says nothing about where
        # this one arrived. Same-game notes carry their own ply, from the loop above.
        rows.append(_note_row(note, scope="position", ply=reached))

    rows.sort(key=lambda row: row["created_at"], reverse=True)
    return rows


def get_last_games(
    session: Session, amount: int = 5, source: Source | None = None, speed: Speed | None = None
) -> list[Game]:
    """The newest games, the way the coach is usually asked for them."""
    return search_games(session, GameFilters(source=source, speed=speed), limit=max(amount, 0))


def game_card(session: Session, game: Game, *, worst: int = 3) -> dict[str, Any]:
    """A game as a compact card: the summary, the eval curve and its worst moments.

    The expensive half is read off `Game.card`, written whenever the game's finished runs
    changed, so a page of fifty of these is fifty rows rather than a hundred queries over
    every MoveEval behind them. Two things still compute it here: a game analysed before
    the column existed, whose card is NULL, and a caller asking for more worst moments than
    a card keeps. Neither writes what it computed — this is what GET handlers call, and
    they do not commit.
    """
    stored = _stored_card(game, worst)
    card = stored if stored is not None else build_card(session, game, worst=max(worst, 0))
    return {
        **game_summary(game),
        "analyzed": card["analyzed"],
        "deep": card["deep"],
        "eval_curve": card["eval_curve"],
        "worst_moments": card["worst_moments"][: max(worst, 0)],
    }


def game_cards(session: Session, games: Iterable[Game], *, worst: int = 3) -> list[dict[str, Any]]:
    """`game_card` over a list, which is what `get_last_games` is usually followed by."""
    return [game_card(session, game, worst=worst) for game in games]


def build_card(session: Session, game: Game, *, worst: int = CARD_WORST_MOMENTS) -> dict[str, Any]:
    """The analysis half of a game's card, folded out of every finished run over it.

    Only the analysis: the game's own metadata is read live from the row by `game_card`, so
    a stored card can never go stale against a re-imported or re-attributed game — the
    only thing that ages it is analysis, and analysis is what rewrites it.

    The eval curve is one point per evaluated ply and stays that way. Whoever draws it
    decides how many points they want; a card that had already thinned it could not be
    un-thinned, and the API shape is the full curve.
    """
    runs = analysis_runs(session, game.id)
    evals, _maia = merge_run_evals(session, runs)
    curve = [
        {"ply": ply, "win": evals[ply].win_after}
        for ply in sorted(evals)
        if evals[ply].win_after is not None
    ]
    owned = (
        row
        for row in evals.values()
        if row.win_loss is not None and _is_owner_ply(game, row.ply)
    )
    ranked = sorted(owned, key=lambda row: row.win_loss or 0.0, reverse=True)
    return {
        "analyzed": bool(runs),
        "deep": any(run.tier == Tier.DEEP for run in runs),
        "eval_curve": curve,
        "worst_moments": [_moment_row(game, row) for row in ranked[:worst]],
    }


def refresh_card(session: Session, game: Game) -> dict[str, Any]:
    """Recompute a game's stored card, leaving the commit to the caller.

    Deliberately without one: this belongs inside the transaction that changed the game's
    finished runs, so the card and the evals it describes become visible together and a
    reader can never catch one without the other.
    """
    card = build_card(session, game)
    game.card = card
    return card


def rebuild_game_cards(session: Session, *, chunk: int = CARD_BACKFILL_CHUNK) -> int:
    """Rewrite the stored card of every game with a finished run; how many were rebuilt.

    Only a library analysed before the cards existed needs this — from then on the runs
    keep their own game's card current. It is a convenience rather than a requirement:
    `game_card` computes what it does not find, so an un-backfilled library is slow, not
    wrong.

    Committing per chunk is what lets it run beside a live server: SQLite has one writer,
    and a single transaction over thousands of games would hold it for the whole sweep.
    """
    game_ids = list(session.scalars(select(Game.id).where(_has_done_run()).order_by(Game.id)))
    rebuilt = 0
    for start in range(0, len(game_ids), max(chunk, 1)):
        for game_id in game_ids[start : start + max(chunk, 1)]:
            game = session.get(Game, game_id)
            if game is not None:
                refresh_card(session, game)
                rebuilt += 1
        session.commit()
        # Nothing here needs the games again, and a sweep over a large library would
        # otherwise keep every one of them — PGN and all — in the identity map.
        session.expunge_all()
    return rebuilt


def _stored_card(game: Game, worst: int) -> dict[str, Any] | None:
    """The stored card, when it holds enough worst moments to answer `worst`.

    A card is cut at `CARD_WORST_MOMENTS`; one holding fewer than that held everything the
    game had to give, so slicing it stays complete however many were asked for.
    """
    card = game.card
    if card is None:
        return None
    kept = card["worst_moments"]
    if worst > len(kept) and len(kept) >= CARD_WORST_MOMENTS:
        return None
    return card


def game_summary(game: Game) -> dict[str, Any]:
    """The compact form of a game every payload in the service layer embeds."""
    return _compact(
        {
            "id": game.id,
            "source": str(game.source),
            "source_id": game.source_id,
            "played_at": _stamp(game.played_at),
            "color": str(game.owner_color) if game.owner_color else None,
            "result": str(game.result),
            "outcome": outcome_of(game),
            "white": game.white_name,
            "black": game.black_name,
            "white_rating": game.white_rating,
            "black_rating": game.black_rating,
            "opponent": opponent_name(game),
            "opponent_rating": opponent_rating(game),
            "rating": owner_rating(game),
            "speed": str(game.speed) if game.speed else None,
            "time_control": game.time_control,
            "rated": game.rated,
            "variant": game.variant if game.variant != "standard" else None,
            "eco": game.eco,
            "opening": game.opening_name,
            "termination": game.termination,
            "ply_count": game.ply_count,
        }
    )


def outcome_of(game: Game) -> str | None:
    """"win" / "loss" / "draw" from the owner's side, or None when they did not play."""
    return outcome_from(game.owner_color, game.result)


def outcome_from(color: Color | None, result: Result) -> str | None:
    """The same rule as `outcome_of` for callers that selected the two columns."""
    if color is None:
        return None
    if result == Result.DRAW:
        return DRAW
    if result == Result.WHITE_WIN:
        return WIN if color == Color.WHITE else LOSS
    if result == Result.BLACK_WIN:
        return WIN if color == Color.BLACK else LOSS
    return None


def score_of(game: Game) -> float | None:
    """The owner's score in a game: 1, 0.5 or 0."""
    return score_from(outcome_of(game))


def score_from(outcome: str | None) -> float | None:
    return {WIN: 1.0, DRAW: 0.5, LOSS: 0.0}.get(outcome or "")


def owner_rating(game: Game) -> int | None:
    if game.owner_color == Color.WHITE:
        return game.white_rating
    if game.owner_color == Color.BLACK:
        return game.black_rating
    return None


def opponent_name(game: Game) -> str | None:
    if game.owner_color == Color.WHITE:
        return game.black_name
    if game.owner_color == Color.BLACK:
        return game.white_name
    return None


def opponent_rating(game: Game) -> int | None:
    if game.owner_color == Color.WHITE:
        return game.black_rating
    if game.owner_color == Color.BLACK:
        return game.white_rating
    return None


def platform_of(game: Game, accounts: dict[int, Account]) -> str | None:
    """Where a game was played: the owner's account if one claims it, else its source."""
    account_id = (
        game.white_account_id if game.owner_color == Color.WHITE else game.black_account_id
    )
    account = accounts.get(account_id) if account_id is not None else None
    if account is not None:
        return str(account.platform)
    platform = PLATFORM_FOR_SOURCE.get(game.source)
    return str(platform) if platform is not None else None


def get_player_profile(
    session: Session, *, max_points: int = PROFILE_MAX_POINTS
) -> dict[str, Any]:
    """Ratings over time per platform, volume and platforms for the owner's accounts.

    Rating series are per platform *and* speed, because a bullet rating and a classical
    rating on the same site are two different numbers and averaging them says nothing.
    """
    accounts = {
        account.id: account for account in session.scalars(select(Account).order_by(Account.id))
    }
    games = list(
        session.scalars(
            select(Game)
            .where(Game.owner_color.is_not(None))
            .order_by(Game.played_at.asc().nulls_last(), Game.id.asc())
        )
    )

    series: dict[tuple[str | None, str | None], list[dict[str, Any]]] = {}
    volume: dict[str, dict[str, int]] = {"source": {}, "speed": {}, "platform": {}, "year": {}}
    counts = {WIN: 0, DRAW: 0, LOSS: 0}
    per_account: dict[int, dict[str, Any]] = {}
    first: datetime | None = None
    last: datetime | None = None

    for game in games:
        platform = platform_of(game, accounts)
        speed = str(game.speed) if game.speed else None
        _bump(volume["source"], str(game.source))
        _bump(volume["speed"], speed or "unknown")
        _bump(volume["platform"], platform or "unknown")
        if game.played_at is not None:
            _bump(volume["year"], str(game.played_at.year))
            first = game.played_at if first is None else min(first, game.played_at)
            last = game.played_at if last is None else max(last, game.played_at)
        outcome = outcome_of(game)
        if outcome is not None:
            counts[outcome] += 1

        rating = owner_rating(game)
        if rating is not None and game.played_at is not None:
            series.setdefault((platform, speed), []).append(
                {"at": _stamp(game.played_at), "rating": rating, "game_id": game.id}
            )

        account_id = (
            game.white_account_id if game.owner_color == Color.WHITE else game.black_account_id
        )
        if account_id is not None:
            entry = per_account.setdefault(account_id, {"games": 0, "first": None, "last": None})
            entry["games"] += 1
            if game.played_at is not None:
                entry["first"] = min(entry["first"] or game.played_at, game.played_at)
                entry["last"] = max(entry["last"] or game.played_at, game.played_at)

    ratings = []
    for (platform, speed), points in sorted(
        series.items(), key=lambda item: (item[0][0] or "", item[0][1] or "")
    ):
        values = [point["rating"] for point in points]
        ratings.append(
            {
                "platform": platform,
                "speed": speed,
                "games": len(points),
                "current": values[-1],
                "min": min(values),
                "max": max(values),
                "points": _downsample(points, max_points),
            }
        )

    played = len(games)
    return {
        "accounts": [
            {
                "id": account.id,
                "platform": str(account.platform),
                "username": account.username,
                "display_name": account.display_name,
                "is_owner": account.is_owner,
                "games": per_account.get(account.id, {}).get("games", 0),
                "first_game": _stamp(per_account.get(account.id, {}).get("first")),
                "last_game": _stamp(per_account.get(account.id, {}).get("last")),
            }
            for account in accounts.values()
        ],
        "ratings": ratings,
        "volume": {
            "games": played,
            "wins": counts[WIN],
            "draws": counts[DRAW],
            "losses": counts[LOSS],
            "score": _ratio(counts[WIN] + 0.5 * counts[DRAW], played),
            "first_game": _stamp(first),
            "last_game": _stamp(last),
            "by_source": dict(sorted(volume["source"].items())),
            "by_speed": dict(sorted(volume["speed"].items())),
            "by_platform": dict(sorted(volume["platform"].items())),
            "by_year": dict(sorted(volume["year"].items())),
        },
    }


def _has_classification(classification: Classification) -> ColumnElement[bool]:
    return exists(
        select(MoveEval.id)
        .join(AnalysisRun, MoveEval.run_id == AnalysisRun.id)
        .where(
            AnalysisRun.game_id == Game.id,
            AnalysisRun.status == RunStatus.DONE,
            MoveEval.classification == classification,
            owner_move_condition(),
        )
        .correlate(Game)
    )


def _has_done_run() -> ColumnElement[bool]:
    return exists(
        select(AnalysisRun.id)
        .where(AnalysisRun.game_id == Game.id, AnalysisRun.status == RunStatus.DONE)
        .correlate(Game)
    )


def _has_deep_run() -> ColumnElement[bool]:
    return exists(
        select(AnalysisRun.id)
        .where(
            AnalysisRun.game_id == Game.id,
            AnalysisRun.tier == Tier.DEEP,
            AnalysisRun.status == RunStatus.DONE,
        )
        .correlate(Game)
    )


def _opponent_condition(name: str) -> ColumnElement[bool]:
    """Whoever was on the other side of the board — either name when there is no owner."""
    return or_(
        and_(Game.owner_color == Color.WHITE, _contains(Game.black_name, name)),
        and_(Game.owner_color == Color.BLACK, _contains(Game.white_name, name)),
        and_(
            Game.owner_color.is_(None),
            or_(_contains(Game.white_name, name), _contains(Game.black_name, name)),
        ),
    )


def _text_condition(text: str) -> ColumnElement[bool]:
    """Free text over the metadata a game is actually looked up by.

    Deliberately not over the raw PGN: a substring scan of every game's moves is the one
    query on this table that does not stay cheap, and the move list is what the explorer
    and the position index are for.
    """
    return or_(
        _contains(Game.white_name, text),
        _contains(Game.black_name, text),
        _contains(Game.opening_name, text),
        _contains(Game.eco, text),
        _contains(Game.termination, text),
    )


def _contains(column: ColumnElement[str | None], value: str) -> ColumnElement[bool]:
    return column.ilike(f"%{_escape_like(value)}%", escape="\\")


def _starts_with(column: ColumnElement[str | None], value: str) -> ColumnElement[bool]:
    return column.ilike(f"{_escape_like(value)}%", escape="\\")


def _escape_like(value: str) -> str:
    return value.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _ply_bounds(game: Game, ply_range: tuple[int, int] | None) -> tuple[int, int]:
    if ply_range is None:
        return 0, max(game.ply_count - 1, 0)
    start, end = ply_range
    return max(start, 0), max(end, 0)


def _is_owner_ply(game: Game, ply: int) -> bool:
    if game.owner_color is None:
        return True
    return (ply % 2 == 0) == (game.owner_color == Color.WHITE)


def _move_row(
    game: Game, ply: int, row: MoveEval | None, maia: dict[str, Any] | None
) -> dict[str, Any]:
    san = game.moves_san[ply] if ply < len(game.moves_san) else None
    uci = game.moves_uci[ply] if ply < len(game.moves_uci) else None
    clocks = game.clocks or []
    move: dict[str, Any] = {
        "ply": ply,
        "move_number": ply // 2 + 1,
        "color": str(Color.WHITE if ply % 2 == 0 else Color.BLACK),
        "san": san,
        "uci": uci,
        "clock": clocks[ply] if ply < len(clocks) else None,
        "by_owner": _is_owner_ply(game, ply) if game.owner_color is not None else None,
    }
    if row is not None:
        move.update(
            {
                "eval_before_cp": row.eval_before_cp,
                "eval_before_mate": row.eval_before_mate,
                "eval_after_cp": row.eval_after_cp,
                "eval_after_mate": row.eval_after_mate,
                "win_before": row.win_before,
                "win_after": row.win_after,
                "win_loss": row.win_loss,
                "classification": str(row.classification) if row.classification else None,
                "best_move_uci": row.best_move_uci,
                "best_lines": row.best_lines,
                "run_id": row.run_id,
            }
        )
    if maia:
        move["maia"] = maia
    return _compact(move)


def _moment_row(game: Game, row: MoveEval) -> dict[str, Any]:
    san = game.moves_san[row.ply] if row.ply < len(game.moves_san) else row.move_san
    return _compact(
        {
            "ply": row.ply,
            "move_number": row.ply // 2 + 1,
            "san": san,
            "uci": row.move_uci,
            "win_loss": row.win_loss,
            "classification": str(row.classification) if row.classification else None,
            "best_move_uci": row.best_move_uci,
        }
    )


def _run_summary(run: AnalysisRun) -> dict[str, Any]:
    engine = run.engine
    return _compact(
        {
            "id": run.id,
            "tier": str(run.tier),
            # None rather than False, so `_compact` leaves the key off every ordinary
            # pass: a run that searched is the reader's default, a fill is what is said.
            "maia_only": True if run.maia_only else None,
            "status": str(run.status),
            "engine": engine.name if engine is not None else None,
            "engine_kind": str(engine.kind) if engine is not None else None,
            "depth": run.depth,
            "nodes": run.nodes,
            "multipv": run.multipv,
            "ply_start": run.ply_start,
            "ply_end": run.ply_end,
            "finished_at": _stamp(run.finished_at),
        }
    )


def _note_row(note: Note, *, scope: str, ply: int | None) -> dict[str, Any]:
    return _compact(
        {
            "id": note.id,
            "text": note.text,
            "tags": list(note.tags or ()),
            "scope": scope,
            "ply": ply,
            "line_id": note.line_id,
            "source": str(note.source),
            "created_at": _stamp(note.created_at),
            "updated_at": _stamp(note.updated_at),
        }
    )


def _downsample(points: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    """Thin a series to roughly `limit` points without starving recent history.

    Every point within the last `PROFILE_RECENT_WINDOW_DAYS` days before the series'
    *last* point is kept untouched, however dense that stretch is. The older prefix is
    uniformly thinned into whatever budget remains, with a floor of
    `PROFILE_MIN_OLD_POINTS` so ancient history never fully disappears -- which can push
    the result a little past `limit`. If the recent window alone exceeds `limit`, it is
    kept in full anyway: recent fidelity wins over the cap. The first and last points of
    the whole series are always kept, and the result stays chronologically sorted.
    """
    if limit <= 0 or len(points) <= limit:
        return points

    cutoff = datetime.fromisoformat(points[-1]["at"]) - timedelta(days=PROFILE_RECENT_WINDOW_DAYS)
    split = next(
        (
            index
            for index, point in enumerate(points)
            if datetime.fromisoformat(point["at"]) >= cutoff
        ),
        len(points),
    )
    old, recent = points[:split], points[split:]
    if len(recent) >= limit:
        return recent

    old_budget = min(max(PROFILE_MIN_OLD_POINTS, limit - len(recent)), len(old))
    return _uniform_downsample(old, old_budget) + recent


def _uniform_downsample(points: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    """Thin a series to at most `limit` points, always keeping the first and the last."""
    if limit <= 0 or len(points) <= limit:
        return points
    step = len(points) / limit
    kept = [points[int(index * step)] for index in range(limit - 1)]
    kept.append(points[-1])
    return kept


def _bump(counter: dict[str, int], key: str) -> None:
    counter[key] = counter.get(key, 0) + 1


def _ratio(numerator: float, denominator: float) -> float | None:
    if not denominator:
        return None
    return round(numerator / denominator, 4)


def _stamp(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _compact(payload: dict[str, Any]) -> dict[str, Any]:
    """Drop the keys that carry nothing: every one of these payloads is read by a model."""
    return {key: value for key, value in payload.items() if value is not None}
