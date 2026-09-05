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
# The public demo: no password because there is nothing to protect, no coach because it
# would be a stranger's way to make the process do work, and no writes because the
# library is the exhibit. Nothing a visitor does reaches an engine on this machine — the
# analysis board and both tiers run on Stockfish in their own tab — and the demo's games
# arrive already analysed, so there is nothing here to keep busy. `remote_runners` stays
# true only so the door a token opens is the same door in every mode: one dials *in* with
# a hash `demo create --runners` copied over, and minting a new one is a write the demo
# refuses, so only the owner's own machines have a key.
DEMO_CAPABILITIES = RuntimeCapabilities(
    password_auth=False,
    mcp=False,
    remote_runners=True,
    read_only=True,
)


def capabilities_for(settings: Settings) -> RuntimeCapabilities:
    """Return the complete runtime contract for one process."""
    if settings.runtime_mode == "desktop":
        return DESKTOP_CAPABILITIES
    if settings.runtime_mode == "demo":
        return DEMO_CAPABILITIES
    return SERVER_CAPABILITIES
