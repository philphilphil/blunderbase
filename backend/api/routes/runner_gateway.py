"""`/runner` — the transport a runner process speaks, and nothing else.

Deliberately singular, and deliberately separate from `/runners`, which is the owner's
CRUD over the same rows: `AuthGuard` exempts one prefix and guards the other, and its rule
(`path == prefix or path.startswith(prefix + "/")`) is what keeps `/runners` out of the
exemption. Everything here is behind `RunnerGuard`'s bearer token instead.

The websocket handler is a decode-and-delegate loop with no scheduling in it — claiming,
slot accounting and reconciliation all live in `workers/runner_gateway.py`. The three REST
endpoints are the same gateway seen through a buffer instead of a socket, which is the
whole of the poll fallback: announce and take work in one request, beat, then answer.
"""

from __future__ import annotations

import contextlib
import logging

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect

from backend.api.errors import ApiError
from backend.api.runner_auth import RunnerDep, deny_socket, guard_socket
from backend.api.schemas import (
    RunnerHeartbeat,
    RunnerHeartbeatResponse,
    RunnerPoll,
    RunnerPollResponse,
    RunnerResult,
    RunnerResultResponse,
)
from backend.runners import protocol
from backend.workers.runner_gateway import (
    ProtoMismatchError,
    RunnerGateway,
    WebsocketLink,
)

router = APIRouter(prefix="/runner", tags=["runner"])

logger = logging.getLogger(__name__)

# A first frame that is not a usable `hello`. Not one of the protocol's own 4000-range
# codes, because it is not a policy the runner can do anything about but a bug in it.
WS_CLOSE_BAD_HELLO = 1008

NO_GATEWAY = "this server is not accepting runners"


@router.websocket("/ws")
async def runner_socket(websocket: WebSocket) -> None:
    """One runner, for as long as it stays. `hello` in, `welcome` out, then frames."""
    runner = await guard_socket(websocket)
    if runner is None:
        return
    gateway: RunnerGateway | None = getattr(websocket.app.state, "gateway", None)
    if gateway is None:  # pragma: no cover - only a process that runs no gateway
        await deny_socket(
            websocket, protocol.WS_CLOSE_REVOKED, protocol.ERROR_REVOKED, NO_GATEWAY
        )
        return

    hello = await _hello(websocket)
    if hello is None:
        return

    link = WebsocketLink(websocket, runner.id, runner.name)
    # The `finally` covers the attach as well as the loop, because the attach is what
    # registers the link: a socket that drops during the handshake would otherwise leave
    # the gateway holding a connection nobody is on, and the row saying `connected`.
    try:
        try:
            # `attach` sends the welcome itself, so nothing can overtake it.
            await gateway.attach(runner, link, hello)
        except ProtoMismatchError as exc:
            await deny_socket(
                websocket,
                protocol.WS_CLOSE_PROTO_MISMATCH,
                protocol.ERROR_PROTO_MISMATCH,
                str(exc),
            )
            return
        except protocol.ProtocolError as exc:
            await deny_socket(websocket, WS_CLOSE_BAD_HELLO, protocol.ERROR_BAD_PAYLOAD, str(exc))
            return
        await gateway.pump(runner.id)

        while True:
            text = await websocket.receive_text()
            try:
                frame = protocol.decode(text)
            except protocol.ProtocolError as exc:
                await gateway.send(
                    runner.id, protocol.error(protocol.ERROR_BAD_PAYLOAD, str(exc))
                )
                continue
            await gateway.handle(runner.id, frame)
    except WebSocketDisconnect:
        pass
    except RuntimeError:
        # The socket was closed under us while a receive was in flight.
        pass
    finally:
        # One await, and this one first: a cancelled task's `finally` gets exactly one
        # that returns, and it has to be the one that gives the runs back.
        await gateway.detach(runner.id, link=link)
        with contextlib.suppress(Exception):
            await websocket.close()


async def _hello(websocket: WebSocket) -> dict | None:
    """The runner's first frame, or None because it was not one and the socket is closed."""
    try:
        frame = protocol.validate(protocol.decode(await websocket.receive_text()))
    except WebSocketDisconnect:
        return None
    except protocol.ProtocolError as exc:
        await deny_socket(websocket, WS_CLOSE_BAD_HELLO, protocol.ERROR_BAD_PAYLOAD, str(exc))
        return None
    if frame.get("type") != protocol.HELLO:
        await deny_socket(
            websocket,
            WS_CLOSE_BAD_HELLO,
            protocol.ERROR_BAD_PAYLOAD,
            f"the first frame is a {protocol.HELLO}, not a {frame.get('type')!r}",
        )
        return None
    return frame


@router.post("/poll", response_model=RunnerPollResponse, summary="Announce and take work")
async def poll(request: Request, runner: RunnerDep, body: RunnerPoll) -> RunnerPollResponse:
    """The fallback for a runner that cannot hold a socket open. Jobs only, no streams."""
    gateway = _gateway(request)
    try:
        answer = await gateway.poll(runner, body.model_dump())
    except ProtoMismatchError as exc:
        raise ApiError(426, protocol.ERROR_PROTO_MISMATCH, str(exc)) from exc
    except protocol.ProtocolError as exc:
        raise ApiError(422, protocol.ERROR_BAD_PAYLOAD, str(exc)) from exc
    return RunnerPollResponse(**answer)


@router.post(
    "/runs/{run_id}/heartbeat",
    response_model=RunnerHeartbeatResponse,
    summary="This run is still being worked on",
)
async def heartbeat(
    request: Request, runner: RunnerDep, run_id: int, body: RunnerHeartbeat
) -> RunnerHeartbeatResponse:
    """`cancel: true` means the run has moved on: abandon it and send nothing.

    The `done`/`total` it carries are the same progress a `run_progress` frame carries, and
    reach `/events` the same way: the transport a runner fell back to is not something the
    browser watching the queue should be able to see.
    """
    alive = await _gateway(request).heartbeat(
        runner.id, run_id, body.attempt_token, done=body.done, total=body.total
    )
    return RunnerHeartbeatResponse(ok=alive, cancel=not alive)


@router.post(
    "/runs/{run_id}/complete",
    response_model=RunnerResultResponse,
    summary="A finished run, or a failed one",
)
async def complete(
    request: Request, runner: RunnerDep, run_id: int, body: RunnerResult
) -> RunnerResultResponse:
    """Both answers come through here, because both free the same slot the same way."""
    try:
        accepted, reason = await _gateway(request).report(
            runner.id,
            run_id,
            body.attempt_token,
            evals=body.evals,
            note=body.note,
            error=body.error,
            stderr=body.stderr,
            retry=body.retry,
        )
    except protocol.ProtocolError as exc:
        raise ApiError(422, protocol.ERROR_BAD_PAYLOAD, str(exc)) from exc
    return RunnerResultResponse(accepted=accepted, reason=reason)


def _gateway(request: Request) -> RunnerGateway:
    gateway: RunnerGateway | None = getattr(request.app.state, "gateway", None)
    if gateway is None:  # pragma: no cover - only a process that runs no gateway
        raise ApiError(503, "unavailable", NO_GATEWAY)
    return gateway
