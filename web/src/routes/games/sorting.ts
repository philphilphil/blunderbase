/**
 * Column sorting for the library table.
 *
 * `/games` has one order and no sort parameter: newest first (`services.games.search_games`).
 * That order is the default here and costs nothing. Any other order is applied to the rows
 * that have actually been fetched — with infinite scroll that is "everything loaded so
 * far", which the footer says out loud rather than pretending the whole database moved.
 */
import type { GameCard } from '@/lib/api/types'

import { tierRank, worstDrop } from './format'

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

/** Whether this sort is the one the backend already returns, so no client pass is needed. */
export function isServerOrder(sort: Sort): boolean {
  return sort.key === DEFAULT_SORT.key && sort.direction === DEFAULT_SORT.direction
}

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

type Value = string | number | null

function valueOf(game: GameCard, key: SortKey): Value {
  switch (key) {
    case 'played_at':
      return game.played_at ? Date.parse(game.played_at) : null
    case 'opponent':
      return game.opponent?.toLowerCase() ?? null
    case 'opponent_rating':
      return game.opponent_rating ?? null
    case 'color':
      return game.color ?? null
    case 'opening':
      return game.opening?.toLowerCase() ?? game.eco?.toLowerCase() ?? null
    case 'result':
      return game.outcome ?? game.result ?? null
    case 'time_control':
      return game.time_control ?? game.speed ?? null
    case 'ply_count':
      return game.ply_count ?? null
    case 'worst':
      return worstDrop(game)
    case 'source':
      return game.source
    case 'tier':
      return tierRank(game)
  }
}

/**
 * A stable sort of the loaded rows. A row with nothing in the sorted column sinks to the
 * bottom whichever way the column points — an unanalysed game is not "the least bad".
 */
export function sortGames(games: GameCard[], sort: Sort): GameCard[] {
  if (isServerOrder(sort)) return games
  const sign = sort.direction === 'asc' ? 1 : -1
  return [...games].sort((left, right) => {
    const a = valueOf(left, sort.key)
    const b = valueOf(right, sort.key)
    if (a === null && b === null) return left.id - right.id
    if (a === null) return 1
    if (b === null) return -1
    if (a === b) return left.id - right.id
    return (a < b ? -1 : 1) * sign
  })
}
