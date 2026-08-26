/**
 * One function per backend route (`backend/api/routes/*.py`), typed against
 * `backend/api/schemas.py`. Nothing here caches — that is TanStack Query's job in
 * `queries.ts`.
 */
import { http, type QueryValue } from './client'
import type {
  AnalysisRequest,
  ComparisonResponse,
  DimensionList,
  EngineCreate,
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
  RunResponse,
  SampleRequest,
  SampleResponse,
  Source,
  StatsResponse,
  TagCount,
  Tier,
  TierStatusResponse,
} from './types'

function filterParams(filters: GameFilters = {}): Record<string, QueryValue> {
  return filters as Record<string, QueryValue>
}

// --- meta -----------------------------------------------------------------

export const health = () => http.get<Health>('/health')

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

export const deleteEngine = (id: number) => http.delete<void>(`/engines/${id}`)

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

// --- live -----------------------------------------------------------------

export const getLiveState = () => http.get<LiveState>('/live')
