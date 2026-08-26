from __future__ import annotations

from collections.abc import Iterable, Sequence
from datetime import datetime
from typing import Any, NamedTuple

from sqlalchemy import ColumnElement, and_, select
from sqlalchemy.orm import Session

from backend.db.enums import Color, RunStatus
from backend.db.models import AnalysisRun, Game, GamePosition, MoveEval, Position
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

# SQLite's parameter limit is the tighter of the two back ends, and the book walk narrows
# a candidate set that starts at "every game the owner has played".
LOOKUP_CHUNK = 400

# How deep `book_walk` follows the owner's most-played continuation before giving up. A
# repertoire that is still unanimous 40 plies in is not a repertoire, it is one game.
MAX_BOOK_DEPTH = 40

# What it takes for a move to still count as "book": the owner played it more than once.
BOOK_MIN_GAMES = 2


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


def opening_explorer(
    session: Session,
    *,
    fen: str | None = None,
    eco: str | None = None,
    color: Color | None = None,
    limit: int = 20,
    min_games: int = 1,
) -> dict[str, Any]:
    """The owner's personal tree from one position: per continuation frequency, score,
    average eval drop, and where the owner leaves book.

    Entry is by FEN, by ECO, or by neither — the initial array. An ECO code names a set of
    games rather than a position, so its root is the deepest position all of those games
    share: walk from the start while they agree, stop where they diverge.

    `limit` caps how many continuations come back (0 for all of them) and `min_games`
    drops the ones played in fewer games than that. Neither touches the book walk, which
    always follows the whole tree — a one-off move is exactly what it is looking for.
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
    if position is None:
        return _empty(fen=fen, eco=eco, color=color, path=path)

    occurrences = position_occurrences(session, position.id, color=color, game_ids=games)
    if not occurrences:
        return _empty(fen=fen, eco=eco, color=color, path=path, position=position)

    moves, totals, ended = _tree(occurrences, position.side_to_move, min_games=min_games)
    book = book_walk(session, position, color=color, game_ids=games)
    return {
        "fen": position.fen,
        "eco": eco,
        "color": str(color) if color else None,
        "side_to_move": str(position.side_to_move),
        "path": path,
        "root_ply": _mode([occurrence.ply for occurrence in occurrences]),
        "totals": {**totals, "ended_here": ended},
        "moves": moves[: max(limit, 0)] if limit else moves,
        **book,
    }


def find_positions(
    session: Session, fen: str, color: Color | None = None, limit: int = 20
) -> list[dict[str, Any]]:
    """"Have I been here before?" — the games that reached a position, with outcomes."""
    position = find_position(session, fen)
    if position is None:
        return []
    occurrences = position_occurrences(session, position.id, color=color)
    occurrences.sort(key=lambda item: (item.played_at is not None, item.played_at), reverse=True)

    wanted = [occurrence.game_id for occurrence in occurrences[: max(limit, 0)]]
    games = {
        game.id: game
        for game in session.scalars(select(Game).where(Game.id.in_(_unique(wanted))))
    }
    rows = []
    for occurrence in occurrences[: max(limit, 0)]:
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
    runs contributes several rows; the deepest, newest one wins.
    """
    statement = (
        select(
            GamePosition.game_id,
            GamePosition.ply,
            GamePosition.move_uci,
            GamePosition.move_san,
            Game.owner_color,
            Game.result,
            Game.played_at,
            AnalysisRun.id,
            AnalysisRun.tier,
            MoveEval.win_loss,
            MoveEval.classification,
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

    best: dict[tuple[int, int], tuple[tuple[int, int, int], Occurrence]] = {}
    for chunk in _chunks(game_ids):
        scoped = statement if chunk is None else statement.where(GamePosition.game_id.in_(chunk))
        for row in session.execute(scoped):
            (
                game_id,
                ply,
                move_uci,
                move_san,
                owner_color,
                result,
                played_at,
                run_id,
                tier,
                win_loss,
                classification,
            ) = row
            rank = (
                1 if win_loss is not None or classification is not None else 0,
                TIER_RANK.get(tier, 0),
                run_id or 0,
            )
            key = (game_id, ply)
            if key in best and best[key][0] >= rank:
                continue
            best[key] = (
                rank,
                Occurrence(
                    game_id=game_id,
                    ply=ply,
                    move_uci=move_uci,
                    move_san=move_san,
                    owner_color=owner_color,
                    outcome=outcome_from(owner_color, result),
                    played_at=played_at,
                    win_loss=win_loss,
                    classification=str(classification) if classification else None,
                ),
            )
    return [occurrence for _rank, occurrence in best.values()]


def book_walk(
    session: Session,
    position: Position,
    *,
    color: Color | None = None,
    game_ids: Iterable[int] | None = None,
    max_depth: int = MAX_BOOK_DEPTH,
    min_games: int = BOOK_MIN_GAMES,
) -> dict[str, Any]:
    """Follow the owner's most-played continuation until it stops repeating.

    There is no reference database here by design, so "book" means the owner's own book:
    the line they have played more than once. The walk stops at the first move they have
    only ever played in a single game, and that depth is where they leave it.

    Each step is a lookup of one position, and the next position is computed from the move
    rather than searched for, so a transposition into the same line is followed correctly.
    """
    line: list[dict[str, Any]] = []
    board = read_fen(position.fen)
    current: Position | None = position
    candidates = set(game_ids) if game_ids is not None else None
    depth = 0
    reason = "depth limit"

    while depth < max_depth:
        if current is None:
            reason = "unknown position"
            break
        counts = _continuations(session, current.id, color=color, game_ids=candidates)
        if not counts:
            reason = "no continuation"
            break
        # Most played first; a tie goes to the move that sorts first, so the same games
        # always produce the same line.
        move_uci, played = min(counts.items(), key=lambda item: (-len(item[1]), item[0]))
        try:
            move = board.parse_uci(move_uci)
            san = board.san(move)
        except ValueError:
            reason = "unplayable continuation"
            break
        line.append({"ply": depth, "uci": move_uci, "san": san, "games": len(played)})
        if len(played) < min_games:
            reason = "novelty"
            break
        candidates = played
        board.push(move)
        current = session.scalars(select(Position).where(Position.fen == board.epd())).first()
        depth += 1

    return {
        "main_line": line,
        # Plies from the queried position that the owner has played more than once. The
        # move at this index is the first one they have only played in a single game.
        "book_depth": depth,
        "leaves_book_with": line[depth] if len(line) > depth else None,
        "leaves_book_because": reason,
    }


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
    """The moves played from a position, each with the games that played it."""
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
        if occurrence.owner_color == side_to_move:
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

    moves = [_node(node) for node in nodes.values() if len(node["games"]) >= max(min_games, 1)]
    moves.sort(key=lambda node: (-node["games"], node["uci"]))
    return moves, _totals(seen.values()), ended


def _node(node: dict[str, Any]) -> dict[str, Any]:
    outcomes = list(node["games"].values())
    totals = _totals(outcomes)
    return {
        "uci": node["uci"],
        "san": node["san"],
        **totals,
        "occurrences": node["occurrences"],
        "owner_moves": node["owner_moves"],
        "evaluated": node["evaluated"],
        # The average win percentage the mover gave away with this move. `None` until
        # something has actually analysed it — an unanalysed move is not a good move.
        "avg_win_loss": _mean(node["loss_sum"], node["evaluated"]),
        "blunders": node["blunders"],
        "avg_ply": _mean(float(sum(node["plies"])), len(node["plies"])),
        "last_played": node["last_played"].isoformat() if node["last_played"] else None,
    }


def _totals(outcomes: Iterable[str | None]) -> dict[str, Any]:
    values = list(outcomes)
    counts = {WIN: 0, DRAW: 0, LOSS: 0}
    for outcome in values:
        if outcome in counts:
            counts[outcome] += 1
    scored = sum(counts.values())
    points = sum(score_from(outcome) or 0.0 for outcome in values if outcome in counts)
    return {
        "games": len(values),
        "wins": counts[WIN],
        "draws": counts[DRAW],
        "losses": counts[LOSS],
        "score": round(points / scored, 4) if scored else None,
    }


def _empty(
    *,
    fen: str | None,
    eco: str | None,
    color: Color | None,
    path: list[dict[str, Any]],
    position: Position | None = None,
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
    if not values:
        return None
    counts: dict[int, int] = {}
    for value in values:
        counts[value] = counts.get(value, 0) + 1
    return max(counts.items(), key=lambda item: (item[1], -item[0]))[0]
