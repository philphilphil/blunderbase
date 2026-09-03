import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
const useStatsDashboard = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/queries', () => ({ useStats, useProfile, useStatsDashboard }))

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
  it('shows a skeleton while the aggregation is in flight', () => {
    render(<BlundersByPhaseCard query={result({ isPending: true })} />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('shows the failure and a way out when the request fails', () => {
    render(
      <BlundersByPhaseCard
        query={result({ isError: true, error: new Error('backend unreachable') })}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('backend unreachable')
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('says so when the window holds no analysed moves', () => {
    render(
      <BlundersByPhaseCard
        query={result({
          data: {
            dimension: 'blunders_by_phase',
            buckets: [],
            total: { key: 'total', moves: 0 },
          },
        })}
      />,
    )
    expect(screen.getByTestId('empty')).toHaveTextContent(/no analysed moves/i)
  })

  it('draws every phase, its count and its share of the blunders', () => {
    render(<BlundersByPhaseCard query={result({ data: PHASES })} />)

    expect(screen.getByText('31 blunders')).toBeInTheDocument()
    expect(screen.getByText('Middlegame')).toBeInTheDocument()
    // 28 of 31 blunders, the share the meter fills to.
    expect(screen.getByText('90%')).toBeInTheDocument()
    expect(screen.getByText('10%')).toBeInTheDocument()
    expect(screen.getByText('0%')).toBeInTheDocument()
  })

  it('names the worst phase in the footer', () => {
    render(<BlundersByPhaseCard query={result({ data: PHASES })} />)
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
 * The filter bar scopes every card on the page, so it belongs on the page — under the
 * header it qualifies, at every width. It used to live in the titlebar on a desktop and
 * come down into the body on a phone; nobody looked at it up there, and a control that
 * moves depending on the window is a control that has to be found twice.
 *
 * The titlebar stand-in stays, because "not in the chrome" is half of what is being
 * asserted.
 */
describe('StatsPage — the filter bar', () => {
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
    useStatsDashboard.mockReturnValue(result({ isPending: true }))
    vi.stubGlobal('WebSocket', FakeSocket)
  })

  afterEach(() => vi.unstubAllGlobals())

  it.each([
    ['a desktop', false],
    ['a phone', true],
  ])('draws every filter on the page and nothing in the titlebar on %s', (_name, mobile) => {
    stubViewport(mobile)
    draw()

    expect(screen.getByTestId('titlebar')).toBeEmptyDOMElement()
    expect(screen.getByRole('group', { name: 'Window' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Colour' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'bullet' })).toBeInTheDocument()
  })

  it('loads the page through one anchored dashboard query', () => {
    stubViewport(false)
    draw()

    expect(useStatsDashboard).toHaveBeenCalledWith({ days: 90 })
    expect(useProfile).not.toHaveBeenCalled()
  })

  it('asks for no speeds at all until one is switched off', async () => {
    stubViewport(false)
    draw()

    // Every chip on is the same question as no speed filter, and it is sent as none.
    expect(useStatsDashboard).toHaveBeenCalledWith({ days: 90 })

    await userEvent.click(screen.getByRole('button', { name: 'bullet' }))

    expect(useStatsDashboard).toHaveBeenLastCalledWith({
      days: 90,
      speed: ['blitz', 'rapid', 'classical', 'correspondence'],
    })
    expect(screen.getByRole('button', { name: 'bullet' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('refuses to leave the bar with no speed on it', async () => {
    stubViewport(false)
    draw()

    for (const speed of ['bullet', 'blitz', 'rapid', 'classical', 'correspondence']) {
      await userEvent.click(screen.getByRole('button', { name: speed }))
    }

    // The last chip cannot be switched off: an empty set counts no games, and a page
    // answering "nothing here" because of it reads as broken rather than as filtered.
    expect(useStatsDashboard).toHaveBeenLastCalledWith({ days: 90, speed: ['correspondence'] })
  })
})
