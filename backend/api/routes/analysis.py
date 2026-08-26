"""`/analysis` — enqueue a pass, watch the queue, read what a run produced."""

from __future__ import annotations

import asyncio
from typing import Annotated, Any

from fastapi import APIRouter, Query, Request, status

from backend.api.deps import SessionDep, SettingsDep, not_found, ply_range, wake_workers
from backend.api.routes.runners import live_picture, local_picture
from backend.api.schemas import (
    AnalysisRequest,
    MoveEvalResponse,
    PositionAnalysis,
    PositionAnalysisRequest,
    QueueDestination,
    QueueStatus,
    RunResponse,
)
from backend.config import Settings
from backend.db.enums import Tier
from backend.db.session import session_scope
from backend.services import analysis as analysis_service
from backend.services import runners as runners_service

router = APIRouter(prefix="/analysis", tags=["analysis"])


@router.post(
    "", response_model=RunResponse, status_code=status.HTTP_202_ACCEPTED, summary="Enqueue a pass"
)
def enqueue(
    request: Request, session: SessionDep, settings: SettingsDep, body: AnalysisRequest
) -> Any:
    """Queue one run over a game or a FEN. Re-analysis is always a new run."""
    run = analysis_service.request_analysis(
        session,
        game_id=body.game_id,
        fen=body.fen,
        tier=body.tier,
        ply_range=body.ply_range,
        engine_id=body.engine_id,
        multipv=body.multipv,
        nodes=body.nodes,
        depth=body.depth,
        priority=body.priority,
        settings=settings,
    )
    wake_workers(request)
    return run


@router.get("/queue", response_model=QueueStatus, summary="How much work is outstanding")
async def queue_status(request: Request, settings: SettingsDep) -> QueueStatus:
    """The backlog, and where it will actually be worked.

    `destinations` splits the same rows by the host that can run them: this one, and each
    registered runner. It answers the question the totals cannot — a queue that is not
    moving because the only machine with that engine is not connected looks exactly like a
    queue that is simply long. The top-level fields are unchanged, and `busy` is still
    *this* process's, so a client that predates the breakdown reads the same numbers.

    Async, like `/runners`: the live half of a destination is the gateway's own state, and
    that belongs to the loop.
    """
    workers = getattr(request.app.state, "workers", None)
    live = live_picture(request)
    local = local_picture(request, settings)
    depth, destinations = await asyncio.to_thread(_queue, settings, live, local)
    return QueueStatus(
        queued=depth["queued"],
        running=depth["running"],
        workers=bool(workers is not None and workers.running),
        busy=int(workers.busy) if workers is not None else 0,
        destinations=[QueueDestination.model_validate(row) for row in destinations],
    )


@router.get("/runs", response_model=list[RunResponse], summary="The runs over one game")
def list_runs(
    session: SessionDep,
    game_id: Annotated[int, Query(description="the game whose runs to list")],
    tier: Tier | None = None,
) -> list[Any]:
    return analysis_service.list_runs(session, game_id, tier=tier)


@router.get("/runs/{run_id}", response_model=RunResponse, summary="One run's status")
def get_run(session: SessionDep, run_id: int) -> Any:
    run = analysis_service.get_run(session, run_id)
    if run is None:
        raise not_found("unknown_run", f"no analysis run with id {run_id}")
    return run


@router.get(
    "/runs/{run_id}/evals",
    response_model=list[MoveEvalResponse],
    summary="The eval curve of one run",
)
def get_run_evals(
    session: SessionDep,
    run_id: int,
    ply_start: Annotated[int | None, Query(ge=0)] = None,
    ply_end: Annotated[int | None, Query(ge=0, description="exclusive")] = None,
) -> list[Any]:
    """The rows of one run. The window is half-open, the way a run is configured."""
    analysis_service.require_run(session, run_id)
    return analysis_service.get_move_evals(session, run_id, ply_range(ply_start, ply_end))


@router.post("/position", response_model=PositionAnalysis, summary="Evaluate one position now")
def analyze_position(session: SessionDep, body: PositionAnalysisRequest) -> Any:
    """A bounded synchronous eval for a "what if" line, on its own short-lived process."""
    return analysis_service.analyze_position(session, body.fen, body.nodes)


def _queue(
    settings: Settings, live: dict[int, dict[str, Any]], local: dict[str, Any]
) -> tuple[dict[str, int], list[dict[str, Any]]]:
    """The database half of a queue answer. Runs in a thread; the live half is the loop's."""
    with session_scope(settings) as session:
        return (
            analysis_service.queue_depth(session),
            runners_service.queue_destinations(session, live=live, local=local),
        )
