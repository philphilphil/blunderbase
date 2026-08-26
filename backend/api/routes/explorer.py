"""`/explorer` — the owner's personal opening tree and "have I been here before?"."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Query

from backend.api.deps import SessionDep
from backend.api.schemas import ExplorerResponse, PositionOccurrence
from backend.db.enums import Color
from backend.services import explorer as explorer_service

router = APIRouter(prefix="/explorer", tags=["explorer"])

MAX_MOVES = 100


@router.get("", response_model=ExplorerResponse, summary="The personal tree from a position")
def explore(
    session: SessionDep,
    fen: Annotated[str | None, Query(description="a FEN or an EPD; omit for the start")] = None,
    eco: Annotated[str | None, Query(description="an ECO code or prefix")] = None,
    color: Annotated[Color | None, Query(description="only games the owner had this")] = None,
    limit: Annotated[int, Query(ge=0, le=MAX_MOVES)] = 20,
    min_games: Annotated[int, Query(ge=1)] = 1,
) -> Any:
    """Per continuation: frequency, score, average eval drop, and where book runs out."""
    return explorer_service.opening_explorer(
        session, fen=fen, eco=eco, color=color, limit=limit, min_games=min_games
    )


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
