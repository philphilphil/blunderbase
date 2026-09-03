"""`/import` — trigger a sync, upload a PGN, read the sync history.

A sync is not a request-shaped thing: a first Lichess archive walk takes minutes. So the
adapter runs in a worker thread under its own transaction and the response carries the
`ImportJob` id, which is the row every progress event names and `/import/jobs/{id}` reads.
Progress reaches the UI over `/events`; a client that missed it polls the job instead.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import Callable
from typing import Annotated, Any

from fastapi import APIRouter, Query, Request, Response, status

from backend.api.deps import BrokerDep, SessionDep, SettingsDep, not_found
from backend.api.errors import ApiError
from backend.api.events import EventBroker
from backend.api.schemas import (
    ImportCancelling,
    ImportJobList,
    ImportJobResponse,
    ImportRequest,
    ImportStarted,
    SyncSchedule,
    SyncScheduleUpdate,
)
from backend.config import Settings
from backend.db.session import session_scope
from backend.services import app_settings as app_settings_service
from backend.services import import_service
from backend.services.import_service import ProgressHook

router = APIRouter(prefix="/import", tags=["import"])

# How long the request waits for the job row to exist before answering without its id. The
# row is written before the adapter makes its first network call, so this is generous.
JOB_ID_TIMEOUT = 5.0
# How long shutdown lets a running sync finish. Whatever is still going keeps going in its
# own thread; the job row records how it ended either way.
SHUTDOWN_GRACE = 10.0

MAX_PAGE = 200


@router.get("/jobs", response_model=ImportJobList, summary="Sync history")
def list_jobs(
    session: SessionDep,
    source: str | None = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ImportJobList:
    """One page of syncs, newest first, with the total the history holds."""
    return ImportJobList(
        jobs=[
            ImportJobResponse.model_validate(job)
            for job in import_service.list_jobs(
                session, source=source, limit=limit, offset=offset
            )
        ],
        total=import_service.count_jobs(session, source=source),
        limit=limit,
        offset=offset,
    )


@router.get("/jobs/{job_id}", response_model=ImportJobResponse, summary="One sync")
def get_job(session: SessionDep, job_id: int) -> Any:
    job = import_service.get_job(session, job_id)
    if job is None:
        raise not_found("unknown_job", f"no import job with id {job_id}")
    return job


@router.post(
    "/jobs/{job_id}/cancel",
    response_model=ImportCancelling,
    summary="Stop a running import",
)
def cancel_job(session: SessionDep, job_id: int) -> ImportCancelling:
    """Stop the sync or upload this job is doing, after the game it is on.

    Not a 202 and not a wait: the signal is taken here, and the run reads it between two
    games — the point of a PGN of fifty thousand games is that stopping it half-way costs
    nothing, because everything it stored is stored and the next run skips straight past it.
    A job that has already finished is a 409; there is nothing left to signal.
    """
    job = import_service.cancel_job(session, job_id)
    return ImportCancelling(job_id=job_id, source=str(job.source), status=job.status)


@router.get("/schedule", response_model=SyncSchedule, summary="How often accounts sync alone")
def get_schedule(session: SessionDep) -> SyncSchedule:
    return SyncSchedule(minutes=app_settings_service.get_auto_sync_minutes(session))


@router.put("/schedule", response_model=SyncSchedule, summary="Sync every N minutes, or never")
def put_schedule(session: SessionDep, body: SyncScheduleUpdate) -> SyncSchedule:
    """Every connected account, from its last cursor, on this clock — the Sync button
    pressed for you (`workers/auto_sync.py`). Answers with what is in force."""
    return SyncSchedule(minutes=app_settings_service.set_auto_sync_minutes(session, body.minutes))


@router.post(
    "/pgn/upload",
    response_model=ImportStarted,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Upload a PGN file",
)
async def upload_pgn(
    request: Request,
    settings: SettingsDep,
    broker: BrokerDep,
    response: Response,
    wait: bool = False,
    max_games: Annotated[int | None, Query(ge=1)] = None,
    analyze: bool = True,
    mine: bool = True,
) -> ImportStarted:
    """The request body is the PGN itself — one game or a thousand, as exported.

    `mine=false` is a file of somebody else's games: they are stored and can be analysed,
    but they are not the owner's and no statistic counts them.
    """
    raw = await request.body()
    text = raw.decode("utf-8-sig", errors="replace")
    if not text.strip():
        raise ApiError(422, "empty_upload", "the request body carried no PGN")
    options: dict[str, Any] = {"text": text}
    if max_games is not None:
        options["max_games"] = max_games
    # Passed on only when it is switched off, the way `ImportRequest.options` carries it:
    # an upload that says nothing about evaluation or about whose games these are leaves
    # the adapter's default in charge.
    if not analyze:
        options["analyze"] = False
    if not mine:
        options["mine"] = False
    return await _start(request, settings, broker, response, "pgn", options, wait=wait)


@router.post(
    "/{source}",
    response_model=ImportStarted,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Sync one source",
)
async def start_import(
    request: Request,
    settings: SettingsDep,
    broker: BrokerDep,
    response: Response,
    source: str,
    body: ImportRequest | None = None,
) -> ImportStarted:
    """Run a source's adapter. `wait=true` answers with the finished job instead."""
    given = body or ImportRequest()
    return await _start(
        request, settings, broker, response, source, given.options(), wait=given.wait
    )


async def _start(
    request: Request,
    settings: Settings,
    broker: EventBroker,
    response: Response,
    source: str,
    options: dict[str, Any],
    *,
    wait: bool,
) -> ImportStarted:
    # Resolving the adapter first is what makes an unknown source a typed 404 before
    # anything has been written and before a thread has been spent on it.
    import_service.get_adapter(source)

    if wait:
        job = await asyncio.to_thread(_run, settings, source, options, broker.publish)
        response.status_code = status.HTTP_200_OK
        return ImportStarted(
            source=source,
            status=str(job.status),
            job_id=job.id,
            job=ImportJobResponse.model_validate(job),
        )

    job_id = await _in_background(request, settings, broker, source, options)
    return ImportStarted(source=source, status="running", job_id=job_id)


async def _in_background(
    request: Request,
    settings: Settings,
    broker: EventBroker,
    source: str,
    options: dict[str, Any],
) -> int | None:
    """Start the sync in a thread and answer as soon as its job row exists."""
    loop = asyncio.get_running_loop()
    started: asyncio.Future[int | None] = loop.create_future()

    def progress(event: dict[str, Any]) -> None:
        if event.get("event") == import_service.EVENT_IMPORT_STARTED:
            loop.call_soon_threadsafe(_settle, started, event.get("job_id"))
        broker.publish(event)

    task = asyncio.create_task(asyncio.to_thread(_run, settings, source, options, progress))
    tasks: set[asyncio.Task[Any]] = request.app.state.imports
    tasks.add(task)
    task.add_done_callback(_forget(tasks))

    await asyncio.wait(
        {started, task}, timeout=JOB_ID_TIMEOUT, return_when=asyncio.FIRST_COMPLETED
    )
    _settle(started, None)
    return started.result()


def _run(
    settings: Settings, source: str, options: dict[str, Any], progress: ProgressHook
) -> Any:
    """One sync, in its own transaction. Runs in a worker thread."""
    with session_scope(settings) as session:
        return import_service.run_import(session, source, progress=progress, **options)


def _forget(tasks: set[asyncio.Task[Any]]) -> Callable[[asyncio.Task[Any]], None]:
    """Drop a finished sync, reading whatever it raised so nothing is left unretrieved.

    `run_import` records an adapter's failure on the job row rather than raising, so
    anything that reaches here is the transaction itself failing — the job row is still
    the record, and there is no request left to tell.
    """

    def done(task: asyncio.Task[Any]) -> None:
        tasks.discard(task)
        if not task.cancelled():
            task.exception()

    return done


def _settle(future: asyncio.Future[int | None], value: int | None) -> None:
    if not future.done():
        future.set_result(value)


async def wait_for_imports(tasks: set[asyncio.Task[Any]], grace: float = SHUTDOWN_GRACE) -> None:
    """Give running syncs a moment to finish at shutdown. Called from the app lifespan."""
    if not tasks:
        return
    with contextlib.suppress(Exception):
        await asyncio.wait(set(tasks), timeout=grace)
