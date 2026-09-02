"""Request-scoped dependencies.

The only database thing in this package is the Session factory: a handler takes a Session
and hands it straight to a service function. Nothing here writes a query.
"""

from __future__ import annotations

import contextlib
from collections.abc import Iterator
from datetime import datetime
from typing import Annotated, Literal

from fastapi import Depends, Query, Request
from sqlalchemy.orm import Session

from backend.api.errors import ApiError
from backend.api.events import EventBroker
from backend.config import Settings
from backend.db.enums import Color, Result, Source, Speed
from backend.db.session import get_sessionmaker
from backend.services.games import GameFilters


def app_settings(request: Request) -> Settings:
    """The settings this app was built with, which need not be the process-wide default."""
    return request.app.state.settings


def db_session(request: Request) -> Iterator[Session]:
    """One Session per request, closed on the way out."""
    with get_sessionmaker(request.app.state.settings)() as session:
        yield session


def event_broker(request: Request) -> EventBroker:
    return request.app.state.events


def wake_workers(request: Request) -> None:
    """Nudge the analysis workers after something was enqueued.

    A handler runs in a thread and the workers' wake-up is an asyncio primitive, so the
    nudge is posted to the loop rather than set directly. Losing it costs one poll
    interval, never a run, which is why every failure here is swallowed.
    """
    workers = getattr(request.app.state, "workers", None)
    loop = getattr(request.app.state, "loop", None)
    if workers is None or loop is None or not workers.running:
        return
    with contextlib.suppress(RuntimeError):
        loop.call_soon_threadsafe(workers.notify)


def game_filters(
    since: Annotated[datetime | None, Query(description="played at or after")] = None,
    until: Annotated[datetime | None, Query(description="played at or before")] = None,
    source: Source | None = None,
    color: Annotated[Color | None, Query(description="the colour the owner had")] = None,
    eco: Annotated[str | None, Query(description="ECO code or prefix, e.g. C6")] = None,
    result: Annotated[Result | None, Query(description="the PGN result")] = None,
    outcome: Annotated[str | None, Query(description="win | loss | draw, owner's side")] = None,
    speed: Speed | None = None,
    time_control: str | None = None,
    opponent: str | None = None,
    variant: str | None = None,
    has_blunders: bool | None = None,
    analyzed: Annotated[bool | None, Query(description="whether any analysis pass is done")] = None,
    deep_analyzed: bool | None = None,
    text: Annotated[str | None, Query(description="free text over names and openings")] = None,
    whose: Annotated[
        Literal["mine", "others", "all"],
        Query(
            description="mine (the default): the owner's own games; others: the games "
            "added from the reference books; all: both"
        ),
    ] = "mine",
) -> GameFilters:
    """The one filter vocabulary, shared by `/games` and every `/stats` dimension.

    `whose` spells the service's three-way `mine` field in words, because `mine=null` is
    not a thing a query string can say.
    """
    return GameFilters(
        since=since,
        until=until,
        source=source,
        color=color,
        eco=eco,
        result=result,
        outcome=outcome,
        speed=speed,
        time_control=time_control,
        opponent=opponent,
        variant=variant,
        has_blunders=has_blunders,
        analyzed=analyzed,
        deep_analyzed=deep_analyzed,
        text=text,
        mine=WHOSE[whose],
    )


# The query string's word for each value of `GameFilters.mine`.
WHOSE: dict[str, bool | None] = {"mine": True, "others": False, "all": None}


def ply_range(start: int | None, end: int | None, *, name: str = "ply") -> tuple[int, int] | None:
    """A ply window from two optional query parameters: both or neither."""
    if start is None and end is None:
        return None
    if start is None or end is None:
        raise ApiError(
            422, "invalid_request", f"{name}_start and {name}_end have to be given together"
        )
    return start, end


def not_found(error: str, detail: str) -> ApiError:
    return ApiError(404, error, detail)


SessionDep = Annotated[Session, Depends(db_session)]
SettingsDep = Annotated[Settings, Depends(app_settings)]
BrokerDep = Annotated[EventBroker, Depends(event_broker)]
FiltersDep = Annotated[GameFilters, Depends(game_filters)]
