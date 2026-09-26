import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { queryKeys } from '@/lib/api/keys'
import type { GameCard } from '@/lib/api/types'
import { setEngineHidden } from '@/lib/ui/engineVisibility'

import { DEFAULT_SORT } from '../sorting'
import { GamesTable, type GamesTableProps } from './GamesTable'

const GAME = {
  id: 12,
  source: 'lichess',
  played_at: '2016-12-06T22:04:29Z',
  color: 'black',
  result: '1-0',
  outcome: 'loss',
  white: 'chillzone',
  black: 'phib',
  white_rating: 1224,
  black_rating: 1300,
  opponent: 'chillzone',
  opponent_rating: 1224,
  eco: 'B02',
  opening: 'Alekhine Defense',
  time_control: '600+0',
  speed: 'rapid',
  ply_count: 70,
  analyzed: true,
  requested: false,
  eval_curve: [],
  worst_moments: [{ ply: 69, win_loss: 80.28, classification: 'blunder' }],
} as unknown as GameCard

function setup(over: Partial<GamesTableProps> = {}) {
  const props: GamesTableProps = {
    games: [GAME],
    sort: DEFAULT_SORT,
    onSortChange: vi.fn(),
    selected: new Set(),
    onToggle: vi.fn(),
    onToggleAll: vi.fn(),
    onOpen: vi.fn(),
    onAnalyse: vi.fn(),
    analysing: new Set(),
    onDelete: vi.fn(),
    status: 'success',
    error: null,
    onRetry: vi.fn(),
    empty: <span>Nothing matches these filters</span>,
    ...over,
  }
  render(<GamesTable {...props} />)
  return props
}

// ⇧E is a mode that outlives a route, and it is written down — so it outlives a test, and
// a whole test file, unless it is put back.
afterEach(() => {
  setEngineHidden(false)
})

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
    expect(screen.getByRole('alert')).toHaveClass('bb-error')
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
    // The card knows a pass is done, not what it stopped at, so the chip says just that —
    // under a header that is no longer sortable, since there is one pass to rank by.
    expect(screen.getByText('Analysed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Analysis/ })).not.toBeInTheDocument()
    // The Flags cell aggregates per class: one chip carrying the glyph and the count.
    expect(screen.getByLabelText('1 blunder')).toHaveTextContent('??1')
  })

  it('names both players and sets the owner’s bold under their side', () => {
    setup()
    // The owner had black, so `phib` is the bold one and `chillzone` is not.
    expect(screen.getByText('phib')).toHaveClass('font-semibold')
    expect(screen.getByText('chillzone')).not.toHaveClass('font-semibold')
  })

  it('sets neither name bold on a game the owner did not play', () => {
    setup({ games: [{ ...GAME, is_owner_game: false, color: null } as unknown as GameCard] })
    expect(screen.getByText('phib')).not.toHaveClass('font-semibold')
    expect(screen.getByText('chillzone')).not.toHaveClass('font-semibold')
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
      games: [{ ...GAME, analyzed: false, requested: false, worst_moments: [] } as GameCard],
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

  it('walks the rows with the arrow keys and opens one with enter', async () => {
    const user = userEvent.setup()
    const props = setup({
      games: [GAME, { ...GAME, id: 13, white: 'someone' } as GameCard],
    })
    const rows = () => screen.getAllByRole('row').filter((row) => row.hasAttribute('data-games-row'))

    // The first press works before anything in the table has focus: the reader arrives on
    // the screen and presses ↓.
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(rows()[0])
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(rows()[1])
    // And never past the end.
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(rows()[1])

    await user.keyboard('{Home}')
    expect(document.activeElement).toBe(rows()[0])
    await user.keyboard('{End}')
    expect(document.activeElement).toBe(rows()[1])

    await user.keyboard('{Enter}')
    expect(props.onOpen).toHaveBeenCalledWith(13)
  })

  it('leaves the arrows to a field and to the browser’s own commands', async () => {
    const user = userEvent.setup()
    setup()
    render(<input aria-label="Somewhere to type" />)

    await user.click(screen.getByLabelText('Somewhere to type'))
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(screen.getByLabelText('Somewhere to type'))

    // ⌘↓ is the bottom of the document, not the next game.
    await user.click(document.body)
    await user.keyboard('{Meta>}{ArrowDown}{/Meta}')
    expect(document.activeElement).toBe(document.body)
  })

  it('leaves the arrows to a popover or a dialog over the table', async () => {
    const user = userEvent.setup()
    setup()
    render(
      <div role="dialog" aria-label="Add to">
        <button type="button">45-45 League</button>
      </div>,
    )

    screen.getByRole('button', { name: '45-45 League' }).focus()
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '45-45 League' }))
    await user.keyboard('{End}')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '45-45 League' }))
  })

  it('deletes one game from its own row', async () => {
    const props = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Delete game 12' }))
    expect(props.onDelete).toHaveBeenCalledWith(12)
    // The row's own delete must not also open the game.
    expect(props.onOpen).not.toHaveBeenCalled()
  })
})

describe('GamesTable source chip', () => {
  it('links to the game on its site without opening the row', async () => {
    const props = setup({
      games: [{ ...GAME, url: 'https://lichess.org/abcd1234' } as GameCard],
    })
    const link = screen.getByRole('link', { name: /Lichess/ })
    expect(link).toHaveAttribute('href', 'https://lichess.org/abcd1234')
    expect(link).toHaveAttribute('target', '_blank')
    await userEvent.click(link)
    expect(props.onOpen).not.toHaveBeenCalled()
  })

  it('is a plain chip on a game that has no page anywhere', () => {
    setup()
    expect(screen.queryByRole('link', { name: /Lichess/ })).not.toBeInTheDocument()
    expect(screen.getByText('Lichess')).toBeInTheDocument()
  })

  it('says the source as plain text rather than as a framed chip', () => {
    setup({ games: [{ ...GAME, url: 'https://lichess.org/abcd1234' } as GameCard] })
    // Routine metadata down a column is words, not fifty bordered badges.
    expect(screen.getByRole('link', { name: /Lichess/ }).className).not.toMatch(/\bborder\b/)
    expect(screen.getByText('Analysed').className).not.toMatch(/\bborder\b/)
  })
})

describe('GamesTable selection', () => {
  it('lights a selected row with the one selected state', () => {
    setup({ selected: new Set([12]) })
    const row = screen.getAllByRole('row').find((node) => node.hasAttribute('data-games-row'))!
    expect(row).toHaveAttribute('aria-selected', 'true')
    expect(row).toHaveClass('bg-selected')
    // Metadata that reads dim on a plain row rises on the selected blue, where dim is sub-AA.
    expect(screen.getByText('B02')).toHaveClass('text-soft')
    expect(screen.getByText('Analysed')).toHaveClass('text-soft')
  })

  it('keeps a requested run in its purple on a selected row', () => {
    setup({ games: [{ ...GAME, requested: true } as GameCard], selected: new Set([12]) })
    // The exception stays the exception: only the routine dim metadata rises to soft.
    const cell = screen.getByText('Analysed')
    expect(cell).toHaveClass('text-deep')
    expect(cell).not.toHaveClass('text-soft')
  })
})

describe('GamesTable collection chips', () => {
  function withCollections(games: GameCard[]) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(queryKeys.collectionList(), {
      collections: [
        { id: 3, name: '45-45 League', color: 'accent', description: null, rule: null, game_count: 8, created_at: '2026-09-01T00:00:00Z' },
        { id: 4, name: 'Tough losses', color: 'way-back', description: null, rule: null, game_count: 2, created_at: '2026-09-01T00:00:00Z' },
      ],
    })
    const onOpen = vi.fn()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <GamesTable
            games={games}
            sort={DEFAULT_SORT}
            onSortChange={vi.fn()}
            selected={new Set()}
            onToggle={vi.fn()}
            onToggleAll={vi.fn()}
            onOpen={onOpen}
            onAnalyse={vi.fn()}
            analysing={new Set()}
            onDelete={vi.fn()}
            status="success"
            error={null}
            onRetry={vi.fn()}
            empty={null}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    return { onOpen }
  }

  it('shows the collections a game is in, as links that do not open the row', async () => {
    const { onOpen } = withCollections([{ ...GAME, collections: [4, 3] } as GameCard])
    // One copy per breakpoint (the Flags cell and the phone card's date line); jsdom has
    // no media queries, so both are in the tree.
    const league = screen.getAllByRole('link', { name: /45-45 League/ })
    expect(league).toHaveLength(2)
    expect(league[0]).toHaveAttribute('href', '/games?collection=3')
    expect(screen.getAllByRole('link', { name: /Tough losses/ })).toHaveLength(2)
    await userEvent.click(league[0]!)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('leaves Enter on a chip to the chip rather than opening the game', async () => {
    const { onOpen } = withCollections([{ ...GAME, collections: [3] } as GameCard])
    const chip = screen.getAllByRole('link', { name: /45-45 League/ })[0]!
    chip.focus()
    await userEvent.keyboard('{Enter}')
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('draws nothing for a game in none', () => {
    withCollections([{ ...GAME, collections: [] } as GameCard])
    expect(screen.queryByRole('link', { name: /League/ })).not.toBeInTheDocument()
  })
})

describe('GamesTable with one game imported with its engine held back', () => {
  it('keeps the Worst column and quietens only that row', () => {
    const quiet = { ...GAME, id: 13, white: 'quietone', engine_hidden: true } as GameCard
    setup({ games: [GAME, quiet] })

    // The column is still there — ⇧E is off — and the ordinary row reads as ever.
    expect(screen.getByRole('button', { name: /Worst/ })).toBeInTheDocument()
    expect(screen.getAllByText('−80%')).toHaveLength(1)
    expect(screen.getAllByLabelText('1 blunder')).toHaveLength(1)
    // The held-back row says why it is quiet, in the cell the number would be in.
    expect(
      screen.getByRole('img', { name: 'Engine hidden on this game until you show it' }),
    ).toBeInTheDocument()
    expect(screen.getByText('quietone')).toBeInTheDocument()
  })
})

describe('GamesTable with the engine hidden', () => {
  it('drops the Worst column and the flag badges, and keeps the game', () => {
    setEngineHidden(true)
    setup()

    // The two things on a row that are the engine's verdict on how it was played.
    expect(screen.queryByRole('button', { name: /Worst/ })).not.toBeInTheDocument()
    expect(screen.queryByText('−80%')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('1 blunder')).not.toBeInTheDocument()

    // Everything that is the game, or the app's own bookkeeping about it, stays.
    expect(screen.getByText('chillzone')).toBeInTheDocument()
    expect(screen.getByText('Alekhine Defense')).toBeInTheDocument()
    expect(screen.getByText('Analysed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete game 12' })).toBeInTheDocument()
  })

  it('still offers to analyse a game nothing has looked at', async () => {
    setEngineHidden(true)
    const props = setup({
      games: [{ ...GAME, analyzed: false, requested: false, worst_moments: [] } as GameCard],
    })
    // The whole point of reading a game unaided is checking yourself against a pass
    // afterwards, so the way to queue one never goes away.
    await userEvent.click(screen.getByRole('button', { name: 'analyse' }))
    expect(props.onAnalyse).toHaveBeenCalledWith(12)
  })

  it('lays the header, the rows and the skeleton out over the same columns', () => {
    setEngineHidden(true)
    setup({ status: 'pending', games: [] })
    const header = screen.getAllByRole('row')[0]
    const skeletonRow = screen.getByTestId('games-loading').firstElementChild!
    expect(skeletonRow.children).toHaveLength(header.children.length)
  })
})
