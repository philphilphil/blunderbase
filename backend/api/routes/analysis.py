"""`/analysis` — enqueue a pass, watch the queue, read what a run produced."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Query, Request, status

from backend.api.deps import SessionDep, SettingsDep, not_found, ply_range, wake_workers
from backend.api.schemas import (
    AnalysisRequest,
    MoveEvalResponse,
    PositionAnalysis,
    PositionAnalysisRequest,
    QueueStatus,
    RunResponse,
)
from backend.db.enums import Tier
from backend.services import analysis as analysis_service

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
def queue_status(request: Request, session: SessionDep) -> QueueStatus:
    workers = getattr(request.app.state, "workers", None)
    depth = analysis_service.queue_depth(session)
    return QueueStatus(
        queued=depth["queued"],
        running=depth["running"],
        workers=bool(workers is not None and workers.running),
        busy=int(workers.busy) if workers is not None else 0,
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
