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
    EngineRole,
    JobStatus,
    NoteSource,
    Platform,
    RunStatus,
    Source,
    Tier,
)
from backend.runtime import RuntimeCapabilities


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
    why runtime capabilities and the deployment-wide Maia configuration ride along on it.
    The browser can hide unavailable surfaces before they mount or issue requests.
    """

    setup_required: bool
    authenticated: bool
    capabilities: RuntimeCapabilities = Field(
        description="optional surfaces exposed by this running installation",
    )
    maia_target_elo: int = Field(
        description="the first rating every Maia question on this deployment is asked at",
    )
    maia_elos: list[int] = Field(
        default_factory=list,
        description="every rating this deployment asks Maia at, lowest first",
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
    """Everything the Engine passes and Maia pages show.

    Nine of them are nullable, and null is never "not loaded yet" — it is the deployment
    saying nobody has set this one, and what is in force is the default
    `services.app_settings` names, which is why the page can show that default under an
    empty box rather than pretending to a value.

    The Maia levels are the exception: every Maia question is asked at a rating, so the
    answer is the ratings in force rather than the row behind them. Clearing them on a PUT is
    still how they go back to the default, and what comes back is that default.
    `maia_target_elo` is the first of `maia_elos` — the same value, for a caller that only
    ever shows one level.
    """

    maia_target_elo: int = Field(
        description="the first of `maia_elos`, for a caller that shows a single level",
    )
    maia_elos: list[int] = Field(
        default_factory=list,
        description="every rating Maia is asked at, lowest first",
    )
    maia_on_quick: int | None = Field(
        default=None, description="1 if a quick pass also asks the human-move model"
    )
    maia_on_deep: int | None = Field(
        default=None,
        description="1 if a deep pass also asks the human-move model; off by default, "
        "because it would recompute the policy the quick pass already stored",
    )
    maia_both_sides: int | None = Field(
        default=None,
        description="1 to ask Maia about every ply, 0 for the owner's own moves only",
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
    maia_elos: list[int] | None = Field(
        default=None,
        description="one to five ratings; a longer list keeps the lowest, out of range is "
        "clamped, and null clears them back to the default",
    )
    maia_on_quick: int | None = Field(
        default=None, description="1 if a quick pass also asks the human-move model"
    )
    maia_on_deep: int | None = Field(
        default=None, description="1 if a deep pass also asks the human-move model"
    )
    maia_both_sides: int | None = Field(
        default=None,
        description="1 to ask Maia about every ply, 0 for the owner's own moves only",
    )
    quick_nodes: int | None = None
    deep_nodes: int | None = None
    deep_multipv: int | None = None
    inaccuracy_threshold: float | None = None
    mistake_threshold: float | None = None
    blunder_threshold: float | None = None


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
    """The owner's password again where password authentication is available.

    Desktop has a native, single-owner session and confirms the destructive action in its
    dialog without inventing a persistent password solely for this request.
    """

    password: str | None = Field(default=None, min_length=1)


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

# How many games one batch may carry. A selection is made by hand on the games page, so
# the ceiling is only there to keep a stray client from asking for a transaction the size
# of the library; `blunderbase analyze` with no game is what queues everything.
MAX_BATCH_GAMES = 500


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
    elos: list[int] | None = Field(
        default=None,
        description="Maia levels for this run alone; omitted, it uses the configured ones",
    )
    maia: bool | None = Field(
        default=None,
        description="whether this run also asks the human-move model; omitted, the tier's "
        "own setting decides (`maia_on_quick`, `maia_on_deep`)",
    )

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


class BatchAnalysisRequest(Input):
    """Enqueue one pass over each of several games.

    Its own body rather than a third alternative on `AnalysisRequest`, because a batch
    does not answer with a run: a route here declares one response shape, and a `game_ids`
    field that silently changed what a 202 carries is a thing neither the OpenAPI schema
    nor the typed client could describe.

    No ply range and no FEN: a window belongs to one game, and a position is one run.
    """

    game_ids: list[int] = Field(min_length=1, max_length=MAX_BATCH_GAMES)
    tier: Tier = Tier.QUICK
    engine_id: int | None = None
    multipv: int | None = Field(default=None, ge=1)
    nodes: int | None = Field(default=None, ge=1)
    depth: int | None = Field(default=None, ge=1)
    priority: int | None = None
    elos: list[int] | None = Field(
        default=None,
        description="Maia levels for these runs alone; omitted, they use the configured ones",
    )
    maia: bool | None = Field(
        default=None,
        description="whether these runs also ask the human-move model; omitted, the tier's "
        "own setting decides (`maia_on_quick`, `maia_on_deep`)",
    )

    @model_validator(mode="after")
    def _distinct_games(self) -> BatchAnalysisRequest:
        # A selection cannot hold the same game twice, so a repeat is a client bug rather
        # than a request for two identical runs. Dropped, not refused, and in the order
        # the batch was asked for.
        self.game_ids = list(dict.fromkeys(self.game_ids))
        return self


class MaiaFillRequest(Input):
    """Fill in the Maia levels the library was never analysed at.

    No games given means every analysed game, which is what the Analysis page sends: the
    point of the button is a library that speaks for the same set of humans throughout.
    """

    game_ids: list[int] | None = Field(
        default=None, description="omit for every analysed game", min_length=1
    )


class MaiaFillReceipt(Payload):
    """What a fill queued, and how much of the library needed nothing.

    `already_complete` counts the games that have every configured level — including the
    ones whose fill is still in the queue from an earlier press, so pressing twice queues
    the work once.
    """

    queued: int = 0
    already_complete: int = 0


class MaiaFillStatus(Payload):
    """What the fill button shows before anybody presses it."""

    missing_games: int = 0
    configured: list[int] = Field(default_factory=list)


class QueuedRun(BaseModel):
    """One game of a batch that is now in the queue, and the run that will work it."""

    game_id: int
    run_id: int


class RefusedGame(BaseModel):
    """One game of a batch that is not, and what the enqueue path said about it."""

    game_id: int
    reason: str


class BatchAnalysisResponse(BaseModel):
    """What a batch queued and what it would not, in the order the ids were given.

    A refusal is per game — an id that is not there — and never the batch's: everything
    else queued anyway, which is the whole point of asking for them together.
    """

    queued: list[QueuedRun] = Field(default_factory=list)
    refused: list[RefusedGame] = Field(default_factory=list)


class BackfillRequest(Input):
    """Which tier a backfill is over. Its own body so the two verbs read the same.

    A backfill takes no game ids and no budget: the selection *is* "everything with no
    pass yet", and a run's nodes and multipv are the ones the Engine passes page shows at
    the moment the button is pressed. Nothing else belongs in this body, and an empty one
    means the quick tier.
    """

    tier: Tier = Tier.QUICK


class BackfillPreview(BaseModel):
    """How many games a backfill would queue if it were started now.

    What the button reads to label itself and to switch itself off: `pending` at zero means
    every game already has a live run of that tier and there is nothing to ask for.
    """

    tier: Tier
    pending: int


class BackfillReceipt(BaseModel):
    """What a backfill put in the queue, and how deep that tier's queue is now.

    `queued` counts only this call's rows; `outstanding` is every queued and running
    full-game run of the tier, so a second press while the first pass is still draining
    reports a small `queued` and a large `outstanding`.
    """

    tier: Tier
    queued: int
    outstanding: int


class BackfillCancelled(BaseModel):
    """How many queued runs the stop button took back, and what is left working.

    `outstanding` is rarely zero: the runs a worker had already claimed are left to finish
    — see `analysis.cancel_queued`.
    """

    tier: Tier
    dropped: int
    outstanding: int


class QueueCleared(BaseModel):
    """How many queued runs the whole-queue reset took back, and what is left working.

    Unlike `BackfillCancelled`, this carries no tier: the drop was not scoped to one, so
    `dropped` covers every tier and every shape of run — windowed, full-game, Maia-fill
    alike. `outstanding` is what a worker had already claimed, left to finish — see
    `analysis.clear_queue`.
    """

    dropped: int
    outstanding: int


class CoverageLevel(Payload):
    """One Maia level and how many games carry it."""

    elo: int
    games: int = 0


class CoverageMissing(Payload):
    """What a backfill of each tier would queue if it were started now.

    Not the complement of the coverage buckets: a game with a deep pass and no quick one is
    missing a quick pass, and is counted here under `quick` while it counts as analysed in
    the split above.
    """

    quick: int = 0
    deep: int = 0


class CoverageMaia(Payload):
    """Which Maia levels the library carries, against the ones configured now.

    `games_with_any` and `per_level` are two different readings and a page needs both: a
    library analysed while Maia was centred on each game's own rating has Maia everywhere
    and none of it at the level the owner is asking about today. Those levels are
    `orphan_levels`, and `missing_games` is what the fill button would queue.
    """

    configured: list[int] = Field(default_factory=list)
    games_with_any: int = 0
    per_level: list[CoverageLevel] = Field(default_factory=list)
    missing_games: int = 0
    orphan_levels: list[CoverageLevel] = Field(default_factory=list)


class CoverageEstimates(Payload):
    """What finishing each tier would cost, in engine-seconds, from this deployment's own history.

    Raw seconds of work rather than of waiting: `concurrency` is how many of them run at
    once, so the wall-clock answer is the one divided by the other. Null where too few
    finished runs carry the budget configured now to average — a made-up number on this
    page is worse than an empty space.

    Each estimate includes matching work already queued or running, so it remains a useful
    remaining-time estimate after a backfill is pressed. `maia_seconds` prices the third
    button, the fill: measured off finished `maia_only` runs, which cost what asking the
    human-move model costs and nothing like what a search does.
    """

    quick_seconds: float | None = None
    deep_seconds: float | None = None
    maia_seconds: float | None = None
    concurrency: int = 1


class AnalysisCoverage(Payload):
    """The whole library's analysis state, as the Analysis page reads it.

    `no_pass`, `quick_only` and `deep` partition the library and add up to `total`.
    """

    total: int = 0
    no_pass: int = 0
    quick_only: int = 0
    deep: int = 0
    missing: CoverageMissing = Field(default_factory=CoverageMissing)
    failed: int = 0
    maia: CoverageMaia = Field(default_factory=CoverageMaia)
    estimates: CoverageEstimates = Field(default_factory=CoverageEstimates)


class RetryFailedRequest(Input):
    """Which failed runs to pick back up. Empty means every one of them."""

    run_ids: list[int] | None = Field(
        default=None, description="the failed runs to retry; omitted means all of them"
    )


class RetryFailedReceipt(Payload):
    """What a retry queued, and how many failures it did not turn into a run.

    `skipped` counts a game whose pass has since succeeded, a second failure over a game
    already being retried, and a run over a bare FEN, which names no game to re-analyse.
    """

    queued: int = 0
    skipped: int = 0


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
    # A pass that asks the human-move model and nothing else. It is queued under a tier to
    # borrow that tier's engine and its place in the queue, so the tier alone does not say
    # what the run did: `maia_only` is what tells a fill from an analysis pass.
    maia_only: bool = False
    # Whether this run's search is followed by a human-move pass, as it was settled when the
    # run was queued: what the caller asked for, or the tier's setting at that moment.
    maia: bool = True
    maia_elos: list[int] | None = None
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


class QueuePaused(BaseModel):
    """What `/queue/pause` and `/queue/resume` answer: the switch, and the depth it acts on.

    The depth comes back with the flag because the two are one sentence — "paused, with
    seven waiting" — and a client that had to read them from two calls could show a queue
    that is stopped and moving at once.
    """

    paused: bool
    queued: int
    running: int


class QueueStatus(BaseModel):
    queued: int
    running: int
    paused: bool = Field(
        default=False, description="whether the workers are stopped from claiming new runs"
    )
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
    elos: list[int] | None = Field(
        default=None,
        description="several levels in one query; omitted, the deployment's configured ones",
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
    levels: dict[str, Any] = Field(
        default_factory=dict,
        description="one {elo, policy, rollout} per level asked about, keyed by the level; "
        "the top-level fields are the first of these",
    )


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
    created_at: datetime
    # None means `path` is a path on some filesystem. A scheme — `wasm` — means it is not,
    # and the UI has to say where the engine lives ("in this browser") instead of showing
    # `wasm:stockfish-18` as though it were a file. Derived here so no client has to parse
    # the path to find out, which would be one more copy of the vocabulary.
    path_scheme: str | None = None

    @model_validator(mode="after")
    def _scheme(self) -> EngineResponse:
        from backend.services.engines import path_scheme

        self.path_scheme = path_scheme(self.path)
        return self


class EngineCreate(Input):
    name: str = Field(min_length=1, max_length=64)
    path: str = Field(min_length=1, max_length=512)
    kind: EngineKind = EngineKind.UCI
    options: dict[str, Any] = Field(default_factory=dict)
    enabled: bool = True


class EngineUpdate(Input):
    """Only the fields that are present are changed."""

    name: str | None = Field(default=None, min_length=1, max_length=64)
    path: str | None = Field(default=None, min_length=1, max_length=512)
    kind: EngineKind | None = None
    options: dict[str, Any] | None = None
    enabled: bool | None = None

    def changes(self) -> dict[str, Any]:
        """A field that was sent is applied; one that was left out is not touched."""
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


class RoleStatusResponse(BaseModel):
    """One role and the engine assigned to it — `services.engines.role_status`.

    `configured` separates "the owner has not chosen an engine for this", which is a shape
    and not a fault, from "they chose one and it cannot run", which always names it.
    """

    role: EngineRole
    engine_id: int | None = None
    engine_name: str | None = None
    available: bool = False
    configured: bool = False
    reason: str | None = None


class EngineRoles(Input):
    """The assignment to write. A key that was not sent is left alone.

    `null` is a real value here and means "unassign", which is why absence has to mean
    something else: a form that saves one dropdown must not clear the other two.
    """

    quick: int | None = None
    deep: int | None = None
    human: int | None = None

    def changes(self) -> dict[str, int | None]:
        return self.model_dump(exclude_unset=True)


class EngineRolesResponse(BaseModel):
    """What runs what: one status per role, in QUICK, DEEP, HUMAN order.

    Human moves is a role beside the two tiers rather than a third `Tier`, because `Tier`
    is a search budget stored on every run row and widening it to carry a role would
    corrupt it. See `db.enums.EngineRole`.
    """

    roles: list[RoleStatusResponse] = Field(default_factory=list)


# --- notes ----------------------------------------------------------------


class LineResponse(Payload):
    """`services.notes.line_payload`: one kept variation off a game.

    `sans` is derived at read time rather than stored — see the service — so it can never
    disagree with the game the line hangs off.
    """

    id: int
    game_id: int
    base_ply: int = 0
    moves: list[str] = Field(default_factory=list)
    sans: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    notes: list[NoteResponse] = Field(default_factory=list)


class LineCreate(Input):
    """The variation to keep: where it branches from, and how it went."""

    game_id: int
    base_ply: int = Field(default=0, ge=0)
    moves: list[str] = Field(min_length=1)


class NoteResponse(Payload):
    """`services.notes.note_payload`.

    Permissive rather than strict because the anchors come resolved: the FEN of the
    position, a small summary of the game and the whole line ride along, so a client that
    renders a note never has to fetch the three things it is about.
    """

    id: int
    text: str
    tags: list[str] = Field(default_factory=list)
    game_id: int | None = None
    position_id: int | None = None
    line_id: int | None = None
    ply: int | None = None
    source: str = "web"
    fen: str | None = None
    line: LineResponse | None = None
    game: dict[str, Any] | None = None
    created_at: datetime
    updated_at: datetime


class NoteLineInput(Input):
    """A variation a note is being written about, persisted before the note is."""

    game_id: int
    base_ply: int = Field(default=0, ge=0)
    moves: list[str] = Field(min_length=1)


class NoteCreate(Input):
    """A note and as much of a position as the writer could name.

    Every anchor is optional and they compose; `from_live` fills in whatever the caller did
    not name from the board the coach and the owner are looking at.
    """

    text: str = Field(min_length=1)
    tags: list[str] = Field(default_factory=list)
    game_id: int | None = None
    fen: str | None = None
    ply: int | None = Field(default=None, ge=0)
    line_id: int | None = None
    line: NoteLineInput | None = None
    source: NoteSource = NoteSource.WEB
    from_live: bool = False


class NoteUpdate(Input):
    text: str | None = Field(default=None, min_length=1)
    tags: list[str] | None = None


class TagCount(BaseModel):
    tag: str
    notes: int


class ResurfaceItem(Payload):
    """One note worth re-reading, and why it came back up."""

    note: NoteResponse
    reason: str
    games: list[int] = Field(default_factory=list)


class ResurfaceResponse(BaseModel):
    items: list[ResurfaceItem] = Field(default_factory=list)


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
    # The same field a `hello` carries, so a poller registers exactly as a socket does. No
    # browser is expected here — a tab that could only poll would have no analysis board —
    # but the two transports describing themselves differently would be a trap.
    browser: bool = False


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

    A runner-bound engine is read-mostly here — its truth is the configuration on that
    machine, and `path` is a path over there — so the UI shows it rather than offering to
    edit it. Unless `path_scheme` is set, in which case `path` is not a path at all but the
    name of an engine the runner carries inside itself.
    """

    id: int
    name: str
    kind: EngineKind
    version: str | None = None
    path: str | None = None
    path_scheme: str | None = Field(
        default=None,
        description="`wasm` where `path` names an engine inside the runner rather than a file",
    )
    enabled: bool = True
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
    browser: bool = Field(
        default=False, description="a browser tab rather than a process on a machine"
    )
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


class McpKeyResponse(Payload):
    """`services.mcp_keys.key_payload`: one minted `/mcp` bearer key, never its hash.

    `last_used_at` moves at a minute's granularity, which is all the owner needs to tell a
    key a client still uses from one that can go.
    """

    id: int
    name: str
    created_at: datetime
    last_used_at: datetime | None = None


class McpKeyCreate(Input):
    name: str = Field(min_length=1, max_length=64)


class McpKeyCreated(BaseModel):
    """The one answer that carries the token. It is not readable again from anywhere."""

    key: McpKeyResponse
    token: str = Field(description="shown once; paste it into the client's Authorization header")


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
