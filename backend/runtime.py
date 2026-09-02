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
    # The library cannot be changed from here: every write answers 403 `read_only`. The
    # page uses it to say so up front rather than letting a visitor find out by trying.
    read_only: bool


SERVER_CAPABILITIES = RuntimeCapabilities(
    password_auth=True,
    mcp=True,
    remote_runners=True,
    read_only=False,
)
DESKTOP_CAPABILITIES = RuntimeCapabilities(
    password_auth=False,
    mcp=False,
    remote_runners=False,
    read_only=False,
)
# The public demo: no password because there is nothing to protect, no coach and no
# runners because both would be a stranger's way to make the process do work, and no
# writes because the library is the exhibit.
DEMO_CAPABILITIES = RuntimeCapabilities(
    password_auth=False,
    mcp=False,
    remote_runners=False,
    read_only=True,
)


def capabilities_for(settings: Settings) -> RuntimeCapabilities:
    """Return the complete runtime contract for one process."""
    if settings.runtime_mode == "desktop":
        return DESKTOP_CAPABILITIES
    if settings.runtime_mode == "demo":
        return DEMO_CAPABILITIES
    return SERVER_CAPABILITIES
