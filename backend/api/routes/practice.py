"""`/practice` — the computer's side of a game played out from a position.

Two questions and nothing stored: who can I play against (`GET /practice/opponents`), and
what does this engine play here (`POST /practice/move`). The game itself — the board, whose
turn, the take-backs — is the browser's; see `services/practice.py` for why a reply is a
bounded search rather than the analysis board's top line.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request

from backend.api.deps import SessionDep
from backend.api.schemas import PracticeMoveRequest, PracticeMoveResponse, PracticeOpponents
from backend.services import practice as practice_service

router = APIRouter(prefix="/practice", tags=["practice"])


def practice_broker(request: Request) -> practice_service.PracticeBroker:
    broker = getattr(request.app.state, "practice", None)
    if broker is None:
        raise practice_service.PracticeUnavailableError("this process does not serve practice")
    return broker


PracticeDep = Annotated[practice_service.PracticeBroker, Depends(practice_broker)]


@router.get(
    "/opponents", response_model=PracticeOpponents, summary="Who a practice game can be against"
)
def opponents(session: SessionDep, broker: PracticeDep) -> Any:
    """Every switched-on UCI engine with its rating range, and whether Maia can answer.

    A plain `def`: an engine probed for the first time since it was added starts a process,
    and that belongs on a worker thread rather than the loop.
    """
    return broker.opponents(session)


@router.post("/move", response_model=PracticeMoveResponse, summary="The engine's reply")
async def move(broker: PracticeDep, body: PracticeMoveRequest) -> Any:
    """Search `fen` for `movetime_ms` and answer with the move played, at `elo` if given."""
    return await broker.move(
        fen=body.fen, engine_id=body.engine_id, elo=body.elo, movetime_ms=body.movetime_ms
    )
