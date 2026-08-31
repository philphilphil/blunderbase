from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, NamedTuple

from sqlalchemy import ColumnElement, Select, and_, case, delete, func, or_, select, update
from sqlalchemy.orm import Session, aliased
from sqlalchemy.sql import Alias, Join, Subquery

from backend.adapters import openings
from backend.db.enums import Color, RunStatus
from backend.db.models import (
    AnalysisRun,
    Game,
    GamePosition,
    MoveEval,
    Position,
    PositionMove,
    PositionTotal,
)
from backend.services.games import (
    DRAW,
    LOSS,
    TIER_RANK,
    WIN,
    game_summary,
    outcome_from,
    score_from,
)

# The same key `import_service` writes: piece placement, side to move, castling rights and
# a legal en-passant square, with the move counters deliberately dropped. Read a FEN
# through `normalize_fen` and never compare a caller's string to `positions.fen` directly.
START_EPD = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"

# SQLite's parameter limit is the tighter of the two back ends, and an ECO query narrows a
# candidate set that starts at "every game the owner has played under that code".
LOOKUP_CHUNK = 400

# How deep `book_walk` follows the owner's most-played continuation before giving up. A
# repertoire that is still unanimous 40 plies in is not a repertoire, it is one game.
MAX_BOOK_DEPTH = 40

# What it takes for a move to still count as "book": the owner played it more than once.
BOOK_MIN_GAMES = 2

# What `positions.book_state` means. Dirty is where every position starts and where every
# write that could change a fold puts it back; the sweep turns each one into built or cold
# and nothing else writes the column.
BOOK_DIRTY = 0
BOOK_BUILT = 1
BOOK_COLD = 2

# How many `game_positions` rows a position needs before it is worth a precomputed book.
# The distribution is the argument: on a real 9.5k-game library 452k of 463k positions are
# reached by exactly one game and fold live in microseconds, while a thousand-odd hot ones
# carry the entire cost of the explorer. Rows for the long tail would be a table the size
# of `game_positions` that saves nothing.
BOOK_MIN_OCCURRENCES = 10

# Positions settled per committed transaction by `rebuild_position_books`. Sized to fit one
# `IN` list, since that is how the chunk's counts and cold marks are written.
BOOK_BACKFILL_CHUNK = LOOKUP_CHUNK

# The aliases `_played_line` joins through, made once and shared by every statement it
# builds. Twenty-odd fresh `Table.alias()` calls cost ~2.5ms to assemble where the query
# they end up in runs in 0.1ms, so on a hot path building the aliases *is* the cost. Table
# aliases are immutable SQL constructs and nothing here mutates one; the same object in two
# statements is the same `AS anchor` in two pieces of SQL. Core aliases rather than ORM ones
# because this joins a chain of `FromClause`s, which an `aliased()` entity cannot be.
LINE_ANCHOR = GamePosition.__table__.alias("anchor")
_LINE_STEPS: dict[int, Alias] = {}


def _line_step(index: int) -> Alias:
    """The alias for the nth step back from the anchor, made on first use and kept."""
    step = _LINE_STEPS.get(index)
    if step is None:
        step = _LINE_STEPS[index] = GamePosition.__table__.alias(f"step{index}")
    return step


class Occurrence(NamedTuple):
    """One game passing through one position, with whatever the engine said about it."""

    game_id: int
    ply: int
    move_uci: str | None
    move_san: str | None
    owner_color: Color | None
    outcome: str | None
    played_at: datetime | None
    win_loss: float | None
    classification: str | None


class Continuation(NamedTuple):
    """One move out of a position for the book walk: how many games, and where it lands."""

    uci: str
    san: str | None
    games: int
    next_position_id: int | None


@dataclass(slots=True)
class MoveCounts:
    """One continuation's folded numbers, from either the stored book or a live fold.

    Every field is a sum or a maximum, which is what lets a colour-filtered read be one
    row and an unfiltered one be white's row merged with black's. The averages the payload
    carries are divisions of these and are never stored, because an average cannot merge.

    `games` through `occurrences` count every game that played the move; `owner_moves`,
    `evaluated`, `blunders` and `loss_sum` count only the occurrences where the owner was
    the one to move, so a continuation the opponent played is frequent but has no accuracy.
    """

    uci: str
    san: str | None = None
    games: int = 0
    wins: int = 0
    draws: int = 0
    losses: int = 0
    occurrences: int = 0
    owner_moves: int = 0
    evaluated: int = 0
    blunders: int = 0
    loss_sum: float = 0.0
    ply_sum: int = 0
    last_played: datetime | None = None

    def merge(self, other: MoveCounts) -> None:
        self.san = self.san or other.san
        self.games += other.games
        self.wins += other.wins
        self.draws += other.draws
        self.losses += other.losses
        self.occurrences += other.occurrences
        self.owner_moves += other.owner_moves
        self.evaluated += other.evaluated
        self.blunders += other.blunders
        self.loss_sum += other.loss_sum
        self.ply_sum += other.ply_sum
        if other.last_played is not None:
            self.last_played = (
                other.last_played
                if self.last_played is None
                else max(self.last_played, other.last_played)
            )


@dataclass(slots=True)
class TotalCounts:
    """A position's own folded numbers — every game through it, however it continued."""

    games: int = 0
    wins: int = 0
    draws: int = 0
    losses: int = 0
    ended_here: int = 0
    ply_counts: dict[int, int] = field(default_factory=dict)

    def merge(self, other: TotalCounts) -> None:
        self.games += other.games
        self.wins += other.wins
        self.draws += other.draws
        self.losses += other.losses
        self.ended_here += other.ended_here
        for ply, count in other.ply_counts.items():
            self.ply_counts[ply] = self.ply_counts.get(ply, 0) + count


def opening_explorer(
    session: Session,
    *,
    fen: str | None = None,
    eco: str | None = None,
    color: Color | None = None,
    limit: int = 20,
    min_games: int = 1,
    line: Sequence[str] | None = None,
) -> dict[str, Any]:
    """The owner's personal tree from one position: per continuation frequency, score,
    average eval drop, and where the owner leaves book.

    Entry is by FEN, by ECO, or by neither — the initial array. An ECO code names a set of
    games rather than a position, so its root is the deepest position all of those games
    share: walk from the start while they agree, stop where they diverge.

    `limit` caps how many continuations come back (0 for all of them) and `min_games`
    drops the ones played in fewer games than that. Neither touches the book walk, which
    always follows the whole tree — a one-off move is exactly what it is looking for.

    `line` is the UCI moves the caller reached this position by, and it names the opening
    and nothing else — which position the tree is about stays `fen` / `eco` / neither. It
    exists because the vendored book stops naming positions three to five plies in, so a
    position any deeper takes its name from an ancestor and only the path knows which one.
    Without a line the queried position is looked up alone, which is the ECO and MCP case.

    A hot position answers out of its precomputed book (`positions.book_state`); everything
    else — the long tail, a position the sweep has not settled, and any ECO query, whose
    root is narrowed to one code's games and so is not what the book counted — folds its
    join rows live. The two paths are the same fold and produce the same payload.
    """
    path: list[dict[str, Any]] = []
    if fen:
        position = find_position(session, fen)
        games: set[int] | None = None
    elif eco:
        position, games, path = eco_root(session, eco, color)
    else:
        position = find_position(session, START_EPD)
        games = None
    opening = _opening(position.fen if position is not None else fen, line)
    if position is None:
        return _empty(fen=fen, eco=eco, color=color, path=path, opening=opening)

    if games is None and position.book_state == BOOK_BUILT:
        moves, totals, ended, root_ply = _tree_from_book(
            session, position, color=color, min_games=min_games
        )
        if totals["games"] == 0:
            return _empty(
                fen=fen, eco=eco, color=color, path=path, position=position, opening=opening
            )
    else:
        occurrences = position_occurrences(session, position.id, color=color, game_ids=games)
        if not occurrences:
            return _empty(
                fen=fen, eco=eco, color=color, path=path, position=position, opening=opening
            )
        moves, totals, ended = _tree(occurrences, position.side_to_move, min_games=min_games)
        root_ply = _mode([occurrence.ply for occurrence in occurrences])

    sliced_moves = moves[: max(limit, 0)] if limit else moves
    _annotate_continuations(session, sliced_moves, position.fen)
    book = book_walk(session, position, color=color)
    return {
        "fen": position.fen,
        "eco": eco,
        "color": str(color) if color else None,
        "side_to_move": str(position.side_to_move),
        "path": path,
        "root_ply": root_ply,
        "opening": opening,
        "totals": {**totals, "ended_here": ended},
        "moves": sliced_moves,
        **book,
    }


def position_books(
    session: Session,
    position_ids: Iterable[int],
    *,
    color: Color | None = None,
    min_games: int = BOOK_MIN_GAMES,
    limit: int = 0,
) -> dict[int, dict[str, Any]]:
    """Several positions' trees at once, keyed by position — only the ones that repeat.

    The narrow entry point behind a game's shipped book (`services.games.game_book`), which
    wants one strip of continuations per ply rather than one page per position. It is the
    same fold `opening_explorer` runs, the stored book where a position has one and a live
    fold where it does not, minus everything that belongs to a *page*: no book walk, no
    opening names, no notes on each child. Those are what make a tree expensive — a walk is
    tens of queries — and a per-ply strip asks none of them.

    A position comes back only when at least `min_games` of the owner's games reached it,
    which is the same cut `book_walk` stops at: a move played once is not book. On a real
    library 452k of 463k positions are reached by exactly one game, so most of a game's
    plies produce no key at all, and a caller that finds none has paid for two queries.
    Continuations themselves are *not* cut that way — a position two games reached where
    they played different moves is precisely the "I have been here and improvised twice"
    the strip exists to show, and hiding both moves would leave it empty.

    Counting the games is deliberately not the fold: a built position's count is a column of
    `position_totals`, and everything else is counted in one grouped query over the join
    rows it is cold *because* it has few of. The fold then runs only for the handful of
    positions that earned it.

    `limit` caps the continuations per position (0 for all of them); they arrive most-played
    first, as everywhere else. Positions with no continuation at all — every game that stood
    there ended there — are left out rather than returned empty, because the panel that
    reads this draws nothing where there is no key.
    """
    positions: dict[int, Position] = {}
    for chunk in _chunks(position_ids):
        if chunk is None:
            continue
        for position in session.scalars(select(Position).where(Position.id.in_(chunk))):
            positions[position.id] = position
    if not positions:
        return {}

    built = [key for key, position in positions.items() if position.book_state == BOOK_BUILT]
    counts = _stored_game_counts(session, built, color=color)
    counts.update(
        _live_game_counts(session, [key for key in positions if key not in counts], color=color)
    )

    books: dict[int, dict[str, Any]] = {}
    for key, position in positions.items():
        if counts.get(key, 0) < max(min_games, 1):
            continue
        if position.book_state == BOOK_BUILT:
            moves, totals, _ended, _root_ply = _tree_from_book(
                session, position, color=color, min_games=1
            )
        else:
            occurrences = position_occurrences(session, key, color=color)
            moves, totals, _ended = _tree(occurrences, position.side_to_move, min_games=1)
        if not moves:
            continue
        books[key] = {**totals, "moves": moves[: max(limit, 0)] if limit else moves}
    return books


def position_book(
    session: Session,
    fen: str,
    *,
    color: Color | None = None,
    min_games: int = BOOK_MIN_GAMES,
    limit: int = 0,
) -> dict[str, Any] | None:
    """One position's strip of continuations, for a board that has left the game line.

    The game ships its own book with it (`services.games.game_book`), which covers stepping
    through the game and costs no request at all. This is the other half: the moment a reader
    plays a move of their own — walking a book line, or just dragging a piece — the board
    stands somewhere that payload cannot describe, and the strip for *that* position has to
    be asked for.

    Deliberately not `opening_explorer`: that builds the explorer *page* — a book walk,
    opening names, a note count per child — which is tens of queries, and none of it is on
    the strip beside a board. This is `position_books` for one position, and it answers
    `None` for the overwhelming majority of positions, which are the ones no two of the
    owner's games ever reached.

    A FEN that is not a position answers `None` rather than raising: the caller is a board,
    and a board that has wandered somewhere unparseable wants an empty strip, not an error.
    """
    try:
        position = find_position(session, fen)
    except ValueError:
        return None
    if position is None:
        return None
    return position_books(
        session, [position.id], color=color, min_games=min_games, limit=limit
    ).get(position.id)


def _stored_game_counts(
    session: Session, position_ids: Sequence[int], *, color: Color | None
) -> dict[int, int]:
    """How many of the owner's games reached each *built* position, off its stored totals.

    Summed rather than read, because a position has one row per owner colour and an
    unfiltered count is white's row plus black's — the same merge `_tree_from_book` does.
    """
    counts: dict[int, int] = {}
    for chunk in _chunks(position_ids):
        if chunk is None:
            continue
        statement = (
            select(PositionTotal.position_id, func.sum(PositionTotal.games))
            .where(PositionTotal.position_id.in_(chunk))
            .group_by(PositionTotal.position_id)
        )
        if color is not None:
            statement = statement.where(PositionTotal.owner_color == color)
        for position_id, games in session.execute(statement):
            counts[position_id] = int(games or 0)
    return counts


def _live_game_counts(
    session: Session, position_ids: Sequence[int], *, color: Color | None
) -> dict[int, int]:
    """The same count for positions with no stored book, in one query for all of them.

    Distinct games and not join rows: a game that stood in a position twice is one game
    here, exactly as the fold counts it. Cheap by construction — a position only lacks a
    book because too few games reach it — and the honest fallback for a library the sweep
    has not been over yet, which stays slow rather than wrong.
    """
    counts: dict[int, int] = {}
    for chunk in _chunks(position_ids):
        if chunk is None:
            continue
        statement = (
            select(GamePosition.position_id, func.count(func.distinct(GamePosition.game_id)))
            .join(Game, GamePosition.game_id == Game.id)
            .where(GamePosition.position_id.in_(chunk), Game.owner_color.is_not(None))
            .group_by(GamePosition.position_id)
        )
        if color is not None:
            statement = statement.where(Game.owner_color == color)
        for position_id, games in session.execute(statement):
            counts[position_id] = int(games or 0)
    return counts


def find_positions(
    session: Session, fen: str, color: Color | None = None, limit: int = 20
) -> list[dict[str, Any]]:
    """"Have I been here before?" — the games that reached a position, with outcomes.

    Newest first, and both the ordering and the cap are the database's: the initial array
    is every game the owner has, and hydrating nine and a half thousand occurrences to hand
    back fourteen of them was most of what this cost.
    """
    position = find_position(session, fen)
    if position is None:
        return []
    best = _ranked_occurrences(position.id, color=color)
    statement = (
        select(best)
        .where(best.c.rank == 1)
        # Nulls last and then oldest-first among them, which is where a game with no date
        # sorted when this was a Python sort over the whole list.
        .order_by(best.c.played_at.desc().nulls_last(), best.c.game_id, best.c.ply)
        .limit(max(limit, 0))
    )
    occurrences = [_occurrence(row) for row in session.execute(statement)]

    wanted = [occurrence.game_id for occurrence in occurrences]
    games = {
        game.id: game
        for game in session.scalars(select(Game).where(Game.id.in_(_unique(wanted))))
    }
    rows = []
    for occurrence in occurrences:
        game = games.get(occurrence.game_id)
        if game is None:
            continue
        rows.append(
            {
                "game": game_summary(game),
                "ply": occurrence.ply,
                "move_number": occurrence.ply // 2 + 1,
                "move_uci": occurrence.move_uci,
                "move_san": occurrence.move_san,
                "win_loss": occurrence.win_loss,
                "classification": occurrence.classification,
            }
        )
    return rows


def find_position(session: Session, fen: str) -> Position | None:
    """The stored Position for a FEN, normalised first. None when no game reached it."""
    epd, _zobrist, _side = normalize_fen(fen)
    return session.scalars(select(Position).where(Position.fen == epd)).first()


def get_or_create_position(session: Session, fen: str) -> Position:
    """The stored Position for a normalised FEN, inserting it the first time it is seen."""
    epd, zobrist, side = normalize_fen(fen)
    position = session.scalars(select(Position).where(Position.fen == epd)).first()
    if position is not None:
        return position
    position = Position(fen=epd, zobrist_key=zobrist, side_to_move=side)
    session.add(position)
    session.flush()
    return position


def read_fen(fen: str):
    """A caller's FEN, EPD or X-FEN as a board. `ValueError` on anything that is not one.

    The one place a pasted position is read, so that every surface — the explorer, the
    analysis queue, the coach's tools — accepts exactly the same set of spellings.
    """
    import chess

    # chess960 while reading: the flag only widens what castling rights parse, and `epd()`
    # spells a standard position the same either way, so one code path handles both.
    # `set_fen` takes a full FEN, an EPD or a FEN without its counters; `set_epd` chokes
    # on the counters, which is exactly what a caller pastes.
    board = chess.Board(chess960=True)
    try:
        board.set_fen(fen)
    except ValueError as exc:
        raise ValueError(f"not a position: {fen!r}") from exc
    # ... and off again unless the position really is one: a chess960 board makes
    # python-chess demand `UCI_Chess960` of any engine it is handed to, and an ordinary
    # Stockfish build does not declare it.
    board.chess960 = board.has_chess960_castling_rights()
    return board


def normalize_fen(fen: str) -> tuple[str, str, Color]:
    """A caller's FEN as the database keys it: EPD, zobrist hash and side to move.

    Accepts a full FEN, an EPD, or either with chess960 castling rights, and raises
    `ValueError` on anything that is not a position — which is what an MCP tool handed a
    typo needs to turn into a structured error rather than a stack trace.
    """
    import chess
    import chess.polyglot

    board = read_fen(fen)
    side = Color.WHITE if board.turn else Color.BLACK
    return board.epd(), f"{chess.polyglot.zobrist_hash(board):016x}", side


def position_occurrences(
    session: Session,
    position_id: int,
    *,
    color: Color | None = None,
    game_ids: Iterable[int] | None = None,
) -> list[Occurrence]:
    """Every time one of the owner's games passed through a position.

    The eval is joined in from the runs over those games rather than looked up per row, so
    the whole tree costs one query however many games are in it. A game with several done
    runs contributes several rows; the deepest, newest one wins, and picking it is the
    database's job — a window function over (game, ply) rather than a fold in Python, so
    the same ranking is available to an ORDER BY and a LIMIT.
    """
    occurrences: list[Occurrence] = []
    for chunk in _chunks(game_ids):
        best = _ranked_occurrences(position_id, color=color, chunk=chunk)
        statement = select(best).where(best.c.rank == 1)
        occurrences.extend(_occurrence(row) for row in session.execute(statement))
    return occurrences


def _ranked_occurrences(
    position_id: int, *, color: Color | None = None, chunk: Sequence[int] | None = None
) -> Subquery:
    """The join rows of one position, each ranked against the others for its (game, ply).

    `rank == 1` is the row that answers for that ply: an evaluated one over an unevaluated
    one, then the deeper tier, then the newer run. One definition, used by every read and
    by the rebuild, because a tree that ranked runs differently from the game list behind
    it would be two accounts of the same move.
    """
    evaluated = case(
        (or_(MoveEval.win_loss.is_not(None), MoveEval.classification.is_not(None)), 1),
        else_=0,
    )
    tier_rank = case(
        *[(AnalysisRun.tier == tier, rank) for tier, rank in TIER_RANK.items()], else_=0
    )
    statement: Select[Any] = (
        select(
            GamePosition.game_id.label("game_id"),
            GamePosition.ply.label("ply"),
            GamePosition.move_uci.label("move_uci"),
            GamePosition.move_san.label("move_san"),
            Game.owner_color.label("owner_color"),
            Game.result.label("result"),
            Game.played_at.label("played_at"),
            MoveEval.win_loss.label("win_loss"),
            MoveEval.classification.label("classification"),
            func.row_number()
            .over(
                partition_by=(GamePosition.game_id, GamePosition.ply),
                order_by=(
                    evaluated.desc(),
                    tier_rank.desc(),
                    func.coalesce(AnalysisRun.id, 0).desc(),
                ),
            )
            .label("rank"),
        )
        .select_from(GamePosition)
        .join(Game, GamePosition.game_id == Game.id)
        .outerjoin(
            AnalysisRun,
            and_(AnalysisRun.game_id == Game.id, AnalysisRun.status == RunStatus.DONE),
        )
        .outerjoin(
            MoveEval,
            and_(MoveEval.run_id == AnalysisRun.id, MoveEval.ply == GamePosition.ply),
        )
        .where(GamePosition.position_id == position_id, Game.owner_color.is_not(None))
    )
    if color is not None:
        statement = statement.where(Game.owner_color == color)
    if chunk is not None:
        statement = statement.where(GamePosition.game_id.in_(chunk))
    return statement.subquery()


def _occurrence(row: Any) -> Occurrence:
    return Occurrence(
        game_id=row.game_id,
        ply=row.ply,
        move_uci=row.move_uci,
        move_san=row.move_san,
        owner_color=row.owner_color,
        outcome=outcome_from(row.owner_color, row.result),
        played_at=row.played_at,
        win_loss=row.win_loss,
        classification=str(row.classification) if row.classification else None,
    )


def book_walk(
    session: Session,
    position: Position,
    *,
    color: Color | None = None,
    max_depth: int = MAX_BOOK_DEPTH,
    min_games: int = BOOK_MIN_GAMES,
) -> dict[str, Any]:
    """Follow the owner's most-played continuation until it stops repeating.

    There is no reference database here by design, so "book" means the owner's own book:
    the line they have played more than once. The walk stops at the first move they have
    only ever played in a single game, and that depth is where they leave it.

    The walk is **positional**, which is what the docstring has always claimed and what a
    book is everywhere else: each step counts every game that has ever stood in that
    position, not only the ones that were still following the line at the previous step. A
    game that transposed in therefore counts from the node it arrives at. It used to narrow
    a set of candidate game ids down the line instead, which cost an `IN` list per step of
    every game still in the running and quietly disagreed with the tree beside it.

    Each step reads one position's continuations — out of the precomputed book where the
    position has one, live where it does not — and follows the stored pointer to where the
    move lands, so nothing here replays a board. A step that names a move nothing recorded
    a landing square for cannot be followed and ends the walk as an unplayable one.

    Positional is right for *choosing* the moves and wrong for the depth that comes out of
    it. Each step honestly reports the games standing in that one position, but a claim
    about the whole line is a different claim, and a greedy walk will happily stitch one
    together out of games that never met: on a real 9.5k-game library it reached ply 23
    from the initial array while no game of the owner's had ever played that line past ply
    18. So the chosen line is then *checked*: `book_depth` is capped to the deepest prefix
    at least `min_games` games played end to end, found by binary search over the prefix
    length (support is monotone — a game that played k+1 moves played the first k), which
    is about five queries rather than one per ply. The departing move is re-derived from
    the games that survive that cap, so it is what they actually played next rather than
    the positional pick, and `main_line` is truncated to match.
    """
    line: list[dict[str, Any]] = []
    # Where each step of the line lands, root first, so the check below has something to
    # anchor on that is not the queried position.
    visited: list[int] = [position.id]
    current: Position | None = position
    depth = 0
    reason = "depth limit"

    while depth < max_depth:
        if current is None:
            reason = "unknown position"
            break
        counts = _book_continuations(session, current, color=color)
        if not counts:
            reason = "no continuation"
            break
        # Most played first; a tie goes to the move that sorts first, so the same games
        # always produce the same line.
        move = min(counts, key=lambda item: (-item.games, item.uci))
        line.append({"ply": depth, "uci": move.uci, "san": move.san, "games": move.games})
        if move.games < min_games:
            reason = "novelty"
            break
        if move.next_position_id is None:
            reason = "unplayable continuation"
            break
        visited.append(move.next_position_id)
        current = session.get(Position, move.next_position_id)
        depth += 1

    supported = _supported_depth(session, visited, color=color, min_games=min_games)
    departs = len(line) > depth
    if supported < depth:
        # The moves are still the owner's most-played ones; what was not true is that they
        # ever played them one after the other. Not a novelty — the next move may be one
        # they have played plenty of times, just never from here.
        depth = supported
        reason = "line not played"
        departs = True
    line = line[:depth]

    leaves = _departing_move(session, visited[: depth + 1], color=color) if departs else None
    if leaves is not None:
        line.append({"ply": depth, **leaves})
    elif departs and reason == "novelty":
        # Every game that followed the whole line ended there, so there is no first
        # improvisation to name after all.
        reason = "no continuation"

    return {
        "main_line": line,
        # Plies from the queried position that at least `min_games` of the owner's games
        # played end to end. The move at this index, when there is one, is what the games
        # that got this far played next — and no two of them agreed on it often enough for
        # it to be book. Its `games` counts those survivors, where every earlier step's
        # counts every game standing in that position however it arrived.
        "book_depth": depth,
        "leaves_book_with": line[depth] if len(line) > depth else None,
        "leaves_book_because": reason,
    }


def _supported_depth(
    session: Session, visited: Sequence[int], *, color: Color | None, min_games: int
) -> int:
    """How far down a walked line `min_games` of the owner's games actually got, together.

    `visited` is the positions the walk stood in, root first. Binary search rather than a
    probe per ply: a game that played the first k+1 moves played the first k, so support
    only ever falls as the prefix grows and the boundary can be bisected. Twenty-odd plies
    cost five queries.
    """
    low, high = 0, len(visited) - 1
    while low < high:
        middle = (low + high + 1) // 2
        if _line_games(session, visited[: middle + 1], color=color) >= min_games:
            low = middle
        else:
            high = middle - 1
    return low


def _line_games(session: Session, visited: Sequence[int], *, color: Color | None) -> int:
    """How many of the owner's games stood in every one of these positions in turn."""
    joined, clauses = _played_line(visited, color=color)
    statement = (
        select(func.count(func.distinct(LINE_ANCHOR.c.game_id)))
        .select_from(joined)
        .where(*clauses)
    )
    return int(session.scalar(statement) or 0)


def _departing_move(
    session: Session, visited: Sequence[int], *, color: Color | None
) -> dict[str, Any] | None:
    """What the games that played a whole line played next, most-played first.

    The point of asking the survivors rather than the position is that it is exact: the
    positional pick at that depth is whatever the crowd standing there favours, which need
    not be a move anybody who followed the line this far ever made. `None` when every game
    that got here ended here.
    """
    joined, clauses = _played_line(visited, color=color)
    statement = (
        select(
            LINE_ANCHOR.c.move_uci,
            func.max(LINE_ANCHOR.c.move_san),
            func.count(func.distinct(LINE_ANCHOR.c.game_id)),
        )
        .select_from(joined)
        .where(*clauses, LINE_ANCHOR.c.move_uci.is_not(None))
        .group_by(LINE_ANCHOR.c.move_uci)
    )
    rows = session.execute(statement).all()
    if not rows:
        return None
    # The same tie-break as the walk itself, so a line and its last step agree.
    uci, san, games = min(rows, key=lambda row: (-row[2], row[0]))
    return {"uci": uci, "san": san, "games": games}


def _played_line(
    visited: Sequence[int], *, color: Color | None = None
) -> tuple[Join, list[ColumnElement[bool]]]:
    """Games that stood in every position of a line in turn, as a join and its conditions.

    One N-way self-join of `game_positions` on `(game_id, ply)` — the unique index
    `uq_game_positions_game_id_ply` is exactly this lookup. Deliberately not a set of game
    ids narrowed in Python: that is what the chunked 400-id `IN` lists used to do, and it
    cost 294ms over 71 queries where this is one.

    Two things make it cheap. It matches *positions* rather than moves, which says the same
    thing — two different moves out of one position cannot land on the same position — but
    is the half of it that is indexed. And it anchors at the line's **last** position and
    joins backwards, because that is the rare one: anchoring at the queried position reads
    every occurrence of it, nine and a half thousand rows at the initial array, before
    anything can prune, and cost 26ms a probe whatever the depth.

    `LINE_ANCHOR`'s own columns are what a caller selects, so the move each survivor played
    *out* of the last position rides along for free — which is what makes the departing
    move theirs rather than the position's.
    """
    games = Game.__table__
    last = len(visited) - 1
    joined = LINE_ANCHOR.join(games, LINE_ANCHOR.c.game_id == games.c.id)
    for index, position_id in enumerate(visited[:-1]):
        step = _line_step(index)
        joined = joined.join(
            step,
            and_(
                step.c.game_id == LINE_ANCHOR.c.game_id,
                step.c.ply == LINE_ANCHOR.c.ply - (last - index),
                step.c.position_id == position_id,
            ),
        )
    clauses: list[ColumnElement[bool]] = [
        LINE_ANCHOR.c.position_id == visited[-1],
        games.c.owner_color.is_not(None),
    ]
    if color is not None:
        clauses.append(games.c.owner_color == color)
    return joined, clauses


def rebuild_position_books(session: Session, *, limit: int = BOOK_BACKFILL_CHUNK) -> int:
    """Settle up to `limit` positions the book does not describe yet; how many. 0 means done.

    "Settled" is either state a sweep can leave a position in: a position at or above
    `BOOK_MIN_OCCURRENCES` gets its `position_moves` and `position_totals` rows rebuilt and
    is marked built, and one below it has any rows it had deleted and is marked cold. Cold
    is a decision, not a gap — the read path folds it live, which for a position two games
    have reached is faster than opening a row.

    One chunk per call rather than a sweep with a loop inside it, and committed here, for
    the same reasons `stats.rebuild_stat_summaries` does it: the loop the server starts is
    cancelled between chunks at shutdown, each chunk is a committed step nothing has to
    redo, and committing per chunk is what lets it run beside a live server on a database
    with one writer.

    Nothing here is a source of truth. Until a position is settled the explorer folds it
    live exactly as it always did, so an un-swept library is slow rather than wrong.
    """
    dirty = list(
        session.scalars(
            select(Position.id).where(Position.book_state == BOOK_DIRTY).limit(max(limit, 1))
        )
    )
    sizes = (
        dict(
            session.execute(
                select(GamePosition.position_id, func.count())
                .where(GamePosition.position_id.in_(dirty))
                .group_by(GamePosition.position_id)
            ).all()
        )
        if dirty
        else {}
    )
    hot = [identifier for identifier in dirty if sizes.get(identifier, 0) >= BOOK_MIN_OCCURRENCES]
    cold = [identifier for identifier in dirty if sizes.get(identifier, 0) < BOOK_MIN_OCCURRENCES]

    if cold:
        _drop_books(session, cold)
        session.execute(
            update(Position)
            .where(Position.id.in_(cold))
            .values(book_state=BOOK_COLD)
            .execution_options(synchronize_session=False)
        )
    for identifier in hot:
        _rebuild_one_book(session, identifier)
    # Unconditionally, so the pass that finds nothing closes its read transaction rather
    # than idling with a snapshot of the database open behind it.
    session.commit()
    # A sweep over a whole library would otherwise keep every position and every book row
    # it has written in the identity map.
    session.expunge_all()
    return len(dirty)


def mark_positions_dirty(session: Session, game_id: int) -> int:
    """Send every position one game touches back to the sweep; how many were still built.

    Uncommitted on purpose, the way `stats.refresh_game_stats` is: this belongs inside the
    transaction that changed what the fold describes — the import that stored the game, the
    run that finished over it, the delete that takes it away — so no reader can find a book
    that counts evals it cannot see, or misses ones it can.
    """
    return mark_games_dirty(session, [game_id])


def mark_games_dirty(session: Session, game_ids: Sequence[int]) -> int:
    """The same, for a writer that changed a set of games in one bulk statement."""
    marked = 0
    for chunk in _chunks(game_ids):
        if chunk is None:
            continue
        touched = select(GamePosition.position_id).where(GamePosition.game_id.in_(chunk))
        result = session.execute(
            update(Position)
            .where(Position.id.in_(touched), Position.book_state != BOOK_DIRTY)
            .values(book_state=BOOK_DIRTY)
            .execution_options(synchronize_session=False)
        )
        marked += int(result.rowcount)
    return marked


def discard_position_books(session: Session) -> None:
    """Throw the whole book away and put every position back in the sweep's queue.

    For the writer that changes every position at once — emptying the library — where
    marking them one game at a time would be a statement per game to reach the same place.
    """
    _drop_books(session)
    session.execute(
        update(Position)
        .where(Position.book_state != BOOK_DIRTY)
        .values(book_state=BOOK_DIRTY)
        .execution_options(synchronize_session=False)
    )


def _drop_books(session: Session, position_ids: Sequence[int] | None = None) -> None:
    """Delete the stored book of some positions, or of all of them."""
    for table in (PositionMove, PositionTotal):
        statement = delete(table)
        if position_ids is not None:
            statement = statement.where(table.position_id.in_(position_ids))
        session.execute(statement.execution_options(synchronize_session=False))


def _rebuild_one_book(session: Session, position_id: int) -> None:
    """Recompute one position's book rows from its join rows, one colour at a time.

    Deliberately the same fold the live path runs (`_fold`), applied to the same ranked
    occurrences (`position_occurrences`), so a built position and a cold one cannot answer
    differently. Everything stored is a sum, a maximum or a count, which is what lets a
    read merge white's row with black's for an unfiltered tree.
    """
    position = session.get(Position, position_id)
    if position is None:
        return
    landings = _next_positions(session, position_id)
    by_color: dict[Color, list[Occurrence]] = {}
    for occurrence in position_occurrences(session, position_id):
        if occurrence.owner_color is not None:
            by_color.setdefault(occurrence.owner_color, []).append(occurrence)

    _drop_books(session, [position_id])
    for owner_color, group in by_color.items():
        nodes, seen, ended = _fold(group, position.side_to_move)
        for counts in (_counts(node) for node in nodes.values()):
            session.add(
                PositionMove(
                    position_id=position_id,
                    owner_color=owner_color,
                    move_uci=counts.uci,
                    move_san=counts.san,
                    next_position_id=landings.get(counts.uci),
                    games=counts.games,
                    occurrences=counts.occurrences,
                    owner_moves=counts.owner_moves,
                    evaluated=counts.evaluated,
                    blunders=counts.blunders,
                    wins=counts.wins,
                    draws=counts.draws,
                    losses=counts.losses,
                    loss_sum=counts.loss_sum,
                    ply_sum=counts.ply_sum,
                    last_played=counts.last_played,
                )
            )
        wins, draws, losses = _outcomes(seen.values())
        session.add(
            PositionTotal(
                position_id=position_id,
                owner_color=owner_color,
                games=len(seen),
                wins=wins,
                draws=draws,
                losses=losses,
                ended_here=ended,
                ply_counts=_ply_counts(group),
            )
        )
    session.execute(
        update(Position)
        .where(Position.id == position_id)
        .values(book_state=BOOK_BUILT)
        .execution_options(synchronize_session=False)
    )


def _next_positions(session: Session, position_id: int) -> dict[str, int]:
    """Where each move out of a position lands, read off the games that played it.

    No chess in it and none needed: the position after a move is a property of the position
    and the move, so the same game's join row one ply later is the answer, and any game that
    played the move gives the same one.
    """
    landing = aliased(GamePosition)
    statement = (
        select(GamePosition.move_uci, func.max(landing.position_id))
        .select_from(GamePosition)
        .join(
            landing,
            and_(
                landing.game_id == GamePosition.game_id,
                landing.ply == GamePosition.ply + 1,
            ),
        )
        .where(GamePosition.position_id == position_id, GamePosition.move_uci.is_not(None))
        .group_by(GamePosition.move_uci)
    )
    return {move_uci: next_id for move_uci, next_id in session.execute(statement) if next_id}


def _book_continuations(
    session: Session, position: Position, *, color: Color | None = None
) -> list[Continuation]:
    """The moves out of one position for the walk: the book's rows, or a live count.

    Per step rather than per walk, because a line runs through hot positions near the root
    and cold ones once it is deep enough that only a couple of games are left.
    """
    if position.book_state == BOOK_BUILT:
        statement = select(PositionMove).where(PositionMove.position_id == position.id)
        if color is not None:
            statement = statement.where(PositionMove.owner_color == color)
        merged: dict[str, Continuation] = {}
        for row in session.scalars(statement):
            seen = merged.get(row.move_uci)
            merged[row.move_uci] = Continuation(
                uci=row.move_uci,
                san=(seen.san if seen else None) or row.move_san,
                games=(seen.games if seen else 0) + row.games,
                next_position_id=(seen.next_position_id if seen else None)
                or row.next_position_id,
            )
        return list(merged.values())

    landing = aliased(GamePosition)
    live = (
        select(
            GamePosition.move_uci,
            func.max(GamePosition.move_san),
            func.count(func.distinct(GamePosition.game_id)),
            func.max(landing.position_id),
        )
        .select_from(GamePosition)
        .join(Game, GamePosition.game_id == Game.id)
        .outerjoin(
            landing,
            and_(
                landing.game_id == GamePosition.game_id,
                landing.ply == GamePosition.ply + 1,
            ),
        )
        .where(
            GamePosition.position_id == position.id,
            GamePosition.move_uci.is_not(None),
            Game.owner_color.is_not(None),
        )
        .group_by(GamePosition.move_uci)
    )
    if color is not None:
        live = live.where(Game.owner_color == color)
    return [
        Continuation(uci=uci, san=san, games=games, next_position_id=next_id)
        for uci, san, games, next_id in session.execute(live)
    ]


def _tree_from_book(
    session: Session, position: Position, *, color: Color | None, min_games: int
) -> tuple[list[dict[str, Any]], dict[str, Any], int, int | None]:
    """One position's tree read out of its stored book, as `_tree` would have folded it.

    A colour-filtered read is one row per move; an unfiltered one merges white's row with
    black's, which is sound because a game has one owner colour and everything stored is a
    sum. The two things that are not sums are computed from the ones that are: an average
    from its total and its count, and `root_ply` from the ply histogram.

    The accuracy counters are read as the owner's alone, to match `_fold`. A row is keyed
    by owner colour and `side_to_move` belongs to the position, so for every occurrence a
    row folded the mover was the owner exactly when the two are equal — which makes the
    other rows' `evaluated`, `loss_sum` and `blunders` zero on the way out, whatever a
    book built before this rule stored in them. No rebuild in it: the sweep will overwrite
    them with zeros in its own time and the payload does not change when it does.
    """
    moves_statement = select(PositionMove).where(PositionMove.position_id == position.id)
    totals_statement = select(PositionTotal).where(PositionTotal.position_id == position.id)
    if color is not None:
        moves_statement = moves_statement.where(PositionMove.owner_color == color)
        totals_statement = totals_statement.where(PositionTotal.owner_color == color)

    merged: dict[str, MoveCounts] = {}
    for row in session.scalars(moves_statement):
        owner_moved = row.owner_color == position.side_to_move
        counts = merged.setdefault(row.move_uci, MoveCounts(uci=row.move_uci))
        counts.merge(
            MoveCounts(
                uci=row.move_uci,
                san=row.move_san,
                games=row.games,
                wins=row.wins,
                draws=row.draws,
                losses=row.losses,
                occurrences=row.occurrences,
                owner_moves=row.owner_moves,
                evaluated=row.evaluated if owner_moved else 0,
                blunders=row.blunders if owner_moved else 0,
                loss_sum=row.loss_sum if owner_moved else 0.0,
                ply_sum=row.ply_sum,
                last_played=row.last_played,
            )
        )

    total = TotalCounts()
    for row in session.scalars(totals_statement):
        total.merge(
            TotalCounts(
                games=row.games,
                wins=row.wins,
                draws=row.draws,
                losses=row.losses,
                ended_here=row.ended_here,
                ply_counts={int(ply): count for ply, count in (row.ply_counts or {}).items()},
            )
        )

    moves = [_node(counts) for counts in merged.values() if counts.games >= max(min_games, 1)]
    moves.sort(key=lambda node: (-node["games"], node["uci"]))
    totals = _totals_from(total.games, total.wins, total.draws, total.losses)
    return moves, totals, total.ended_here, _mode_of(total.ply_counts)


def eco_root(
    session: Session, eco: str, color: Color | None = None
) -> tuple[Position | None, set[int] | None, list[dict[str, Any]]]:
    """The deepest position every game with this ECO code shares, and those games.

    An ECO code names an opening, not a position, and the games filed under one do not all
    reach the same square on the same ply. Walking from the start while every candidate
    plays the same move lands on the position they genuinely have in common.
    """
    statement = select(Game.id).where(Game.owner_color.is_not(None), _eco_like(eco))
    if color is not None:
        statement = statement.where(Game.owner_color == color)
    candidates = set(session.scalars(statement))
    if not candidates:
        return None, None, []

    opening = _openings(session, candidates)
    if len(opening) != 1:
        # Games filed under one code that do not even start from the same array (a 960
        # game tagged by transposition): take the array most of them start from.
        if not opening:
            return None, None, []
        position_id, games = max(opening.items(), key=lambda item: len(item[1]))
        candidates = games
    else:
        position_id, candidates = next(iter(opening.items()))

    current = session.get(Position, position_id)
    if current is None:
        return None, None, []

    board = read_fen(current.fen)
    path: list[dict[str, Any]] = []
    while len(path) < MAX_BOOK_DEPTH:
        counts = _continuations(session, current.id, color=color, game_ids=candidates)
        if len(counts) != 1:
            break
        move_uci, games = next(iter(counts.items()))
        if len(games) != len(candidates):
            break
        try:
            move = board.parse_uci(move_uci)
        except ValueError:
            break
        path.append(
            {"ply": len(path), "uci": move_uci, "san": board.san(move), "games": len(games)}
        )
        board.push(move)
        nxt = session.scalars(select(Position).where(Position.fen == board.epd())).first()
        if nxt is None:
            break
        current, candidates = nxt, games
    return current, candidates, path


def _continuations(
    session: Session,
    position_id: int,
    *,
    color: Color | None = None,
    game_ids: Iterable[int] | None = None,
) -> dict[str, set[int]]:
    """The moves played from a position, each with the games that played it.

    Which games, rather than how many, because the ECO walk this is now the only caller of
    is about a *set* of games agreeing: it stops where the code's games stop playing one
    move, and it has to carry the ones that are left into the next step. The book walk used
    to narrow the same way and no longer does — standing in the position is what counts
    there, so it asks `_book_continuations` for counts and follows a stored pointer.
    """
    statement = (
        select(GamePosition.move_uci, GamePosition.game_id)
        .join(Game, GamePosition.game_id == Game.id)
        .where(
            GamePosition.position_id == position_id,
            GamePosition.move_uci.is_not(None),
            Game.owner_color.is_not(None),
        )
    )
    if color is not None:
        statement = statement.where(Game.owner_color == color)

    counts: dict[str, set[int]] = {}
    for chunk in _chunks(game_ids):
        scoped = statement if chunk is None else statement.where(GamePosition.game_id.in_(chunk))
        for move_uci, game_id in session.execute(scoped):
            counts.setdefault(move_uci, set()).add(game_id)
    return counts


def _openings(session: Session, game_ids: Iterable[int]) -> dict[int, set[int]]:
    """The ply-0 position of each game, grouped by position."""
    statement = select(GamePosition.position_id, GamePosition.game_id).where(
        GamePosition.ply == 0
    )
    grouped: dict[int, set[int]] = {}
    for chunk in _chunks(game_ids):
        scoped = statement if chunk is None else statement.where(GamePosition.game_id.in_(chunk))
        for position_id, game_id in session.execute(scoped):
            grouped.setdefault(position_id, set()).add(game_id)
    return grouped


def _tree(
    occurrences: Sequence[Occurrence], side_to_move: Color, *, min_games: int
) -> tuple[list[dict[str, Any]], dict[str, Any], int]:
    """Fold occurrences into one node per continuation, scored from the owner's side."""
    nodes, seen, ended = _fold(occurrences, side_to_move)
    moves = [
        _node(_counts(node))
        for node in nodes.values()
        if len(node["games"]) >= max(min_games, 1)
    ]
    moves.sort(key=lambda node: (-node["games"], node["uci"]))
    return moves, _totals(seen.values()), ended


def _fold(
    occurrences: Sequence[Occurrence], side_to_move: Color
) -> tuple[dict[str, dict[str, Any]], dict[int, str | None], int]:
    """The accumulation both paths share: one bucket per continuation, plus the position's.

    Separate from `_tree` because the rebuild needs the raw accumulators rather than the
    payload — what `position_moves` stores is exactly what this adds up, and computing the
    stored numbers any other way would be a second definition of a continuation.
    """
    nodes: dict[str, dict[str, Any]] = {}
    seen: dict[int, str | None] = {}
    ended = 0

    for occurrence in occurrences:
        seen[occurrence.game_id] = occurrence.outcome
        if occurrence.move_uci is None:
            ended += 1
            continue
        node = nodes.setdefault(
            occurrence.move_uci,
            {
                "uci": occurrence.move_uci,
                "san": occurrence.move_san,
                "games": {},
                "occurrences": 0,
                "owner_moves": 0,
                "evaluated": 0,
                "loss_sum": 0.0,
                "blunders": 0,
                "plies": [],
                "last_played": None,
            },
        )
        node["san"] = node["san"] or occurrence.move_san
        node["games"].setdefault(occurrence.game_id, occurrence.outcome)
        node["occurrences"] += 1
        node["plies"].append(occurrence.ply)
        # Frequency counts everyone; accuracy counts only the owner. The panel is headed
        # "your move tree", so a blunder or a win percentage given away is only theirs
        # when they were the one to move — which is exactly `owner_moves`' predicate.
        owner_move = occurrence.owner_color == side_to_move
        if owner_move:
            node["owner_moves"] += 1
            if occurrence.win_loss is not None:
                node["evaluated"] += 1
                node["loss_sum"] += occurrence.win_loss
            if occurrence.classification == "blunder":
                node["blunders"] += 1
        if occurrence.played_at is not None:
            last = node["last_played"]
            node["last_played"] = occurrence.played_at if last is None else max(
                last, occurrence.played_at
            )

    return nodes, seen, ended


def _counts(node: dict[str, Any]) -> MoveCounts:
    """One folded bucket as the mergeable counters both the payload and the book want."""
    wins, draws, losses = _outcomes(node["games"].values())
    return MoveCounts(
        uci=node["uci"],
        san=node["san"],
        games=len(node["games"]),
        wins=wins,
        draws=draws,
        losses=losses,
        occurrences=node["occurrences"],
        owner_moves=node["owner_moves"],
        evaluated=node["evaluated"],
        blunders=node["blunders"],
        loss_sum=node["loss_sum"],
        ply_sum=sum(node["plies"]),
        last_played=node["last_played"],
    )


def _ply_counts(occurrences: Sequence[Occurrence]) -> dict[str, int]:
    """How many occurrences arrived at each ply, keyed as JSON needs it."""
    counts: dict[str, int] = {}
    for occurrence in occurrences:
        key = str(occurrence.ply)
        counts[key] = counts.get(key, 0) + 1
    return counts


def _node(counts: MoveCounts) -> dict[str, Any]:
    return {
        "uci": counts.uci,
        "san": counts.san,
        **_totals_from(counts.games, counts.wins, counts.draws, counts.losses),
        "occurrences": counts.occurrences,
        "owner_moves": counts.owner_moves,
        "evaluated": counts.evaluated,
        # The average win percentage the *owner* gave away with this move. `None` until
        # something has actually analysed it — an unanalysed move is not a good move — and
        # `None` too where they never played it, since `evaluated` counts their moves only
        # and a continuation only the opponent played says nothing about how they play.
        "avg_win_loss": _mean(counts.loss_sum, counts.evaluated),
        "blunders": counts.blunders,
        "avg_ply": _mean(float(counts.ply_sum), counts.occurrences),
        "last_played": counts.last_played.isoformat() if counts.last_played else None,
    }


def _outcomes(outcomes: Iterable[str | None]) -> tuple[int, int, int]:
    """Wins, draws and losses among some outcomes; anything undecided counts as none."""
    counts = {WIN: 0, DRAW: 0, LOSS: 0}
    for outcome in outcomes:
        if outcome in counts:
            counts[outcome] += 1
    return counts[WIN], counts[DRAW], counts[LOSS]


def _totals(outcomes: Iterable[str | None]) -> dict[str, Any]:
    values = list(outcomes)
    return _totals_from(len(values), *_outcomes(values))


def _totals_from(games: int, wins: int, draws: int, losses: int) -> dict[str, Any]:
    """The scored half of a payload from counts alone, so a stored fold can build one."""
    scored = wins + draws + losses
    points = wins * (score_from(WIN) or 0.0) + draws * (score_from(DRAW) or 0.0)
    return {
        "games": games,
        "wins": wins,
        "draws": draws,
        "losses": losses,
        "score": round(points / scored, 4) if scored else None,
    }


def _opening(fen: str | None, line: Sequence[str] | None) -> dict[str, Any] | None:
    """What the vendored book calls this position, or the deepest ancestor it names.

    With a line, the whole path is looked up and the deepest hit wins, because the book
    stops naming positions a few plies in and the queried position is usually past that.
    Without one there is no path to walk, so only the position itself is asked about and
    `ply` is `null` — nothing here knows how deep a bare FEN is. Either way an unnamed
    position stays unnamed: a made-up name would be worse than no name.
    """
    if line:
        found = openings.deepest(_line_epds(line))
        return {"eco": found.eco, "name": found.name, "ply": found.index} if found else None
    epd = _safe_epd(fen) if fen else None
    named = openings.find(epd) if epd else None
    return {"eco": named.eco, "name": named.name, "ply": None} if named else None


def _line_epds(line: Sequence[str]) -> list[str]:
    """Every position a line of UCI moves stands in, root first, the final one included.

    A move that will not parse or will not play truncates the walk there rather than
    raising, which is what the client already does with an unplayable tail (`line.ts`'s
    `buildLine`) — a stale link should name the opening it got to, not fail.
    """
    board = read_fen(START_EPD)
    epds = [board.epd()]
    for uci in line:
        try:
            move = board.parse_uci(uci)
        except ValueError:
            break
        board.push(move)
        epds.append(board.epd())
    return epds


def _annotate_continuations(session: Session, moves: list[dict[str, Any]], fen: str) -> None:
    """What each continuation leads into, added to every move node in place: which opening
    the book calls it, and what the owner wrote about it.

    A name is reported only when the position the move reaches is itself in the book —
    never the parent's name. The book stops naming positions three to five plies in, so
    most continuations end up unnamed past the first few moves; inheriting the parent's
    name onto them would make every row after that show the identical string, and the whole
    point of the column is that a name means "this move enters that opening" rather than
    "still in whatever you were in".

    A note is the owner's own, and it hangs off the position the move *reaches* for the
    same reason the name does: a note about a move is a note about where it goes. The
    newest one wins and the whole page's worth is one query rather than one per row; which
    note belongs to a position is `notes.latest_note_by_fen`'s to say, so this and the
    notes card beside the table cannot disagree. `None` where nothing was written.

    One board, built once from the queried position and replayed move by move rather than
    reparsed per continuation, since this runs over a page of them (~20) every request. A
    move that will not parse or is not legal here gets neither name nor note rather than
    raising, and reaches no position to look one up on.
    """
    # Imported here rather than at the top of the module: `services.notes` resolves its own
    # positions through this module, so the two only meet inside a call.
    from backend.services import notes as notes_service

    try:
        board = read_fen(fen)
    except ValueError:
        for move in moves:
            move["eco"] = None
            move["name"] = None
            move["note"] = None
        return

    children: dict[str, str] = {}
    for move in moves:
        found = None
        child = None
        try:
            parsed = board.parse_uci(move["uci"])
        except ValueError:
            parsed = None
        if parsed is not None:
            board.push(parsed)
            child = board.epd()
            found = openings.find(child)
            board.pop()
        move["eco"] = found.eco if found else None
        move["name"] = found.name if found else None
        move["note"] = None
        if child is not None:
            children[move["uci"]] = child

    written = notes_service.latest_note_by_fen(session, children.values())
    for move in moves:
        child = children.get(move["uci"])
        note = written.get(child) if child is not None else None
        if note is not None:
            move["note"] = {"id": note.id, "text": note.text}


def _empty(
    *,
    fen: str | None,
    eco: str | None,
    color: Color | None,
    path: list[dict[str, Any]],
    position: Position | None = None,
    opening: dict[str, Any] | None = None,
) -> dict[str, Any]:
    resolved = position.fen if position is not None else (_safe_epd(fen) if fen else None)
    side = position.side_to_move if position is not None else None
    return {
        "fen": resolved,
        "eco": eco,
        "color": str(color) if color else None,
        "side_to_move": str(side) if side else None,
        "path": path,
        "root_ply": None,
        "opening": opening,
        "totals": {"games": 0, "wins": 0, "draws": 0, "losses": 0, "score": None, "ended_here": 0},
        "moves": [],
        "main_line": [],
        "book_depth": 0,
        "leaves_book_with": None,
        "leaves_book_because": "no games",
    }


def _safe_epd(fen: str) -> str | None:
    try:
        return read_fen(fen).epd()
    except ValueError:
        return None


def _eco_like(eco: str) -> ColumnElement[bool]:
    cleaned = eco.strip().replace("%", "\\%").replace("_", "\\_")
    return Game.eco.ilike(f"{cleaned}%", escape="\\")


def _chunks(game_ids: Iterable[int] | None) -> list[list[int] | None]:
    """A game-id filter as IN chunks, or a single unfiltered pass when there is none."""
    if game_ids is None:
        return [None]
    ids = sorted(set(game_ids))
    if not ids:
        return []
    return [ids[start : start + LOOKUP_CHUNK] for start in range(0, len(ids), LOOKUP_CHUNK)]


def _unique(values: Sequence[int]) -> list[int]:
    return list(dict.fromkeys(values))


def _mean(total: float, count: int) -> float | None:
    return round(total / count, 4) if count else None


def _mode(values: Sequence[int]) -> int | None:
    counts: dict[int, int] = {}
    for value in values:
        counts[value] = counts.get(value, 0) + 1
    return _mode_of(counts)


def _mode_of(counts: dict[int, int]) -> int | None:
    """The commonest value in a histogram; a tie goes to the smallest."""
    if not counts:
        return None
    return max(counts.items(), key=lambda item: (item[1], -item[0]))[0]
