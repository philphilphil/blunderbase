"""`/events` — one WebSocket carrying everything the UI has to follow rather than poll.

Every frame is one service event as it was emitted, so the `event` key is the same string
the CLI prints and the MCP layer would see: `import.started`, `import.game`,
`import.finished`, `analysis.queued`, `analysis.running`, `analysis.progress`,
`analysis.done`, `analysis.failed`, `live.updated`, `note.created`, plus the two families
the remote runners brought — `runner.connected`, `runner.disconnected`, `runner.updated`
for who can do engine work right now, and `stream.started`, `stream.snapshot`,
`stream.ended` for an analysis board.

`stream.snapshot` is the hot one, at about two frames a second per open board. It is why
delivery is deliberately lossy: a socket that falls behind drops its oldest frames, and
each snapshot carries a `seq` so a consumer can ignore one that arrives out of order.

Nothing is replayed and nothing is acknowledged. A socket that drops has missed whatever
happened while it was gone, and the UI refetches on reconnect.
"""

from __future__ import annotations

import asyncio
import contextlib
from functools import partial

from anyio import to_thread
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.api.auth import AUTHENTICATED, COOKIE_NAME, WS_CLOSE_UNAUTHORIZED, AuthGuard
from backend.api.events import EventBroker

router = APIRouter(tags=["events"])

# How often a silent stream checks that the client is still there.
PING_SECONDS = 30.0


@router.websocket("/events")
async def events(websocket: WebSocket) -> None:
    broker: EventBroker = websocket.app.state.events
    guard = AuthGuard(websocket.app, websocket.app.state.settings)
    check_session = partial(guard.state, websocket.cookies.get(COOKIE_NAME), cached=False)
    await websocket.accept()
    with broker.listen() as queue:
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), PING_SECONDS)
                except TimeoutError:
                    event = {"event": "ping"}
                # Check before every delivery, including idle pings. This also observes
                # revocations from another process (the password-reset CLI, for example).
                state = await to_thread.run_sync(check_session)
                if state != AUTHENTICATED:
                    await websocket.close(code=WS_CLOSE_UNAUTHORIZED, reason=state)
                    return
                await websocket.send_json(event)
        except WebSocketDisconnect:
            return
        except RuntimeError:
            # The socket was closed under us while a send was in flight.
            return
        finally:
            with contextlib.suppress(Exception):
                await websocket.close()
