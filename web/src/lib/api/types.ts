/**
 * The wire types, mirroring `backend/api/schemas.py`.
 *
 * Response models on the backend are `extra="allow"` and drop `None` keys, so every
 * optional field here is genuinely optional and payloads may carry more than is
 * documented — hence the `Extra` index signature on the payload-shaped types.
 */

export type Extra = Record<string, unknown>

// --- enums (backend/db/enums.py) ------------------------------------------

/** `masters` is a game added from the reference explorer's masters archive — never synced. */
export type Source = 'lichess' | 'chesscom' | 'fics' | 'pgn' | 'manual' | 'masters'
export type Platform = 'lichess' | 'chesscom' | 'fics' | 'otb'
export type Color = 'white' | 'black'
export type Result = '1-0' | '0-1' | '1/2-1/2' | '*'
export type Speed = 'bullet' | 'blitz' | 'rapid' | 'classical' | 'correspondence'
export type Tier = 'quick' | 'deep'
export type RunStatus = 'queued' | 'running' | 'done' | 'failed'
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
export type Classification = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder'
export type EngineKind = 'uci' | 'maia'
export type Outcome = 'win' | 'loss' | 'draw'

export const SOURCES: readonly Source[] = [
  'lichess',
  'chesscom',
  'fics',
  'pgn',
  'manual',
  'masters',
]
export const SPEEDS: readonly Speed[] = [
  'bullet',
  'blitz',
  'rapid',
  'classical',
  'correspondence',
]
export const CLASSIFICATIONS: readonly Classification[] = [
  'best',
  'good',
  'inaccuracy',
  'mistake',
  'blunder',
]
export const TIERS: readonly Tier[] = ['quick', 'deep']

// --- errors ---------------------------------------------------------------

export interface ErrorBody {
  error: string
  detail: string
  fields?: { field: string; message: string }[]
}

// --- auth -----------------------------------------------------------------

export interface RuntimeCapabilities {
  password_auth: boolean
  mcp: boolean
  remote_runners: boolean
  /**
   * The public demo: the library cannot be changed from here, and every write answers
   * 403 `read_only`. The shell says so up front rather than letting a visitor find out.
   */
  read_only: boolean
}

export const SERVER_CAPABILITIES: RuntimeCapabilities = {
  password_auth: true,
  mcp: true,
  remote_runners: true,
  read_only: false,
}

/**
 * What every `/auth` route answers with: is there a password, and do I have it.
 *
 * It doubles as the app's bootstrap payload — it is the one call made before anything
 * renders — so the deployment-wide Maia target elo rides along on it. The Maia page
 * owns that value (`AppSettings` below), but every other screen needs it to render and
 * none of them should wait on a second call for it.
 */
export interface AuthStatus {
  setup_required: boolean
  authenticated: boolean
  capabilities: RuntimeCapabilities
  /** The first of `maia_elos` — for a screen that shows a single level. */
  maia_target_elo: number
  /**
   * Every rating this deployment asks Maia at, lowest first.
   *
   * Optional only because the client makes one `AuthStatus` up rather than reading it (the
   * signed-out one, where the deployment's levels are not knowable): every answer the
   * backend sends carries the list.
   */
  maia_elos?: number[]
}

// --- settings --------------------------------------------------------------

/**
 * The level a deployment that has chosen none is pinned to — the backend's own default
 * (`services/app_settings.py`), repeated here because the client has to name it in the one
 * place it makes an `AuthStatus` up rather than reading one: a session it just lost.
 */
export const DEFAULT_MAIA_TARGET_ELO = 2000

/** The band Maia's weights cover (`backend/config.py`), and the step a level is picked in. */
export const MAIA_MIN_ELO = 1100
export const MAIA_MAX_ELO = 2000
export const MAIA_ELO_STEP = 50
/** How many levels one deployment may ask about at once (`services/app_settings.py`). */
export const MAX_MAIA_ELOS = 5

/**
 * `GET`/`PUT /settings` — analysis configuration: eleven numbers, ten of them
 * nullable.
 *
 * Null is not "unset yet" pending a load: it is the deployment's answer that nobody has
 * set this one, and what is in force is the default the backend names. The page shows
 * that default under an empty box rather than pretending to a value.
 *
 * The target elo is the exception. Every Maia question is asked at a rating, so what comes
 * back is the rating in force rather than the row behind it — sending null still puts it
 * back to the default, and the default is what answers.
 */
export interface AppSettings {
  /** The first of `maia_elos`, for a caller that shows a single level. */
  maia_target_elo: number
  /**
   * Every rating Maia is asked at, lowest first — one to five of them, and never empty:
   * there is no such thing as a deployment that asks Maia at no rating.
   *
   * Optional in the type rather than in the answer, so that a client which builds settings
   * it was not told (a test fixture, an optimistic write) does not have to invent a list.
   */
  maia_elos?: number[]
  /**
   * The three switches over the Maia pass itself, stored as 0 or 1 rather than as booleans
   * — they are rows of the same numeric settings table as the budgets, and the PUT has to
   * carry them as the numbers the backend clamps.
   *
   * `maia_on_quick` defaults on, `maia_on_deep` off (a deep pass would recompute the policy
   * the quick pass already stored), `maia_both_sides` on.
   */
  maia_on_quick: number | null
  maia_on_deep: number | null
  maia_both_sides: number | null
  quick_nodes: number | null
  deep_nodes: number | null
  deep_multipv: number | null
  inaccuracy_threshold: number | null
  mistake_threshold: number | null
  blunder_threshold: number | null
}

/**
 * A PUT carries the whole of the settings, not a patch of them: a field sent as null is
 * cleared back to its default — the target elo included, which is why every field is
 * nullable on the way in and only ten of them are on the way back. Out of range is
 * clamped by the backend rather than refused, so the response is what is in force — not
 * always what was sent. The one refusal is a set of classification thresholds that does
 * not rise, which comes back as a 422.
 */
export type AppSettingsUpdate = { [K in keyof AppSettings]: AppSettings[K] | null }

/**
 * `GET`/`PUT /settings/tour` — whether the owner has been through the orientation tour.
 *
 * Stored on the deployment rather than in this browser because it is a fact about the
 * person: a tour that came back on a second machine, or after clearing site data, would be
 * a tour that had not run once. The demo is the exception and keeps its own copy — see
 * `lib/tour/seen.ts`.
 */
export interface TourState {
  seen: boolean
}

// --- games ----------------------------------------------------------------

export interface GameSummary extends Extra {
  id: number
  source: Source
  source_id?: string | null
  played_at?: string | null
  color?: Color | null
  /**
   * False for a game added from the reference books: somebody else's, kept for study,
   * analysed and annotated like any other and counted in nothing. Absent means true.
   */
  is_owner_game?: boolean
  result?: string | null
  outcome?: string | null
  white?: string | null
  black?: string | null
  white_rating?: number | null
  black_rating?: number | null
  opponent?: string | null
  opponent_rating?: number | null
  rating?: number | null
  speed?: string | null
  time_control?: string | null
  rated?: boolean | null
  variant?: string | null
  eco?: string | null
  opening?: string | null
  termination?: string | null
  ply_count?: number | null
}

/** One point of a game's eval curve: `win` is the win percentage, 0..100. */
export interface EvalPoint extends Extra {
  ply: number
  win?: number | null
  cp?: number | null
  mate?: number | null
}

export interface WorstMoment extends Extra {
  ply: number
  move_number?: number | null
  san?: string | null
  uci?: string | null
  classification?: Classification | null
  win_loss?: number | null
  best_move_uci?: string | null
}

/** `GET /games?cards=true` and the dashboard strip. */
export interface GameCard extends GameSummary {
  analyzed: boolean
  deep: boolean
  eval_curve: EvalPoint[]
  worst_moments: WorstMoment[]
}

export interface GameList {
  games: GameSummary[]
  total: number
  limit: number
  offset: number
}

export interface GameCardList extends GameList {
  games: GameCard[]
}

/**
 * `POST /games/delete-all` — what the wipe took. `import_jobs` is the surprising one and
 * is reported for that reason: the sync history goes with the games, which is what makes
 * the next sync of a source a fresh one.
 */
export interface GamesDeleted {
  games: number
  runs: number
  notes: number
  import_jobs: number
}

/**
 * `POST /games/delete` — what one delete of a selection took. No `import_jobs`, unlike a
 * wipe: the sync history survives, so the next sync does not fetch the deleted games back.
 */
export interface GamesRemoved {
  games: number
  runs: number
  notes: number
  lines: number
  /** How many were written into the deletion record, so no import brings them back. */
  remembered: number
}

/**
 * `GET /library/deleted-games` — one game an import is refusing to store again.
 *
 * The game is gone, so every field is the snapshot taken when it went: `source` and
 * `source_id` are what a sync is matched on, `dedup_hash` catches the same game arriving
 * as a PGN with no ID, and the names and the date are how a person recognises the row.
 */
export interface DeletedGame {
  id: number
  source: Source
  source_id?: string | null
  dedup_hash: string
  white_name: string
  black_name: string
  played_at?: string | null
  deleted_at: string
}

export interface DeletedGameList {
  games: DeletedGame[]
  total: number
}

/** `POST /library/deleted-games/forget` — how many records went, not how many games came back. */
export interface DeletionsForgotten {
  forgotten: number
}

export interface BackupEstimate {
  estimated_bytes: number
}

export interface BackupPrepared {
  token: string
  filename: string
  bytes: number
}

export interface EngineLine extends Extra {
  multipv?: number
  cp?: number | null
  mate?: number | null
  pv?: string[]
  san?: string[]
  move_uci?: string | null
  move_san?: string | null
}

export interface MaiaPolicy extends Extra {
  /** rating band -> predicted moves; the exact shape is the engine adapter's. */
  [key: string]: unknown
}

// --- live Maia (`POST /maia/policy`) --------------------------------------

/** One move the human model offers, as both the stored blob and the live endpoint write it. */
export interface MaiaPolicyMove {
  uci: string
  san?: string | null
  rank?: number | null
  /** The policy share, 0..1. Omitted where the build publishes no figure. */
  p?: number | null
}

export interface MaiaPolicyRequest {
  fen: string
  /** One level. The older spelling of `elos: [elo]`, kept because it still works. */
  elo?: number | null
  /**
   * Every level wanted, in one call — omitted, the deployment's configured ones.
   *
   * One call rather than one per level on purpose: behind the endpoint is a single warm
   * process under a single lock, so asking separately serialises the same work.
   */
  elos?: number[] | null
  /** Maximum policy entries; defaults to the batch pass's `MAIA_POLICY_MOVES`. */
  moves?: number | null
  /** 0 or absent asks for no rollout. */
  rollout_plies?: number | null
}

/** One level's answer: what a human of that rating plays here, and what follows. */
export interface MaiaLevelPolicy extends Extra {
  /**
   * The level actually used — the clamped request, or a fixed-weights engine's own level
   * where its weights name one. Null where such an engine never says which human it is,
   * and the panel then shows no number rather than one the engine did not honour.
   */
  elo: number | null
  policy: MaiaPolicyMove[]
  /** The most likely continuation, both sides conditioned at `elo`. Absent when not asked for. */
  rollout?: MaiaPolicyMove[] | null
}

/**
 * `409` means no backend-local Maia is available; the caller hides its live section
 * rather than reporting an error (see `useLiveMaia`).
 *
 * `levels` is one entry per level asked about, keyed by the level *asked for* — so a
 * caller finds its answer where it put the question, and reads the entry's own `elo` for
 * what actually played. The top-level `elo`/`policy`/`rollout` are the first of them,
 * which is the shape the board read before there was more than one level. A fixed-weights
 * build answers with one entry however many were asked for: it is one rating, and the same
 * policy in five columns would invent a comparison.
 */
export interface MaiaPolicyResponse extends MaiaLevelPolicy {
  levels?: Record<string, MaiaLevelPolicy>
}

export interface MoveRow extends Extra {
  ply: number
  move_number?: number | null
  color?: Color | null
  san?: string | null
  uci?: string | null
  clock?: number | null
  by_owner?: boolean | null
  win_before?: number | null
  win_after?: number | null
  win_loss?: number | null
  classification?: Classification | null
  best_move_uci?: string | null
  best_lines?: EngineLine[] | null
  maia?: MaiaPolicy | null
  run_id?: number | null
  /** Undocumented on the schema but always sent by `games.get_game_detail`. */
  eval_before_cp?: number | null
  eval_before_mate?: number | null
  eval_after_cp?: number | null
  eval_after_mate?: number | null
}

/**
 * The compact run row a game detail carries — not a full `RunResponse`: the service
 * names the engine instead of its id and leaves out the queue bookkeeping.
 */
export interface GameRunSummary extends Extra {
  id: number
  tier: Tier
  /**
   * A pass that asked the human-move model and searched nothing. It is filed under a tier
   * to borrow that tier's engine, so the tier alone does not say what the run did; only
   * a fill carries the key.
   */
  maia_only?: boolean
  status: RunStatus
  engine?: string | null
  engine_kind?: EngineKind | null
  depth?: number | null
  nodes?: number | null
  multipv?: number
  finished_at?: string | null
}

/**
 * One continuation out of the owner's own games, from a position this game passed through.
 *
 * A strict subset of `ExplorerMove` — same field names, minus the per-page extras — because
 * it is the same fold over the same table (`services/explorer.position_books`). That is what
 * lets the game screen's book table use the explorer's own `splitOf`/`scorePercent`/
 * `formatAvgDrop` rather than a second, subtly different set.
 */
export interface GameBookMove extends Extra {
  uci: string
  san?: string | null
  games: number
  wins?: number
  draws?: number
  losses?: number
  score?: number | null
  occurrences?: number
  owner_moves?: number
  evaluated?: number
  avg_win_loss?: number | null
  blunders?: number
  avg_ply?: number | null
  last_played?: string | null
}

/** One position's book: how often the owner reached it, and what they played from it. */
export interface GameBookEntry extends Extra {
  games: number
  wins?: number
  draws?: number
  losses?: number
  score?: number | null
  moves: GameBookMove[]
}

export interface GameDetail extends Extra {
  game: GameSummary
  ply_range?: [number, number] | null
  moves: MoveRow[]
  runs: GameRunSummary[]
  notes?: NoteResponse[] | null
  /**
   * The owner's own tree at the plies that have one, keyed by half-move **count** — the
   * position *before* that ply, which is the position on the board after `count` moves. JSON
   * object keys are strings, so the lookup is `book?.[String(ply)]`; a missing key means
   * there is no book here, which is the common case (`0017_explorer_book`: 452k of 463k
   * positions are reached by exactly one game).
   *
   * It ships with the game rather than from a per-position endpoint on purpose: a fetch per
   * ply while stepping is the pattern that took the server down once already
   * (`memory/blunderbase-meltdown-root-cause.md`).
   */
  book?: Record<string, GameBookEntry>
}

/** The query vocabulary shared by `/games` and every `/stats` dimension. */
export interface GameFilters {
  since?: string
  until?: string
  source?: Source
  color?: Color
  eco?: string
  result?: Result
  outcome?: Outcome
  /**
   * One speed, or the set of them to count. Repeated in the query string
   * (`speed=blitz&speed=rapid`), which is how FastAPI reads a set — see `toQuery`.
   */
  speed?: Speed | readonly Speed[]
  time_control?: string
  opponent?: string
  variant?: string
  has_blunders?: boolean
  analyzed?: boolean
  deep_analyzed?: boolean
  text?: string
  /**
   * Whose games: the owner's (`mine`, the default when absent), the ones added from the
   * reference books (`others`), or both (`all`).
   */
  whose?: Whose
}

export type Whose = 'mine' | 'others' | 'all'

// --- import ---------------------------------------------------------------

export interface ImportRequest {
  username?: string
  path?: string
  text?: string
  since?: string
  max_games?: number
  /** Left unset by default; `false` lands the games without queueing a quick pass. */
  analyze?: boolean
  wait?: boolean
}

/**
 * `GET`/`PUT /import/schedule` — how often every connected account is synced on its own.
 * Null is off. The number is minutes, floored at one by the backend.
 */
export interface SyncSchedule {
  minutes: number | null
}

export interface ImportJob {
  id: number
  source: Source
  account_id?: number | null
  status: JobStatus
  cursor?: string | null
  created_at: string
  started_at?: string | null
  finished_at?: string | null
  games_seen: number
  games_imported: number
  games_skipped: number
  /** Games this run left alone because they are in the deletion record. */
  games_blocked: number
  games_failed: number
  errors: { ref?: string; error?: string }[]
  message?: string | null
}

/**
 * `GET /import/jobs` — one page of the sync history.
 *
 * An object rather than a bare array: the history table pages, and a pager cannot say
 * "page 2 of 7" without being told how many syncs there have been.
 */
export interface ImportJobList {
  jobs: ImportJob[]
  total: number
  limit: number
  offset: number
}

export interface ImportStarted {
  source: string
  status: string
  job_id?: number | null
  job?: ImportJob | null
}

/**
 * `POST /import/jobs/{id}/cancel` — the stop signal was taken.
 *
 * `status` is the row as it is at that moment, still `running`: the import ends after the
 * game it is on, and the `import.finished` frame is what reports `cancelled`.
 */
export interface ImportCancelling {
  job_id: number
  source: string
  status: JobStatus
}

// --- analysis -------------------------------------------------------------

export interface AnalysisRequest {
  game_id?: number
  fen?: string
  tier?: Tier
  ply_start?: number
  ply_end?: number
  engine_id?: number
  multipv?: number
  nodes?: number
  depth?: number
  priority?: number
  /** Maia levels for this run alone; omitted, it uses the deployment's configured ones. */
  elos?: number[]
}

/**
 * One pass over each of several games. Its own body rather than a list on
 * `AnalysisRequest`, because the answer is not a run — see `BatchAnalysisResponse`.
 */
export interface BatchAnalysisRequest {
  game_ids: number[]
  tier?: Tier
  engine_id?: number
  multipv?: number
  nodes?: number
  depth?: number
  priority?: number
  /** Maia levels for these runs alone; omitted, they use the configured ones. */
  elos?: number[]
}

/**
 * `POST /analysis/maia-fill` — add the configured Maia levels to games that already have a
 * pass, without redoing the search. No games named means every analysed game.
 */
export interface MaiaFillRequest {
  game_ids?: number[]
}

/**
 * What a fill queued. `already_complete` counts the games that have every configured level
 * *including* the ones whose fill is still in the queue, so pressing twice queues it once.
 */
export interface MaiaFillReceipt {
  queued: number
  already_complete: number
}

/** What the fill button shows before anybody presses it. */
export interface MaiaFillStatus {
  missing_games: number
  configured: number[]
}

export interface QueuedRun {
  game_id: number
  run_id: number
}

export interface RefusedGame {
  game_id: number
  reason: string
}

/** What a batch queued and what it would not, in the order the ids were given. */
export interface BatchAnalysisResponse {
  queued: QueuedRun[]
  refused: RefusedGame[]
}

/**
 * The whole library in one pass, for the nights the owner wants every game covered.
 *
 * `pending` is how many games have no live run of that tier — what a backfill would take
 * on. `outstanding` is queued-plus-running full-game runs of the tier, which is what tells
 * a caller whether a pass it started is still going.
 */
export interface BackfillPreview {
  tier: Tier
  pending: number
}

export interface BackfillStarted {
  tier: Tier
  queued: number
  outstanding: number
}

/** Cancelling drops what is still queued; what is already running is left to finish. */
export interface BackfillCancelled {
  tier: Tier
  dropped: number
  outstanding: number
}

/**
 * The whole-queue reset: every tier and every shape of queued run, dropped in one call.
 * No `tier` — unlike `BackfillCancelled`, this was never scoped to one.
 */
export interface QueueCleared {
  dropped: number
  outstanding: number
}

export interface RunResponse {
  id: number
  game_id?: number | null
  fen?: string | null
  engine_id?: number | null
  tier: Tier
  status: RunStatus
  depth?: number | null
  nodes?: number | null
  multipv: number
  ply_start?: number | null
  ply_end?: number | null
  priority: number
  attempts: number
  /** A Maia fill: this run asks the human-move model and searches nothing. */
  maia_only?: boolean
  /** Whether this run's search is followed by a human-move pass, as settled when queued. */
  maia?: boolean
  /** The levels this run was queued for; null means whatever is configured when it runs. */
  maia_elos?: number[] | null
  created_at: string
  started_at?: string | null
  finished_at?: string | null
  error?: string | null
  stderr?: string | null
}

// --- the library's analysis coverage --------------------------------------

/** One Maia level and how many games carry it. */
export interface CoverageLevel {
  elo: number
  games: number
}

/**
 * What a backfill of each tier would queue if it were started now.
 *
 * Not the complement of the coverage buckets: a game with a deep pass and no quick one is
 * missing a quick pass, and counts here under `quick` while counting as analysed in the
 * split above.
 */
export interface CoverageMissing {
  quick: number
  deep: number
}

/**
 * Which Maia levels the library carries, against the ones configured now.
 *
 * `games_with_any` and `per_level` are two different readings and the page needs both: a
 * library analysed while Maia was centred on each game's own rating has Maia everywhere
 * and none of it at the level configured today. Those are the `orphan_levels`, and
 * `missing_games` is what the fill button would queue.
 */
export interface CoverageMaia {
  configured: number[]
  games_with_any: number
  per_level: CoverageLevel[]
  missing_games: number
  orphan_levels: CoverageLevel[]
}

/**
 * What finishing each piece of work would cost, in engine-seconds measured off this
 * deployment's own finished runs. Matching work already queued or running is included,
 * so the estimate keeps counting down after a backfill is pressed.
 *
 * Seconds of *work*, not of waiting: `concurrency` is how many run at once, so the
 * wall-clock answer is the one divided by the other. Null where too few finished runs
 * carry the budget configured now to average — an empty space beats a made-up number on a
 * page whose whole purpose is "what will this cost me".
 */
export interface CoverageEstimates {
  quick_seconds: number | null
  deep_seconds: number | null
  /** The fill, priced off finished `maia_only` runs rather than off a tier that searches. */
  maia_seconds: number | null
  concurrency: number
}

/**
 * `GET /analysis/coverage` — the whole library's analysis state in one answer.
 *
 * One call rather than six, so the page cannot show a breakdown that fails to add up to
 * its own total: `no_pass`, `quick_only` and `deep` partition the library and sum to
 * `total`.
 */
export interface AnalysisCoverage {
  total: number
  no_pass: number
  quick_only: number
  deep: number
  missing: CoverageMissing
  failed: number
  maia: CoverageMaia
  estimates: CoverageEstimates
}

/**
 * What a retry queued, and how many failures it did not turn into a run.
 *
 * `skipped` counts a game whose pass has since succeeded, a second failure over a game
 * already being retried, and a run over a bare FEN, which names no game to re-analyse.
 */
export interface RetryFailedReceipt {
  queued: number
  skipped: number
}

export interface MoveEvalResponse {
  ply: number
  move_uci?: string | null
  move_san?: string | null
  eval_before_cp?: number | null
  eval_before_mate?: number | null
  eval_after_cp?: number | null
  eval_after_mate?: number | null
  win_before?: number | null
  win_after?: number | null
  win_loss?: number | null
  classification?: Classification | null
  best_move_uci?: string | null
  best_lines?: EngineLine[] | null
  maia_policy?: MaiaPolicy | null
}

/**
 * One place the backlog can be worked. A run with no engine, or one whose engine is
 * switched off, counts as `local` — that is where the worker's fallback sends it.
 */
export interface QueueDestination extends Extra {
  destination: 'local' | 'runner'
  runner_id?: number | null
  name: string
  connected: boolean
  slots?: number | null
  queued: number
  running: number
  streams: number
}

export interface QueueStatus {
  queued: number
  running: number
  /** The owner has stopped the workers claiming; what one already claimed still finishes. */
  paused: boolean
  workers: boolean
  busy: number
  /** Always sent by the backend (`default_factory`); consumers still read `?? []`. */
  destinations: QueueDestination[]
}

/** What pausing or resuming answers: the switch, and the depth it was thrown over. */
export interface QueuePaused {
  paused: boolean
  queued: number
  running: number
}

export interface PositionAnalysis extends Extra {
  fen: string
  engine_id?: number | null
  engine_name?: string | null
  depth?: number | null
  nodes?: number | null
  cp?: number | null
  mate?: number | null
  win_percent?: number | null
  best_move?: (Extra & { uci?: string; san?: string }) | null
  lines: EngineLine[]
}

// --- explorer -------------------------------------------------------------

export interface ExplorerMove extends Extra {
  uci: string
  san: string
  games: number
  wins?: number
  draws?: number
  losses?: number
  /** 0..1, the owner's score from here. */
  score?: number | null
  occurrences?: number
  owner_moves?: number
  evaluated?: number
  /** Win percentage given away on this move, averaged. */
  avg_win_loss?: number | null
  blunders?: number
  avg_ply?: number | null
  last_played?: string | null
  /**
   * What the vendored opening book calls the position *this move reaches* — null far more
   * often than not. Reported only when that child position is itself named in the book;
   * an unnamed child never inherits its parent's name, since the book stops naming
   * positions three to five plies in and inheriting would repeat the same string down
   * every row after that. A name here reads as "this move enters that opening".
   */
  eco?: string | null
  name?: string | null
  /**
   * The owner's own newest note on the position this move reaches, whole rather than
   * shortened — the table truncates it, and `PositionNotes` is where it is written and
   * read in full. Null where they have written nothing about where this move goes.
   */
  note?: ExplorerMoveNote | null
}

/** A note as a move row carries it: enough to show it and to find it again. */
export interface ExplorerMoveNote extends Extra {
  id: number
  text: string
}

/**
 * What the vendored opening book calls a position. `ply` is where along the queried line
 * the name was found — the book stops naming positions three to five plies in, so it is
 * usually an ancestor rather than the position itself, and it is null when no line was
 * sent and only the position was looked up.
 */
export interface ExplorerOpening extends Extra {
  eco: string
  name: string
  ply?: number | null
}

export interface ExplorerResponse extends Extra {
  fen?: string | null
  eco?: string | null
  color?: Color | null
  side_to_move?: Color | null
  path: (Extra & { uci?: string; san?: string; ply?: number })[]
  root_ply?: number | null
  opening?: ExplorerOpening | null
  totals: Extra & { games?: number; wins?: number; draws?: number; losses?: number }
  moves: ExplorerMove[]
  main_line: ExplorerMove[]
  book_depth: number
  leaves_book_with?: Extra | null
  leaves_book_because?: string | null
}

export interface PositionOccurrence extends Extra {
  game: GameSummary
  ply: number
  move_number?: number | null
  move_uci?: string | null
  move_san?: string | null
  win_loss?: number | null
  classification?: Classification | null
}

// --- reference explorer ---------------------------------------------------

/**
 * The two outside books, served through `GET /reference/*` from Lichess's opening-explorer
 * API. They are read and never stored: nothing under this heading is a row in the owner's
 * database, and no count here is ever folded into `ExplorerResponse`, whose numbers are
 * the owner's own games and must stay that way.
 *
 * The counts are games, not percentages — the frontend derives the shares — and the names
 * are the backend's normalisation of Lichess's camelCase, so nothing in the app has to
 * know which of `averageRating` / `averageOpponentRating` the upstream sent.
 */
export type ReferenceSource = 'masters' | 'lichess'

/**
 * What Lichess calls the position. Either half can be null: the backend answers with the
 * object as soon as one of the two is known and with `null` when neither is, so a name
 * without an ECO code (or the reverse) is a shape the page has to survive rather than a
 * bug. Reading either one needs a fallback.
 */
export interface ReferenceOpening extends Extra {
  eco: string | null
  name: string | null
}

/** A player as a reference game names them; the rating is missing on some masters games. */
export interface ReferencePlayer extends Extra {
  name: string
  rating?: number | null
}

export interface ReferenceMove extends Extra {
  uci: string
  san: string
  games: number
  /** Game counts from White's point of view — there is no owner here to score for. */
  white: number
  draws: number
  black: number
  average_rating?: number | null
  /**
   * What the vendored book calls the position this move reaches — the child's own name,
   * never inherited, same rule as `ExplorerMove`. Null on most rows past the first moves.
   */
  eco?: string | null
  name?: string | null
}

export interface ReferenceTotals extends Extra {
  games: number
  white: number
  draws: number
  black: number
}

/** One of the games Lichess returns for a position, enough to list it and to open it. */
export interface ReferenceTopGame extends Extra {
  id: string
  white: ReferencePlayer
  black: ReferencePlayer
  /** Null for a draw. */
  winner?: 'white' | 'black' | null
  year?: number | null
  month?: string | null
  /** Lichess source only — a masters game has no time control worth naming. */
  speed?: string | null
}

export interface ReferenceExplorerResponse extends Extra {
  source: ReferenceSource
  /** The position the answer is about, as the backend normalised it. */
  fen: string
  opening?: ReferenceOpening | null
  totals: ReferenceTotals
  moves: ReferenceMove[]
  top_games: ReferenceTopGame[]
}

export interface ReferenceGameMove extends Extra {
  /** 0-based and absolute, like `LineStep.ply`: ply 0 is White's first move. */
  ply: number
  uci: string
  san: string
}

export interface ReferenceGame extends Extra {
  source: ReferenceSource
  id: string
  white: ReferencePlayer
  black: ReferencePlayer
  result: string
  event?: string | null
  site?: string | null
  date?: string | null
  moves: ReferenceGameMove[]
  /** Present for a lichess game, and for a masters game whose site is known. */
  lichess_url?: string | null
}

/**
 * A reference game now in the library. `created` is false when it already was — asking
 * twice opens the same game.
 */
export interface ReferenceImported extends Extra {
  game: GameSummary
  created: boolean
}

/** Whether a Lichess API token is stored. The token itself is never sent back. */
export interface ReferenceTokenStatus extends Extra {
  configured: boolean
}

/** `null` or an empty string clears the stored token. */
export interface ReferenceTokenUpdate {
  token: string | null
}

// --- repertoire -----------------------------------------------------------

/**
 * One move of a repertoire, and everything played after it.
 *
 * `rank` orders siblings and `0` is the main move — the reply the owner intends to play,
 * not merely the first one they entered — so the tree renders in movetext order without
 * the client deciding what is main. `comment` is `""` rather than null when unset, so a
 * textarea can be bound to it directly.
 *
 * `epd` is the position *after* the move. Nothing on this page reads it yet; it is on the
 * wire because deviation comparison (#5) is a lookup by position rather than by path, and
 * a repertoire that stores only the move order cannot answer a transposition.
 */
export interface RepertoireNode extends Extra {
  id: number
  uci: string
  san: string
  comment: string
  rank: number
  epd: string
  /** Absent on the single node a write answers with — only the tree read nests them. */
  children?: RepertoireNode[]
}

/** A whole colour's repertoire: the moves playable from the initial array, and their trees. */
export interface RepertoireTree extends Extra {
  color: Color
  moves: RepertoireNode[]
}

/** The UCI path from the initial array, in full — the backend creates whatever is missing. */
export interface RepertoireLineCreate {
  ucis: string[]
}

/** How many nodes the path actually created, and the node it ends on. */
export interface RepertoireLineCreated extends Extra {
  created: number
  tip: RepertoireNode
}

/** `comment: null` clears it; `promote: true` makes the move main among its siblings. */
export interface RepertoireMoveUpdate {
  comment?: string | null
  promote?: boolean
}

// --- stats ----------------------------------------------------------------

/**
 * Every dimension answers in the same shape: named buckets plus a total row. The keys
 * beyond `key` are the dimension's own (`blunder_rate`, `score`, `end_rating`, …).
 */
export interface StatsBucket extends Extra {
  key: string
}

export interface StatsResponse extends Extra {
  dimension: string
  since?: string | null
  until?: string | null
  buckets?: StatsBucket[]
  total?: StatsBucket
}

export interface StatsDashboardResponse extends Extra {
  anchor: string
  since?: string | null
  until: string
  dimensions: Record<string, StatsResponse>
}

export interface ComparisonResponse extends Extra {
  dimension: string
  then: Extra
  now: Extra
  delta: Extra
}

export interface RatingPoint extends Extra {
  at: string
  rating: number
  game_id?: number
}

/** One platform+speed rating history, as `/stats/profile` returns it. */
export interface RatingSeries extends Extra {
  platform: Platform
  speed: string
  games: number
  current?: number | null
  min?: number | null
  max?: number | null
  points: RatingPoint[]
}

export interface AccountSummary extends Extra {
  id: number
  platform: Platform
  username: string
  display_name?: string | null
  is_owner?: boolean
  games?: number
  first_game?: string | null
  last_game?: string | null
}

export interface ProfileResponse extends Extra {
  accounts: AccountSummary[]
  ratings: RatingSeries[]
  volume: Extra
}

export interface MomentResponse extends Extra {
  game: GameSummary
  ply: number
  move_number?: number | null
  san?: string | null
  uci?: string | null
  classification?: Classification | null
  win_loss?: number | null
  phase?: string | null
  piece?: string | null
  fen?: string | null
  best_move_uci?: string | null
  best_move_san?: string | null
  run_id?: number | null
  tier?: Tier | null
}

export interface DimensionList {
  dimensions: string[]
  planned: string[]
}

// --- engines --------------------------------------------------------------

export interface EngineResponse {
  id: number
  name: string
  kind: EngineKind
  path: string
  version?: string | null
  options: Record<string, unknown>
  enabled: boolean
  created_at: string
  /**
   * null ⇒ `path` is a path on some filesystem. A scheme — `wasm` — means it is not one at
   * all, and the page has to say where the engine lives ("in this browser") rather than
   * render `wasm:stockfish-18` as though it were a file. The backend derives it so no
   * client parses the path for itself.
   */
  path_scheme?: string | null
}

export interface EngineCreate {
  name: string
  path: string
  kind?: EngineKind
  options?: Record<string, unknown>
  enabled?: boolean
}

export interface EngineUpdate {
  name?: string
  path?: string
  kind?: EngineKind
  options?: Record<string, unknown>
  enabled?: boolean
}

/** `DELETE /engines/{id}` — queued runs bound to the engine are removed as a side effect. */
export interface EngineDeleteResult {
  unqueued: number
}

export interface ProbeRequest {
  path: string
  kind?: EngineKind
}

export interface ProbeOption extends Extra {
  name?: string
  type?: string
  default?: unknown
  min?: number
  max?: number
  /** A combo option's choices. `var` is the wire key — python-chess's own spelling. */
  var?: string[]
  /** Set per analysis by the driver (MultiPV, Ponder …); the backend refuses to store it. */
  managed?: boolean
}

export interface ProbeResponse extends Extra {
  name?: string | null
  author?: string | null
  options: ProbeOption[]
}

export interface SampleRequest {
  fen?: string
  nodes?: number
  multipv?: number
  ratings?: number[]
}

export interface SampleResponse extends Extra {
  engine_id: number
  engine_name: string
  kind: EngineKind
  fen: string
  elapsed_ms: number
  depth?: number | null
  nodes?: number | null
  cp?: number | null
  mate?: number | null
  best_move?: (Extra & { uci?: string; san?: string }) | null
  lines?: EngineLine[] | null
  policy?: MaiaPolicy | null
}

export interface TierStatusResponse {
  tier: Tier
  engine_id?: number | null
  engine_name?: string | null
  available: boolean
  reason?: string | null
}

/**
 * The three jobs an engine can be assigned to, in the order `/engines/roles` lists them.
 *
 * Human moves is a role beside the two tiers rather than a third `Tier`: `Tier` is a search
 * budget stored on every analysis run, and Maia searches nothing. `db.enums.EngineRole` is
 * the same list on the backend.
 */
export type EngineRoleName = 'quick' | 'deep' | 'human'

export const ENGINE_ROLES: readonly EngineRoleName[] = ['quick', 'deep', 'human']

/**
 * One role and the engine assigned to it — `services.engines.role_status`.
 *
 * `configured` and `available` are two different questions and the form draws them
 * differently. `configured` is "the owner has chosen an engine for this"; `available` is
 * "that engine can run this second". Unconfigured is not a fault — a deployment that has
 * not chosen a human-move model has one fewer column, not a broken role — while configured
 * and unavailable is one, and `reason` then names the engine and what is wrong with it in
 * the same words a failed run would use.
 */
export interface EngineRoleStatus {
  role: EngineRoleName
  engine_id?: number | null
  engine_name?: string | null
  available: boolean
  configured: boolean
  reason?: string | null
}

/** `GET /engines/roles` / `PUT /engines/roles` — one status per role, in `ENGINE_ROLES` order. */
export interface EngineRolesResponse {
  roles: EngineRoleStatus[]
}

/**
 * The assignment to write. A key that is left out is left alone; `null` unassigns.
 *
 * That distinction is the whole shape: saving one dropdown must not clear the other two,
 * so absence cannot mean "no engine" — only an explicit `null` does.
 */
export interface EngineRolesUpdate {
  quick?: number | null
  deep?: number | null
  human?: number | null
}

// --- notes ----------------------------------------------------------------

/** Who wrote a note: this app, the coach over MCP, or a snapshot of the live board. */
export type NoteSource = 'web' | 'mcp' | 'live'

export const NOTE_SOURCES: readonly NoteSource[] = ['web', 'mcp', 'live']

/**
 * Which anchors a note has, as `GET /notes?scope=` names them: `game` is about a game,
 * `position` about a FEN and no game, `line` about a kept variation, `free` about nothing
 * but itself.
 */
export type NoteScope = 'game' | 'position' | 'line' | 'free'

export const NOTE_SCOPES: readonly NoteScope[] = ['game', 'position', 'line', 'free']

/** Just enough of a game to label a note with it (`services.notes.game_brief`). */
export interface NoteGameBrief extends Extra {
  id: number
  white?: string | null
  black?: string | null
  result?: string | null
  /** The day it was played, `YYYY-MM-DD`, or null for a game that carries no date. */
  date?: string | null
  /** False for a model game from the reference books — one kept for study, not played. */
  is_owner_game?: boolean
}

/**
 * The move a note was written on, already spelled (`services.notes.note_move`).
 *
 * `ply` is the half-move **count** after the move, so the move itself is at `ply - 1`;
 * `on_line` marks a move inside a pinned variation rather than one of the game's own.
 */
export interface NoteMove extends Extra {
  ply: number
  move_number: number
  color: Color
  san: string
  /** `3. Bb5` or `3... a6` — what a person writes. */
  label: string
  on_line?: boolean
}

/**
 * One kept variation off a game — `POST /lines`, `GET /games/{id}/lines`.
 *
 * `base_ply` is the mainline ply it branches from (0 from the start) and `moves` is UCI.
 * `sans` is the same line in SAN, derived by the backend at read time rather than stored,
 * so it is shorter than `moves` for a line whose game no longer replays it.
 */
export interface LineResponse extends Extra {
  id: number
  game_id: number
  base_ply: number
  moves: string[]
  sans: string[]
  created_at: string
  updated_at: string
  /** Only where the route carries them: `POST /lines` and `GET /games/{id}/lines`. */
  notes?: NoteResponse[]
}

/**
 * The variation to keep. Deduped by shape rather than by id: a line already covered by a
 * kept one comes back as that one, and a line that continues a kept one extends it — so
 * pinning the same branch twice keeps one row.
 */
export interface LineCreate {
  game_id: number
  base_ply?: number
  moves: string[]
}

/**
 * A note with its anchors resolved: the FEN of the position, the whole line and a small
 * summary of the game ride along, so nothing that renders a note has to fetch them.
 *
 * `ply` is a half-move **count**, not a move index — 0 is the starting position and `n` the
 * position after `n` half-moves. On a line note it is `line.base_ply + k`: the position
 * after `k` moves of the variation.
 */
export interface NoteResponse extends Extra {
  id: number
  text: string
  tags: string[]
  game_id?: number | null
  position_id?: number | null
  line_id?: number | null
  ply?: number | null
  source?: NoteSource
  fen?: string | null
  line?: LineResponse | null
  game?: NoteGameBrief | null
  /**
   * The move it was written on, so a note that resurfaces at a position reached some other
   * way can still name where it came from. Null when there is no move to name.
   */
  move?: NoteMove | null
  /** How many of the owner's games pass through this note's position. 0 when none do. */
  position_games?: number
  /** How many model games do — kept for study, outside the explorer's tree. */
  position_reference_games?: number
  created_at: string
  updated_at: string
}

/**
 * A note and as much of a position as the writer could name. Every anchor is optional and
 * they compose.
 */
export interface NoteCreate {
  text: string
  tags?: string[]
  game_id?: number | null
  fen?: string | null
  /** The mainline ply the note is about, or the index into `line` (`base_ply + k`). */
  ply?: number | null
  /** Pin the note to a variation that is already kept. */
  line_id?: number | null
  /** Keep this variation first, then pin the note to it — a note on a line always pins it. */
  line?: LineCreate | null
  source?: NoteSource
  /**
   * Snapshot the live board instead of naming a position: its FEN, the game it is
   * following and, off the mainline, the departure as a kept line. `source` becomes `live`.
   */
  from_live?: boolean
}

export interface NoteUpdate {
  text?: string
  tags?: string[]
}

export interface TagCount {
  tag: string
  notes: number
}

/** Why a note came back up: its position recurred in a recent game, or it has gone quiet. */
/** `md` for a person to read, `pgn` for a board program to open. */
export type NoteExportFormat = 'md' | 'pgn'

export const NOTE_EXPORT_FORMATS: readonly NoteExportFormat[] = ['md', 'pgn']

// --- live -----------------------------------------------------------------

export interface LiveArrow {
  from: string
  to: string
  color: string
}

export interface LiveSquare {
  square: string
  color: string
}

export interface LiveState extends Extra {
  active: boolean
  game_id?: number | null
  ply?: number | null
  fen?: string | null
  turn?: string | null
  moves: string[]
  last_move?: string | null
  arrows: LiveArrow[]
  squares: LiveSquare[]
  text?: string | null
  viewer_count: number
  updated_at?: string | null
}

// --- runners --------------------------------------------------------------

export type RunnerTransport = 'websocket' | 'poll'

/**
 * An engine as its host advertises it. A runner-bound row is read-mostly here — its truth
 * is the yaml on that machine, and `path` is a path over there.
 */
export interface RunnerEngine extends Extra {
  id: number
  name: string
  kind: EngineKind
  version?: string | null
  /** The path on THAT machine; read-only here. */
  path?: string | null
  /** As on `EngineResponse`: `wasm` means `path` names a browser engine, not a file. */
  path_scheme?: string | null
  enabled: boolean
  /**
   * Whether this engine can drive a board at all: its kind (false for Maia) and what its
   * host advertised (false for a runner that takes queue work only). It does not know the
   * transport, which changes per connection: see `lib/engines/hosts.ts`, where "queue only"
   * is decided.
   */
  streams: boolean
}

export interface RunnerResponse extends Extra {
  id: number
  name: string
  slots: number
  version?: string | null
  connected: boolean
  /**
   * What kind of host last dialled in. A browser tab is a runner that closes when someone
   * shuts it, so it is listed differently and forgiven differently than a machine that is
   * supposed to be there.
   */
  browser?: boolean
  transport?: RunnerTransport | null
  last_seen_at?: string | null
  created_at?: string | null
  /** Slots holding a queue run. */
  busy: number
  /** Slots holding an analysis board. */
  streams: number
  free_slots: number
  /** Queued runs only this runner can take. */
  queued_eligible: number
  engines: RunnerEngine[]
}

export interface RunnerCreate {
  name: string
  /** >= 1, default 1. */
  slots?: number
}

export interface RunnerUpdate {
  name?: string
  slots?: number
}

/** The one answer that carries a token. It is not readable again from anywhere. */
export interface RunnerCreated {
  runner: RunnerResponse
  token: string
  /** A paste-ready `runner.yaml` with the token already in it. */
  config_yaml: string
}

/** This host, described as one more destination. */
export interface LocalHost extends Extra {
  name: string
  /** `analysis_concurrency`, when this process knows it. */
  slots?: number | null
  busy: number
  streams: number
  /** Whether this process drains the queue. */
  workers: boolean
  queued: number
  running: number
  engines: RunnerEngine[]
}

export interface QueueTotals {
  queued: number
  running: number
}

export interface RunnersStatus {
  runners: RunnerResponse[]
  local: LocalHost
  queue: QueueTotals
}

// --- mcp keys -------------------------------------------------------------

/** A bearer key for `/mcp`, minus the secret: only its hash is stored. */
export interface McpKeyResponse extends Extra {
  id: number
  name: string
  created_at: string
  last_used_at?: string | null
}

export interface McpKeyCreate {
  name: string
}

/** The one answer that carries the token. It is not readable again from anywhere. */
export interface McpKeyCreated {
  key: McpKeyResponse
  token: string
}

// --- streams --------------------------------------------------------------

/**
 * One session per surface. `companion` is the iOS app's own, which is why turning its
 * engine on never takes the browser's board over; nothing in this app opens one.
 */
export type StreamSurface = 'game' | 'live' | 'companion'
export type StreamState = 'starting' | 'running' | 'ended'
export type StreamEndReason = 'closed' | 'replaced' | 'idle' | 'engine_failed' | 'runner_gone'

/**
 * One multi-PV line of a snapshot. `cp` is from the SIDE TO MOVE's point of view — the same
 * vocabulary as `MoveEval.best_lines`, and structurally compatible with `EngineLine`.
 */
export interface StreamLine extends Extra {
  multipv: number
  cp?: number | null
  mate?: number | null
  pv: string[]
}

export interface StreamCreate {
  fen: string
  /** Omitted or null ⇒ the deep tier's engine. */
  engine_id?: number | null
  /** 1..5, default 1. */
  multipv?: number
  /** One session per surface; a second POST replaces the first. */
  surface?: StreamSurface
  /** Echoed back untouched, for the page's own bookkeeping. */
  game_id?: number | null
  ply?: number | null
}

export interface StreamUpdate {
  fen?: string
  multipv?: number
}

export interface StreamResponse extends Extra {
  id: string
  surface: StreamSurface
  fen: string
  multipv: number
  engine_id: number
  engine: string
  /** null ⇒ a local engine; that is the only thing that distinguishes the two. */
  runner_id?: number | null
  runner?: string | null
  state: StreamState
  reason?: StreamEndReason | null
  seq: number
  created_at: string
  last_snapshot_at?: string | null
  game_id?: number | null
  ply?: number | null
}

// --- search (`GET /search`) -----------------------------------------------

/** One opponent the box matched: how often they were played, and how the owner did. */
export interface OpponentHit extends Extra {
  name: string
  games: number
  /** The owner's score over those games as a percentage — a win a point, a draw half. */
  score: number
}

/** One opening the box matched, by name or by ECO prefix. */
export interface OpeningHit extends Extra {
  eco: string
  name: string
  games: number
}

/**
 * `services.search.global_search`: one query, four groups, each capped on its own.
 *
 * A query shorter than two characters answers with four empty groups rather than an
 * error — the box is searched as it is typed.
 */
export interface SearchResponse {
  games: GameSummary[]
  opponents: OpponentHit[]
  openings: OpeningHit[]
  notes: NoteResponse[]
}

// --- meta -----------------------------------------------------------------

export interface Health {
  status: string
}
