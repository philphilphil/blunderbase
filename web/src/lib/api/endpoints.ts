/**
 * One function per backend route (`backend/api/routes/*.py`), typed against
 * `backend/api/schemas.py`. Nothing here caches — that is TanStack Query's job in
 * `queries.ts`.
 */
import { desktopBootstrapHeaders } from '@/lib/desktop/nativeBridge'

import { apiUrl, http, requestDownload, type QueryValue } from './client'
import type {
  AnalysisCoverage,
  AnalysisRequest,
  AppSettings,
  AppSettingsUpdate,
  AuthStatus,
  BackfillCancelled,
  BackfillPreview,
  BackfillStarted,
  BatchAnalysisRequest,
  BatchAnalysisResponse,
  ComparisonResponse,
  DimensionList,
  EngineCreate,
  EngineDeleteResult,
  EngineResponse,
  EngineRolesResponse,
  EngineRolesUpdate,
  EngineUpdate,
  ExplorerResponse,
  GameCardList,
  GameDetail,
  GameFilters,
  GameList,
  GamesDeleted,
  Health,
  ImportJob,
  ImportRequest,
  ImportStarted,
  LineCreate,
  LineResponse,
  LiveState,
  MaiaFillReceipt,
  MaiaFillStatus,
  MaiaPolicyRequest,
  MaiaPolicyResponse,
  McpKeyCreate,
  McpKeyCreated,
  McpKeyResponse,
  MomentResponse,
  MoveEvalResponse,
  NoteCreate,
  NoteExportFormat,
  NoteResponse,
  NoteScope,
  NoteUpdate,
  PositionAnalysis,
  PositionOccurrence,
  ProbeRequest,
  ProbeResponse,
  ProfileResponse,
  QueueCleared,
  QueuePaused,
  QueueStatus,
  RetryFailedReceipt,
  RunnerCreate,
  RunnerCreated,
  RunnerResponse,
  RunnersStatus,
  RunnerUpdate,
  RunResponse,
  RunStatus,
  SampleRequest,
  SampleResponse,
  SearchResponse,
  Source,
  StatsDashboardResponse,
  StatsResponse,
  StreamCreate,
  StreamResponse,
  StreamUpdate,
  TagCount,
  Tier,
  TierStatusResponse,
} from './types'

function filterParams(filters: GameFilters = {}): Record<string, QueryValue> {
  return filters as Record<string, QueryValue>
}

// --- meta -----------------------------------------------------------------

export const health = () => http.get<Health>('/health')

// --- auth -----------------------------------------------------------------

/** Never guarded — this is the call the page makes before it renders anything. */
export const authStatus = () =>
  http.get<AuthStatus>('/auth/status', { headers: desktopBootstrapHeaders() })

/** First run only: a second caller gets a 409 `already_configured`. */
export const setupPassword = (password: string) =>
  http.post<AuthStatus>('/auth/setup', { body: { password } })

export const login = (password: string) =>
  http.post<AuthStatus>('/auth/login', { body: { password } })

/** Always 204, cookie cleared — a browser asking to be signed out is never refused. */
export const logout = () => http.post<void>('/auth/logout')

/** Signs every other browser out and hands this one a fresh cookie. */
export const changePassword = (current: string, next: string) =>
  http.post<AuthStatus>('/auth/password', { body: { current, new: next } })

// --- settings --------------------------------------------------------------

export const getAppSettings = () => http.get<AppSettings>('/settings')

/**
 * The whole of the settings, not a patch of them. The answer is what is in force
 * afterwards: an out-of-range level comes back clamped rather than refused.
 */
export const saveAppSettings = (body: AppSettingsUpdate) =>
  http.put<AppSettings>('/settings', { body })

// --- games ----------------------------------------------------------------

export interface GameQuery extends GameFilters {
  limit?: number
  offset?: number
}

export const listGames = (query: GameQuery = {}) =>
  http.get<GameList>('/games', { query: { ...filterParams(query), cards: false } })

/** The same page with the eval curve and the worst moments attached. */
export const listGameCards = (query: GameQuery = {}) =>
  http.get<GameCardList>('/games', { query: { ...filterParams(query), cards: true } })

export interface GameDetailQuery {
  ply_start?: number
  ply_end?: number
  notes?: boolean
}

export const getGame = (id: number, query: GameDetailQuery = {}) =>
  http.get<GameDetail>(`/games/${id}`, { query: query as Record<string, QueryValue> })

/**
 * Every game, and everything that only exists because of one: its analysis, its notes and
 * the sync history the next import would otherwise resume from. Accounts, engines and
 * notes about a position stay. Server mode checks its password again; desktop confirms
 * through its native, passwordless session.
 */
export const deleteAllGames = (password?: string) =>
  http.post<GamesDeleted>('/games/delete-all', { body: { password } })

// --- import ---------------------------------------------------------------

export const listImportJobs = (query: { source?: Source; limit?: number } = {}) =>
  http.get<ImportJob[]>('/import/jobs', { query })

export const getImportJob = (id: number) => http.get<ImportJob>(`/import/jobs/${id}`)

export const startImport = (source: Source, body: ImportRequest = {}) =>
  http.post<ImportStarted>(`/import/${source}`, { body })

/** The PGN itself is the request body; `wait` runs the sync inline. */
export const uploadPgn = (
  pgn: string,
  query: { wait?: boolean; max_games?: number; analyze?: boolean } = {},
) => http.post<ImportStarted>('/import/pgn/upload', { text: pgn, query })

// --- analysis -------------------------------------------------------------

export const requestAnalysis = (body: AnalysisRequest) =>
  http.post<RunResponse>('/analysis', { body })

/**
 * One pass over each of several games, in one call and one transaction. A game that
 * could not be queued comes back in `refused` rather than failing the rest of them.
 */
export const requestAnalysisBatch = (body: BatchAnalysisRequest) =>
  http.post<BatchAnalysisResponse>('/analysis/batch', { body })

export const getQueue = () => http.get<QueueStatus>('/analysis/queue')

/** How many games a backfill of this tier would take on, without taking any of them on. */
export const getBackfill = (tier: Tier = 'quick') =>
  http.get<BackfillPreview>('/analysis/backfill', { query: { tier } })

/**
 * A pass over the whole library, in one call. Unlike `/analysis/batch` there is no cap and
 * no per-game receipt: the answer is a count, and the socket says `analysis.backfill` once
 * rather than once per game.
 */
export const startBackfill = (tier: Tier = 'quick') =>
  http.post<BackfillStarted>('/analysis/backfill', { body: { tier } })

/** Drops what is still queued. Runs already on an engine are left to finish. */
export const cancelBackfill = (tier: Tier = 'quick') =>
  http.post<BackfillCancelled>('/analysis/backfill/cancel', { body: { tier } })

/**
 * Drops everything still queued, whatever tier or shape it is queued in — the undo for a
 * queue built up by mistake. Runs already on an engine are left to finish.
 */
export const clearQueue = () => http.post<QueueCleared>('/analysis/queue/clear')

/**
 * Stops the workers claiming anything else — every machine's, not only this one's, since
 * the pause is a stored flag both halves of the queue read. A run already claimed finishes.
 */
export const pauseQueue = () => http.post<QueuePaused>('/analysis/queue/pause')

/** Lets the queue drain again, and nudges the workers so it starts without a poll's wait. */
export const resumeQueue = () => http.post<QueuePaused>('/analysis/queue/resume')

/**
 * The whole library's analysis state in one call — what has been analysed with what, what
 * a backfill of each tier would queue, and what this deployment's own history says either
 * would cost. The Analysis page renders from nothing else.
 */
export const getCoverage = () => http.get<AnalysisCoverage>('/analysis/coverage')

/**
 * Newest first. One of `gameId` and `status` has to be given: the backend refuses a
 * listing that narrows by neither rather than paging the whole run table.
 */
export const listRuns = (
  gameId?: number,
  tier?: Tier,
  query: { status?: RunStatus; limit?: number } = {},
) =>
  http.get<RunResponse[]>('/analysis/runs', {
    query: { game_id: gameId, tier, status: query.status, limit: query.limit },
  })

/**
 * Queue a fresh pass for every game behind a failed run — the one press that clears a few
 * hundred failures from a tier that had no engine on the day the library was imported.
 * No ids means every failure. 409 `tier_unavailable` when that tier still has no engine.
 */
export const retryFailedRuns = (runIds?: number[]) =>
  http.post<RetryFailedReceipt>('/analysis/runs/retry-failed', {
    body: runIds && runIds.length > 0 ? { run_ids: runIds } : {},
  })

export const getRun = (runId: number) => http.get<RunResponse>(`/analysis/runs/${runId}`)

/** The window is half-open, the way a run is configured. */
export const getRunEvals = (
  runId: number,
  window: { ply_start?: number; ply_end?: number } = {},
) => http.get<MoveEvalResponse[]>(`/analysis/runs/${runId}/evals`, { query: window })

export const analyzePosition = (fen: string, nodes?: number) =>
  http.post<PositionAnalysis>('/analysis/position', { body: { fen, nodes } })

/** How many analysed games are missing one of the configured Maia levels. */
export const getMaiaFillStatus = () => http.get<MaiaFillStatus>('/analysis/maia-fill/status')

/**
 * Add the missing Maia levels to games that already have a pass — a Maia-only run per
 * game, merged into what is stored, so a new level costs minutes rather than a re-analysis
 * of the library. No ids means every analysed game.
 */
export const maiaFill = (gameIds?: number[]) =>
  http.post<MaiaFillReceipt>('/analysis/maia-fill', {
    body: gameIds && gameIds.length > 0 ? { game_ids: gameIds } : {},
  })

// --- explorer -------------------------------------------------------------

export interface ExplorerQuery {
  fen?: string
  eco?: string
  color?: 'white' | 'black'
  limit?: number
  min_games?: number
  /**
   * `e2e4,e7e5` — how this position was reached. Naming only: the tree is still the one
   * `fen` asks for. The opening book stops naming positions a few plies in, so a position
   * any deeper takes its name from an ancestor, and only the path says which one.
   */
  line?: string
}

export const explore = (query: ExplorerQuery = {}) =>
  http.get<ExplorerResponse>('/explorer', { query: query as Record<string, QueryValue> })

export const findPositions = (
  fen: string,
  query: { color?: 'white' | 'black'; limit?: number } = {},
) => http.get<PositionOccurrence[]>('/explorer/positions', { query: { fen, ...query } })

// --- stats ----------------------------------------------------------------

export const listDimensions = () => http.get<DimensionList>('/stats/dimensions')

export const getProfile = () => http.get<ProfileResponse>('/stats/profile')

export interface StatsDashboardQuery extends GameFilters {
  days?: number
}

export const getStatsDashboard = (query: StatsDashboardQuery = {}) =>
  http.get<StatsDashboardResponse>('/stats/dashboard', { query: filterParams(query) })

export const getWorstMoments = (
  query: GameFilters & { days?: number; amount?: number } = {},
) => http.get<MomentResponse[]>('/stats/worst-moments', { query: filterParams(query) })

export interface CompareQuery extends GameFilters {
  dimension: string
  then_start: string
  then_end: string
  now_start: string
  now_end: string
}

export const comparePeriods = (query: CompareQuery) =>
  http.get<ComparisonResponse>('/stats/compare', { query: filterParams(query) })

export const getStats = (dimension: string, filters: GameFilters = {}) =>
  http.get<StatsResponse>(`/stats/${dimension}`, { query: filterParams(filters) })

// --- engines --------------------------------------------------------------

export const listEngines = (enabledOnly = false) =>
  http.get<EngineResponse[]>('/engines', { query: { enabled_only: enabledOnly } })

export const getEngine = (id: number) => http.get<EngineResponse>(`/engines/${id}`)

export const addEngine = (body: EngineCreate) =>
  http.post<EngineResponse>('/engines', { body })

export const updateEngine = (id: number, body: EngineUpdate) =>
  http.patch<EngineResponse>(`/engines/${id}`, { body })

export const deleteEngine = (id: number) => http.delete<EngineDeleteResult>(`/engines/${id}`)

export const probeEngine = (body: ProbeRequest) =>
  http.post<ProbeResponse>('/engines/probe', { body })

export const listTierStatus = () => http.get<TierStatusResponse[]>('/engines/tiers')

/**
 * What runs what: the engine assigned to each of the three roles, in one read.
 *
 * Supersedes `listTierStatus` for anything drawing the whole picture — human moves is a
 * role the tier list has no member for, and widening `Tier` to give it one would corrupt a
 * type the whole analysis pipeline stores on every run.
 */
export const listEngineRoles = () => http.get<EngineRolesResponse>('/engines/roles')

/**
 * Assign engines to roles. Only the keys that are sent are written, so the roles form saves
 * one dropdown without touching the other two, and `null` is how a role is emptied.
 *
 * The response is the whole assignment afterwards — every role's status, not just the ones
 * that changed — because switching Deep to an engine that is switched off changes nothing
 * about Quick but does change what the page has to say about Deep.
 */
export const setEngineRoles = (body: EngineRolesUpdate) =>
  http.put<EngineRolesResponse>('/engines/roles', { body })

export const testRunEngine = (id: number, body: SampleRequest = {}) =>
  http.post<SampleResponse>(`/engines/${id}/test-run`, { body })

// --- notes ----------------------------------------------------------------

export interface NoteQuery {
  query?: string
  /** Notes carrying *every* one of these tags. */
  tags?: string[]
  since?: string
  until?: string
  game_id?: number
  /** Notes on exactly this position. */
  fen?: string
  /** Which anchors the note has — see `NoteScope`. */
  scope?: NoteScope
  /** Notes pinned to one kept variation. */
  line_id?: number
  /** True for only the notes that know their position, false for only those that do not. */
  has_position?: boolean
  limit?: number
}

/** `NoteQuery` minus the page size: an export is a document, and the backend caps it. */
export type NoteExportQuery = Omit<NoteQuery, 'limit'>

function noteParams(query: NoteQuery | NoteExportQuery = {}): Record<string, QueryValue> {
  return query as Record<string, QueryValue>
}

export const searchNotes = (query: NoteQuery = {}) =>
  http.get<NoteResponse[]>('/notes', { query: noteParams(query) })

export const getNote = (id: number) => http.get<NoteResponse>(`/notes/${id}`)

export const saveNote = (body: NoteCreate) => http.post<NoteResponse>('/notes', { body })

export const updateNote = (id: number, body: NoteUpdate) =>
  http.patch<NoteResponse>(`/notes/${id}`, { body })

export const deleteNote = (id: number) => http.delete<void>(`/notes/${id}`)

export const listTags = () => http.get<TagCount[]>('/notes/tags')

/**
 * The notes worth re-reading: ones whose position came back in a recently imported game,
 * and ones nobody has touched in three weeks. Each item says which of the two it is.
 */
/** The href of an export, for a link that wants one. `exportNotes` is what a button uses. */
export const exportNotesUrl = (format: NoteExportFormat = 'md', query: NoteExportQuery = {}) =>
  apiUrl('/notes/export', { ...noteParams(query), format })

/**
 * The notes the same filters would list, as a document to keep — Markdown for a person,
 * PGN for a board program.
 *
 * Fetched rather than linked to: a link cannot report a failure (the browser would navigate
 * to the error body) and cannot read the filename the backend chose. Hand the result to
 * `saveDownload` from `./client` to put it on disk.
 */
export const exportNotes = (format: NoteExportFormat = 'md', query: NoteExportQuery = {}) =>
  requestDownload('/notes/export', {
    query: { ...noteParams(query), format },
    fallbackName: format === 'pgn' ? 'blunderbase-notes.pgn' : 'blunderbase-notes.md',
  })

// --- lines ----------------------------------------------------------------

/**
 * Pin a variation off a game. Idempotent by shape rather than by id — a line already
 * covered by a kept one comes back as that one, and a longer one extends it — so pinning
 * the same branch twice is one row, and the answer says which row it is.
 */
export const saveLine = (body: LineCreate) => http.post<LineResponse>('/lines', { body })

/** Every kept variation of a game, each with the notes hanging off it. */
export const listLines = (gameId: number) =>
  http.get<LineResponse[]>(`/games/${gameId}/lines`)

/** Unpin it. Notes written about the line survive with their `line_id` cleared. */
export const deleteLine = (id: number) => http.delete<void>(`/lines/${id}`)

// --- search ---------------------------------------------------------------

/**
 * The command palette's one box: games, opponents, openings and notes at once.
 *
 * `limit` caps each group on its own (1..20). A query under two characters is answered
 * with four empty groups by the backend, so nothing here has to guard the first letter.
 */
export const search = (q: string, limit?: number) =>
  http.get<SearchResponse>('/search', { query: { q, limit } })

// --- runners --------------------------------------------------------------

export const listRunners = () => http.get<RunnerResponse[]>('/runners')

/** Where engine work can run right now: this host, every runner, the backlog between them. */
export const getRunnersStatus = () => http.get<RunnersStatus>('/runners/status')

/** The one answer that carries a token — nothing stores it, so nothing can show it again. */
export const createRunner = (body: RunnerCreate) =>
  http.post<RunnerCreated>('/runners', { body })

export const updateRunner = (id: number, body: RunnerUpdate) =>
  http.patch<RunnerResponse>(`/runners/${id}`, { body })

export const deleteRunner = (id: number) => http.delete<void>(`/runners/${id}`)

// --- mcp keys -------------------------------------------------------------

export const listMcpKeys = () => http.get<McpKeyResponse[]>('/mcp-keys')

/** The one answer that carries a token — nothing stores it, so nothing can show it again. */
export const createMcpKey = (body: McpKeyCreate) =>
  http.post<McpKeyCreated>('/mcp-keys', { body })

export const deleteMcpKey = (id: number) => http.delete<void>(`/mcp-keys/${id}`)

// --- streams --------------------------------------------------------------

export const listStreams = () => http.get<StreamResponse[]>('/streams')

export const openStream = (body: StreamCreate) => http.post<StreamResponse>('/streams', { body })

/** A position change is a restart on the same slot, never a teardown. */
export const restartStream = (id: string, body: StreamUpdate) =>
  http.patch<StreamResponse>(`/streams/${id}`, { body })

export const closeStream = (id: string) => http.delete<void>(`/streams/${id}`)

// --- maia -----------------------------------------------------------------

/**
 * The human model on an arbitrary position — the analysis board's Maia column.
 *
 * One shot, not a stream: the query is a 1-node policy read, milliseconds on a warm
 * engine. `409` means the deployment has no backend-local Maia, which is a reason to
 * show nothing rather than an error to report.
 */
export const maiaPolicy = (body: MaiaPolicyRequest) =>
  http.post<MaiaPolicyResponse>('/maia/policy', { body })

// --- live -----------------------------------------------------------------

export const getLiveState = () => http.get<LiveState>('/live')
