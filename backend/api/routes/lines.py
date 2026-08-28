"""`/lines` — the variations worth keeping, and the notes hanging off them.

Two prefixes rather than one, which is why this router carries no `prefix` of its own: a
line is addressed by its own id (`/lines/{id}`), and the set of them is a property of a game
(`/games/{id}/lines`). Both are the same three service functions.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Response, status

from backend.api.deps import SessionDep, not_found
from backend.api.schemas import LineCreate, LineResponse
from backend.services import notes as notes_service

router = APIRouter(tags=["lines"])


@router.post(
    "/lines",
    response_model=LineResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Keep a variation",
)
def save_line(session: SessionDep, body: LineCreate) -> Any:
    """Pin a line off a game.

    Idempotent by design rather than by id: a line already covered by a kept one comes back
    as that one, and a line that continues a kept one extends it — see
    `services.notes.save_line`. A 201 either way, because what the caller asked for is
    stored when it answers.
    """
    line = notes_service.save_line(session, body.game_id, body.base_ply, body.moves)
    return notes_service.line_payload(line, with_notes=True)


@router.get(
    "/games/{game_id}/lines",
    response_model=list[LineResponse],
    summary="The variations kept on a game",
)
def list_lines(session: SessionDep, game_id: int) -> list[Any]:
    return [
        notes_service.line_payload(line, with_notes=True)
        for line in notes_service.get_lines(session, game_id)
    ]


@router.delete(
    "/lines/{line_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Unpin a variation"
)
def delete_line(session: SessionDep, line_id: int) -> Response:
    """Forget the line. Notes written about it survive with their `line_id` cleared."""
    if not notes_service.delete_line(session, line_id):
        raise not_found("unknown_line", f"no line with id {line_id}")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
