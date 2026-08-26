from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic import Field, model_validator
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
    # Everything the app writes that is not the database: downloaded engines, weights,
    # uploaded PGNs. Defaults to `<root>/data`.
    data_dir: Path | None = None
    database_path: Path | None = Field(default=None, validation_alias="BLUNDERBASE_DB_PATH")
    # The built web app, served by the API process so a deployment is one port. Defaults
    # to `<root>/web/dist`; a directory that was never built simply is not served, which
    # is the normal case in development (the Vite dev server has the page instead).
    web_dist: Path | None = None
    # The PostgreSQL escape hatch: a full SQLAlchemy URL that replaces the SQLite file.
    # Unset — the normal case — means the database at `database_path`. Nothing else in the
    # codebase asks which back end it is talking to; this is the only seam.
    database_url: str = ""

    # Engine processes running at once, shared across tiers. Workers are asyncio tasks in
    # the API process, so this caps CPU rather than connections.
    analysis_concurrency: int = Field(default_factory=default_analysis_concurrency, ge=1)
    # Whether the API process runs the analysis workers itself. Off is for a deployment
    # that drives the queue from `blunderbase analyze` on another schedule.
    analysis_workers: bool = True
    # How long an idle worker waits before looking at the queue again.
    analysis_poll_seconds: float = Field(default=1.0, gt=0)

    # Engine budget per position. Quick is the automatic pass on import and is sized to
    # keep up with an archive sync; deep is what someone is waiting on.
    quick_nodes: int = Field(default=250_000, ge=1)
    deep_nodes: int = Field(default=2_000_000, ge=1)
    deep_multipv: int = Field(default=4, ge=1, le=10)

    # Move classification thresholds, in win-percentage points lost by the mover (à la
    # Lichess). Centipawns are deliberately not the unit: they overweight a middlegame
    # swing between two already-winning positions.
    inaccuracy_threshold: float = Field(default=10.0, ge=0, le=100)
    mistake_threshold: float = Field(default=20.0, ge=0, le=100)
    blunder_threshold: float = Field(default=30.0, ge=0, le=100)

    # The rating levels Maia is asked about, as offsets from the owner's rating in the
    # game being analysed. Two or three levels around it is what a coach actually uses.
    maia_rating_offsets: tuple[int, ...] = (-100, 0, 100)
    # Used when the game carries no rating for the owner — an OTB PGN, an unrated game.
    default_owner_rating: int = Field(default=1500, ge=1)

    # Guards the MCP streamable-HTTP transport only; the HTTP API binds to loopback.
    # Empty means the remote transport is not configured and must not be served.
    mcp_bearer_key: str = ""

    # Remote runners. Every one of these has a default, so a deployment with no runners
    # registered behaves exactly as it did before they existed.
    #
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
        if not self.database_url.strip():
            self.database_url = f"sqlite+pysqlite:///{self.database_path}"
        return self

    @model_validator(mode="after")
    def _ordered_thresholds(self) -> Settings:
        ordered = (self.inaccuracy_threshold, self.mistake_threshold, self.blunder_threshold)
        if list(ordered) != sorted(ordered):
            raise ValueError(
                "classification thresholds must rise: inaccuracy <= mistake <= blunder"
            )
        return self

    def _resolve(self, value: Path | None, fallback: Path) -> Path:
        if value is None:
            return fallback
        value = value.expanduser()
        return value if value.is_absolute() else (self.root / value).resolve()

    def ensure_directories(self) -> None:
        assert self.data_dir is not None and self.database_path is not None
        for path in (self.data_dir, self.database_path.parent):
            path.mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
