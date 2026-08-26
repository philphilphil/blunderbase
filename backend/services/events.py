"""The service layer's general event hub.

Two feeds already existed before this one and neither fits everything. `analysis.subscribe`
carries run lifecycle, and its events wait for the transaction that wrote the row; an
import is handed a `progress` callable by whoever started it, because a sync has a job to
report against. What is left over — a note being written, the live board moving — belongs
to no run and to no job, so it goes out here.

`backend/api/events.py` attaches the `/events` sockets to this hub exactly the way it
attaches them to the other two: a hook is called from whichever thread reached the
transition, so a subscriber that owns an event loop has to bounce the event onto it
itself. A subscriber that raises is ignored — publishing must never be able to fail the
thing that published.
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from typing import Any

EventHook = Callable[[dict[str, Any]], None]

_SUBSCRIBERS: list[EventHook] = []
_SUBSCRIBER_LOCK = threading.Lock()


def subscribe(hook: EventHook) -> Callable[[], None]:
    """Receive every event published here. Returns the callable that unsubscribes it."""
    with _SUBSCRIBER_LOCK:
        _SUBSCRIBERS.append(hook)

    def cancel() -> None:
        unsubscribe(hook)

    return cancel


def unsubscribe(hook: EventHook) -> None:
    with _SUBSCRIBER_LOCK:
        if hook in _SUBSCRIBERS:
            _SUBSCRIBERS.remove(hook)


def clear_subscribers() -> None:
    """Drop every subscriber. Tests and a shutting-down process call this."""
    with _SUBSCRIBER_LOCK:
        _SUBSCRIBERS.clear()


def emit(event: dict[str, Any]) -> None:
    """Hand one event to every subscriber, whatever any of them makes of it."""
    with _SUBSCRIBER_LOCK:
        hooks = list(_SUBSCRIBERS)
    for hook in hooks:
        try:
            hook(event)
        except Exception:
            continue
