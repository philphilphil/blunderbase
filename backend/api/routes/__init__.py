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
    live,
    notes,
    stats,
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
    live.router,
    events.router,
)

__all__ = ["ROUTERS"]
