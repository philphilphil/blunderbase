/**
 * Column sorting for the library table: the vocabulary, not the sorting itself.
 *
 * The sort travels to `/games?order=…&direction=…` and the backend orders the whole
 * filtered library (`backend/services/games.py: GAME_ORDERS`, which answers to exactly
 * these keys). It used to be a client pass over the rows that had been loaded so far,
 * which was honest under infinite scroll and would be a lie under paging: sorting the
 * fifty rows of page 2 answers a different question than the one a column header asks.
 */
export type SortKey =
  | 'played_at'
  | 'opponent'
  | 'opponent_rating'
  | 'color'
  | 'opening'
  | 'result'
  | 'time_control'
  | 'ply_count'
  | 'worst'
  | 'source'
  | 'tier'

export interface Sort {
  key: SortKey
  direction: 'asc' | 'desc'
}

export const DEFAULT_SORT: Sort = { key: 'played_at', direction: 'desc' }

/** Clicking a header: the same column flips, a new column starts in its natural direction. */
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key === key) {
    return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
  }
  return { key, direction: NATURAL_DIRECTION[key] }
}

/** Dates, ratings and severities read biggest-first; names and codes read A→Z. */
const NATURAL_DIRECTION: Record<SortKey, 'asc' | 'desc'> = {
  played_at: 'desc',
  opponent: 'asc',
  opponent_rating: 'desc',
  color: 'asc',
  opening: 'asc',
  result: 'asc',
  time_control: 'asc',
  ply_count: 'desc',
  worst: 'desc',
  source: 'asc',
  tier: 'desc',
}
