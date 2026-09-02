from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[1]

MIN_ANALYSIS_CONCURRENCY = 1
RESERVED_CORES = 2

# Maia's Elo conditioning only means anything inside the range it was trained on; an
# engine that declares its own SelfElo bounds narrows these further at analysis time.
MAIA_MIN_RATING = 1100
MAIA_MAX_RATING = 2000


def default_analysis_concurrency() -> int:
    """Leave two cores for the API process and the machine's owner."""
    cores = os.cpu_count() or (MIN_ANALYSIS_CONCURRENCY + RESERVED_CORES)
    return max(MIN_ANALYSIS_CONCURRENCY, cores - RESERVED_CORES)


class Settings(BaseSettings):
    # `env_ignore_empty` makes a present-but-empty variable mean "unset" rather than a
    # value to parse: a commented-out entry someone uncommented and left blank falls back
    # to the default here instead of refusing to boot on an int or a path it cannot read.
    model_config = SettingsConfigDict(
        env_prefix="BLUNDERBASE_", extra="ignore", env_ignore_empty=True
    )

    root: Path = ROOT
    # The same build runs as a networked server, inside the desktop shell, and as the public
    # demo. The mode is runtime configuration so the backend, web UI and tests all see the
    # same capabilities. `demo` opens the door to everyone and closes every write — it is
    # for a database `blunderbase demo create` built, and nothing else should ever run in it.
    runtime_mode: Literal["server", "desktop", "demo"] = "server"
    # A desktop launch authenticates its own webview transparently with this per-launch
    # secret. It is deliberately unrelated to the owner's persistent server password.
    desktop_token: SecretStr = SecretStr("")
    # Everything the app writes that is not the database: downloaded engines, weights,
    # uploaded PGNs. Defaults to `<root>/data`.
    data_dir: Path | None = None
    database_path: Path | None = Field(default=None, validation_alias="BLUNDERBASE_DB_PATH")
    # The built web app, served by the API process so a deployment is one port. Defaults
    # to `<root>/web/dist`; a directory that was never built simply is not served, which
    # is the normal case in development (the Vite dev server has the page instead).
    web_dist: Path | None = None
    # Whether the page is served cross-origin isolated (`Cross-Origin-Opener-Policy:
    # same-origin` plus `Cross-Origin-Embedder-Policy: require-corp`). That is the browser's
    # price for `SharedArrayBuffer`, which a multi-threaded WASM engine cannot run without —
    # so it is on, and the cost is that every cross-origin subresource the page loads must
    # opt in with CORP. Off is for a deployment behind a proxy that rewrites the headers, or
    # one that has added an asset from another origin: the page then works exactly as before
    # and a browser engine falls back to one thread. See `api/web.py`.
    cross_origin_isolation: bool = True

    # Engine processes running at once, shared across tiers. Workers are asyncio tasks in
    # the API process, so this caps CPU rather than connections.
    analysis_concurrency: int = Field(default_factory=default_analysis_concurrency, ge=1)
    # Whether the API process runs the analysis workers itself. Off is for a deployment
    # that drives the queue from `blunderbase analyze` on another schedule.
    analysis_workers: bool = True
    # How long an idle worker waits before looking at the queue again.
    analysis_poll_seconds: float = Field(default=1.0, gt=0)

    # The per-position engine budgets, the classification thresholds and the rating to
    # centre Maia on when a game carries none are deliberately not here: they are app
    # settings, stored in the database and edited on the analysis configuration pages,
    # because they are
    # the ones an owner changes as their play changes and a restart is not a thing to ask
    # of them for that. `services/app_settings.py` owns them and their defaults.

    # Guards the MCP streamable-HTTP transport only; the HTTP API binds to loopback.
    # Empty means the remote transport is not configured and must not be served.
    mcp_bearer_key: str = ""

    # Remote runners. Every one of these has a default, so a deployment with no runners
    # registered behaves exactly as it did before they existed.
    #
    # How often the scheduled sync looks at the clock. The interval itself is an app
    # setting (`auto_sync_minutes`, off by default); this only decides how late a sync can
    # be, so a minute is plenty and the tests shrink it.
    auto_sync_poll_seconds: float = Field(default=60.0, gt=0)

    # How often the gateway pings a connected runner, and how often a polling one comes
    # back for work. Several beats fit inside `analysis.STALE_AFTER_SECONDS`.
    runner_heartbeat_seconds: float = Field(default=10.0, gt=0)
    runner_poll_seconds: float = Field(default=5.0, gt=0)
    # The gateway sweeps for stale runs on its own clock, because it is what creates
    # orphans no local worker would ever notice.
    runner_stale_sweep_seconds: float = Field(default=20.0, gt=0)

    # Infinite analysis. Snapshots are throttled at whichever host is producing them.
    stream_snapshot_interval: float = Field(default=0.5, gt=0)
    # How long a session survives with nobody listening on `/events` before it frees its slot.
    stream_idle_seconds: float = Field(default=30.0, gt=0)
    # One session per browser surface: the game board and the live board.
    stream_max_sessions: int = Field(default=2, ge=1)

    # How this deployment is reached from outside, used to write the `runner.yaml` snippet
    # the create-runner flow hands over. Empty falls back to the requesting origin.
    public_url: str = ""

    host: str = "127.0.0.1"
    port: int = 8765

    @model_validator(mode="after")
    def _resolve_paths(self) -> Settings:
        self.root = self.root.expanduser().resolve()
        self.data_dir = self._resolve(self.data_dir, self.root / "data")
        self.database_path = self._resolve(self.database_path, self.data_dir / "blunderbase.db")
        self.web_dist = self._resolve(self.web_dist, self.root / "web" / "dist")
        if self.runtime_mode == "desktop":
            token = self.desktop_token.get_secret_value()
            if len(token) != 64 or any(character not in "0123456789abcdef" for character in token):
                raise ValueError("desktop mode needs a 64-character lowercase hexadecimal token")
        return self

    def _resolve(self, value: Path | None, fallback: Path) -> Path:
        if value is None:
            return fallback
        value = value.expanduser()
        return value if value.is_absolute() else (self.root / value).resolve()

    @property
    def demo(self) -> bool:
        """Whether this is the public, read-only demo — the one mode with no door at all."""
        return self.runtime_mode == "demo"

    @property
    def database_url(self) -> str:
        """The SQLAlchemy URL for `database_path`. SQLite is the only back end there is."""
        return f"sqlite+pysqlite:///{self.database_path}"

    def ensure_directories(self) -> None:
        assert self.data_dir is not None and self.database_path is not None
        for path in (self.data_dir, self.database_path.parent):
            path.mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
