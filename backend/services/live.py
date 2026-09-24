"""The live session: the one board the owner and the coach share — the Board page.

The owner works split-screen — Blunderbase in the browser, the coach in a chat beside it —
and this module is what keeps the two looking at the same position. There is exactly one
board because there is exactly one owner. Either side can put something on it: a stored
game at a ply, a pasted FEN or PGN, or the starting position, plus the arrows, highlights
and comment drawn over it. Either side can play moves on it, and the owner can step back
and forth through what was played.

The board is a *line* with at most one *branch* off it, the same shape as the game page's
analysis line. `line` is the mainline — a stored game's moves, a PGN's mainline, or nothing
for a bare position — and `ply` is how far into it the board stands. `moves` is a branch
that leaves the mainline after `base` plies, and `cursor` is how many of its moves are on
the board: `cursor == 0` means the board is on the mainline at `ply`, anything more means
it is in the branch. Stepping back along the mainline keeps the branch, so a variation
survives a look at what was actually played; starting another branch replaces it.

Every mutation publishes `live.updated` carrying the whole new state through
`services.events`, which is what the `/events` sockets hand to the browser. The state
lives here rather than in the socket, so a refresh or a reconnect restores it: the page
fetches `/live` once and follows the events from there.

**Live moves are ephemeral.** Nothing here writes a `Game`, a `Position` or a `MoveEval`.
The one query in the module reads a stored game in order to *start* from it; from that
point the board is an analysis board and anything legal can be played on it without
touching what was actually played.
"""

from __future__ import annotations

import io
import threading
from collections.abc import Mapping, Sequence
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.db.enums import Color
from backend.db.models import Game, GamePosition, Position
from backend.db.types import utcnow
from backend.services import events as events_service
from backend.services import games as games_service

if TYPE_CHECKING:  # pragma: no cover - typing only
    import chess

EVENT_LIVE_UPDATED = "live.updated"

# chessground's brushes, which is what the frontend has to draw the marks with. A colour
# outside this set would reach the board as no colour at all, so it is refused here.
COLORS = ("green", "red", "blue", "yellow")
ARROW_COLOR = "green"
SQUARE_COLOR = "yellow"

# A comment is a sentence or two under the board; the coach's essays go in a note.
MAX_TEXT = 2000
# Enough to mark every piece of one side and then some. A board carrying more marks than
# this is not being annotated, it is being scribbled on.
MAX_MARKS = 32


class LiveError(RuntimeError):
    """Anything the live session reports instead of a stack trace."""


class LiveRequestError(LiveError, ValueError):
    """The request itself is wrong: no board yet, a ply off the end, an unknown colour."""


class LiveFenError(LiveRequestError):
    """That is not a position."""


class IllegalMoveError(LiveRequestError):
    """That move is not legal on the board as it stands."""


class NoLivePositionError(LiveRequestError):
    """There is no live board yet to move on."""


class UnknownLiveGameError(LiveError, LookupError):
    """No game with that id to show."""


@dataclass
class LiveState:
    """The board and what is drawn on it.

    `start` is the position the mainline `line` starts from and `ply` how far into it the
    board stands; `moves` is the branch that leaves it after `base` plies and `cursor` how
    much of that branch is on the board (see the module docstring). `game_id` says which
    stored game the mainline is, when it is one. A bare position has an empty `line` and
    counts its own moves from the FEN it was given, as a branch off ply 0.
    """

    game_id: int | None = None
    ply: int = 0
    base: int = 0
    moves: list[str] = field(default_factory=list)
    cursor: int = 0
    last_move: str | None = None
    arrows: list[dict[str, str]] = field(default_factory=list)
    squares: list[dict[str, str]] = field(default_factory=list)
    text: str | None = None
    updated_at: datetime | None = None
    # The line's first position and the board at the cursor, which `_rebuild` replays from
    # it. Neither is part of the payload: the board goes out as a FEN.
    start: chess.Board | None = None
    board: chess.Board | None = None
    line: tuple[str, ...] = ()
    # Every mainline position with the move that led to it, and the branch in SAN — worked
    # out once when the line or the branch changes, so the move list is never replayed by
    # the browser.
    line_positions: list[dict[str, Any]] = field(default_factory=list)
    move_sans: list[str] = field(default_factory=list)


_STATE = LiveState()
_POSITIONS: list[LiveState] = []
_POSITION_INDEX = 0
# Mutations arrive from MCP tool threads and reads from request threads, so the state is
# only ever touched under this. Events are published outside it: a subscriber that came
# back in here would deadlock on a plain lock and re-enter on a reentrant one.
_LOCK = threading.RLock()
_VIEWERS = 0


# --- what the coach shows --------------------------------------------------


def show_game(session: Session, game_id: int, ply: int = 0) -> dict[str, Any]:
    """Put a stored game on the live board at `ply` half-moves in.

    The moves are replayed from the game's own first position, so a game that did not start
    from the initial array — chess960, an OTB fragment — arrives on the board it was
    actually played on.
    """
    return show_positions(session, [{"game_id": game_id, "ply": ply}])


def show_position(fen: str) -> dict[str, Any]:
    return _show_states([_position_state({"fen": fen}, None)])


def new_board() -> dict[str, Any]:
    """The starting position, ready to be played from — the owner's "new board"."""
    import chess

    return _show_states([_line_state(chess.Board(), ())])


def load(fen: str | None = None, pgn: str | None = None) -> dict[str, Any]:
    """Put a pasted FEN, or a pasted PGN's mainline, on the board.

    A PGN is read the way any PGN is: its `FEN`/`SetUp` headers say where it starts and a
    Chess960 `Variant` header is honoured. Only the mainline is kept — variations and
    comments are the author's, and the board's own branch is where the owner's go. The
    board stands at the end of the mainline, which is what somebody pasting a game to look
    at "this position" means; the move list walks back from there.
    """
    if (fen is None) == (pgn is None):
        raise LiveRequestError("load takes a FEN or a PGN")
    if fen is not None:
        return show_position(fen)
    return _show_states([_pgn_state(str(pgn))])


def _pgn_state(text: str) -> LiveState:
    import chess.pgn

    body = text.strip()
    if not body:
        raise LiveRequestError("a PGN is required")
    game = chess.pgn.read_game(io.StringIO(body))
    if game is None:
        raise LiveRequestError("that is not a PGN")
    if game.errors:
        raise LiveRequestError(f"that PGN could not be read: {game.errors[0]}")
    try:
        start = game.board()
    except ValueError as exc:  # a `FEN` header that is not one
        raise LiveFenError(f"that PGN's FEN header is not a position: {exc}") from None
    moves = tuple(move.uci() for move in game.mainline_moves())
    if not moves and "FEN" not in game.headers:
        raise LiveRequestError("that PGN has no moves")
    state = _line_state(start, moves)
    state.ply = len(moves)
    return _rebuild(state)


def _line_state(start: chess.Board, line: tuple[str, ...]) -> LiveState:
    """A fresh state on `start` with `line` as its mainline, at the first position."""
    state = LiveState(start=start.copy(stack=False), line=line)
    board = start.copy(stack=False)
    state.line_positions = [{"ply": 0, "fen": board.fen(), "san": None, "uci": None}]
    for ply, uci in enumerate(line, 1):
        move = board.parse_uci(uci)
        san = board.san(move)
        board.push(move)
        state.line_positions.append({"ply": ply, "fen": board.fen(), "san": san, "uci": uci})
    return _rebuild(state)


def _position_state(entry: Mapping[str, Any], session: Session | None) -> LiveState:
    from backend.services.explorer import read_fen

    if entry.get("game_id") is not None:
        if entry.get("fen") is not None:
            raise LiveRequestError("use either game_id or fen for each position")
        game = games_service.get_game(session, int(entry["game_id"]))
        if game is None:
            raise UnknownLiveGameError(f"no game with id {entry['game_id']}")
        target = int(entry.get("ply", 0))
        moves = tuple(game.moves_uci or ())
        if target < 0 or target > len(moves):
            raise LiveRequestError(f"ply {target} is outside game {game.id}")
        state = _line_state(_board_at(session, game, 0), moves)
        state.game_id, state.ply = game.id, target
        _rebuild(state)
    else:
        fen = str(entry.get("fen") or "").strip()
        if not fen:
            raise LiveFenError("a FEN is required")
        try:
            state = _line_state(read_fen(fen), ())
        except ValueError as exc:
            raise LiveFenError(str(exc)) from None
    state.text = _comment(entry.get("text") or "") or None
    state.arrows = [_arrow(value) for value in _marks(entry.get("arrows") or [], "arrows")]
    state.squares = [_square(value) for value in _marks(entry.get("squares") or [], "squares")]
    return state


def show_positions(session: Session, positions: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """Replace the queue atomically; each entry is a FEN or game_id/ply with annotations."""
    if not isinstance(positions, (list, tuple)) or not 1 <= len(positions) <= 100:
        raise LiveRequestError("provide between 1 and 100 positions")
    if any(not isinstance(entry, Mapping) for entry in positions):
        raise LiveRequestError("each position must be an object")
    return _show_states([_position_state(entry, session) for entry in positions])


def _show_states(states: list[LiveState]) -> dict[str, Any]:
    global _STATE, _POSITIONS, _POSITION_INDEX
    with _LOCK:
        _POSITIONS, _POSITION_INDEX = states, 0
        _STATE = deepcopy(states[0])
        _touch()
        payload = _payload()
    return _published(payload)


def select_position(index: int) -> dict[str, Any]:
    """Select a queued position, preserving edits when the user returns to it."""
    global _STATE, _POSITION_INDEX
    with _LOCK:
        if index < 0 or index >= len(_POSITIONS):
            raise LiveRequestError("position index is outside the queue")
        _POSITIONS[_POSITION_INDEX] = deepcopy(_STATE)
        _POSITION_INDEX = index
        _STATE = deepcopy(_POSITIONS[index])
        _touch()
        payload = _payload()
    return _published(payload)


def make_move(uci: str) -> dict[str, Any]:
    """Advance the board by one move, given in UCI (`e2e4`, `e7e8q`) — the coach's move.

    Unlike the owner's `play`, this never starts a board of its own: a coach that moves on
    an empty board has lost track of what it is showing, and is told so.
    """
    return play([uci])


def play(ucis: Sequence[str], start_if_empty: bool = False) -> dict[str, Any]:
    """Play `ucis` from the position on the board, in order, all of them or none.

    Legality is decided by the board as it stands, so neither side can put the other in a
    position that does not exist. Each move is placed the way the move list reads it:

    - the branch's own next move steps into the branch, keeping what follows;
    - on the mainline, the mainline's own next move keeps the board on it;
    - anything else is a departure: inside the branch it cuts the branch at the cursor and
      continues from there, on the mainline it starts a new branch here, replacing the old.

    `start_if_empty` is the owner's first drag on an empty board, which starts one from
    the initial position rather than being refused.
    """
    import chess

    global _STATE, _POSITIONS, _POSITION_INDEX
    texts = [str(uci or "").strip() for uci in ucis]
    if not texts or not all(texts):
        raise IllegalMoveError("a move is required")

    with _LOCK:
        if _STATE.board is None:
            if not start_if_empty:
                raise NoLivePositionError(
                    "nothing is on the board yet; call show_game or show_position first"
                )
            state = _line_state(chess.Board(), ())
        else:
            state = deepcopy(_STATE)
        # Played on a copy, so a batch with an illegal move in it changes nothing at all.
        for text in texts:
            _advance(state, text)
        state.arrows.clear()  # the marks named squares of the position that was left
        state.squares.clear()
        if _STATE.board is None:
            _POSITIONS, _POSITION_INDEX = [state], 0
        _STATE = state
        _touch()
        payload = _payload()
    return _published(payload)


def _advance(state: LiveState, text: str) -> None:
    board = state.board
    assert board is not None
    try:
        played = board.parse_uci(text).uci()
    except ValueError as exc:
        raise IllegalMoveError(f"{text!r} is not legal here: {exc}") from None

    in_branch = state.cursor > 0
    at_branch = bool(state.moves) and (in_branch or state.ply == state.base)
    if at_branch and state.cursor < len(state.moves) and state.moves[state.cursor] == played:
        state.cursor += 1
    elif not in_branch and state.ply < len(state.line) and state.line[state.ply] == played:
        state.ply += 1
    elif in_branch:
        state.moves = [*state.moves[: state.cursor], played]
        state.cursor += 1
    else:
        state.base, state.moves, state.cursor = state.ply, [played], 1
    _rebuild(state)


def goto(ply: int, cursor: int = 0) -> dict[str, Any]:
    """Step the board to mainline ply `ply`, or `cursor` moves into the branch.

    A `cursor` above 0 names a move of the branch, which hangs off one ply only, so `ply`
    must be that ply. Stepping along the mainline keeps the branch where it is.
    """
    with _LOCK:
        if _STATE.board is None:
            raise NoLivePositionError("nothing is on the board yet")
        if cursor < 0:
            raise LiveRequestError("cursor is never negative")
        if cursor > 0 and (ply != _STATE.base or cursor > len(_STATE.moves)):
            raise LiveRequestError(f"there is no branch move {cursor} after ply {ply}")
        if ply < 0 or ply > len(_STATE.line):
            raise LiveRequestError(f"ply {ply} is outside the line")
        _STATE.ply, _STATE.cursor = ply, cursor
        _rebuild(_STATE)
        _STATE.arrows.clear()
        _STATE.squares.clear()
        _touch()
        payload = _payload()
    return _published(payload)


def annotate(
    arrows: Sequence[Any] | None = None,
    squares: Sequence[Any] | None = None,
    text: str | None = None,
) -> dict[str, Any]:
    """Draw on the live board. Each argument replaces what was there; omitting one leaves
    it alone, and passing an empty list or an empty string clears it.

    An arrow is `"e2e4"` or `"e2e4:blue"`, or `{"from": "e2", "to": "e4", "color": "blue"}`;
    a highlight is `"e4"` or `"e4:red"`, or `{"square": "e4", "color": "red"}`.
    """
    if arrows is None and squares is None and text is None:
        raise LiveRequestError("annotate needs arrows, squares or text")

    drawn = None if arrows is None else [_arrow(entry) for entry in _marks(arrows, "arrows")]
    marked = None if squares is None else [_square(entry) for entry in _marks(squares, "squares")]
    comment = None if text is None else _comment(text)

    with _LOCK:
        if drawn is not None:
            _STATE.arrows = drawn
        if marked is not None:
            _STATE.squares = marked
        if comment is not None:
            _STATE.text = comment or None
        _touch()
        payload = _payload()
    return _published(payload)


def clear() -> dict[str, Any]:
    """Take everything off the live board. The page falls back to whatever it shows idle."""
    with _LOCK:
        _reset()
        _touch()
        payload = _payload()
    return _published(payload)


def get_state() -> dict[str, Any]:
    """The live board as the UI renders it and the coach reads it back. No mutation."""
    with _LOCK:
        return _payload()


# --- who is watching -------------------------------------------------------


def viewer_joined() -> int:
    """One more `/events` socket is connected. Called by the API's socket lifecycle."""
    global _VIEWERS
    with _LOCK:
        _VIEWERS += 1
        return _VIEWERS


def viewer_left() -> int:
    """One fewer. Never negative: a socket that was never counted must not push it under."""
    global _VIEWERS
    with _LOCK:
        _VIEWERS = max(0, _VIEWERS - 1)
        return _VIEWERS


def viewer_count() -> int:
    """How many browsers are currently following the live session."""
    with _LOCK:
        return _VIEWERS


# --- internals -------------------------------------------------------------


def _reset() -> None:
    """Back to an empty board. Called under `_LOCK`; the viewer count is not state."""
    global _POSITION_INDEX
    _POSITIONS.clear()
    _POSITION_INDEX = 0
    _STATE.line_positions = []
    _STATE.move_sans = []
    _STATE.game_id = None
    _STATE.ply = 0
    _STATE.base = 0
    _STATE.moves = []
    _STATE.cursor = 0
    _STATE.last_move = None
    _STATE.arrows = []
    _STATE.squares = []
    _STATE.text = None
    _STATE.start = None
    _STATE.board = None
    _STATE.line = ()
    _touch()


def _rebuild(state: LiveState) -> LiveState:
    """Replay the board at the cursor from `start`, and the branch's SAN with it."""
    if state.start is None:
        return state
    in_branch = state.cursor > 0
    board = state.start.copy(stack=False)
    for uci in state.line[: state.base if in_branch else state.ply]:
        board.push(board.parse_uci(uci))
    # The branch leaves the mainline at `base`, wherever the board is standing on it.
    branch = board.copy(stack=False) if in_branch else state.start.copy(stack=False)
    if not in_branch:
        for uci in state.line[: state.base]:
            branch.push(branch.parse_uci(uci))
    state.move_sans = []
    for index, uci in enumerate(state.moves):
        move = branch.parse_uci(uci)
        state.move_sans.append(branch.san(move))
        branch.push(move)
        if in_branch and index + 1 == state.cursor:
            board = branch.copy(stack=False)
    state.board = board
    if in_branch:
        state.last_move = state.moves[state.cursor - 1]
    else:
        state.last_move = state.line[state.ply - 1] if state.ply else None
    return state


def _touch() -> None:
    _STATE.updated_at = utcnow()


def _payload() -> dict[str, Any]:
    """The whole state, as both the `/live` response and the `live.updated` event.

    `ply` is None on a bare position — there is no mainline to count along — and is the
    branch's base while the board is in the branch, so a reader that only knows `ply` and
    `moves` reads it exactly as before the branch learned a cursor.
    """
    board = _STATE.board
    has_line = _STATE.game_id is not None or bool(_STATE.line)
    return {
        "active": board is not None,
        "position_index": _POSITION_INDEX,
        "position_count": len(_POSITIONS),
        "line_positions": deepcopy(_STATE.line_positions),
        "game_id": _STATE.game_id,
        "ply": _STATE.ply if board is not None and has_line else None,
        "base": _STATE.base if _STATE.moves else None,
        "cursor": _STATE.cursor,
        "fen": board.fen() if board is not None else None,
        "turn": _turn(board),
        "moves": list(_STATE.moves),
        "move_sans": list(_STATE.move_sans),
        "last_move": _STATE.last_move,
        "arrows": [dict(arrow) for arrow in _STATE.arrows],
        "squares": [dict(square) for square in _STATE.squares],
        "text": _STATE.text,
        "viewer_count": _VIEWERS,
        "updated_at": _STATE.updated_at.isoformat() if _STATE.updated_at else None,
    }


def _published(payload: dict[str, Any]) -> dict[str, Any]:
    """Announce a mutation, outside the lock, and hand the caller what it published."""
    events_service.emit({"event": EVENT_LIVE_UPDATED, **payload})
    return payload


def _turn(board: chess.Board | None) -> str | None:
    if board is None:
        return None
    import chess

    return str(Color.WHITE if board.turn == chess.WHITE else Color.BLACK)


def _board_at(session: Session, game: Game, ply: int) -> chess.Board:
    """The game's position after `ply` half-moves, replayed from where it started."""
    import chess

    from backend.services.import_service import CHESS960_VARIANTS

    initial = session.scalar(
        select(Position.fen)
        .join(GamePosition, GamePosition.position_id == Position.id)
        .where(GamePosition.game_id == game.id, GamePosition.ply == 0)
    )
    chess960 = (game.variant or "").lower() in CHESS960_VARIANTS
    board = chess.Board(initial, chess960=chess960) if initial else chess.Board(chess960=chess960)
    board.chess960 = board.chess960 or board.has_chess960_castling_rights()
    for uci in (game.moves_uci or ())[:ply]:
        board.push(board.parse_uci(uci))
    return board


def _marks(values: Sequence[Any], field_name: str) -> list[Any]:
    if isinstance(values, str | bytes) or not isinstance(values, Sequence):
        raise LiveRequestError(f"{field_name} is a list, not {type(values).__name__}")
    entries = [value for value in values if value not in (None, "")]
    if len(entries) > MAX_MARKS:
        raise LiveRequestError(f"{field_name} carries more than {MAX_MARKS} marks")
    return entries


def _arrow(value: Any) -> dict[str, str]:
    if isinstance(value, Mapping):
        origin = value.get("from") or value.get("orig")
        target = value.get("to") or value.get("dest")
        color = value.get("color") or value.get("brush") or ARROW_COLOR
        return {
            "from": _square_name(origin, "arrow"),
            "to": _square_name(target, "arrow"),
            "color": _color(color),
        }
    text, _, color = str(value).strip().partition(":")
    if len(text) != 4:
        raise LiveRequestError(f"{value!r} is not an arrow; write one as 'e2e4' or 'e2e4:blue'")
    return {
        "from": _square_name(text[:2], "arrow"),
        "to": _square_name(text[2:], "arrow"),
        "color": _color(color or ARROW_COLOR),
    }


def _square(value: Any) -> dict[str, str]:
    if isinstance(value, Mapping):
        name = value.get("square") or value.get("key")
        color = value.get("color") or value.get("brush") or SQUARE_COLOR
        return {"square": _square_name(name, "highlight"), "color": _color(color)}
    text, _, color = str(value).strip().partition(":")
    return {"square": _square_name(text, "highlight"), "color": _color(color or SQUARE_COLOR)}


def _square_name(value: Any, kind: str) -> str:
    import chess

    name = str(value or "").strip().casefold()
    if name not in chess.SQUARE_NAMES:
        raise LiveRequestError(f"{value!r} is not a square of the board ({kind})")
    return name


def _color(value: Any) -> str:
    name = str(value or "").strip().casefold()
    if name not in COLORS:
        raise LiveRequestError(f"unknown colour {value!r}; it is one of {', '.join(COLORS)}")
    return name


def _comment(text: str) -> str:
    body = str(text).strip()
    if len(body) > MAX_TEXT:
        raise LiveRequestError(f"a live comment is at most {MAX_TEXT} characters")
    return body
