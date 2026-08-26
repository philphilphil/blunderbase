import type { QueryKey } from '@tanstack/react-query'

import type { GameFilters, Source, Tier } from './types'
import type { CompareQuery, ExplorerQuery, GameDetailQuery, GameQuery, NoteQuery } from './endpoints'

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

  analysis: (): QueryKey => ['analysis'],
  queue: (): QueryKey => ['analysis', 'queue'],
  runs: (gameId: number, tier?: Tier): QueryKey => ['analysis', 'runs', gameId, tier ?? null],
  run: (runId: number): QueryKey => ['analysis', 'run', runId],
  runEvals: (runId: number, window: { ply_start?: number; ply_end?: number } = {}): QueryKey => [
    'analysis',
    'run',
    runId,
    'evals',
    window,
  ],

  imports: (): QueryKey => ['import'],
  importJobs: (query: { source?: Source; limit?: number } = {}): QueryKey => [
    'import',
    'jobs',
    query,
  ],
  importJob: (id: number): QueryKey => ['import', 'job', id],

  explorer: (): QueryKey => ['explorer'],
  explorerTree: (query: ExplorerQuery = {}): QueryKey => ['explorer', 'tree', query],
  explorerPositions: (
    fen: string,
    query: { color?: 'white' | 'black'; limit?: number } = {},
  ): QueryKey => ['explorer', 'positions', fen, query],

  stats: (): QueryKey => ['stats'],
  statsDimensions: (): QueryKey => ['stats', 'dimensions'],
  statsProfile: (): QueryKey => ['stats', 'profile'],
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

  notes: (): QueryKey => ['notes'],
  noteList: (query: NoteQuery = {}): QueryKey => ['notes', 'list', query],
  note: (id: number): QueryKey => ['notes', 'detail', id],
  noteTags: (): QueryKey => ['notes', 'tags'],

  live: (): QueryKey => ['live'],
} as const
