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
    Platform,
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


# --- auth -----------------------------------------------------------------


class AuthStatus(BaseModel):
    """What the page asks before it renders anything: is there a password, and do I have it.

    It is also the only payload every screen already has by the time it renders, which is
    why the one piece of deployment-wide configuration the UI needs rides along on it: the
    Settings page owns that value (`/settings` below), but every other screen needs it to
    render and none of them should have to wait on a second call for it.
    """

    setup_required: bool
    authenticated: bool
    maia_target_elo: int | None = Field(
        default=None,
        description="the configured Maia level, or null for the rating-centred behaviour",
    )


class PasswordSetup(Input):
    """First run. The length rule is the service's, so a short password is a named
    refusal (`weak_password`) rather than an anonymous validation error."""

    password: str = Field(min_length=1)


class PasswordLogin(Input):
    password: str = Field(min_length=1)


class PasswordChange(Input):
    current: str = Field(min_length=1)
    new: str = Field(min_length=1)


# --- settings --------------------------------------------------------------


class AppSettings(BaseModel):
    """Everything the Settings page shows: eight numbers, each of them nullable.

    Null is never "not loaded yet". It is the deployment saying nobody has set this one,
    and what is in force is the default `services.app_settings` names — which is why the
    page can show that default under an empty box rather than pretending to a value.
    """

    maia_target_elo: int | None = Field(
        default=None,
        description=(
            "the one rating every Maia question is asked at, or null for a level centred "
            "on the owner's rating in the game, over their own moves"
        ),
    )
    quick_nodes: int | None = Field(
        default=None, description="nodes per position in the automatic pass on import"
    )
    deep_nodes: int | None = Field(
        default=None, description="nodes per position in a deep pass someone is waiting on"
    )
    deep_multipv: int | None = Field(
        default=None, description="how many lines a deep pass keeps per position"
    )
    inaccuracy_threshold: float | None = Field(
        default=None, description="win-percentage points lost that make a move an inaccuracy"
    )
    mistake_threshold: float | None = Field(
        default=None, description="win-percentage points lost that make a move a mistake"
    )
    blunder_threshold: float | None = Field(
        default=None, description="win-percentage points lost that make a move a blunder"
    )
    default_owner_rating: int | None = Field(
        default=None, description="the rating to use where the game itself carries none"
    )


class AppSettingsUpdate(Input):
    """A change to the settings. Null clears one back to its default.

    A PUT carries the whole of the settings rather than a patch of them, so an omitted
    field means the same as a null one: cleared.

    Out of range is clamped rather than refused, which is the rule the whole store follows
    (`services.app_settings`): an owner aiming at 2200 gets Maia's top level, not a form
    that will not save. The one refusal is a set of classification thresholds that does not
    rise, because no clamp rescues an inaccuracy that costs more than a blunder.
    """

    maia_target_elo: int | None = None
    quick_nodes: int | None = None
    deep_nodes: int | None = None
    deep_multipv: int | None = None
    inaccuracy_threshold: float | None = None
    mistake_threshold: float | None = None
    blunder_threshold: float | None = None
    default_owner_rating: int | None = None


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


class GamesWipe(Input):
    """The owner's password again. Holding a session is not consent to empty the library."""

    password: str = Field(min_length=1)


class GamesDeleted(BaseModel):
    """What the wipe removed, so the page can say it rather than only imply it.

    `import_jobs` is in the answer because it is the surprising half: the sync history goes
    with the games, which is what makes the next sync of a source a fresh one.
    """

    games: int = 0
    runs: int = 0
    notes: int = 0
    import_jobs: int = 0


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


# --- accounts -------------------------------------------------------------


class AccountResponse(Payload):
    """`services.accounts.account_payload`: one username the owner plays under."""

    id: int
    platform: Platform
    username: str
    display_name: str | None = None
    is_owner: bool = True
    games: int = Field(default=0, description="stored games this account is a player in")
    created_at: datetime | None = None


class AccountCreate(Input):
    """Register an account. Registering also repairs the games it already played in."""

    platform: Platform
    username: str = Field(min_length=1, max_length=64)
    display_name: str | None = Field(default=None, max_length=128)


class Reconciliation(BaseModel):
    """What a repair filled in, and what it could not: games nobody is a player in."""

    linked: int = Field(default=0, description="game sides that gained their account link")
    colored: int = Field(default=0, description="games that gained an owner colour")
    unclaimed: int = Field(default=0, description="games left with no owner colour at all")


class AccountRegistered(BaseModel):
    account: AccountResponse
    reconciled: Reconciliation


# --- import ---------------------------------------------------------------


class ImportRequest(Input):
    """The options an import adapter takes. An adapter ignores the ones it does not use."""

    username: str | None = None
    path: str | None = None
    text: str | None = Field(default=None, description="PGN text, for the `pgn` source")
    since: str | None = Field(default=None, description="resume from this cursor")
    max_games: int | None = Field(default=None, ge=1)
    analyze: bool = Field(
        default=True, description="queue a quick pass over each game as it lands"
    )
    wait: bool = Field(default=False, description="run the sync inline and return the finished job")

    def options(self) -> dict[str, Any]:
        """Only the flags that were given, so an adapter sees its own defaults."""
        given = self.model_dump(exclude={"wait"}, exclude_none=True)
        # `analyze` is a plain bool, so it is never "not given" the way the rest are: it
        # travels only when it is switched off, which leaves every adapter's own default —
        # evaluate — the one that decides, exactly as it did before the flag existed.
        if given.get("analyze") is not False:
            given.pop("analyze", None)
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


class QueueDestination(Payload):
    """`services.runners.queue_destinations`: one place the backlog can be worked.

    A run with no engine, or one whose engine is switched off, counts as `local` — that is
    where the worker's fallback sends it, whatever it was queued against.
    """

    destination: str = Field(description="local | runner")
    runner_id: int | None = None
    name: str
    connected: bool = True
    slots: int | None = None
    queued: int = 0
    running: int = 0
    streams: int = 0


class QueueStatus(BaseModel):
    queued: int
    running: int
    workers: bool = Field(description="whether this process is draining the queue")
    busy: int = Field(default=0, description="runs executing in this process right now")
    destinations: list[QueueDestination] = Field(
        default_factory=list, description="the same backlog, split by where it will be run"
    )


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


# --- maia -----------------------------------------------------------------


class MaiaPolicyRequest(Input):
    """Ask the human-move model about a position the analysis board made up.

    Only `fen` is required: the level defaults to the deployment's target elo, the width to
    what a batch pass stores, and no `rollout_plies` means the policy alone.
    """

    fen: str = Field(min_length=1)
    elo: int | None = Field(
        default=None, ge=1, description="clamped to what the build can answer for"
    )
    moves: int | None = Field(default=None, ge=1, le=10, description="policy entries wanted")
    rollout_plies: int = Field(
        default=0, ge=0, le=20, description="0 for no rollout; both sides play at `elo`"
    )


class MaiaPolicyResponse(Payload):
    """`services.maia_live.live_policy`: what a human at `elo` plays here, and next.

    `elo` is the level the engine really used — the clamped request for a build that takes
    one, the level its weights are for where a fixed-weights build names them, and `null`
    where such a build never says which human it plays as (the panel then shows no number
    rather than the one nobody honoured). `p` is absent from an entry whose build publishes
    no policy figure, exactly as in the stored `MoveEval.maia_policy` blob.
    """

    elo: int | None = None
    policy: list[dict[str, Any]] = Field(default_factory=list)
    rollout: list[dict[str, Any]] = Field(default_factory=list)


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


class EngineDeleteResponse(BaseModel):
    """How many of its queued runs had nowhere left to run and were dropped with it."""

    unqueued: int


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


# --- runner gateway -------------------------------------------------------


class Frame(BaseModel):
    """A body a runner sends over the poll fallback.

    Deliberately **not** an `Input`: the wire protocol's own rule is that a field the
    receiver does not know is ignored, so that a newer runner talking to an older server
    is a missing feature rather than a 422 on every poll. A browser typing a field name
    wrongly wants the opposite, which is why `Input` stays strict for everything else.
    """

    model_config = ConfigDict(extra="ignore")


class RunnerActiveRun(Frame):
    """One run the runner says it is still executing, and the attempt it holds it under."""

    run_id: int
    attempt_token: str


class RunnerPoll(Frame):
    """`POST /runner/poll`: announce, say how much room there is, and take work away."""

    proto: int = 1
    runner: str = ""
    version: str | None = None
    slots: int = Field(default=1, ge=0)
    # Omitted after the first poll means "what I advertised last still stands"; an empty
    # list means "I advertise nothing", which switches the previous ones off.
    engines: list[dict[str, Any]] | None = None
    free_slots: int | None = Field(default=None, ge=0)
    active_runs: list[RunnerActiveRun] = Field(default_factory=list)


class RunnerPollResponse(BaseModel):
    runner_id: int
    proto: int
    runner: str
    poll_seconds: float
    engines: list[dict[str, Any]] = Field(default_factory=list)
    dispatch: list[dict[str, Any]] = Field(default_factory=list)
    cancel: list[int] = Field(default_factory=list)


class RunnerHeartbeat(Frame):
    attempt_token: str
    done: int = 0
    total: int = 0


class RunnerHeartbeatResponse(BaseModel):
    ok: bool
    cancel: bool = Field(
        default=False, description="the run is no longer this runner's; abandon it"
    )


class RunnerResult(Frame):
    """A finished run: exactly one of `evals` and `error`."""

    attempt_token: str
    evals: list[dict[str, Any]] | None = None
    note: str | None = None
    error: str | None = None
    stderr: str | None = None
    retry: bool = True

    @model_validator(mode="after")
    def _one_answer(self) -> RunnerResult:
        if (self.evals is None) == (self.error is None):
            raise ValueError("a result carries exactly one of evals and error")
        return self


class RunnerResultResponse(BaseModel):
    """A dropped payload is a 200: the runner did nothing wrong, and a 4xx would retry."""

    accepted: bool
    reason: str | None = None


# --- runners ---------------------------------------------------------------


class RunnerEngine(Payload):
    """`services.runners.engine_payload`: an engine as its host advertises it.

    A runner-bound engine is read-mostly here — its truth is the yaml on that machine, and
    `path` is a path over there — so the UI shows it rather than offering to edit it.
    """

    id: int
    name: str
    kind: EngineKind
    version: str | None = None
    path: str | None = None
    enabled: bool = True
    default_tier: Tier | None = None
    streams: bool = Field(default=False, description="whether it can drive an analysis board")


class RunnerResponse(Payload):
    """`services.runners.runner_payload`: one registered machine.

    The row and the live picture in one object: `connected` and `last_seen_at` are columns,
    while `transport` and the three slot counts are what the gateway knows about the link
    it is holding. A process with no gateway reports the row alone.
    """

    id: int
    name: str
    slots: int = 1
    version: str | None = None
    connected: bool = False
    transport: str | None = Field(default=None, description="websocket | poll | null")
    last_seen_at: datetime | None = None
    created_at: datetime | None = None
    busy: int = Field(default=0, description="slots holding a queue run")
    streams: int = Field(default=0, description="slots holding an analysis board")
    free_slots: int = 0
    queued_eligible: int = Field(default=0, description="queued runs only this runner can take")
    engines: list[RunnerEngine] = Field(default_factory=list)


class RunnerCreate(Input):
    name: str = Field(min_length=1, max_length=64)
    slots: int = Field(default=1, ge=1, description="engine jobs and boards at once")


class RunnerUpdate(Input):
    """Only the fields that are present are changed."""

    name: str | None = Field(default=None, min_length=1, max_length=64)
    slots: int | None = Field(default=None, ge=1)


class RunnerCreated(BaseModel):
    """The one answer that carries a token. It is not readable again from anywhere."""

    runner: RunnerResponse
    token: str = Field(description="shown once; the runner's whole identity")
    config_yaml: str = Field(description="a paste-ready runner.yaml with the token in it")


class LocalHost(Payload):
    """`services.runners.local_row`: this machine, described as one more destination."""

    name: str = "local"
    slots: int | None = Field(default=None, description="analysis_concurrency, when known")
    busy: int = 0
    streams: int = 0
    workers: bool = Field(default=False, description="whether this process drains the queue")
    queued: int = 0
    running: int = 0
    engines: list[RunnerEngine] = Field(default_factory=list)


class QueueTotals(BaseModel):
    queued: int = 0
    running: int = 0


class RunnersStatus(BaseModel):
    """Where engine work can run right now — the read the Engines page and the coach share."""

    runners: list[RunnerResponse] = Field(default_factory=list)
    local: LocalHost
    queue: QueueTotals


# --- streams ---------------------------------------------------------------


class StreamCreate(Input):
    """Open an analysis board. `engine_id` omitted takes the deep tier's engine."""

    fen: str = Field(min_length=1)
    engine_id: int | None = None
    multipv: int = Field(default=1, ge=1, le=5)
    surface: str = Field(default="game", description="game | live — one session each")
    # Echoed back untouched, so the page can tell which board a session belongs to.
    game_id: int | None = None
    ply: int | None = None


class StreamUpdate(Input):
    """A position change or a new multipv. Only what is sent changes."""

    fen: str | None = Field(default=None, min_length=1)
    multipv: int | None = Field(default=None, ge=1, le=5)


class StreamResponse(Payload):
    """`services.streams.StreamSession.payload`: one analysis board.

    `runner_id: null` is a local engine, and that is the only thing that distinguishes
    the two — the snapshots on `/events` are identical either way.
    """

    id: str
    surface: str
    fen: str
    multipv: int = 1
    engine_id: int
    engine: str
    runner_id: int | None = None
    runner: str | None = None
    state: str = "starting"
    reason: str | None = None
    seq: int = 0
    created_at: datetime
    last_snapshot_at: datetime | None = None
    game_id: int | None = None
    ply: int | None = None


# --- live -----------------------------------------------------------------


class LiveArrow(BaseModel):
    """An arrow drawn on the live board, as chessground takes one."""

    from_: str = Field(alias="from")
    to: str
    color: str


class LiveSquare(BaseModel):
    square: str
    color: str


class LiveState(Payload):
    """`services.live.get_state`: the board the coach is driving, whole.

    The page fetches this once on load or reconnect and follows `live.updated` from there,
    which is why every field the socket carries is documented here too.
    """

    active: bool = False
    game_id: int | None = None
    ply: int | None = None
    fen: str | None = None
    turn: str | None = None
    moves: list[str] = Field(default_factory=list)
    last_move: str | None = None
    arrows: list[LiveArrow] = Field(default_factory=list)
    squares: list[LiveSquare] = Field(default_factory=list)
    text: str | None = None
    viewer_count: int = 0
    updated_at: datetime | None = None


# --- search ----------------------------------------------------------------


class OpponentHit(BaseModel):
    """One opponent the search box matched: how often, and how the owner did."""

    name: str
    games: int
    # The owner's score over those games as a percentage: a win is a point, a draw half.
    score: float


class OpeningHit(BaseModel):
    """One opening the search box matched, by name or by ECO prefix."""

    eco: str = ""
    name: str = ""
    games: int


class SearchResponse(BaseModel):
    """`services.search.global_search`: one query, four groups, each capped on its own.

    A query too short to answer is four empty groups, not an error — the box searches as
    it is typed.
    """

    games: list[GameSummary] = Field(default_factory=list)
    opponents: list[OpponentHit] = Field(default_factory=list)
    openings: list[OpeningHit] = Field(default_factory=list)
    notes: list[NoteResponse] = Field(default_factory=list)
