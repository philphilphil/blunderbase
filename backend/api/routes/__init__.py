"""The HTTP surface: one router per service, each a thin wrapper over it."""

from fastapi import APIRouter

from backend.api.routes import (
    accounts,
    analysis,
    auth,
    engines,
    events,
    explorer,
    games,
    imports,
    lines,
    live,
    maia,
    notes,
    runner_gateway,
    runners,
    search,
    settings,
    stats,
    streams,
)

ROUTERS: tuple[APIRouter, ...] = (
    auth.router,
    games.router,
    accounts.router,
    imports.router,
    analysis.router,
    explorer.router,
    stats.router,
    engines.router,
    notes.router,
    lines.router,
    search.router,
    live.router,
    maia.router,
    runner_gateway.router,
    runners.router,
    settings.router,
    streams.router,
    events.router,
)

__all__ = ["ROUTERS"]
