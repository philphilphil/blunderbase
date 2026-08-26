"""The HTTP surface: one router per service, each a thin wrapper over it."""

from fastapi import APIRouter

from backend.api.routes import analysis, engines, events, explorer, games, imports, notes, stats

ROUTERS: tuple[APIRouter, ...] = (
    games.router,
    imports.router,
    analysis.router,
    explorer.router,
    stats.router,
    engines.router,
    notes.router,
    events.router,
)

__all__ = ["ROUTERS"]
