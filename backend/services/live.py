"""The live session: the one board the coach is driving.

The owner works split-screen — Blunderbase in the browser, the coach in a chat beside it —
and this module is what keeps the two looking at the same position. There is exactly one
live board because there is exactly one owner: the game and ply they are being shown, or
an ad-hoc FEN with the moves played on top of it, plus the arrows, highlights and comment
drawn over it.

Every mutation publishes `live.updated` carrying the whole new state through
`services.events`, which is what the `/events` sockets hand to the browser. The state
lives here rather than in the socket, so a refresh or a reconnect restores it: the page
fetches `/live` once and follows the events from there.

**Live moves are ephemeral.** Nothing here writes a `Game`, a `Position` or a `MoveEval`.
The one query in the module reads a stored game in order to *start* from it; from that
point the board is an analysis board and the coach can play anything legal on it without
touching what was actually played.
"""

from __future__ import annotations

import threading
from collections.abc import Mapping, Sequence
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
    """The live board and what is drawn on it.

    `game_id` and `ply` say which stored game the board is following and how far into it;
    `moves` holds what the coach has played beyond that line, so an empty `moves` means the
    board still *is* the game at `ply` and a non-empty one means it has left it. An ad-hoc
    position carries no `game_id` and counts its own moves from the FEN it was given.
    """

    game_id: int | None = None
    ply: int | None = None
    moves: list[str] = field(default_factory=list)
    last_move: str | None = None
    arrows: list[dict[str, str]] = field(default_factory=list)
    squares: list[dict[str, str]] = field(default_factory=list)
    text: str | None = None
    updated_at: datetime | None = None
    # The board itself, and the move list of the game it is following. Neither is part of
    # the payload: the first goes out as a FEN, the second is only here so `make_move` can
    # tell "the game's next move" from a departure without opening a Session.
    board: chess.Board | None = None
    line: tuple[str, ...] = ()


_STATE = LiveState()
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
    game = games_service.get_game(session, int(game_id))
    if game is None:
        raise UnknownLiveGameError(f"no game with id {game_id}")

    moves = tuple(game.moves_uci or ())
    target = int(ply)
    if target < 0 or target > len(moves):
        raise LiveRequestError(
            f"ply {target} is outside game {game.id}, which has {len(moves)} half-moves"
        )

    board = _board_at(session, game, target)
    with _LOCK:
        _reset()
        _STATE.game_id = game.id
        _STATE.ply = target
        _STATE.board = board
        _STATE.line = moves
        _STATE.last_move = moves[target - 1] if target else None
        payload = _payload()
    return _published(payload)


def show_position(fen: str) -> dict[str, Any]:
    """Put an ad-hoc position on the live board. Accepts a FEN, an EPD, or either of the
    two with chess960 castling rights — the same spellings every other surface takes."""
    from backend.services.explorer import read_fen

    text = (fen or "").strip()
    if not text:
        raise LiveFenError("a FEN is required")
    try:
        board = read_fen(text)
    except ValueError as exc:
        raise LiveFenError(str(exc)) from None

    with _LOCK:
        _reset()
        _STATE.board = board
        payload = _payload()
    return _published(payload)


def make_move(uci: str) -> dict[str, Any]:
    """Advance the live board by one move, given in UCI (`e2e4`, `e7e8q`).

    Legality is decided by the board as it stands, so a coach walking a line can never put
    the browser in a position that does not exist. Playing the followed game's own next
    move keeps the board on that game — anything else is a departure from it, and the state
    says which happened.
    """
    text = (uci or "").strip()
    if not text:
        raise IllegalMoveError("a move is required")

    with _LOCK:
        board = _STATE.board
        if board is None:
            raise NoLivePositionError(
                "nothing is on the live board yet; call show_game or show_position first"
            )
        try:
            move = board.parse_uci(text)
        except ValueError as exc:
            raise IllegalMoveError(f"{text!r} is not legal here: {exc}") from None

        played = move.uci()
        following = (
            _STATE.game_id is not None
            and not _STATE.moves
            and _STATE.ply is not None
            and _STATE.ply < len(_STATE.line)
            and _STATE.line[_STATE.ply] == played
        )
        board.push(move)
        if following:
            _STATE.ply = (_STATE.ply or 0) + 1
        else:
            _STATE.moves.append(played)
        _STATE.last_move = played
        # The marks named squares of the position that has just been left.
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
    _STATE.game_id = None
    _STATE.ply = None
    _STATE.moves = []
    _STATE.last_move = None
    _STATE.arrows = []
    _STATE.squares = []
    _STATE.text = None
    _STATE.board = None
    _STATE.line = ()
    _touch()


def _touch() -> None:
    _STATE.updated_at = utcnow()


def _payload() -> dict[str, Any]:
    """The whole state, as both the `/live` response and the `live.updated` event."""
    board = _STATE.board
    return {
        "active": board is not None,
        "game_id": _STATE.game_id,
        "ply": _STATE.ply,
        "fen": board.fen() if board is not None else None,
        "turn": _turn(board),
        "moves": list(_STATE.moves),
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
