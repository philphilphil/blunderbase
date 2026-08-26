"""`/games` — the games table and the flagship game view."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from backend.api.deps import FiltersDep, SessionDep, not_found, ply_range
from backend.api.schemas import GameDetail, GameList
from backend.services import games as games_service

router = APIRouter(prefix="/games", tags=["games"])

MAX_PAGE = 200


@router.get("", response_model=GameList, summary="Search games")
def list_games(
    session: SessionDep,
    filters: FiltersDep,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    cards: Annotated[bool, Query(description="add the eval curve and the worst moments")] = False,
) -> GameList:
    """One page of games, newest first, with the total the filters match."""
    found = games_service.search_games(session, filters, limit=limit, offset=offset)
    rows = (
        games_service.game_cards(session, found)
        if cards
        else [games_service.game_summary(game) for game in found]
    )
    return GameList(
        games=rows,
        total=games_service.count_games(session, filters),
        limit=limit,
        offset=offset,
    )


@router.get("/{game_id}", response_model=GameDetail, summary="One game with its analysis")
def get_game(
    session: SessionDep,
    game_id: int,
    ply_start: Annotated[int | None, Query(ge=0)] = None,
    ply_end: Annotated[int | None, Query(ge=0, description="inclusive")] = None,
    notes: Annotated[bool, Query(description="include the notes attached to the game")] = True,
) -> GameDetail:
    """Moves, merged evals, Maia predictions, the runs behind them and the notes.

    The ply window here is inclusive at both ends: it names moves to show, not the
    half-open window an analysis run is configured with.
    """
    detail = games_service.get_game_detail(
        session,
        game_id,
        ply_range=ply_range(ply_start, ply_end),
        include_notes=notes,
    )
    if detail is None:
        raise not_found("unknown_game", f"no game with id {game_id}")
    return GameDetail.model_validate(detail)
