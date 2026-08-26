"""Request and response models.

Two kinds live here. A request model is strict: it rejects a field it does not know, so a
typo in a body is a 422 rather than a silently ignored option. A response model built from
a service payload is permissive (`extra="allow"`): the documented fields are what a client
can rely on, and anything the service adds — a dimension's own keys, a new field on a game
card — still reaches the client instead of being filtered out of the response.

Service payloads drop keys that are None (they are read by a chat model as often as by a
browser), so every documented field carries a default.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.db.enums import (
    Classification,
    Color,
    EngineKind,
    JobStatus,
    RunStatus,
    Source,
    Tier,
)


class Payload(BaseModel):
    """A response built by a service: documented fields, plus whatever else it carries."""

    model_config = ConfigDict(extra="allow")


class Input(BaseModel):
    """A request body. An unknown field is a mistake, not something to ignore."""

    model_config = ConfigDict(extra="forbid")


class Row(BaseModel):
    """A response read straight off a service's ORM row."""

    model_config = ConfigDict(from_attributes=True)


# --- games ----------------------------------------------------------------


class GameSummary(Payload):
    """`services.games.game_summary`: the compact game every payload embeds."""

    id: int
    source: Source
    source_id: str | None = None
    played_at: datetime | None = None
    color: Color | None = None
    result: str | None = None
    outcome: str | None = None
    white: str | None = None
    black: str | None = None
    white_rating: int | None = None
    black_rating: int | None = None
    opponent: str | None = None
    opponent_rating: int | None = None
    rating: int | None = None
    speed: str | None = None
    time_control: str | None = None
    rated: bool | None = None
    variant: str | None = None
    eco: str | None = None
    opening: str | None = None
    termination: str | None = None
    ply_count: int | None = None


class GameCard(GameSummary):
    """A summary plus the eval curve and the worst moments, for a dashboard strip."""

    analyzed: bool = False
    deep: bool = False
    eval_curve: list[dict[str, Any]] = Field(default_factory=list)
    worst_moments: list[dict[str, Any]] = Field(default_factory=list)


class GameList(BaseModel):
    """`cards=true` adds every `GameCard` field to each entry."""

    games: list[GameSummary]
    total: int
    limit: int
    offset: int


class MoveRow(Payload):
    ply: int
    move_number: int | None = None
    color: Color | None = None
    san: str | None = None
    uci: str | None = None
    clock: float | None = None
    by_owner: bool | None = None
    win_before: float | None = None
    win_after: float | None = None
    win_loss: float | None = None
    classification: Classification | None = None
    best_move_uci: str | None = None
    best_lines: list[dict[str, Any]] | None = None
    maia: dict[str, Any] | None = None
    run_id: int | None = None


class GameDetail(Payload):
    """`services.games.get_game_detail`."""

    game: GameSummary
    ply_range: list[int] | None = None
    moves: list[MoveRow] = Field(default_factory=list)
    runs: list[dict[str, Any]] = Field(default_factory=list)
    notes: list[dict[str, Any]] | None = None


# --- import ---------------------------------------------------------------


class ImportRequest(Input):
    """The options an import adapter takes. An adapter ignores the ones it does not use."""

    username: str | None = None
    path: str | None = None
    text: str | None = Field(default=None, description="PGN text, for the `pgn` source")
    since: str | None = Field(default=None, description="resume from this cursor")
    max_games: int | None = Field(default=None, ge=1)
    wait: bool = Field(default=False, description="run the sync inline and return the finished job")

    def options(self) -> dict[str, Any]:
        """Only the flags that were given, so an adapter sees its own defaults."""
        given = self.model_dump(exclude={"wait"}, exclude_none=True)
        return {key: value for key, value in given.items() if value != ""}


class ImportJobResponse(Row):
    id: int
    source: Source
    account_id: int | None = None
    status: JobStatus
    cursor: str | None = None
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    games_seen: int = 0
    games_imported: int = 0
    games_skipped: int = 0
    games_failed: int = 0
    errors: list[dict[str, Any]] = Field(default_factory=list)
    message: str | None = None


class ImportStarted(BaseModel):
    """What a triggered sync answers with. The job row is the record of what happened."""

    source: str
    status: str
    job_id: int | None = None
    job: ImportJobResponse | None = None


# --- analysis -------------------------------------------------------------


class AnalysisRequest(Input):
    """Enqueue one pass. Exactly one of `game_id` and `fen`."""

    game_id: int | None = None
    fen: str | None = None
    tier: Tier = Tier.QUICK
    ply_start: int | None = Field(default=None, ge=0)
    ply_end: int | None = Field(default=None, ge=0)
    engine_id: int | None = None
    multipv: int | None = Field(default=None, ge=1)
    nodes: int | None = Field(default=None, ge=1)
    depth: int | None = Field(default=None, ge=1)
    priority: int | None = None

    @model_validator(mode="after")
    def _paired_ply_range(self) -> AnalysisRequest:
        if (self.ply_start is None) != (self.ply_end is None):
            raise ValueError("ply_start and ply_end have to be given together")
        return self

    @property
    def ply_range(self) -> tuple[int, int] | None:
        if self.ply_start is None or self.ply_end is None:
            return None
        return self.ply_start, self.ply_end


class RunResponse(Row):
    id: int
    game_id: int | None = None
    fen: str | None = None
    engine_id: int | None = None
    tier: Tier
    status: RunStatus
    depth: int | None = None
    nodes: int | None = None
    multipv: int = 1
    ply_start: int | None = None
    ply_end: int | None = None
    priority: int = 0
    attempts: int = 0
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    error: str | None = None
    stderr: str | None = None


class MoveEvalResponse(Row):
    ply: int
    move_uci: str | None = None
    move_san: str | None = None
    eval_before_cp: int | None = None
    eval_before_mate: int | None = None
    eval_after_cp: int | None = None
    eval_after_mate: int | None = None
    win_before: float | None = None
    win_after: float | None = None
    win_loss: float | None = None
    classification: Classification | None = None
    best_move_uci: str | None = None
    best_lines: list[dict[str, Any]] | None = None
    maia_policy: dict[str, Any] | None = None


class QueueStatus(BaseModel):
    queued: int
    running: int
    workers: bool = Field(description="whether this process is draining the queue")
    busy: int = Field(default=0, description="runs executing in this process right now")


class PositionAnalysisRequest(Input):
    fen: str
    nodes: int = Field(default=200_000, ge=1, le=50_000_000)


class PositionAnalysis(Payload):
    """`services.analysis.analyze_position`: a bounded synchronous "what if"."""

    fen: str
    engine_id: int | None = None
    engine_name: str | None = None
    depth: int | None = None
    nodes: int | None = None
    cp: int | None = None
    mate: int | None = None
    win_percent: float | None = None
    best_move: dict[str, Any] | None = None
    lines: list[dict[str, Any]] = Field(default_factory=list)


# --- explorer -------------------------------------------------------------


class ExplorerResponse(Payload):
    """`services.explorer.opening_explorer`."""

    fen: str | None = None
    eco: str | None = None
    color: Color | None = None
    side_to_move: Color | None = None
    path: list[dict[str, Any]] = Field(default_factory=list)
    root_ply: int | None = None
    totals: dict[str, Any] = Field(default_factory=dict)
    moves: list[dict[str, Any]] = Field(default_factory=list)
    main_line: list[dict[str, Any]] = Field(default_factory=list)
    book_depth: int = 0
    leaves_book_with: dict[str, Any] | None = None
    leaves_book_because: str | None = None


class PositionOccurrence(Payload):
    """One game that reached the queried position."""

    game: GameSummary
    ply: int
    move_number: int | None = None
    move_uci: str | None = None
    move_san: str | None = None
    win_loss: float | None = None
    classification: Classification | None = None


# --- stats ----------------------------------------------------------------


class StatsResponse(Payload):
    """One aggregation. The keys beyond these are the dimension's own."""

    dimension: str
    since: datetime | None = None
    until: datetime | None = None


class ComparisonResponse(Payload):
    """`services.stats.compare_periods`."""

    dimension: str
    then: dict[str, Any]
    now: dict[str, Any]
    delta: dict[str, Any]


class ProfileResponse(Payload):
    """`services.games.get_player_profile`."""

    accounts: list[dict[str, Any]] = Field(default_factory=list)
    ratings: list[dict[str, Any]] = Field(default_factory=list)
    volume: dict[str, Any] = Field(default_factory=dict)


class MomentResponse(Payload):
    """One of the worst recent moments, with the position and the better move."""

    game: GameSummary
    ply: int
    move_number: int | None = None
    san: str | None = None
    uci: str | None = None
    classification: Classification | None = None
    win_loss: float | None = None
    phase: str | None = None
    piece: str | None = None
    fen: str | None = None
    best_move_uci: str | None = None
    best_move_san: str | None = None
    run_id: int | None = None
    tier: Tier | None = None


class DimensionList(BaseModel):
    dimensions: list[str]
    planned: list[str]


# --- engines --------------------------------------------------------------


class EngineResponse(Row):
    id: int
    name: str
    kind: EngineKind
    path: str
    version: str | None = None
    options: dict[str, Any] = Field(default_factory=dict)
    enabled: bool = True
    default_tier: Tier | None = None
    created_at: datetime


class EngineCreate(Input):
    name: str = Field(min_length=1, max_length=64)
    path: str = Field(min_length=1, max_length=512)
    kind: EngineKind = EngineKind.UCI
    options: dict[str, Any] = Field(default_factory=dict)
    default_tier: Tier | None = None
    enabled: bool = True


class EngineUpdate(Input):
    """Only the fields that are present are changed."""

    name: str | None = Field(default=None, min_length=1, max_length=64)
    path: str | None = Field(default=None, min_length=1, max_length=512)
    kind: EngineKind | None = None
    options: dict[str, Any] | None = None
    default_tier: Tier | None = None
    enabled: bool | None = None

    def changes(self) -> dict[str, Any]:
        """`default_tier=None` is a real value, so what was sent is what is applied."""
        return self.model_dump(exclude_unset=True)


class ProbeRequest(Input):
    path: str = Field(min_length=1, max_length=512)
    kind: EngineKind = EngineKind.UCI


class ProbeResponse(Payload):
    """What a binary said about itself when it was asked to identify."""

    name: str | None = None
    author: str | None = None
    options: list[dict[str, Any]] = Field(default_factory=list)


class SampleRequest(Input):
    """The test-run button: one position, a budget sized for someone waiting on it."""

    fen: str | None = None
    nodes: int = Field(default=200_000, ge=1, le=50_000_000)
    multipv: int = Field(default=3, ge=1, le=10)
    ratings: list[int] | None = Field(default=None, description="Maia rating levels to ask about")


class SampleResponse(Payload):
    engine_id: int
    engine_name: str
    kind: EngineKind
    fen: str
    elapsed_ms: int
    depth: int | None = None
    nodes: int | None = None
    cp: int | None = None
    mate: int | None = None
    best_move: dict[str, Any] | None = None
    lines: list[dict[str, Any]] | None = None
    policy: dict[str, Any] | None = None


class TierStatusResponse(BaseModel):
    tier: Tier
    engine_id: int | None = None
    engine_name: str | None = None
    available: bool = False
    reason: str | None = None


# --- notes ----------------------------------------------------------------


class NoteResponse(BaseModel):
    id: int
    text: str
    tags: list[str] = Field(default_factory=list)
    game_id: int | None = None
    position_id: int | None = None
    created_at: datetime
    updated_at: datetime


class NoteCreate(Input):
    text: str = Field(min_length=1)
    tags: list[str] = Field(default_factory=list)
    game_id: int | None = None
    fen: str | None = None


class NoteUpdate(Input):
    text: str | None = Field(default=None, min_length=1)
    tags: list[str] | None = None


class TagCount(BaseModel):
    tag: str
    notes: int
