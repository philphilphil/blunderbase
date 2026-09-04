from __future__ import annotations

from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import (
    ColumnElement,
    Delete,
    Select,
    UnaryExpression,
    and_,
    case,
    delete,
    exists,
    func,
    or_,
    select,
)
from sqlalchemy.orm import Session, joinedload

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
    DeletedGame,
    Game,
    GamePosition,
    ImportJob,
    Line,
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
    Source.FICS: Platform.FICS,
}

# A deep pass is the better answer wherever it reaches; a quick pass fills in the rest.
TIER_RANK: dict[Tier, int] = {Tier.QUICK: 0, Tier.DEEP: 1}

# How the games table may be ordered, and the order it takes when nothing says otherwise.
# The expressions themselves are `GAME_ORDERS`, below the helpers they are built from.
SORT_DIRECTIONS = ("asc", "desc")
DEFAULT_ORDER = "played_at"
DEFAULT_DIRECTION = "desc"

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

# How many game ids one delete statement names. SQLite compiles an `IN` list into one bound
# parameter apiece and has a ceiling on those, so a caller with a long list is served by
# several statements rather than by one that would not compile.
DELETE_CHUNK = 500

# How deep into a game its shipped book looks. `explorer.MAX_BOOK_DEPTH` gives up at 40
# plies from the start and the deepest line two of the owner's games ever shared on a real
# 9.5k library was ply 18, so thirty is headroom over anything a repertoire reaches while
# still bounding what one game asks about to thirty positions.
BOOK_MAX_PLY = 30

# Continuations kept per ply. The panel that reads them is a four-column strip a few rows
# tall; the whole tree is the explorer page's job, and it is one click away.
BOOK_MAX_MOVES = 6


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
    # A set rather than one value: "blitz and rapid" is the ordinary question, and the
    # Stats page asks it by leaving speeds out. An empty tuple is not a filter — it would
    # match no game at all — and is treated as None; a game whose speed was never parsed
    # falls outside any set, which is what naming speeds means.
    speeds: tuple[Speed, ...] | None = None
    time_control: str | None = None
    opponent: str | None = None
    variant: str | None = None
    has_blunders: bool | None = None
    analyzed: bool | None = None
    deep_analyzed: bool | None = None
    text: str | None = None
    # Whose games: True is the owner's own (the default everywhere, which is what keeps a
    # game added from the reference books out of every statistic without each one having
    # to remember), False is only those, None is both.
    mine: bool | None = True


def search_games(
    session: Session,
    filters: GameFilters,
    limit: int = 50,
    offset: int = 0,
    order: str = DEFAULT_ORDER,
    direction: str = DEFAULT_DIRECTION,
) -> list[Game]:
    """Games matching `filters`, newest first unless another order is asked for."""
    statement = select(Game).where(*game_conditions(filters))
    statement = statement.order_by(*order_clauses(order, direction))
    return list(session.scalars(statement.limit(limit).offset(offset)))


def order_clauses(order: str, direction: str) -> list[UnaryExpression[Any]]:
    """One sortable column as ORDER BY, with the tiebreak that makes paging stable.

    Rows with nothing in the sorted column sink to the bottom whichever way the column
    points: an unanalysed game is not "the least bad". `id` breaks every tie, so two games
    with the same opponent cannot swap places between page 2 and page 3 — an order without
    a total tiebreak is an order that shows a row twice and hides another.
    """
    build = GAME_ORDERS.get(order)
    if build is None:
        raise ValueError(f"unknown order {order!r}; known orders: {', '.join(GAME_ORDERS)}")
    if direction not in SORT_DIRECTIONS:
        raise ValueError(
            f"unknown direction {direction!r}; known directions: {', '.join(SORT_DIRECTIONS)}"
        )
    column = build()
    sorted_column = column.desc() if direction == "desc" else column.asc()
    return [sorted_column.nulls_last(), Game.id.desc()]


def _opponent_column(white: Any, black: Any) -> ColumnElement[Any]:
    """Whichever of a pair of columns belongs to the opponent, by the owner's colour.

    NULL for a game no account of theirs played in, the way `opponent_name` answers None.
    """
    return case(
        (Game.owner_color == Color.WHITE, black),
        (Game.owner_color == Color.BLACK, white),
    )


def _outcome_column() -> ColumnElement[Any]:
    """The owner's result as the table shows it, falling back to the PGN result.

    Built out of `outcome_condition` rather than beside it, so the order and the `outcome`
    filter can never disagree about what a win is.
    """
    return func.coalesce(
        case(
            (outcome_condition(WIN), WIN),
            (outcome_condition(LOSS), LOSS),
            (outcome_condition(DRAW), DRAW),
        ),
        Game.result,
    )


def _tier_column() -> ColumnElement[Any]:
    """Unanalysed < quick < deep, the rank the table's tier badge sorts by."""
    return case((_has_deep_run(), 2), (_has_done_run(), 1), else_=0)


# The orders `/games` will return, keyed the way the table's columns are named.
#
# Every one of them sorts on the value the cell shows rather than on a near neighbour of
# it: `result` reads the outcome with the raw result behind it exactly as the cell falls
# back, and `worst` reads the same stored card the `Worst` column reads rather than
# `stat_worst_win_loss`, which is the worst *blunder* of the primary run and so a different
# number for a game whose worst moment was a mistake. A game analysed before the card
# column existed has no stored card to read and sorts as though it had nothing — the same
# games `rebuild_game_cards` exists to catch up.
GAME_ORDERS: dict[str, Callable[[], ColumnElement[Any]]] = {
    "played_at": lambda: Game.played_at,
    "opponent": lambda: func.lower(_opponent_column(Game.white_name, Game.black_name)),
    "opponent_rating": lambda: _opponent_column(Game.white_rating, Game.black_rating),
    "color": lambda: Game.owner_color,
    # The two sides as the table now shows them — a game added from the reference books
    # has no opponent, so the library lists both players and sorts by either.
    "white": lambda: func.lower(Game.white_name),
    "white_rating": lambda: Game.white_rating,
    "black": lambda: func.lower(Game.black_name),
    "black_rating": lambda: Game.black_rating,
    "opening": lambda: func.lower(func.coalesce(Game.opening_name, Game.eco)),
    "result": _outcome_column,
    "time_control": lambda: func.coalesce(Game.time_control, Game.speed),
    "ply_count": lambda: Game.ply_count,
    "worst": lambda: Game.card["worst_moments"][0]["win_loss"].as_float(),
    "source": lambda: Game.source,
    "tier": _tier_column,
}


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


@dataclass(slots=True)
class Deleted:
    """What `delete_games` removed, in rows, and how many it wrote down as deleted."""

    games: int = 0
    runs: int = 0
    notes: int = 0
    lines: int = 0
    remembered: int = 0


def delete_games(session: Session, game_ids: Sequence[int]) -> Deleted:
    """Delete some games and everything that only exists because of them.

    The same child-first order `delete_all_games` spells out, and for the same three
    reasons, narrowed to a set of ids: a queued run goes before the game it names, the
    counts are what the statements actually took rather than a guess, and nothing here
    depends on the foreign keys being enforced.

    Three differences from the wipe, all deliberate. Every game deleted here leaves a
    `deleted_games` row behind, so an import cannot store it again without the owner saying
    so first — see `record_deletions`. The sync history stays: an owner who deleted forty
    games did not ask for the next sync of that source to start over, and
    `import_service.latest_cursor` is what would send it there. And the explorer's fold is
    marked dirty for these games' positions only, which has to happen while the
    `game_positions` rows that name them are still there to be read.

    A note about a position rather than about one of these games stays, as it does in a
    wipe. A kept line belongs to the game it branches off and goes with it; a note that
    named that line but not the game survives with its `line_id` cleared, which is what
    that foreign key is `SET NULL` for.
    """
    from backend.services import explorer as explorer_service

    deleted = Deleted()
    ids = _unique_ids(game_ids)
    if not ids:
        return deleted
    for chunk in _id_chunks(ids):
        # Only the ids that are really there, so the counts describe this call rather than
        # what it was asked about, and so an unknown id is a no-op rather than a refusal.
        present = list(session.scalars(select(Game.id).where(Game.id.in_(chunk))))
        if not present:
            continue
        deleted.remembered += record_deletions(session, present)
        explorer_service.mark_games_dirty(session, present)
        of_these = select(AnalysisRun.id).where(AnalysisRun.game_id.in_(present))
        _deleted(session, delete(MoveEval).where(MoveEval.run_id.in_(of_these)))
        deleted.runs += _deleted(
            session, delete(AnalysisRun).where(AnalysisRun.game_id.in_(present))
        )
        deleted.notes += _deleted(session, delete(Note).where(Note.game_id.in_(present)))
        deleted.lines += _deleted(session, delete(Line).where(Line.game_id.in_(present)))
        _deleted(session, delete(GamePosition).where(GamePosition.game_id.in_(present)))
        deleted.games += _deleted(session, delete(Game).where(Game.id.in_(present)))
    session.commit()
    # A bulk delete does not tell the identity map what it took, so a caller that goes on
    # using this Session — a CLI, a test, anything that is not one request — would keep
    # reading the games, notes and lines it has just deleted out of memory. A request-scoped
    # session is about to be closed and does not care either way.
    session.expunge_all()
    return deleted


# --- what an import may not bring back ------------------------------------
#
# A deleted game leaves nothing behind for the importer's duplicate lookup to find, so
# `deleted_games` is what stands in for it. The three functions below are the whole of it:
# one writes the rows, one is what the importer asks, and one is the owner taking it back.


def record_deletions(session: Session, game_ids: Sequence[int]) -> int:
    """Write down the games about to be deleted; how many rows were added.

    Uncommitted, like the rest of `delete_games`: the tombstone and the delete are one
    change, and a reader must never find a library that has lost the game and not yet
    remembered losing it.

    A game already written down — deleted, imported again on purpose, deleted again —
    is not written twice, so the list the owner reads is a list of games rather than a
    list of clicks.
    """
    rows = session.execute(
        select(
            Game.source,
            Game.source_id,
            Game.dedup_hash,
            Game.white_name,
            Game.black_name,
            Game.played_at,
        ).where(Game.id.in_(game_ids))
    ).all()
    written = 0
    for source, source_id, digest, white, black, played_at in rows:
        if identify(session, source, source_id, digest).deleted is not None:
            continue
        session.add(
            DeletedGame(
                source=source,
                source_id=source_id,
                dedup_hash=digest,
                white_name=white,
                black_name=black,
                played_at=played_at,
            )
        )
        # Flushed as it goes, so two identical games in one selection are one row.
        session.flush()
        written += 1
    return written


@dataclass(slots=True)
class Identity:
    """What the library already knows about a game that is arriving.

    Three answers, and exactly one of them is true of any game: it is already stored
    (`game`), it was deleted on purpose (`deleted`), or the library has never seen it.
    A stored game wins over a record of a deleted one — a game that is here is here,
    whatever was once thrown away that looks like it.
    """

    game: Game | None = None
    deleted: DeletedGame | None = None

    @property
    def known(self) -> bool:
        return self.game is not None or self.deleted is not None


def identify(
    session: Session, source: Source, source_id: str | None, digest: str
) -> Identity:
    """Does the library know this game — as a game it has, or as one it threw away?

    One function over both tables because it is one question, asked once per game arriving,
    and because the rule that answers it is subtle enough that two copies of it would drift:

    * The source's own ID is the identity where the source names one. A game *this* source
      names differently is a different game however identical it looks — two bullet
      rematches of the same short trap line share every scrap of the hash's material, and
      swallowing the second would lose it for good.
    * The content hash (moves + day + both names) is the fallback for a game that arrives
      by a route with no ID of its own: a PGN export of an already-synced Lichess game
      keeps all three even though its source and its source ID change. That fallback
      deliberately does not match a row this same source named, for the reason above.

    Which is why deleting a game and re-importing its PGN is refused: `deleted_games` is
    matched on exactly the terms `games` is, so the tombstone stands in for the row that is
    gone (`db.models.DeletedGame`).

    At most two statements, and one whenever the game is already stored — which is the case
    on every sync that re-reads an archive it has read before. The exact-ID match is
    preferred inside the statement rather than by asking for it first.
    """
    stored = session.scalars(_identity_query(Game, source, source_id, digest)).first()
    if stored is not None:
        return Identity(game=stored)
    gone = session.scalars(_identity_query(DeletedGame, source, source_id, digest)).first()
    return Identity(deleted=gone)


_IdentityTable = type[Game] | type[DeletedGame]


def _identity_query(
    table: _IdentityTable, source: Source, source_id: str | None, digest: str
) -> Select[Any]:
    """`identify`'s rule as one statement over whichever of the two tables is asked."""
    by_hash = table.dedup_hash == digest
    if not source_id:
        return select(table).where(by_hash).order_by(table.id)
    named = and_(table.source == source, table.source_id == source_id)
    return (
        select(table)
        .where(or_(named, and_(by_hash, or_(table.source != source, table.source_id.is_(None)))))
        # The row this source named is the answer whenever there is one; the hash is what
        # the rest is ranked by, and `id` only keeps the order from being arbitrary.
        .order_by(case((named, 0), else_=1), table.id)
    )


def list_deletions(
    session: Session, limit: int = 50, offset: int = 0
) -> tuple[list[DeletedGame], int]:
    """The games an import is currently refusing, newest deletion first, and how many."""
    rows = list(
        session.scalars(
            select(DeletedGame)
            .order_by(DeletedGame.deleted_at.desc(), DeletedGame.id.desc())
            .limit(limit)
            .offset(offset)
        )
    )
    total = int(session.scalar(select(func.count(DeletedGame.id))) or 0)
    return rows, total


def forget_deletions(session: Session, ids: Sequence[int] | None = None) -> int:
    """Forget some deletions, or all of them; how many records went.

    This is the undo, and it undoes nothing by itself: the game does not come back, the
    refusal does. Whatever imports that game next — the source's next sync, a PGN dropped
    on the page — stores it again as a new game, with no analysis and no notes, because
    those went with the original.
    """
    forgotten = 0
    if ids is None:
        forgotten = _deleted(session, delete(DeletedGame))
    else:
        wanted = _unique_ids(ids)
        if not wanted:
            return 0
        for chunk in _id_chunks(wanted):
            forgotten += _deleted(session, delete(DeletedGame).where(DeletedGame.id.in_(chunk)))
    session.commit()
    # The bulk delete does not tell the identity map what it took, and SQLite hands the
    # freed primary keys straight back out: a caller that goes on using this Session would
    # otherwise find the next deletion it writes colliding with a record that is gone.
    session.expunge_all()
    return forgotten


def _unique_ids(game_ids: Iterable[int]) -> list[int]:
    """The ids asked for, once each, in the order they were given."""
    return list(dict.fromkeys(int(game_id) for game_id in game_ids))


def _id_chunks(ids: list[int]) -> list[list[int]]:
    """The ids as IN-sized batches: SQLite has a ceiling on bound parameters."""
    return [ids[start : start + DELETE_CHUNK] for start in range(0, len(ids), DELETE_CHUNK)]


def delete_all_games(session: Session) -> Wiped:
    """Empty the library: every game, and everything that only exists because of one.

    The schema already cascades — `game_positions`, `analysis_runs` and a game's notes name
    `ondelete="CASCADE"`, and `move_evals` follow their run — but the deletes are spelled
    out child-first anyway. It is what makes the counts real rather than guessed, it is what
    a database whose foreign keys are not enforced needs, and it is the order that drops a
    queued run *before* its game rather than trusting a worker not to claim it in between.

    Nothing here is written into `deleted_games`, unlike `delete_games`: a reset means
    starting over, and a library's worth of tombstones would block the re-import that
    follows it. The records an earlier delete left behind survive the wipe, though — they
    are about games, and this is about the library.

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
    # Imported here rather than at the top because `services.explorer` imports this module:
    # the explorer is built on what a game and an outcome mean, and this is the one write
    # that has to reach back the other way.
    from backend.services import explorer as explorer_service

    wiped = Wiped()
    # Before the join rows go, because it is those rows that say which positions a game
    # touched. Every game is going, so every position's fold is wrong.
    explorer_service.discard_position_books(session)
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
    if filters.speeds:
        conditions.append(Game.speed.in_(filters.speeds))
    if filters.time_control:
        conditions.append(Game.time_control == filters.time_control)
    if filters.variant:
        conditions.append(func.lower(Game.variant) == filters.variant.strip().casefold())
    if filters.opponent:
        conditions.append(_opponent_condition(filters.opponent))
    if filters.has_blunders is not None:
        blunders = _has_classification(Classification.BLUNDER)
        conditions.append(blunders if filters.has_blunders else ~blunders)
    if filters.analyzed is not None:
        done = _has_done_run()
        conditions.append(done if filters.analyzed else ~done)
    if filters.deep_analyzed is not None:
        deep = _has_deep_run()
        conditions.append(deep if filters.deep_analyzed else ~deep)
    if filters.text:
        conditions.append(_text_condition(filters.text))
    if filters.mine is not None:
        conditions.append(Game.is_owner_game.is_(filters.mine))
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
    is the only honest answer when there is no "you" to filter by — unless the game is
    known not to be theirs at all (a reference game kept for study), which contributes
    none: there the honest answer is that nothing in it was their move.
    """
    return or_(
        and_(Game.owner_color == Color.WHITE, MoveEval.ply % 2 == 0),
        and_(Game.owner_color == Color.BLACK, MoveEval.ply % 2 == 1),
        and_(Game.owner_color.is_(None), Game.is_owner_game.is_(True)),
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
    include_book: bool = True,
) -> dict[str, Any] | None:
    """One game as the coach reads it: moves, evals, Maia predictions, notes and book.

    Every ply carries the eval of the newest run that reaches it, a deep run beating a
    quick one for the plies it covers, so a deep pass over the endgame shows up as deep
    evals for the endgame and quick evals everywhere else. Maia's policy is merged the
    same way but separately, because it usually arrives from a run of its own.

    `book` is the explorer's answer for the positions this game stood in, keyed by ply and
    carried *with* the game rather than fetched as the reader steps through it — see
    `game_book` for why that direction, and for why most games carry only a handful of keys.
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
    if include_book:
        detail["book"] = game_book(session, game_id, ply_range=ply_range)
    if include_notes:
        detail["notes"] = game_notes(session, game_id)
    return detail


def game_book(
    session: Session, game_id: int, *, ply_range: tuple[int, int] | None = None
) -> dict[int, dict[str, Any]]:
    """The owner's own book along one game: ply -> the tree of the position *before* it.

    Keyed by ply and shipped with the game on purpose. The alternative — a request per
    position as the reader steps — is a fetch per keystroke, which is the exact shape that
    took the server down once already (the stampede in `docs`' meltdown history), and it
    would refetch the same dozen answers every time somebody walked back and forth through
    an opening. Shipping them costs almost nothing because there are almost never many:
    `0017_explorer_book`'s own figure is that 452k of 463k positions in a real library are
    reached by exactly one game, and a position one game reached is not book, so a game
    carries entries for its opening and nothing after it.

    Two caps keep the work bounded whatever the game. Only plies up to `BOOK_MAX_PLY` are
    even looked at — `explorer.book_walk` gives up at 40 plies from the start and on a real
    library the deepest line two games ever shared was ply 18, so past thirty there is
    nothing to find and asking is pure cost. And each entry keeps `BOOK_MAX_MOVES`
    continuations, which is what the panel can draw; the explorer page is where the whole
    tree lives.

    The gate is `explorer.position_books`: at least two of the owner's games reached the
    position. Everything below that produces no key at all rather than an empty one, so a
    game whose positions are all singletons costs the three statements that establish
    exactly that — its plies, their positions, and how many games reached them — and adds
    nothing to the payload.

    Unfiltered by colour, like the explorer's own default view: "have I been here before"
    is a question about the owner's whole library, and the position's side to move already
    says whose choice a continuation was.

    A window narrows the book to it, one ply wider at the top end: the moves `ply_range`
    asks for run `start`..`end`, but the board can stand on the position *after* the last
    of them, and that position is book like any other.
    """
    # Imported inside the call: `services.explorer` builds its trees out of this module's
    # outcome and summary helpers, so the two can only meet here, the way `explorer` itself
    # reaches `services.notes`.
    from backend.services import explorer as explorer_service

    start, end = 0, BOOK_MAX_PLY
    if ply_range is not None:
        start = max(ply_range[0], 0)
        end = min(max(ply_range[1], 0) + 1, BOOK_MAX_PLY)
    if start > end:
        return {}

    rows = session.execute(
        select(GamePosition.ply, GamePosition.position_id).where(
            GamePosition.game_id == game_id,
            GamePosition.ply >= start,
            GamePosition.ply <= end,
        )
    ).all()
    if not rows:
        return {}

    books = explorer_service.position_books(
        session, [position_id for _ply, position_id in rows], limit=BOOK_MAX_MOVES
    )
    # A game that repeats a position gets the same entry under both plies, which is what a
    # reader stepping through it should see: the tree belongs to the position, not the ply.
    return {ply: books[position_id] for ply, position_id in rows if position_id in books}


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

    A `position` note is somebody's thinking about a board this game happened to arrive at,
    written somewhere else — in another game, or in the explorer on a position nobody had
    played yet. Those rows carry where they came from (`game_id`, a `game` brief and the
    `move` it was written on) because the panel has to say so: unattributed advice appearing
    under a game the reader is working through reads as advice about *this* game, and for a
    note made on somebody else's moves that is simply false.
    """
    # Imported here rather than at the top: `explorer` imports this module, and `notes`
    # imports `explorer`, so a module-level import would close the ring.
    from backend.services import notes as notes_service

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
        # The game each of these was written on is read for every row, so it is joined in
        # rather than lazy-loaded one note at a time.
        .options(joinedload(Note.game), joinedload(Note.line))
        .group_by(Note.id)
    )
    for note, reached in session.execute(attached):
        # `reached` and not `note.ply`: the query above excludes this game's own notes, so
        # the note's ply counts half-moves into *another* game and says nothing about where
        # this one arrived. Same-game notes carry their own ply, from the loop above.
        row = _note_row(note, scope="position", ply=reached)
        row["game_id"] = note.game_id
        if note.game is not None:
            row["game"] = notes_service.game_brief(note.game)
            row["move"] = notes_service.note_move(note)
        rows.append(_compact(row))

    rows.sort(key=lambda row: row["created_at"], reverse=True)
    return rows


def get_last_games(
    session: Session, amount: int = 5, source: Source | None = None, speed: Speed | None = None
) -> list[Game]:
    """The newest games, the way the coach is usually asked for them."""
    return search_games(
        session,
        GameFilters(source=source, speeds=(speed,) if speed is not None else None),
        limit=max(amount, 0),
    )


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


def refresh_cards(session: Session, game_ids: Sequence[int]) -> int:
    """Refold the stored cards of these games; how many were rewritten.

    For the other writer that changes what a card says — `accounts.reconcile_games`,
    learning whose side of a game is whose, which is what decides the plies `build_card` is
    allowed to call the owner's worst moments. A card folded while the owner was unknown
    kept every ply and so lists the opponent's blunders as theirs, and unlike the stat
    summaries beside it there is no sweep that would notice: `rebuild_game_cards` is a
    command somebody has to run. So it is refolded here, in the transaction that recoloured
    the games, and the commit is left to that caller.

    A game with no stored card is left alone. NULL is what `game_card` folds live, so it
    already answers with the colour the row has now, and writing one here would only make
    the repair walk the evals of games nothing has asked about.
    """
    rebuilt = 0
    for game_id in game_ids:
        game = session.get(Game, game_id)
        if game is None or game.card is None:
            continue
        refresh_card(session, game)
        rebuilt += 1
    return rebuilt


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
            "is_owner_game": game.is_owner_game,
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


@dataclass(slots=True)
class ProfileRow:
    """One of the owner's games, reduced to what the profile actually reads."""

    id: int
    played_at: datetime | None
    source: Source
    speed: Speed | None
    result: Result
    owner_color: Color | None
    white_rating: int | None
    black_rating: int | None
    white_account_id: int | None
    black_account_id: int | None

    @property
    def account_id(self) -> int | None:
        """The account on the owner's side of the board, where a row names one."""
        return self.white_account_id if self.owner_color == Color.WHITE else self.black_account_id

    @property
    def rating(self) -> int | None:
        """The owner's rating in this game — `owner_rating` off the same two columns."""
        if self.owner_color == Color.WHITE:
            return self.white_rating
        if self.owner_color == Color.BLACK:
            return self.black_rating
        return None


def platform_of(row: ProfileRow, accounts: dict[int, Account]) -> str | None:
    """Where a game was played: the owner's account if one claims it, else its source."""
    account = accounts.get(row.account_id) if row.account_id is not None else None
    if account is not None:
        return str(account.platform)
    platform = PLATFORM_FOR_SOURCE.get(row.source)
    return str(platform) if platform is not None else None


def get_player_profile(
    session: Session, *, max_points: int = PROFILE_MAX_POINTS
) -> dict[str, Any]:
    """Ratings over time per platform, volume and platforms for the owner's accounts.

    Rating series are per platform *and* speed, because a bullet rating and a classical
    rating on the same site are two different numbers and averaging them says nothing.

    This is the one read that walks the *whole* library, so it selects the ten columns it
    adds up rather than hydrating games: a `select(Game)` would parse every one of their
    PGNs, cards and stat summaries to count a rating and a result, which on a library of a
    few thousand games is seconds of a worker thread the rest of the app is queueing for.
    """
    accounts = {
        account.id: account for account in session.scalars(select(Account).order_by(Account.id))
    }
    statement = (
        select(
            Game.id,
            Game.played_at,
            Game.source,
            Game.speed,
            Game.result,
            Game.owner_color,
            Game.white_rating,
            Game.black_rating,
            Game.white_account_id,
            Game.black_account_id,
        )
        .where(Game.owner_color.is_not(None))
        .order_by(Game.played_at.asc().nulls_last(), Game.id.asc())
    )
    games = [
        ProfileRow(
            id=row.id,
            played_at=row.played_at,
            source=row.source,
            speed=row.speed,
            result=row.result,
            owner_color=row.owner_color,
            white_rating=row.white_rating,
            black_rating=row.black_rating,
            white_account_id=row.white_account_id,
            black_account_id=row.black_account_id,
        )
        for row in session.execute(statement)
    ]

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
        outcome = outcome_from(game.owner_color, game.result)
        if outcome is not None:
            counts[outcome] += 1

        rating = game.rating
        if rating is not None and game.played_at is not None:
            series.setdefault((platform, speed), []).append(
                {"at": _stamp(game.played_at), "rating": rating, "game_id": game.id}
            )

        account_id = game.account_id
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
