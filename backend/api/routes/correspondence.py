"""`/correspondence` — the games the owner is playing, and the tree behind each of them.

Three groups of routes under one prefix: the games (list, create, import, read, patch, the
two that move the game, finish), the tree's nodes (create, patch, delete), and the export.
A node is addressed by its own id rather than under its game, because an id is enough to
find it and making the client repeat the game would let the two disagree — the repertoire's
rule, for the same reason.

Every handler is a thin call into `services.correspondence`, which owns what a
correspondence game is; the typed failures it raises are turned into status codes by
`api/errors.py`. The mode is deliberately not gated here: `correspondence_enabled` decides
whether the *rail entry* exists and whether the client routes there, and a deployment that
has switched the mode off but still holds games must be able to read them.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Response, status

from backend.api.deps import SessionDep
from backend.api.schemas import (
    CorrespondenceFinish,
    CorrespondenceGameCreate,
    CorrespondenceGameDetail,
    CorrespondenceGameList,
    CorrespondenceGameUpdate,
    CorrespondenceMoveCreate,
    CorrespondenceNodeAdded,
    CorrespondenceNodeCreate,
    CorrespondenceNodeResponse,
    CorrespondenceNodeUpdate,
    CorrespondencePgnImport,
)
from backend.services import correspondence as correspondence_service

router = APIRouter(prefix="/correspondence", tags=["correspondence"])


@router.get("/games", response_model=CorrespondenceGameList, summary="Correspondence games")
def list_games(session: SessionDep, state: str | None = None) -> Any:
    """`state=ongoing` or `state=finished`; without one, every game.

    One ordering with two cuts in it — your move by due date, then the opponent's, then the
    finished — so the page's three sections are a client-side split rather than three calls.
    """
    return correspondence_service.list_games(session, state=state)


@router.post(
    "/games",
    response_model=CorrespondenceGameDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Start a correspondence game",
)
def create_game(session: SessionDep, body: CorrespondenceGameCreate) -> Any:
    """The game goes in through the ordinary import path, with no automatic quick pass."""
    return correspondence_service.create_game(
        session,
        white=body.white,
        black=body.black,
        owner_color=body.owner_color,
        event=body.event,
        url=body.url,
        iccf_id=body.iccf_id,
        time_control=body.time_control,
        start_fen=body.start_fen,
        days_per_move=body.days_per_move,
        reply_due=body.reply_due,
        white_rating=body.white_rating,
        black_rating=body.black_rating,
    )


@router.post(
    "/games/import",
    response_model=CorrespondenceGameDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Start one from a PGN",
)
def import_game(session: SessionDep, body: CorrespondencePgnImport) -> Any:
    """The moves in the PGN arrive as the tree's played path, so the spine is already there."""
    return correspondence_service.import_game(
        session,
        body.pgn,
        owner_color=body.owner_color,
        event=body.event,
        url=body.url,
        iccf_id=body.iccf_id,
        days_per_move=body.days_per_move,
        reply_due=body.reply_due,
    )


@router.get(
    "/games/{game_id}",
    response_model=CorrespondenceGameDetail,
    summary="One game, its tree, its evaluations and its searches",
)
def get_game(session: SessionDep, game_id: int) -> Any:
    """One payload: the page has no second request to make before it can draw."""
    return correspondence_service.get_game(session, game_id)


@router.patch(
    "/games/{game_id}",
    response_model=CorrespondenceGameDetail,
    summary="Change the event, the link or the deadlines",
)
def update_game(session: SessionDep, game_id: int, body: CorrespondenceGameUpdate) -> Any:
    """A field left out is left alone; a field given as null is cleared.

    Which is why the body is read through `model_fields_set` — the two are different
    requests and the service takes them as different arguments.
    """
    given = body.model_fields_set
    unchanged = correspondence_service.UNCHANGED
    return correspondence_service.update_game(
        session,
        game_id,
        event=body.event if "event" in given else unchanged,
        url=body.url if "url" in given else unchanged,
        reply_due=body.reply_due if "reply_due" in given else unchanged,
        days_per_move=body.days_per_move if "days_per_move" in given else unchanged,
    )


@router.post(
    "/games/{game_id}/moves",
    response_model=CorrespondenceGameDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Play a move — either side's",
)
def play_move(session: SessionDep, game_id: int, body: CorrespondenceMoveCreate) -> Any:
    """Appends to the game and marks the node played, in one transaction."""
    return correspondence_service.play_move(session, game_id, body.uci)


@router.delete(
    "/games/{game_id}/moves/last",
    response_model=CorrespondenceGameDetail,
    summary="Take the last move back",
)
def undo_move(session: SessionDep, game_id: int) -> Any:
    """The node stays where it is, unplayed: the analysis under it is still worth what it was."""
    return correspondence_service.undo_move(session, game_id)


@router.post(
    "/games/{game_id}/finish",
    response_model=CorrespondenceGameDetail,
    summary="Record the result and hand the game to the library",
)
def finish_game(session: SessionDep, game_id: int, body: CorrespondenceFinish) -> Any:
    """Queues the ordinary quick and deep passes, and freezes the tree."""
    return correspondence_service.finish_game(
        session, game_id, result=body.result, termination=body.termination
    )


@router.get(
    "/games/{game_id}/pgn",
    response_class=Response,
    summary="The game with its tree as variations",
    responses={200: {"content": {"application/x-chess-pgn": {}}}},
)
def export_pgn(session: SessionDep, game_id: int) -> Response:
    """Comments as comments, marks as NAGs, each node's chosen evaluation as `{[%eval ...]}`."""
    return Response(
        content=correspondence_service.export_pgn(session, game_id),
        media_type="application/x-chess-pgn; charset=utf-8",
        headers={"content-disposition": f'attachment; filename="correspondence-{game_id}.pgn"'},
    )


@router.post(
    "/nodes",
    response_model=CorrespondenceNodeAdded,
    status_code=status.HTTP_201_CREATED,
    summary="Put a move, or a line, into the tree",
)
def add_node(session: SessionDep, body: CorrespondenceNodeCreate) -> Any:
    """Idempotent: a move already stored under the parent is reused, and `created` says so."""
    return correspondence_service.add_node(
        session, parent_id=body.parent_id, ucis=body.ucis or [body.uci or ""]
    )


@router.patch(
    "/nodes/{node_id}",
    response_model=CorrespondenceNodeResponse,
    summary="Comment on a node, mark it, pin an engine or promote it",
)
def update_node(session: SessionDep, node_id: int, body: CorrespondenceNodeUpdate) -> Any:
    """A field left out is left alone; null clears it. `promote` makes it the first sibling."""
    given = body.model_fields_set
    unchanged = correspondence_service.UNCHANGED
    return correspondence_service.update_node(
        session,
        node_id,
        comment=body.comment if "comment" in given else unchanged,
        mark=body.mark if "mark" in given else unchanged,
        pinned_engine_id=(body.pinned_engine_id if "pinned_engine_id" in given else unchanged),
        conditional=body.conditional if "conditional" in given else unchanged,
        promote=body.promote,
    )


@router.delete(
    "/nodes/{node_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Forget a move and everything after it",
)
def delete_node(session: SessionDep, node_id: int) -> Response:
    """Refused for the root, for a move the game has played, and while a search is inside it."""
    correspondence_service.delete_node(session, node_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
