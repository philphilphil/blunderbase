"""`/streams` — infinite analysis: open a board, move it, close it.

Only the control is REST. The output rides the `/events` socket as `stream.snapshot`,
because a browser wants two pictures a second and a poll is the wrong shape for that; a
session's lifecycle is announced there too, as `stream.started` and `stream.ended`.

Nothing here can tell a local engine from one on a runner, and neither can the client: the
`runner_id` in the response is context, not a different kind of session.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request, Response, status

from backend.api.schemas import StreamCreate, StreamResponse, StreamUpdate
from backend.services import streams as streams_service

router = APIRouter(prefix="/streams", tags=["streams"])


def stream_broker(request: Request) -> streams_service.StreamBroker:
    broker = getattr(request.app.state, "streams", None)
    if broker is None:
        raise streams_service.StreamUnavailableError(
            "this process does not serve analysis boards"
        )
    return broker


StreamsDep = Annotated[streams_service.StreamBroker, Depends(stream_broker)]


@router.get("", response_model=list[StreamResponse], summary="Every open analysis board")
async def list_streams(broker: StreamsDep) -> list[Any]:
    return [session.payload() for session in broker.list()]


@router.post(
    "",
    response_model=StreamResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Open an analysis board",
)
async def open_stream(broker: StreamsDep, body: StreamCreate) -> Any:
    """Start an infinite search. Omitting `engine_id` takes the deep tier's engine."""
    session = await broker.open(
        fen=body.fen,
        engine_id=body.engine_id,
        multipv=body.multipv,
        surface=body.surface,
        game_id=body.game_id,
        ply=body.ply,
    )
    return session.payload()


@router.patch("/{session_id}", response_model=StreamResponse, summary="Move the board")
async def restart_stream(broker: StreamsDep, session_id: str, body: StreamUpdate) -> Any:
    """A new position or a new multipv: stop and go on the same slot, never a teardown."""
    session = await broker.restart(session_id, fen=body.fen, multipv=body.multipv)
    return session.payload()


@router.delete(
    "/{session_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Close an analysis board"
)
async def close_stream(broker: StreamsDep, session_id: str) -> Response:
    broker.get(session_id)
    await broker.close(session_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
