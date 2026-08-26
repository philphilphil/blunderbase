import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { GameCard } from '@/lib/api/types'

import { DEFAULT_SORT } from '../sorting'
import { GamesTable, type GamesTableProps } from './GamesTable'

const GAME = {
  id: 12,
  source: 'lichess',
  played_at: '2016-12-06T22:04:29Z',
  color: 'black',
  result: '1-0',
  outcome: 'loss',
  opponent: 'chillzone',
  opponent_rating: 1224,
  eco: 'B02',
  opening: 'Alekhine Defense',
  time_control: '600+0',
  speed: 'rapid',
  ply_count: 70,
  analyzed: true,
  deep: false,
  eval_curve: [],
  worst_moments: [{ ply: 69, win_loss: 80.28, classification: 'blunder' }],
} as unknown as GameCard

function setup(over: Partial<GamesTableProps> = {}) {
  const props: GamesTableProps = {
    games: [GAME],
    height: '2.125rem',
    sort: DEFAULT_SORT,
    onSortChange: vi.fn(),
    selected: new Set(),
    onToggle: vi.fn(),
    onToggleAll: vi.fn(),
    onOpen: vi.fn(),
    onAnalyse: vi.fn(),
    analysing: new Set(),
    status: 'success',
    error: null,
    onRetry: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    onLoadMore: vi.fn(),
    empty: <span>Nothing matches these filters</span>,
    ...over,
  }
  render(<GamesTable {...props} />)
  return props
}

describe('GamesTable states', () => {
  it('shows skeleton rows while the first page is in flight', () => {
    setup({ status: 'pending', games: [] })
    expect(screen.getByTestId('games-loading')).toBeInTheDocument()
    expect(screen.queryByText('chillzone')).not.toBeInTheDocument()
  })

  it('shows the backend’s message and a retry when the query fails', async () => {
    const props = setup({
      status: 'error',
      games: [],
      error: new Error('no game with id 12'),
    })
    expect(screen.getByText('no game with id 12')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(props.onRetry).toHaveBeenCalledOnce()
  })

  it('shows the caller’s empty state when the query succeeded with nothing', () => {
    setup({ games: [] })
    expect(screen.getByText('Nothing matches these filters')).toBeInTheDocument()
  })
})

describe('GamesTable rows', () => {
  it('renders a game across the design’s columns', () => {
    setup()
    expect(screen.getByText('chillzone')).toBeInTheDocument()
    expect(screen.getByText('1224')).toBeInTheDocument()
    expect(screen.getByText('B02')).toBeInTheDocument()
    expect(screen.getByText('10+0')).toBeInTheDocument()
    // 70 plies is 35 whole moves; the worst moment gave away 80 percentage points.
    expect(screen.getByText('35')).toBeInTheDocument()
    expect(screen.getByText('−80%')).toBeInTheDocument()
    expect(screen.getByText('Lichess')).toBeInTheDocument()
    expect(screen.getByText('Quick')).toBeInTheDocument()
    // The Flags cell aggregates per class: one chip carrying the glyph and the count.
    expect(screen.getByLabelText('1 blunder')).toHaveTextContent('??1')
  })

  it('opens the game on a row click and selects on the checkbox instead', async () => {
    const props = setup()
    await userEvent.click(screen.getByText('chillzone'))
    expect(props.onOpen).toHaveBeenCalledWith(12)

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select game 12' }))
    expect(props.onToggle).toHaveBeenCalledOnce()
    // The checkbox must not also open the game.
    expect(props.onOpen).toHaveBeenCalledOnce()
  })

  it('offers to analyse a game nothing has looked at', async () => {
    const props = setup({
      games: [{ ...GAME, analyzed: false, deep: false, worst_moments: [] } as GameCard],
    })
    await userEvent.click(screen.getByRole('button', { name: 'analyse' }))
    expect(props.onAnalyse).toHaveBeenCalledWith(12)
    expect(screen.getByText('Unanalysed')).toBeInTheDocument()
  })

  it('flips the sort when a column header is clicked', async () => {
    const props = setup()
    await userEvent.click(screen.getByRole('button', { name: /Date/ }))
    expect(props.onSortChange).toHaveBeenCalledWith({ key: 'played_at', direction: 'asc' })
  })

  it('offers a manual load-more when there is another page', async () => {
    const props = setup({ hasNextPage: true })
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(props.onLoadMore).toHaveBeenCalledOnce()
  })
})

/** jsdom has none, so the sentinel is driven by hand. */
class FakeObserver {
  static instances: FakeObserver[] = []
  callback: IntersectionObserverCallback
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    FakeObserver.instances.push(this)
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
  /** The sentinel scrolling into the root margin. */
  enter() {
    this.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    )
  }
}

describe('GamesTable infinite scroll', () => {
  afterEach(() => {
    FakeObserver.instances = []
    vi.unstubAllGlobals()
  })

  function observe(over: Partial<GamesTableProps> = {}) {
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    const props = setup({ hasNextPage: true, ...over })
    return { props, observer: FakeObserver.instances.at(-1)! }
  }

  it('asks for the next page when the sentinel comes into view', () => {
    const { props, observer } = observe()
    observer.enter()
    expect(props.onLoadMore).toHaveBeenCalledOnce()
  })

  it('does not restart a page that is already in flight', () => {
    // `fetchNextPage` cancels and reissues the request it is already running, so scroll
    // jitter over the sentinel would keep the next page from ever landing.
    const { props, observer } = observe({ isFetchingNextPage: true })
    observer.enter()
    observer.enter()
    expect(props.onLoadMore).not.toHaveBeenCalled()
  })
})
