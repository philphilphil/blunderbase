"""The MCP coach surface: thin tool wrappers over `backend.services`.

Never touches the database.
"""

from backend.mcp.errors import CoachError
from backend.mcp.server import SERVER_NAME, Coach, build_server, run_stdio

__all__ = ["SERVER_NAME", "Coach", "CoachError", "build_server", "run_stdio"]
