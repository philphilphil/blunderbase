"""The runtime features one Blunderbase process can actually provide.

Distribution shape is decided when the process starts, not when the web bundle is built.
The browser therefore receives this small contract from the backend and never has to infer
"desktop" from a port, user agent, or Tauri global.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict

if TYPE_CHECKING:
    from backend.config import Settings


class RuntimeCapabilities(BaseModel):
    """Optional surfaces exposed by this running installation."""

    model_config = ConfigDict(frozen=True)

    password_auth: bool
    mcp: bool
    remote_runners: bool


SERVER_CAPABILITIES = RuntimeCapabilities(
    password_auth=True,
    mcp=True,
    remote_runners=True,
)
DESKTOP_CAPABILITIES = RuntimeCapabilities(
    password_auth=False,
    mcp=False,
    remote_runners=False,
)


def capabilities_for(settings: Settings) -> RuntimeCapabilities:
    """Return the complete runtime contract for one process."""
    return DESKTOP_CAPABILITIES if settings.runtime_mode == "desktop" else SERVER_CAPABILITIES
