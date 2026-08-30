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
    mcp_keys,
    notes,
    runner_gateway,
    runners,
    search,
    settings,
    stats,
    streams,
)

CORE_ROUTERS: tuple[APIRouter, ...] = (
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
    runners.status_router,
    settings.router,
    streams.router,
    events.router,
)

REMOTE_RUNNER_ROUTERS: tuple[APIRouter, ...] = (runner_gateway.router, runners.router)
MCP_ROUTERS: tuple[APIRouter, ...] = (mcp_keys.router,)

# The complete server surface remains useful to callers that inspect the module. App
# construction chooses the runtime subset below rather than teaching each handler modes.
ROUTERS: tuple[APIRouter, ...] = CORE_ROUTERS + REMOTE_RUNNER_ROUTERS + MCP_ROUTERS

__all__ = ["CORE_ROUTERS", "MCP_ROUTERS", "REMOTE_RUNNER_ROUTERS", "ROUTERS"]
