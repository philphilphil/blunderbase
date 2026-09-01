import type { QueryKey } from '@tanstack/react-query'

import type { Color, GameFilters, Source, Tier } from './types'
import type {
  CompareQuery,
  ExplorerQuery,
  GameDetailQuery,
  GameQuery,
  NoteQuery,
  ReferenceExplorerQuery,
  StatsDashboardQuery,
} from './endpoints'

/**
 * One place every query key is built.
 *
 * The keys are hierarchical on purpose: `['games']` invalidates every games query,
 * `['games', 'detail', 7]` only that game. `src/lib/events/invalidation.ts` maps socket
 * events onto these prefixes, so the two files have to stay in step.
 */
export const queryKeys = {
  health: (): QueryKey => ['health'],

  /**
   * The one query that survives signing out — everything else is cleared with the session,
   * and `AuthProvider` tells the two apart by this prefix.
   */
  auth: (): QueryKey => ['auth'],

  /** The analysis configuration read. Its Maia values also ride on `auth()`. */
  settings: (): QueryKey => ['settings'],

  games: (): QueryKey => ['games'],
  gameList: (query: GameQuery = {}): QueryKey => ['games', 'list', query],
  gameCards: (query: GameQuery = {}): QueryKey => ['games', 'cards', query],
  gameDetails: (): QueryKey => ['games', 'detail'],
  gameDetail: (id: number, query: GameDetailQuery = {}): QueryKey => [
    'games',
    'detail',
    id,
    query,
  ],

  library: (): QueryKey => ['library'],
  backupEstimate: (): QueryKey => ['library', 'backup-estimate'],
  /**
   * The deletion record. Under `['library']` because it is an installation-wide list
   * rather than a cut of the games — and deliberately *not* under `['games']`, whose every
   * socket event would otherwise refetch a list that only a delete or a forget can change.
   */
  deletedGames: (query: { limit?: number; offset?: number } = {}): QueryKey => [
    'library',
    'deleted-games',
    query,
  ],

  analysis: (): QueryKey => ['analysis'],
  queue: (): QueryKey => ['analysis', 'queue'],
  backfill: (tier: Tier): QueryKey => ['analysis', 'backfill', tier],
  /**
   * Under `['analysis']` on purpose: every analysis event marks it stale, so the count on
   * the fill button catches up as the runs it queued come back.
   */
  maiaFill: (): QueryKey => ['analysis', 'maia-fill'],
  /**
   * The Analysis page's whole picture. Under `['analysis']` for the same reason the fill
   * count is: every socket frame about a run makes the split, the backlog counts and the
   * estimates stale, and `invalidationsFor` already names that prefix.
   */
  coverage: (): QueryKey => ['analysis', 'coverage'],
  runs: (gameId: number, tier?: Tier): QueryKey => ['analysis', 'runs', gameId, tier ?? null],
  /** The failures, listed by status rather than by game — no game to key them under. */
  failedRuns: (limit: number): QueryKey => ['analysis', 'runs', 'failed', limit],
  run: (runId: number): QueryKey => ['analysis', 'run', runId],
  runEvals: (runId: number, window: { ply_start?: number; ply_end?: number } = {}): QueryKey => [
    'analysis',
    'run',
    runId,
    'evals',
    window,
  ],

  imports: (): QueryKey => ['import'],
  importJobs: (query: { source?: Source; limit?: number; offset?: number } = {}): QueryKey => [
    'import',
    'jobs',
    query,
  ],
  importJob: (id: number): QueryKey => ['import', 'job', id],

  explorer: (): QueryKey => ['explorer'],
  explorerTree: (query: ExplorerQuery = {}): QueryKey => ['explorer', 'tree', query],
  // Keyed by the position, not by the game: walking back and forth over the same square
  // asks once, and two games that transpose share the answer.
  explorerBook: (fen: string): QueryKey => ['explorer', 'book', fen],
  explorerPositions: (
    fen: string,
    query: { color?: 'white' | 'black'; limit?: number } = {},
  ): QueryKey => ['explorer', 'positions', fen, query],

  /**
   * The outside books — Lichess's masters and rated databases, read through
   * `/reference/*`. Their own root and emphatically not a corner of `['explorer']`: that
   * prefix is invalidated by every analysis event and every note write, and none of those
   * can change what a million strangers played in 1997. Sharing it would put a request to
   * Lichess behind every game the owner imports.
   */
  reference: (): QueryKey => ['reference'],
  referenceExplorer: (query: ReferenceExplorerQuery): QueryKey => [
    'reference',
    'explorer',
    query,
  ],
  referenceGame: (source: string, gameId: string): QueryKey => [
    'reference',
    'game',
    source,
    gameId,
  ],
  /** Under the same root, so storing a token refetches the tree that failed without one. */
  referenceToken: (): QueryKey => ['reference', 'token'],

  /**
   * The two opening repertoires. Their own root and deliberately not a corner of
   * `['explorer']`: a repertoire is what the owner *intends* to play and changes only when
   * they edit it, so no analysis event and no import may mark it stale — and one edit to
   * White's tree must not refetch Black's, which is why the colour is part of the key.
   */
  repertoire: (): QueryKey => ['repertoire'],
  repertoireTree: (color: Color): QueryKey => ['repertoire', 'tree', color],

  stats: (): QueryKey => ['stats'],
  statsDimensions: (): QueryKey => ['stats', 'dimensions'],
  statsProfile: (): QueryKey => ['stats', 'profile'],
  statsDashboard: (query: StatsDashboardQuery = {}): QueryKey => [
    'stats',
    'dashboard',
    query,
  ],
  statsDimension: (dimension: string, filters: GameFilters = {}): QueryKey => [
    'stats',
    'dimension',
    dimension,
    filters,
  ],
  worstMoments: (query: GameFilters & { days?: number; amount?: number } = {}): QueryKey => [
    'stats',
    'worst-moments',
    query,
  ],
  compare: (query: CompareQuery): QueryKey => ['stats', 'compare', query],

  engines: (): QueryKey => ['engines'],
  engineList: (enabledOnly = false): QueryKey => ['engines', 'list', enabledOnly],
  engine: (id: number): QueryKey => ['engines', 'detail', id],
  engineTiers: (): QueryKey => ['engines', 'tiers'],
  engineRoles: (): QueryKey => ['engines', 'roles'],

  runners: (): QueryKey => ['runners'],
  runnerList: (): QueryKey => ['runners', 'list'],
  runnersStatus: (): QueryKey => ['runners', 'status'],

  mcpKeys: (): QueryKey => ['mcp-keys'],

  streams: (): QueryKey => ['streams'],
  streamList: (): QueryKey => ['streams', 'list'],

  /** One entry per query text, so re-typing a query the palette already asked is instant. */
  search: (q: string, limit: number): QueryKey => ['search', q, limit],

  notes: (): QueryKey => ['notes'],
  noteList: (query: NoteQuery = {}): QueryKey => ['notes', 'list', query],
  note: (id: number): QueryKey => ['notes', 'detail', id],
  noteTags: (): QueryKey => ['notes', 'tags'],

  /**
   * Kept variations. Their own prefix rather than a corner of `['games']`: pinning a line
   * changes no game row, and every note event that names a line invalidates this alone.
   */
  lines: (): QueryKey => ['lines'],
  gameLines: (gameId: number): QueryKey => ['lines', 'game', gameId],

  maia: (): QueryKey => ['maia'],
  /**
   * One entry per position and set of levels, so stepping back into a line is instant.
   *
   * The levels are part of the key rather than a filter over one answer: a query for
   * 1500-and-1900 and a query for 1500 alone are different requests, and the second must
   * not read the first's cache entry as though it had asked for one level.
   */
  maiaPolicy: (
    fen: string,
    elos: readonly number[] | null,
    rolloutPlies: number,
  ): QueryKey => ['maia', 'policy', fen, elos, rolloutPlies],

  live: (): QueryKey => ['live'],
} as const
