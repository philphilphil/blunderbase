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

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.api.events import EventBroker

router = APIRouter(tags=["events"])

# How often a silent stream checks that the client is still there.
PING_SECONDS = 30.0


@router.websocket("/events")
async def events(websocket: WebSocket) -> None:
    broker: EventBroker = websocket.app.state.events
    await websocket.accept()
    with broker.listen() as queue:
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), PING_SECONDS)
                except TimeoutError:
                    await websocket.send_json({"event": "ping"})
                    continue
                await websocket.send_json(event)
        except WebSocketDisconnect:
            return
        except RuntimeError:
            # The socket was closed under us while a send was in flight.
            return
        finally:
            with contextlib.suppress(Exception):
                await websocket.close()
