import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { UseQueryResult } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import { usePageChrome } from '@/components/shell/PageChrome'
import { MOBILE_QUERY } from '@/lib/ui/media'
import type { StatsResponse } from '@/lib/api/types'

import { BlundersByPhaseCard } from './cards/BlundersByPhaseCard'
import { StatsPage } from './StatsPage'
import { exportRows, toCsv } from './kit/csv'

const useStats = vi.hoisted(() => vi.fn())
const useProfile = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/queries', () => ({ useStats, useProfile }))

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

/**
 * The window and colour controls scope every card on the page, so they have to stay
 * reachable on a phone — where the titlebar they normally live in has no room and clipped
 * them into fragments. They move into the page body instead, and the point of the branch
 * is that they *move*: two of them, one hidden, would be two controls each claiming to say
 * what the screen is showing.
 */
describe('StatsPage — where the scope controls live', () => {
  /** Renders whatever the page put in the titlebar, which the shell would otherwise draw. */
  function Titlebar() {
    const { actions } = usePageChrome()
    return <div data-testid="titlebar">{actions}</div>
  }

  /** `EventsProvider` dials one of these; nothing here cares what it says. */
  class FakeSocket {
    onopen: (() => void) | null = null
    onmessage: ((event: MessageEvent<string>) => void) | null = null
    onerror: (() => void) | null = null
    onclose: (() => void) | null = null
    close() {}
  }

  /** A `matchMedia` that answers only the mobile query, so the theme is left alone. */
  function stubViewport(mobile: boolean) {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: mobile && query === MOBILE_QUERY,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )
  }

  function draw() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <Providers client={client}>
        <MemoryRouter>
          <Titlebar />
          <StatsPage />
        </MemoryRouter>
      </Providers>,
    )
  }

  beforeEach(() => {
    // Every card stays a skeleton: this is about where two controls are rendered, not
    // about what the aggregations say.
    useStats.mockReturnValue(result({ isPending: true }))
    useProfile.mockReturnValue(result({ isPending: true }))
    vi.stubGlobal('WebSocket', FakeSocket)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('puts them in the titlebar on a desktop', () => {
    stubViewport(false)
    draw()
    const titlebar = screen.getByTestId('titlebar')
    expect(titlebar).toContainElement(screen.getByRole('group', { name: 'Window' }))
    expect(titlebar).toContainElement(screen.getByRole('group', { name: 'Colour' }))
  })

  it('brings them down into the page on a phone', () => {
    stubViewport(true)
    draw()
    const titlebar = screen.getByTestId('titlebar')
    expect(titlebar).toBeEmptyDOMElement()
    expect(screen.getByRole('group', { name: 'Window' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Colour' })).toBeInTheDocument()
  })

})
