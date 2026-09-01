"""`/repertoire` — the two opening trees, one per colour the owner plays.

Two prefixes under the one router, which is why the paths are spelled out rather than
carried as a router prefix: a tree is addressed by its colour (`/repertoire/{color}`) and a
single move by its own id (`/repertoire/moves/{id}`), because a move's id is enough to find
it and making the client repeat the colour would let the two disagree.

The colour is the `Color` enum, so a path that is not `white` or `black` is a 422 from
FastAPI before any handler runs.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Response, status

from backend.api.deps import SessionDep
from backend.api.schemas import (
    RepertoireLineAdded,
    RepertoireLineCreate,
    RepertoireMoveResponse,
    RepertoireMoveUpdate,
    RepertoireTree,
)
from backend.db.enums import Color
from backend.services import repertoire as repertoire_service

router = APIRouter(prefix="/repertoire", tags=["repertoire"])


@router.get("/{color}", response_model=RepertoireTree, summary="One colour's repertoire")
def get_repertoire(session: SessionDep, color: Color) -> Any:
    """The whole tree. Siblings come back in `rank` order, and rank 0 is the main line."""
    return repertoire_service.tree(session, color)


@router.post(
    "/{color}/line",
    response_model=RepertoireLineAdded,
    status_code=status.HTTP_201_CREATED,
    summary="Add a line to a repertoire",
)
def add_line(session: SessionDep, color: Color, body: RepertoireLineCreate) -> Any:
    """Walk a line of UCI moves from the start position, creating the ones not stored yet.

    Idempotent: a line already in the tree creates nothing and comes back with `created`
    at zero. An illegal or garbled move is a 422 rather than a half-written line.
    """
    return repertoire_service.add_line(session, color, body.ucis)


@router.patch(
    "/moves/{move_id}",
    response_model=RepertoireMoveResponse,
    summary="Comment on a move, or make it the main line",
)
def update_move(session: SessionDep, move_id: int, body: RepertoireMoveUpdate) -> Any:
    """`comment: null` clears the comment; omitting the field leaves it as it was.

    Which is why the body is read through `model_fields_set` rather than by testing for
    None — the two are different requests and the service takes them as different
    arguments.
    """
    given = body.model_fields_set
    return repertoire_service.update_move(
        session,
        move_id,
        comment=body.comment if "comment" in given else repertoire_service.UNCHANGED,
        promote=body.promote,
    )


@router.delete(
    "/moves/{move_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Forget a move and everything after it",
)
def delete_move(session: SessionDep, move_id: int) -> Response:
    """Deletes the node and its whole subtree — the preparation, not just the move."""
    repertoire_service.delete_move(session, move_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
