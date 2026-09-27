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
  | 'white'
  | 'white_rating'
  | 'black'
  | 'black_rating'
  | 'opening'
  | 'result'
  | 'time_control'
  | 'ply_count'
  | 'worst'
  | 'source'
// No `tier`: it ranked games by which pass they had, and with one pass there is nothing left
// to rank. The backend still reads an old `order=tier` as the default order.

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
  white: 'asc',
  white_rating: 'desc',
  black: 'asc',
  black_rating: 'desc',
  opening: 'asc',
  result: 'asc',
  time_control: 'asc',
  ply_count: 'desc',
  worst: 'desc',
  source: 'asc',
}

const SORT_KEYS = Object.keys(NATURAL_DIRECTION) as SortKey[]

/**
 * The sort as the library's own URL carries it (`/games?order=black&direction=desc`), in the
 * API's words. It rides in the address beside the filters so that Back from a game returns
 * to the list as it was sorted, which state held in the page could not: the page unmounts
 * the moment a row is opened. A key or direction that is not one reads as the default.
 */
export function sortFromParams(params: URLSearchParams): Sort {
  const order = params.get('order')
  const key = SORT_KEYS.includes(order as SortKey) ? (order as SortKey) : DEFAULT_SORT.key
  const direction = params.get('direction')
  return {
    key,
    direction: direction === 'asc' || direction === 'desc' ? direction : NATURAL_DIRECTION[key],
  }
}

/**
 * Write `sort` into `params`, leaving out whatever is the default — the default column, and
 * a column's natural direction — so an unsorted library's address stays `/games`.
 */
export function writeSortParams(params: URLSearchParams, sort: Sort): void {
  params.delete('order')
  params.delete('direction')
  if (sort.key !== DEFAULT_SORT.key) params.set('order', sort.key)
  if (sort.direction !== NATURAL_DIRECTION[sort.key]) params.set('direction', sort.direction)
}
