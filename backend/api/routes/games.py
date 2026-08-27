"""`/games` — the games table and the flagship game view, and the one route that empties it."""

from __future__ import annotations

from dataclasses import asdict
from typing import Annotated

from fastapi import APIRouter, Query, status

from backend.api.deps import FiltersDep, SessionDep, not_found, ply_range
from backend.api.errors import ApiError
from backend.api.schemas import GameDetail, GameList, GamesDeleted, GamesWipe
from backend.services import auth as auth_service
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


@router.post("/delete-all", response_model=GamesDeleted, summary="Delete every game")
def delete_all_games(session: SessionDep, body: GamesWipe) -> GamesDeleted:
    """Empty the library, on the owner's password rather than on their cookie.

    A POST rather than a DELETE because the password travels in the body, and a body on a
    DELETE is something clients and proxies disagree about. The password is checked the way
    the login route checks it, lockout and all: a browser that is already signed in has
    proved it is *a* session, not that the person at it meant this.

    Accounts, engines, runners and the settings stay; so do notes about a position rather
    than about a game. The sync history goes, so the next sync of a source starts over —
    see `services.games.delete_all_games`.
    """
    if not auth_service.verify_password(session, body.password):
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED, "invalid_password", "that is not the password"
        )
    return GamesDeleted(**asdict(games_service.delete_all_games(session)))


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
