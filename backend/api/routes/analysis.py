"""`/analysis` — enqueue a pass, watch the queue, read what a run produced."""

from __future__ import annotations

import asyncio
from typing import Annotated, Any

from fastapi import APIRouter, Query, Request, status

from backend.api.deps import SessionDep, SettingsDep, not_found, ply_range, wake_workers
from backend.api.routes.runners import live_picture, local_picture
from backend.api.schemas import (
    AnalysisRequest,
    BackfillCancelled,
    BackfillPreview,
    BackfillReceipt,
    BackfillRequest,
    BatchAnalysisRequest,
    BatchAnalysisResponse,
    MaiaFillReceipt,
    MaiaFillRequest,
    MaiaFillStatus,
    MoveEvalResponse,
    PositionAnalysis,
    PositionAnalysisRequest,
    QueueCleared,
    QueueDestination,
    QueuedRun,
    QueueStatus,
    RefusedGame,
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
def enqueue(request: Request, session: SessionDep, body: AnalysisRequest) -> Any:
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
        elos=body.elos,
    )
    wake_workers(request)
    return run


@router.post(
    "/batch",
    response_model=BatchAnalysisResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Enqueue a pass over each of several games",
)
def enqueue_batch(
    request: Request, session: SessionDep, body: BatchAnalysisRequest
) -> BatchAnalysisResponse:
    """Queue one run per game, all of them in one transaction.

    What the games page's selection footer sends: sixty selected games are one call and
    one commit rather than sixty of each. A game that cannot be queued is named in
    `refused` instead of failing the rest — 202 is what the batch was accepted as, not a
    claim that every id in it was.
    """
    queued, refused = analysis_service.request_analysis_batch(
        session,
        body.game_ids,
        tier=body.tier,
        engine_id=body.engine_id,
        multipv=body.multipv,
        nodes=body.nodes,
        depth=body.depth,
        priority=body.priority,
        elos=body.elos,
    )
    wake_workers(request)
    return BatchAnalysisResponse(
        # Every run a batch queued was queued for a game, so `game_id` is one.
        queued=[QueuedRun(game_id=run.game_id, run_id=run.id) for run in queued],
        refused=[RefusedGame(game_id=item.game_id, reason=item.reason) for item in refused],
    )


@router.get(
    "/maia-fill/status",
    response_model=MaiaFillStatus,
    summary="How many games are missing a configured Maia level",
)
def maia_fill_status(session: SessionDep) -> MaiaFillStatus:
    """What the "fill in the missing levels" button shows before anybody presses it.

    Read off the same statement the fill enqueues with, so the number on the button and the
    number of runs it writes are answers to one question.
    """
    return MaiaFillStatus.model_validate(analysis_service.maia_fill_status(session))


@router.post(
    "/maia-fill",
    response_model=MaiaFillReceipt,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Add the missing Maia levels to games that already have a pass",
)
def maia_fill(
    request: Request, session: SessionDep, body: MaiaFillRequest | None = None
) -> MaiaFillReceipt:
    """Queue a Maia-only pass over every analysed game missing a configured level.

    Not a re-analysis: adding a level to a library that has already been evaluated is a
    question for the human-move model alone, so these runs search nothing and store rows
    that carry a policy over the top of what is there. That is the difference between adding
    a Maia level in minutes and re-analysing the library over a weekend.
    """
    game_ids = (body or MaiaFillRequest()).game_ids
    receipt = analysis_service.queue_maia_fill(session, game_ids)
    wake_workers(request)
    return MaiaFillReceipt(
        queued=receipt["queued"], already_complete=receipt["already_complete"]
    )


@router.get(
    "/backfill", response_model=BackfillPreview, summary="How many games have no pass yet"
)
def backfill_preview(
    session: SessionDep,
    tier: Annotated[Tier, Query(description="the tier the backfill would be over")] = Tier.QUICK,
) -> BackfillPreview:
    """What a backfill of this tier has left to do.

    Read off the same statement the enqueue selects with, so the number the button shows
    and the number of rows the button writes are answers to one question.
    """
    return BackfillPreview(tier=tier, pending=analysis_service.count_missing(session, tier))


@router.post(
    "/backfill",
    response_model=BackfillReceipt,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Queue a pass over every game that has none",
)
def backfill(
    request: Request, session: SessionDep, body: BackfillRequest | None = None
) -> BackfillReceipt:
    """Queue a full-game pass over every game with no live run of this tier.

    Uncapped, which is the whole difference between this and `/batch`. That route serves a
    selection made by hand on the games page and keeps its five-hundred ceiling for exactly
    that reason; this one is "analyse the library while I sleep", and a library is ten
    thousand games. One transaction and one commit carry all of them.

    A backfill announces itself once — see `analysis.backfill_event` — rather than once per
    run, so a client hears that the queue moved without being handed every row that moved
    it. The 202 is what the write was accepted as; the runs are worked afterwards, by
    whichever machine the tier's engine lives on.
    """
    tier = (body or BackfillRequest()).tier
    queued = analysis_service.enqueue_missing(session, tier)
    wake_workers(request)
    return BackfillReceipt(
        tier=tier,
        queued=len(queued),
        outstanding=analysis_service.outstanding_runs(session, tier),
    )


@router.post(
    "/backfill/cancel",
    response_model=BackfillCancelled,
    summary="Take a backfill back out of the queue",
)
def cancel_backfill(session: SessionDep, body: BackfillRequest | None = None) -> BackfillCancelled:
    """Drop this tier's queued full-game runs, leaving the ones already being worked.

    Not a 202: the queue is shorter by the time this answers, and `dropped` is the count of
    rows that actually went. `outstanding` is what is still in flight — a pass the workers
    had already claimed finishes, because there is nothing to move it to.
    """
    tier = (body or BackfillRequest()).tier
    dropped = analysis_service.cancel_queued(session, tier)
    return BackfillCancelled(
        tier=tier,
        dropped=dropped,
        outstanding=analysis_service.outstanding_runs(session, tier),
    )


@router.post(
    "/queue/clear",
    response_model=QueueCleared,
    summary="Take everything still queued back out, whatever tier or shape it is",
)
def clear_queue(session: SessionDep) -> QueueCleared:
    """Drop every queued run in one call — the undo for a queue built up by mistake.

    Not scoped to a tier the way `/backfill/cancel` is: a queue that took on eight hundred
    Maia-fill runs by accident, or the wrong tier over the whole library, is emptied in one
    write regardless of what filled it. A run already claimed by a worker is left to finish,
    same as a backfill's cancel — there is nowhere else for it to go.
    """
    dropped = analysis_service.clear_queue(session)
    depth = analysis_service.queue_depth(session)
    return QueueCleared(dropped=dropped, outstanding=depth["queued"] + depth["running"])


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
