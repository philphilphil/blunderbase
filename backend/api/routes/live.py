"""`/live` — what the coach is currently showing on the board.

The page reads the shared state on load and follows live.updated events. Reset and
position selection are shared mutations, so the coach sees the user's navigation.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from backend.api.schemas import LiveState
from backend.services import live as live_service

router = APIRouter(prefix="/live", tags=["live"])


@router.get("", response_model=LiveState, summary="The live session")
def get_live_state() -> Any:
    return live_service.get_state()


@router.post("/reset", response_model=LiveState)
def reset_live() -> Any:
    return live_service.clear()


@router.post("/positions/{index}", response_model=LiveState)
def select_live_position(index: int) -> Any:
    try:
        return live_service.select_position(index)
    except live_service.LiveRequestError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
