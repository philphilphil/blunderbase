import { render, screen } from '@testing-library/react'
import type { UseQueryResult } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GameCardList } from '@/lib/api/types'

import { RecentGamesList } from './RecentGamesList'

const useGameCards = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/queries', () => ({ useGameCards }))

function result(state: Partial<UseQueryResult<GameCardList, Error>>) {
  return {
    data: undefined,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...state,
  }
}

const CARDS: GameCardList = {
  total: 15,
  limit: 12,
  offset: 0,
  games: [
    {
      id: 10,
      source: 'lichess',
      outcome: 'loss',
      opponent: 'jazzoz',
      opponent_rating: 1272,
      eco: 'B02',
      opening: 'Alekhine Defense: Maróczy Variation',
      analyzed: true,
      deep: true,
      eval_curve: [],
      worst_moments: [{ ply: 23, san: 'Ba6', classification: 'blunder', win_loss: 44.2 }],
    },
    {
      id: 11,
      source: 'chesscom',
      outcome: 'win',
      opponent: 'pawnshop_hero',
      opponent_rating: 1690,
      eco: 'B22',
      opening: 'Sicilian, Alapin',
      analyzed: false,
      deep: false,
      eval_curve: [],
      worst_moments: [],
    },
  ],
}

function draw(state: Partial<UseQueryResult<GameCardList, Error>>) {
  useGameCards.mockReturnValue(result(state))
  return render(
    <MemoryRouter>
      <RecentGamesList />
    </MemoryRouter>,
  )
}

describe('RecentGamesList — component states (design 2a rail)', () => {
  beforeEach(() => useGameCards.mockReset())

  it('shows placeholder rows while the page is in flight', () => {
    draw({ isPending: true })
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('reports a failed fetch instead of an empty list', () => {
    draw({ isError: true, error: new Error('fetch failed') })
    expect(screen.getByRole('alert')).toHaveTextContent('fetch failed')
  })

  it('offers the import when the database is empty', () => {
    draw({ data: { total: 0, limit: 12, offset: 0, games: [] } })
    expect(screen.getByTestId('empty')).toHaveTextContent(/no games in the database/i)
    expect(screen.getByRole('link', { name: /import games/i })).toHaveAttribute('href', '/import')
  })

  it('draws each game as a row with its result, opponent and worst swing', () => {
    draw({ data: CARDS })

    const game = screen.getByRole('link', { name: /jazzoz/ })
    expect(game).toHaveAttribute('href', '/games/10')
    expect(game).toHaveTextContent('L')
    expect(game).toHaveTextContent('1272')
    // 44.2 win percentage points given away, written the way the move list writes it.
    expect(game).toHaveTextContent('−44.2%')
    // Opening/source/tier moved off the row and into the tooltip.
    expect(game).toHaveAttribute('title', expect.stringContaining('B02'))
    expect(game).toHaveAttribute('title', expect.stringContaining('deep'))
  })

  it('marks a game no engine has been over as unanalysed, with no swing to show', () => {
    draw({ data: CARDS })
    const game = screen.getByRole('link', { name: /pawnshop_hero/ })
    expect(game).toHaveTextContent('W')
    expect(game).toHaveTextContent('—')
    expect(game).toHaveAttribute('title', expect.stringContaining('unanalysed'))
  })

  it('links the whole library, counted', () => {
    draw({ data: CARDS })
    expect(screen.getByRole('link', { name: 'all 15' })).toHaveAttribute('href', '/games')
  })
})
