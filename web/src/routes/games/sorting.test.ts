import { describe, expect, it } from 'vitest'

import type { GameCard } from '@/lib/api/types'

import { DEFAULT_SORT, isServerOrder, nextSort, sortGames } from './sorting'

function card(over: Partial<GameCard> & { id: number }): GameCard {
  return {
    source: 'lichess',
    analyzed: false,
    deep: false,
    eval_curve: [],
    worst_moments: [],
    ...over,
  } as GameCard
}

const GAMES: GameCard[] = [
  card({
    id: 1,
    played_at: '2016-12-05T19:47:41Z',
    opponent: 'zeta',
    opponent_rating: 1500,
    analyzed: true,
    worst_moments: [{ ply: 4, win_loss: 12, classification: 'inaccuracy' }],
  }),
  card({
    id: 2,
    played_at: '2016-12-07T13:17:53Z',
    opponent: 'Alpha',
    opponent_rating: 1700,
    analyzed: true,
    deep: true,
    worst_moments: [{ ply: 8, win_loss: 58, classification: 'blunder' }],
  }),
  card({ id: 3, played_at: '2016-12-06T10:00:00Z', opponent: 'mid' }),
]

describe('nextSort', () => {
  it('flips the direction when the same column is clicked again', () => {
    expect(nextSort({ key: 'opponent', direction: 'asc' }, 'opponent')).toEqual({
      key: 'opponent',
      direction: 'desc',
    })
  })

  it('starts a new column in the direction that column reads naturally', () => {
    expect(nextSort({ key: 'opponent', direction: 'asc' }, 'worst')).toEqual({
      key: 'worst',
      direction: 'desc',
    })
    expect(nextSort({ key: 'worst', direction: 'desc' }, 'opening')).toEqual({
      key: 'opening',
      direction: 'asc',
    })
  })
})

describe('sortGames', () => {
  it('leaves the backend order untouched, so the default costs nothing', () => {
    expect(isServerOrder(DEFAULT_SORT)).toBe(true)
    expect(sortGames(GAMES, DEFAULT_SORT)).toBe(GAMES)
  })

  it('sorts names case-insensitively', () => {
    const sorted = sortGames(GAMES, { key: 'opponent', direction: 'asc' })
    expect(sorted.map((game) => game.opponent)).toEqual(['Alpha', 'mid', 'zeta'])
  })

  it('sinks rows with nothing in the column, whichever way it points', () => {
    const descending = sortGames(GAMES, { key: 'worst', direction: 'desc' })
    expect(descending.map((game) => game.id)).toEqual([2, 1, 3])
    const ascending = sortGames(GAMES, { key: 'worst', direction: 'asc' })
    expect(ascending.map((game) => game.id)).toEqual([1, 2, 3])
  })

  it('ranks tiers unanalysed < quick < deep', () => {
    expect(sortGames(GAMES, { key: 'tier', direction: 'desc' }).map((game) => game.id)).toEqual([
      2, 1, 3,
    ])
  })

  it('breaks ties by id, so the order never flickers', () => {
    const tied = [card({ id: 9, opponent: 'same' }), card({ id: 4, opponent: 'same' })]
    expect(sortGames(tied, { key: 'opponent', direction: 'asc' }).map((game) => game.id)).toEqual([
      4, 9,
    ])
  })

  it('does not mutate the array it was given', () => {
    const input = [...GAMES]
    sortGames(input, { key: 'opponent', direction: 'asc' })
    expect(input.map((game) => game.id)).toEqual([1, 2, 3])
  })
})
