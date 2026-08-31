"""`/explorer` — the owner's personal opening tree and "have I been here before?"."""

from __future__ import annotations

import re
from typing import Annotated, Any

from fastapi import APIRouter, Query

from backend.api.deps import SessionDep
from backend.api.schemas import ExplorerResponse, GameBookEntry, PositionOccurrence
from backend.db.enums import Color
from backend.services import explorer as explorer_service

# The same cap the game's own shipped book uses, so the two paths cannot disagree about how
# long a strip beside the board is.
from backend.services.games import BOOK_MAX_MOVES

router = APIRouter(prefix="/explorer", tags=["explorer"])

MAX_MOVES = 100

# How the web app spells a line in the URL — `web/src/routes/explorer/line.ts`'s
# `parseLineParam` is the reference, down to dropping what does not match rather than
# refusing the request. A line only names the opening, so a garbled crumb costs a name and
# never a tree; a 422 would take the page away over a link someone edited by hand.
UCI = re.compile(r"^[a-h][1-8][a-h][1-8][qrbn]?$")


@router.get("", response_model=ExplorerResponse, summary="The personal tree from a position")
def explore(
    session: SessionDep,
    fen: Annotated[str | None, Query(description="a FEN or an EPD; omit for the start")] = None,
    eco: Annotated[str | None, Query(description="an ECO code or prefix")] = None,
    color: Annotated[Color | None, Query(description="only games the owner had this")] = None,
    limit: Annotated[int, Query(ge=0, le=MAX_MOVES)] = 20,
    min_games: Annotated[int, Query(ge=1)] = 1,
    line: Annotated[
        str | None,
        Query(description="the UCI moves this position was reached by, `e2e4,e7e5`"),
    ] = None,
) -> Any:
    """Per continuation: frequency, score, average eval drop, and where book runs out."""
    return explorer_service.opening_explorer(
        session,
        fen=fen,
        eco=eco,
        color=color,
        limit=limit,
        min_games=min_games,
        line=_line(line),
    )


def _line(value: str | None) -> list[str]:
    """`e2e4,e7e5` as a move list, anything that is not a UCI move dropped."""
    if not value:
        return []
    return [move for move in (part.strip().lower() for part in value.split(",")) if UCI.match(move)]


@router.get(
    "/book",
    response_model=GameBookEntry | None,
    summary="One position's strip of continuations",
)
def position_book(
    session: SessionDep,
    fen: Annotated[str, Query(description="the position on the board, as a FEN or an EPD")],
    color: Annotated[Color | None, Query(description="only games the owner had this")] = None,
) -> Any:
    """The same strip a game ships with it, for a position that game does not contain.

    A game carries the book for its own plies, so stepping through it costs no request. This
    is what the board asks for once the reader has played a move of their own and stands
    somewhere that payload cannot describe. Null for a position no two of the owner's games
    reached — which is nearly all of them — and null rather than a 422 for a FEN that will
    not parse, because the caller is a board and an empty strip is the useful answer.
    """
    return explorer_service.position_book(session, fen, color=color, limit=BOOK_MAX_MOVES)


@router.get(
    "/positions",
    response_model=list[PositionOccurrence],
    summary="The games that reached a position",
)
def find_positions(
    session: SessionDep,
    fen: Annotated[str, Query(description="a FEN or an EPD")],
    color: Color | None = None,
    limit: Annotated[int, Query(ge=1, le=MAX_MOVES)] = 20,
) -> list[Any]:
    return explorer_service.find_positions(session, fen, color=color, limit=limit)
