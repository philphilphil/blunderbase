/**
 * The wire types, mirroring `backend/api/schemas.py`.
 *
 * Response models on the backend are `extra="allow"` and drop `None` keys, so every
 * optional field here is genuinely optional and payloads may carry more than is
 * documented — hence the `Extra` index signature on the payload-shaped types.
 */

export type Extra = Record<string, unknown>

// --- enums (backend/db/enums.py) ------------------------------------------

export type Source = 'lichess' | 'chesscom' | 'pgn' | 'manual'
export type Platform = 'lichess' | 'chesscom' | 'otb'
export type Color = 'white' | 'black'
export type Result = '1-0' | '0-1' | '1/2-1/2' | '*'
export type Speed = 'bullet' | 'blitz' | 'rapid' | 'classical' | 'correspondence'
export type Tier = 'quick' | 'deep'
export type RunStatus = 'queued' | 'running' | 'done' | 'failed'
export type JobStatus = 'queued' | 'running' | 'done' | 'failed'
export type Classification = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder'
export type EngineKind = 'uci' | 'maia'
export type Outcome = 'win' | 'loss' | 'draw'

export const SOURCES: readonly Source[] = ['lichess', 'chesscom', 'pgn', 'manual']
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

/** What every `/auth` route answers with: is there a password, and do I have it. */
export interface AuthStatus {
  setup_required: boolean
  authenticated: boolean
}

// --- games ----------------------------------------------------------------

export interface GameSummary extends Extra {
  id: number
  source: Source
  source_id?: string | null
  played_at?: string | null
  color?: Color | null
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
  status: RunStatus
  engine?: string | null
  engine_kind?: EngineKind | null
  depth?: number | null
  nodes?: number | null
  multipv?: number
  finished_at?: string | null
}

export interface GameDetail extends Extra {
  game: GameSummary
  ply_range?: [number, number] | null
  moves: MoveRow[]
  runs: GameRunSummary[]
  notes?: NoteResponse[] | null
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
  speed?: Speed
  time_control?: string
  opponent?: string
  variant?: string
  has_blunders?: boolean
  deep_analyzed?: boolean
  text?: string
}

// --- import ---------------------------------------------------------------

export interface ImportRequest {
  username?: string
  path?: string
  text?: string
  since?: string
  max_games?: number
  wait?: boolean
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
  games_failed: number
  errors: { ref?: string; error?: string }[]
  message?: string | null
}

export interface ImportStarted {
  source: string
  status: string
  job_id?: number | null
  job?: ImportJob | null
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
  created_at: string
  started_at?: string | null
  finished_at?: string | null
  error?: string | null
  stderr?: string | null
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

export interface QueueStatus {
  queued: number
  running: number
  workers: boolean
  busy: number
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
}

export interface ExplorerResponse extends Extra {
  fen?: string | null
  eco?: string | null
  color?: Color | null
  side_to_move?: Color | null
  path: (Extra & { uci?: string; san?: string; ply?: number })[]
  root_ply?: number | null
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
  default_tier?: Tier | null
  created_at: string
}

export interface EngineCreate {
  name: string
  path: string
  kind?: EngineKind
  options?: Record<string, unknown>
  default_tier?: Tier | null
  enabled?: boolean
}

export interface EngineUpdate {
  name?: string
  path?: string
  kind?: EngineKind
  options?: Record<string, unknown>
  default_tier?: Tier | null
  enabled?: boolean
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

// --- notes ----------------------------------------------------------------

export interface NoteResponse {
  id: number
  text: string
  tags: string[]
  game_id?: number | null
  position_id?: number | null
  created_at: string
  updated_at: string
}

export interface NoteCreate {
  text: string
  tags?: string[]
  game_id?: number | null
  fen?: string | null
}

export interface NoteUpdate {
  text?: string
  tags?: string[]
}

export interface TagCount {
  tag: string
  notes: number
}

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

// --- meta -----------------------------------------------------------------

export interface Health {
  status: string
}
