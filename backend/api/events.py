"""The bridge between the service layer's synchronous hooks and the `/events` sockets.

Both hooks — `analysis.subscribe` for run lifecycle and the `progress=` callable an import
takes — are plain callables invoked from whichever thread reached the transition: a worker
thread, the import thread, a request thread. `publish` is that boundary. It bounces the
event onto the loop that owns the sockets and returns immediately, so a slow or absent
reader can never slow down an import or fail a run.

Delivery is deliberately lossy. A socket that cannot keep up drops its oldest event rather
than growing without bound, and a dropped connection is not repaired — the UI refetches on
reconnect, which is the contract the design spec asks for.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import Callable, Iterator
from typing import Any

from backend.services import analysis as analysis_service

# How many events one socket may fall behind before it starts losing the oldest of them.
CLIENT_BACKLOG = 256


class EventBroker:
    """Fan import and analysis events out to every connected `/events` socket."""

    def __init__(self, *, backlog: int = CLIENT_BACKLOG) -> None:
        self._backlog = backlog
        self._loop: asyncio.AbstractEventLoop | None = None
        self._clients: set[asyncio.Queue[dict[str, Any]]] = set()
        self._cancel: Callable[[], None] | None = None

    # --- lifecycle --------------------------------------------------------

    def start(self) -> None:
        """Bind to the running loop and start receiving run events. Called from lifespan."""
        self._loop = asyncio.get_running_loop()
        if self._cancel is None:
            self._cancel = analysis_service.subscribe(self.publish)

    def stop(self) -> None:
        if self._cancel is not None:
            self._cancel()
            self._cancel = None
        self._clients.clear()
        self._loop = None

    @property
    def listeners(self) -> int:
        return len(self._clients)

    # --- publishing -------------------------------------------------------

    def publish(self, event: dict[str, Any]) -> None:
        """Hand one event to every socket. Safe to call from any thread, including none."""
        loop = self._loop
        if loop is None or not self._clients:
            return
        with contextlib.suppress(RuntimeError):
            loop.call_soon_threadsafe(self._fanout, dict(event))

    def _fanout(self, event: dict[str, Any]) -> None:
        for queue in list(self._clients):
            if queue.full():
                with contextlib.suppress(asyncio.QueueEmpty):
                    queue.get_nowait()
            with contextlib.suppress(asyncio.QueueFull):
                queue.put_nowait(event)

    # --- listening --------------------------------------------------------

    @contextlib.contextmanager
    def listen(self) -> Iterator[asyncio.Queue[dict[str, Any]]]:
        """One socket's backlog, unregistered however the socket ends."""
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=self._backlog)
        self._clients.add(queue)
        try:
            yield queue
        finally:
            self._clients.discard(queue)
