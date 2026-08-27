/**
 * One function per backend route (`backend/api/routes/*.py`), typed against
 * `backend/api/schemas.py`. Nothing here caches — that is TanStack Query's job in
 * `queries.ts`.
 */
import { http, type QueryValue } from './client'
import type {
  AnalysisRequest,
  AuthStatus,
  ComparisonResponse,
  DimensionList,
  EngineCreate,
  EngineDeleteResult,
  EngineResponse,
  EngineUpdate,
  ExplorerResponse,
  GameCardList,
  GameDetail,
  GameFilters,
  GameList,
  Health,
  ImportJob,
  ImportRequest,
  ImportStarted,
  LiveState,
  MaiaPolicyRequest,
  MaiaPolicyResponse,
  MomentResponse,
  MoveEvalResponse,
  NoteCreate,
  NoteResponse,
  NoteUpdate,
  PositionAnalysis,
  PositionOccurrence,
  ProbeRequest,
  ProbeResponse,
  ProfileResponse,
  QueueStatus,
  RunnerCreate,
  RunnerCreated,
  RunnerResponse,
  RunnersStatus,
  RunnerUpdate,
  RunResponse,
  SampleRequest,
  SampleResponse,
  Source,
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
export const authStatus = () => http.get<AuthStatus>('/auth/status')

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

// --- import ---------------------------------------------------------------

export const listImportJobs = (query: { source?: Source; limit?: number } = {}) =>
  http.get<ImportJob[]>('/import/jobs', { query })

export const getImportJob = (id: number) => http.get<ImportJob>(`/import/jobs/${id}`)

export const startImport = (source: Source, body: ImportRequest = {}) =>
  http.post<ImportStarted>(`/import/${source}`, { body })

/** The PGN itself is the request body; `wait` runs the sync inline. */
export const uploadPgn = (
  pgn: string,
  query: { wait?: boolean; max_games?: number } = {},
) => http.post<ImportStarted>('/import/pgn/upload', { text: pgn, query })

// --- analysis -------------------------------------------------------------

export const requestAnalysis = (body: AnalysisRequest) =>
  http.post<RunResponse>('/analysis', { body })

export const getQueue = () => http.get<QueueStatus>('/analysis/queue')

export const listRuns = (gameId: number, tier?: Tier) =>
  http.get<RunResponse[]>('/analysis/runs', { query: { game_id: gameId, tier } })

export const getRun = (runId: number) => http.get<RunResponse>(`/analysis/runs/${runId}`)

/** The window is half-open, the way a run is configured. */
export const getRunEvals = (
  runId: number,
  window: { ply_start?: number; ply_end?: number } = {},
) => http.get<MoveEvalResponse[]>(`/analysis/runs/${runId}/evals`, { query: window })

export const analyzePosition = (fen: string, nodes?: number) =>
  http.post<PositionAnalysis>('/analysis/position', { body: { fen, nodes } })

// --- explorer -------------------------------------------------------------

export interface ExplorerQuery {
  fen?: string
  eco?: string
  color?: 'white' | 'black'
  limit?: number
  min_games?: number
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

export const testRunEngine = (id: number, body: SampleRequest = {}) =>
  http.post<SampleResponse>(`/engines/${id}/test-run`, { body })

// --- notes ----------------------------------------------------------------

export interface NoteQuery {
  query?: string
  tags?: string[]
  since?: string
  until?: string
  game_id?: number
  fen?: string
  limit?: number
}

export const searchNotes = (query: NoteQuery = {}) =>
  http.get<NoteResponse[]>('/notes', { query: query as Record<string, QueryValue> })

export const getNote = (id: number) => http.get<NoteResponse>(`/notes/${id}`)

export const saveNote = (body: NoteCreate) => http.post<NoteResponse>('/notes', { body })

export const updateNote = (id: number, body: NoteUpdate) =>
  http.patch<NoteResponse>(`/notes/${id}`, { body })

export const deleteNote = (id: number) => http.delete<void>(`/notes/${id}`)

export const listTags = () => http.get<TagCount[]>('/notes/tags')

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
