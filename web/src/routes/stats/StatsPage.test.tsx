import { render, screen } from '@testing-library/react'
import type { UseQueryResult } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { StatsResponse } from '@/lib/api/types'

import { BlundersByPhaseCard } from './cards/BlundersByPhaseCard'
import { exportRows, toCsv } from './kit/csv'

const useStats = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/queries', () => ({ useStats }))

/** Just the fields the cards read off a query result. */
function result(state: Partial<UseQueryResult<StatsResponse, Error>>) {
  return {
    data: undefined,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...state,
  }
}

const PHASES: StatsResponse = {
  dimension: 'blunders_by_phase',
  buckets: [
    {
      key: 'opening',
      moves: 174,
      evaluated: 174,
      inaccuracy: 21,
      mistake: 3,
      blunder: 3,
      blunder_rate: 0.0172,
    },
    {
      key: 'middlegame',
      moves: 270,
      evaluated: 270,
      inaccuracy: 28,
      mistake: 10,
      blunder: 28,
      blunder_rate: 0.1037,
    },
    {
      key: 'endgame',
      moves: 23,
      evaluated: 23,
      inaccuracy: 0,
      mistake: 0,
      blunder: 0,
      blunder_rate: 0,
    },
  ],
  total: {
    key: 'total',
    moves: 467,
    evaluated: 467,
    blunder: 31,
    blunder_rate: 0.0664,
    avg_win_loss: 6.9144,
  },
}

describe('BlundersByPhaseCard — component states (design 1c)', () => {
  beforeEach(() => useStats.mockReset())

  it('shows a skeleton while the aggregation is in flight', () => {
    useStats.mockReturnValue(result({ isPending: true }))
    render(<BlundersByPhaseCard filters={{}} />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('shows the failure and a way out when the request fails', () => {
    useStats.mockReturnValue(result({ isError: true, error: new Error('backend unreachable') }))
    render(<BlundersByPhaseCard filters={{}} />)
    expect(screen.getByRole('alert')).toHaveTextContent('backend unreachable')
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('says so when the window holds no analysed moves', () => {
    useStats.mockReturnValue(
      result({
        data: {
          dimension: 'blunders_by_phase',
          buckets: [],
          total: { key: 'total', moves: 0 },
        },
      }),
    )
    render(<BlundersByPhaseCard filters={{}} />)
    expect(screen.getByTestId('empty')).toHaveTextContent(/no analysed moves/i)
  })

  it('draws every phase, its count and its share of the blunders', () => {
    useStats.mockReturnValue(result({ data: PHASES }))
    render(<BlundersByPhaseCard filters={{}} />)

    expect(screen.getByText('31 blunders')).toBeInTheDocument()
    expect(screen.getByText('Middlegame')).toBeInTheDocument()
    // 28 of 31 blunders, the share the meter fills to.
    expect(screen.getByText('90%')).toBeInTheDocument()
    expect(screen.getByText('10%')).toBeInTheDocument()
    expect(screen.getByText('0%')).toBeInTheDocument()
  })

  it('names the worst phase in the footer', () => {
    useStats.mockReturnValue(result({ data: PHASES }))
    render(<BlundersByPhaseCard filters={{}} />)
    expect(screen.getByText(/90% of them happen in the middlegame/i)).toBeInTheDocument()
  })
})

describe('CSV export', () => {
  it('quotes only what has to be quoted', () => {
    expect(
      toCsv([
        ['a', 'b'],
        ['plain', 1],
      ]),
    ).toBe('a,b\nplain,1')
    expect(toCsv([['with,comma', 'with"quote']])).toBe('"with,comma","with""quote"')
  })

  it('flattens every bucket of every dimension, totals included', () => {
    const rows = exportRows([{ dimension: 'blunders_by_phase', data: PHASES }])
    expect(rows[0]).toEqual(['dimension', 'bucket', 'field', 'value'])
    expect(rows).toContainEqual(['blunders_by_phase', 'middlegame', 'blunder', 28])
    expect(rows).toContainEqual(['blunders_by_phase', 'total', 'moves', 467])
    // `key` is the bucket name, not a measurement.
    expect(rows.some((row) => row[2] === 'key')).toBe(false)
  })

  it('skips a dimension that has not loaded', () => {
    expect(exportRows([{ dimension: 'rating_trend', data: undefined }])).toHaveLength(1)
  })
})
