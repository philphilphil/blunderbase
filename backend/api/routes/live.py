"""`/live` — what the coach is currently showing on the board.

The live session is driven entirely from the MCP side; this is the read the page needs on
load and after a reconnect. From there it follows `live.updated` on the `/events` socket,
which carries this same payload every time the coach moves, draws or clears.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from backend.api.schemas import LiveState
from backend.services import live as live_service

router = APIRouter(prefix="/live", tags=["live"])


@router.get("", response_model=LiveState, summary="The live session")
def get_live_state() -> Any:
    return live_service.get_state()
