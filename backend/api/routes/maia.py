"""`/maia` — what a human of a given rating plays in a position nobody has stored.

The game panel needs none of this: a game's human-move data was computed by the batch pass
and is read back off the row. This is the analysis board, where the position is whatever
someone just made up, so the only way to answer is to ask a warm Maia — see
`services/maia_live.py` for why there is exactly one of those and where it lives.

A deployment with no local Maia answers 409 with the reason. That is a hidden section in
the UI, not an error banner: the board still has Stockfish.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from backend.api.deps import SessionDep
from backend.api.schemas import MaiaPolicyRequest, MaiaPolicyResponse
from backend.services import maia_live as maia_live_service

router = APIRouter(prefix="/maia", tags=["maia"])


@router.post("/policy", response_model=MaiaPolicyResponse, summary="Ask Maia about a position")
def policy(session: SessionDep, body: MaiaPolicyRequest) -> Any:
    """One position's human-move policy, and optionally the line two humans would play.

    A plain `def`, so FastAPI runs it in a worker thread: the query holds a lock and talks
    to a subprocess, and a debounced board must not be able to stall the loop while it
    waits its turn.
    """
    return maia_live_service.live_policy(
        session,
        fen=body.fen,
        elo=body.elo,
        moves=body.moves,
        rollout_plies=body.rollout_plies,
    )
