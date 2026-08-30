"""`/runners` — the machines allowed to run engine work, and what they are doing.

The owner's side of the runner surface. The runners' own side is `/runner` (singular),
which carries a per-runner bearer token and is exempt from the session cookie; this one is
guarded like every other route, because minting a token is the most privileged thing in the
application.

Two things are worth knowing about the shape of this module. **Every handler is `async`**,
which is unusual here: a runner's live picture — its transport, the slots it is holding —
lives in the gateway's own dictionaries, and those are mutated on the event loop as links
come and go. Reading them from a worker thread would be reading a dict somebody else is
writing, so the live half is taken on the loop and only the database half goes to a thread.
And **the token appears exactly once**, in the answer to the request that mints it. Nothing
stores it, so nothing can show it again; a lost token is a revoke and a new runner.
"""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Request, Response, status

from backend.api.deps import SettingsDep
from backend.api.schemas import (
    RunnerCreate,
    RunnerCreated,
    RunnerResponse,
    RunnersStatus,
    RunnerUpdate,
)
from backend.config import Settings
from backend.db.session import session_scope
from backend.runners import protocol
from backend.runtime import capabilities_for
from backend.services import runners as runners_service
from backend.services import streams as streams_service
from backend.workers import runner_gateway

router = APIRouter(prefix="/runners", tags=["runners"])
status_router = APIRouter(prefix="/runners", tags=["runners"])


# --- the live half ----------------------------------------------------------


def live_picture(request: Request) -> dict[int, dict[str, Any]]:
    """What the gateway knows about each attached runner, keyed by id.

    Called on the loop, never from a thread: these are the gateway's own dictionaries.
    """
    gateway = getattr(request.app.state, "gateway", None)
    if gateway is None:
        return {}
    return {int(row["runner_id"]): row for row in gateway.status()}


def local_picture(request: Request, settings: Settings) -> dict[str, Any]:
    """This host as a destination: its cap, what it is running, and whether it drains at all.

    A process started with `analysis_workers` off is a perfectly good server that simply
    does no engine work itself — the answer says so rather than pretending to a cap.
    """
    workers = getattr(request.app.state, "workers", None)
    broker = getattr(request.app.state, "streams", None)
    boards = 0 if broker is None else len(_local_boards(broker))
    return {
        "slots": settings.analysis_concurrency,
        "busy": int(workers.busy) if workers is not None else 0,
        "streams": boards,
        "workers": bool(workers is not None and workers.running),
    }


def _local_boards(broker: streams_service.StreamBroker) -> list[Any]:
    """The analysis boards running on this host's own engines."""
    return [
        session
        for session in broker.list()
        if session.runner_id is None and session.state != streams_service.STATE_ENDED
    ]


# --- the runners ------------------------------------------------------------


@router.get("", response_model=list[RunnerResponse], summary="Every registered runner")
async def list_runners(request: Request, settings: SettingsDep) -> list[Any]:
    live = live_picture(request)
    return await asyncio.to_thread(_rows, settings, live)


@router.post(
    "",
    response_model=RunnerCreated,
    status_code=status.HTTP_201_CREATED,
    summary="Register a runner",
)
async def create_runner(
    request: Request, settings: SettingsDep, body: RunnerCreate
) -> RunnerCreated:
    """Register a machine and mint its token.

    The token and the `runner.yaml` around it are in this response and nowhere else: only a
    SHA-256 of it is stored, so there is no second reading of it to offer later.
    """
    server = _server_url(request, settings)
    runner, token, config = await asyncio.to_thread(
        _create, settings, body.name, body.slots, server
    )
    return RunnerCreated(
        runner=RunnerResponse.model_validate(runner), token=token, config_yaml=config
    )


@status_router.get("/status", response_model=RunnersStatus, summary="Where engine work can run")
async def runners_status(request: Request, settings: SettingsDep) -> Any:
    """This host and every runner side by side, with the backlog split between them.

    Declared above `/{runner_id}` so the word `status` is read as itself.
    """
    live = live_picture(request)
    local = local_picture(request, settings)
    include_remote = capabilities_for(settings).remote_runners
    return await asyncio.to_thread(_status, settings, live, local, include_remote)


@router.patch("/{runner_id}", response_model=RunnerResponse, summary="Rename or resize a runner")
async def update_runner(
    request: Request, settings: SettingsDep, runner_id: int, body: RunnerUpdate
) -> Any:
    """Only what is sent changes. A lowered cap applies to the next dispatch, not to work
    already running: taking a search away to enforce a number nobody is waiting on would
    spend an attempt for nothing."""
    changes = body.model_dump(exclude_unset=True)
    updated = await asyncio.to_thread(_update, settings, runner_id, changes)
    _retune(request, runner_id, updated)
    # The live picture is read again on the far side of the retune, so the answer and the
    # event both carry the free slots the new cap actually leaves.
    row = await asyncio.to_thread(_one, settings, runner_id, live_picture(request))
    runners_service.announce(row)
    return row


@router.delete(
    "/{runner_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Revoke a runner"
)
async def delete_runner(request: Request, settings: SettingsDep, runner_id: int) -> Response:
    """Close the link, then delete the row: the token, the engines and the runner itself.

    In that order, so that the runs it was holding come back to the queue before the engine
    rows they name are deleted — and with their attempts refunded, because a runner the
    owner took away did not fail. Its engines go with it: a remote engine row is an
    advertisement owned by that machine, not configuration to leave pointing at nothing.
    """
    await asyncio.to_thread(_require, settings, runner_id)
    gateway = getattr(request.app.state, "gateway", None)
    if gateway is not None:
        await gateway.detach(
            runner_id,
            reason=runner_gateway.REASON_REVOKED,
            close_code=protocol.WS_CLOSE_REVOKED,
        )
    await asyncio.to_thread(_delete, settings, runner_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- the database half ------------------------------------------------------


def _rows(settings: Settings, live: dict[int, dict[str, Any]]) -> list[dict[str, Any]]:
    with session_scope(settings) as session:
        return runners_service.runner_rows(session, live=live)


def _one(settings: Settings, runner_id: int, live: dict[int, dict[str, Any]]) -> dict[str, Any]:
    """One runner in the same shape the list reports, so a PATCH answers what a GET would."""
    with session_scope(settings) as session:
        rows = runners_service.runner_rows(session, live=live)
    for row in rows:
        if row["id"] == runner_id:
            return row
    raise runners_service.UnknownRunnerError(f"no runner with id {runner_id}")


def _status(
    settings: Settings,
    live: dict[int, dict[str, Any]],
    local: dict[str, Any],
    include_remote: bool = True,
) -> dict[str, Any]:
    with session_scope(settings) as session:
        payload = runners_service.status_payload(session, live=live, local=local)
    if not include_remote:
        payload["runners"] = []
    return payload


def _create(
    settings: Settings, name: str, slots: int, server_url: str
) -> tuple[dict[str, Any], str, str]:
    with session_scope(settings) as session:
        runner, token = runners_service.create_runner(session, name, slots=slots)
        return (
            runners_service.runner_payload(runner, engines=[]),
            token,
            runners_service.config_yaml(runner, token, server_url=server_url),
        )


def _update(settings: Settings, runner_id: int, changes: dict[str, Any]) -> tuple[str, int]:
    with session_scope(settings) as session:
        runner = runners_service.update_runner(session, runner_id, **changes)
        return runner.name, runner.slots


def _require(settings: Settings, runner_id: int) -> None:
    """Fail a revoke that names nobody before a single link is closed."""
    with session_scope(settings) as session:
        runners_service.require_runner(session, runner_id)


def _delete(settings: Settings, runner_id: int) -> None:
    with session_scope(settings) as session:
        runners_service.delete_runner(session, runner_id)


def _retune(request: Request, runner_id: int, updated: tuple[str, int]) -> None:
    """Teach the live link its new name and cap, so an edit does not wait for a reconnect.

    Through the state's own `retune`, which keeps the rule the handshake applied: the link
    holds to the lower of the owner's cap and what the machine said it can do. Raising the
    row's number does not conjure slots on a runner that only has two.
    """
    gateway = getattr(request.app.state, "gateway", None)
    state = None if gateway is None else gateway.state(runner_id)
    if state is None:
        return
    state.retune(*updated)
    if state.free_slots:
        gateway.notify()


def _server_url(request: Request, settings: Settings) -> str:
    """The URL to write into a `runner.yaml`: what the deployment calls itself.

    `public_url` when it is configured, because a server behind a proxy has no way of
    knowing its own name; otherwise the origin this very request arrived on, which is at
    least an address that reached it once.
    """
    configured = settings.public_url.strip().rstrip("/")
    if configured:
        return configured
    return f"{request.url.scheme}://{request.url.netloc}"
