"""`/reference` — Lichess's masters and rated databases, beside the owner's own explorer.

The other explorer. `/explorer` answers from games the owner played; this answers from two
databases they have never touched, over the network, and stores none of it. The two are
separate routers for exactly that reason: a client that mixes their numbers has to do it on
purpose, and nothing on this side can ever add a game to the library.

`source` is a literal rather than a free string, so a typo is FastAPI's 422 before the
service is called; `speeds` and `ratings` arrive as comma-separated lists the way the web
app already spells a set in a URL, and an entry neither side knows is dropped rather than
refused — a mistyped filter should cost the filter, not the position.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query

from backend.api.deps import SessionDep
from backend.api.schemas import (
    ReferenceExplorer,
    ReferenceGame,
    ReferenceToken,
    ReferenceTokenUpdate,
)
from backend.services import app_settings as app_settings_service
from backend.services import reference as reference_service

router = APIRouter(prefix="/reference", tags=["reference"])

Source = Literal["masters", "lichess"]


@router.get(
    "/explorer",
    response_model=ReferenceExplorer,
    summary="A position in a reference database",
)
def explore(
    session: SessionDep,
    source: Annotated[Source, Query(description="the masters archive or the rated pools")],
    fen: Annotated[str | None, Query(description="a FEN or an EPD; omit for the start")] = None,
    speeds: Annotated[
        str | None, Query(description="rated pools only, e.g. `blitz,rapid`")
    ] = None,
    ratings: Annotated[
        str | None, Query(description="rated pools only, Lichess bands, e.g. `1600,1800`")
    ] = None,
    moves: Annotated[int, Query(ge=0, le=reference_service.MAX_MOVES)] = (
        reference_service.DEFAULT_MOVES
    ),
    top_games: Annotated[int, Query(ge=0, le=reference_service.MAX_TOP_GAMES)] = (
        reference_service.DEFAULT_TOP_GAMES
    ),
) -> Any:
    """Continuations, the position's record, and the strongest games that reached it.

    Needs the owner's Lichess token: the explorer endpoints stopped answering anonymous
    requests, which is a 409 the page turns into "paste a token" rather than an empty tree.
    """
    return reference_service.explore(
        session,
        source=source,
        fen=fen,
        speeds=_csv(speeds),
        ratings=_csv(ratings),
        limit=moves,
        top_games=top_games,
    )


@router.get(
    "/games/{source}/{game_id}",
    response_model=ReferenceGame,
    summary="One reference game, read-only",
)
def model_game(session: SessionDep, source: Source, game_id: str) -> Any:
    """A model game to play through. It is never imported — there is no route that would."""
    return reference_service.model_game(session, source=source, game_id=game_id)


@router.get("/token", response_model=ReferenceToken, summary="Is a Lichess token stored")
def get_token(session: SessionDep) -> ReferenceToken:
    """Whether, not which: the stored token is never answered with, only replaced."""
    return ReferenceToken(configured=reference_service.has_token(session))


@router.put("/token", response_model=ReferenceToken, summary="Store or clear the token")
def put_token(session: SessionDep, body: ReferenceTokenUpdate) -> ReferenceToken:
    """A null or empty token clears the stored one, which switches the reference sources off."""
    stored = app_settings_service.set_lichess_token(session, body.token)
    return ReferenceToken(configured=stored is not None)


def _csv(value: str | None) -> list[str]:
    """`blitz,rapid` as a list. What the entries mean is the service's to decide."""
    if not value:
        return []
    return [part.strip() for part in value.split(",") if part.strip()]
