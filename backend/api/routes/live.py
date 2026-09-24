"""`/live` — the Board page's one shared board.

The page reads the shared state on load and follows live.updated events. Everything the
owner does here — loading a position, playing, stepping, reset, position selection — is
a shared mutation, so the coach reads back exactly what the owner is looking at.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from backend.api.schemas import LiveGoto, LiveLoad, LiveMoves, LiveState
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


@router.post("/new", response_model=LiveState, summary="Start from the initial position")
def new_live_board() -> Any:
    return live_service.new_board()


@router.post("/load", response_model=LiveState, summary="Load a pasted FEN or PGN")
def load_live_board(body: LiveLoad) -> Any:
    try:
        return live_service.load(fen=body.fen, pgn=body.pgn)
    except live_service.LiveRequestError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None


@router.post("/moves", response_model=LiveState, summary="Play moves on the board")
def play_live_moves(body: LiveMoves) -> Any:
    try:
        return live_service.play(body.ucis, start_if_empty=True)
    except live_service.LiveRequestError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None


@router.post("/goto", response_model=LiveState, summary="Step to a ply of the line")
def goto_live_ply(body: LiveGoto) -> Any:
    try:
        return live_service.goto(body.ply, body.cursor)
    except live_service.LiveRequestError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
