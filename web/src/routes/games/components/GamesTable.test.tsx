import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { queryKeys } from '@/lib/api/keys'
import type { GameCard, GameColumns } from '@/lib/api/types'
import { GAME_COLUMNS_KEY } from '@/lib/games/demoColumns'
import { setEngineHidden } from '@/lib/ui/engineVisibility'

import { DEFAULT_SORT } from '../sorting'
import { columnsFor, defaultArrangement, type LaidColumn } from './columns'
import { GameRow } from './GameRow'
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

function setup(over: Partial<GamesTableProps> = {}, columns?: GameColumns) {
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
  // The table asks for the collections list (it drops its Collections column without any);
  // an empty client answers "none" by never answering.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  // The owner's column choice, as the server would have answered it.
  if (columns) client.setQueryData(queryKeys.gameColumns(), columns)
  render(
    <QueryClientProvider client={client}>
      <GamesTable {...props} />
    </QueryClientProvider>,
  )
  return props
}

// ⇧E is a mode that outlives a route, and it is written down — so it outlives a test, and
// a whole test file, unless it is put back. So is this browser's copy of the column choice.
afterEach(() => {
  setEngineHidden(false)
  localStorage.removeItem(GAME_COLUMNS_KEY)
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
    // In the Analysis column, in place of "Unanalysed", and a copy in the phone card's Flags
    // slot (that card has no Analysis column); jsdom has no media queries, so both are here.
    const buttons = screen.getAllByRole('button', { name: 'Analyse' })
    expect(buttons).toHaveLength(2)
    expect(buttons[0]!.closest('[data-col]')).toHaveAttribute('data-col', 'tier')
    expect(buttons[1]!.parentElement).toHaveClass('md:hidden')
    expect(buttons[1]!.closest('[data-col]')).toHaveAttribute('data-col', 'flags')
    await userEvent.click(buttons[0]!)
    expect(props.onAnalyse).toHaveBeenCalledWith(12)
    expect(screen.queryByText('Unanalysed')).not.toBeInTheDocument()
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

describe('GameRow cells', () => {
  /** The table's columns cut after `id`, which becomes the flexible last one, as `columnsFor` makes it. */
  function lastIs(id: string): LaidColumn[] {
    const all = columnsFor(defaultArrangement(), false, false)
    const cut = all.slice(0, all.findIndex((column) => column.id === id) + 1)
    return cut.map((column, index) => ({ ...column, last: index === cut.length - 1 }))
  }

  function row(columns: readonly LaidColumn[]) {
    render(
      <GameRow
        game={GAME}
        selected={false}
        onToggle={vi.fn()}
        onOpen={vi.fn()}
        onAnalyse={vi.fn()}
        onDelete={vi.fn()}
        analysing={false}
        columns={columns}
        collectionNames={new Map()}
      />,
    )
    return screen.getByRole('row')
  }

  it('draws one cell per column, in the column list’s order', () => {
    const columns = columnsFor(defaultArrangement(), false, false)
    row(columns)
    expect(screen.getAllByRole('cell').map((cell) => cell.getAttribute('data-col'))).toEqual(
      columns.map((column) => column.id),
    )
  })

  it('puts the delete at the end of the table’s last cell', () => {
    setup()
    // Without collections, Notes is last.
    const remove = screen.getByRole('button', { name: 'Delete game 12' })
    expect(remove.closest('[data-col]')).toHaveAttribute('data-col', 'notes')
    expect(screen.getByTestId('game-note-count')).toContainElement(remove)
  })

  it('moves the delete to whichever column is last', () => {
    row(lastIs('opening'))
    const remove = screen.getByRole('button', { name: 'Delete game 12' })
    expect(remove.closest('[data-col]')).toHaveAttribute('data-col', 'opening')
    // The title stays on the span holding the words, not on the cell around the bin.
    expect(screen.getByText('Alekhine Defense')).toHaveAttribute('title', 'Alekhine Defense · B02')
  })

  it('keeps the phone card’s Flags slot intact when Flags is last', () => {
    const cell = row(lastIs('flags')).querySelector<HTMLElement>('[data-col="flags"]')!
    expect(cell).toHaveAttribute('role', 'cell')
    // The bin's line is a desktop layout only: on a phone the cell is a plain box in the
    // card's grid, and its inner span carries the cell's own layout as when it is not last.
    expect(cell).toHaveClass('md:flex', 'max-md:col-start-6', 'max-md:row-start-2')
    expect(cell).not.toHaveClass('flex')
    const inner = cell.firstElementChild!
    expect(inner).toHaveClass('flex', 'items-center', 'gap-1', 'overflow-hidden', 'max-md:justify-end')
    // The badges are the inner span's own flex items, and the bin sits after it.
    expect(screen.getByLabelText('1 blunder').parentElement).toBe(inner)
    expect(cell.lastElementChild).toBe(screen.getByRole('button', { name: 'Delete game 12' }))
    expect(cell.lastElementChild).toHaveClass('max-md:hidden')
  })

  it('keeps a last name cut short and aligned in the phone card', () => {
    // On a phone the inner span is neither a grid nor a flex item, so it has to be a block
    // of its own: an inline span can neither truncate a long name nor align a figure.
    const white = row(lastIs('white')).querySelector<HTMLElement>('[data-col="white"]')!
    const name = white.firstElementChild!
    expect(name).toHaveClass('block', 'truncate')
    expect(name).not.toHaveClass('inline')
    cleanup()
    const worst = row(lastIs('worst')).querySelector<HTMLElement>('[data-col="worst"]')!
    expect(worst.firstElementChild).toHaveClass('block', 'text-right')
    cleanup()
    // A renderer's own flex box still wins over the block.
    const flags = row(lastIs('flags')).querySelector<HTMLElement>('[data-col="flags"]')!
    expect(flags.firstElementChild).toHaveClass('flex')
    expect(flags.firstElementChild).not.toHaveClass('block')
  })
})

describe('GamesTable layout', () => {
  /** The grid between the scroller and the rows, which carries the track list. */
  function grid() {
    return screen.getByRole('table', { name: 'Games' }).firstElementChild as HTMLElement
  }

  it('lays the columns on one grid of content-sized tracks, the last taking the rest', () => {
    setup()
    // Without collections Notes is last: 7rem plus the row's 1.25rem padding.
    expect(grid().getAttribute('style')).toMatch(/grid-template-columns:[^;]*auto minmax\(8\.25rem, 1fr\)/)
    // No cell is handed a width any more; each sizes its track.
    for (const cell of screen.getAllByRole('cell')) expect(cell.getAttribute('style')).toBeNull()
  })

  it('makes the header, the body, the rows and the skeleton subgrids of it', () => {
    setup()
    const [header, row] = screen.getAllByRole('row')
    for (const node of [header!, screen.getByRole('rowgroup'), row!]) {
      expect(node).toHaveClass('md:grid-cols-subgrid', 'md:col-span-full')
    }
    // The header stays put in the one scroller while the rows go under it — for the whole
    // scroll only if its parent, the grid, is never shrunk to the scroller's height.
    expect(header).toHaveClass('sticky', 'top-0')
    expect(grid()).toHaveClass('flex-none')
  })

  it('keeps the skeleton’s wrapper a subgrid level, so its rows are not squeezed into one track', () => {
    setup({ status: 'pending', games: [] })
    const wrapper = screen.getByTestId('games-loading')
    expect(wrapper).toHaveAttribute('aria-busy')
    expect(wrapper).toHaveClass('md:grid-cols-subgrid', 'md:col-span-full')
    expect(wrapper.firstElementChild).toHaveClass('md:grid-cols-subgrid')
  })

  it('scrolls in one place only: nothing between the scroller and the cells has overflow', () => {
    // A subgrid that is also a scroll container falls out of line in WebKit.
    setup()
    const table = screen.getByRole('table', { name: 'Games' })
    expect(table).toHaveClass('overflow-auto')
    const levels = [grid(), ...screen.getAllByRole('row'), screen.getByRole('rowgroup')]
    for (const node of levels) expect(node.className).not.toMatch(/overflow-/)
  })

  it('keeps a blank the size of the delete after the last head, over the row’s bin', () => {
    setup()
    const heads = screen.getAllByRole('columnheader')
    const last = heads.at(-1)!
    expect(last).toHaveTextContent('Notes')
    expect(last.lastElementChild).toHaveAttribute('aria-hidden')
    expect(last.lastElementChild).toHaveClass('size-6', 'max-md:hidden')
  })

  it('puts the whole clock in the Time cell’s title, since a long one is cut short', () => {
    setup({ games: [{ ...GAME, time_control: '1/259200' } as GameCard] })
    const cell = screen.getAllByRole('cell').find((node) => node.dataset.col === 'time')!
    expect(cell).toHaveAttribute('title', cell.textContent!)
  })
})

describe('GamesTable with the owner’s column choice', () => {
  const cellOf = (id: string) => screen.queryAllByRole('cell').find((node) => node.dataset.col === id)
  const heads = () => screen.getAllByRole('columnheader').map((head) => head.textContent)

  it('lays the columns out in the chosen order', () => {
    setup({}, { order: ['opening', 'white', 'date'], hidden: [] })
    // The ones the choice leaves out are new to it and slot in after their predecessors;
    // the three it names keep their order.
    const order = screen.getAllByRole('cell').map((cell) => cell.dataset.col)
    expect(order.indexOf('opening')).toBeLessThan(order.indexOf('white'))
    expect(order.indexOf('white')).toBeLessThan(order.indexOf('date'))
    expect(heads()[0]).toBe('Opening')
  })

  it('draws every column, hiding none, when nothing is stored', () => {
    setup({}, { order: [], hidden: [] })
    expect(heads()).toContain('Opening')
    expect(screen.getAllByRole('cell').filter((cell) => cell.classList.contains('md:hidden'))).toEqual([])
  })

  it('drops a hidden phone-less column everywhere, and keeps a card field as md:hidden', () => {
    setup({}, { order: ['date', 'white', 'opening', 'notes'], hidden: ['opening', 'white'] })
    expect(heads()).not.toContain('Opening')
    expect(heads()).not.toContain('White')
    // Opening has no place in the phone card, so it is gone; White is a card field, so its
    // cell stays for the card and is hidden from md up.
    expect(cellOf('opening')).toBeUndefined()
    expect(cellOf('white')).toHaveClass('md:hidden', 'max-md:col-start-2')
    expect(screen.getByText('chillzone')).toBeInTheDocument()
    // One track per shown column: the hidden ones take none.
    const shownColumns = screen.getAllByRole('columnheader').length + 1 // and the checkbox
    const tracks = screen.getByRole('table', { name: 'Games' }).firstElementChild!.getAttribute('style')!
    expect(tracks.match(/auto|minmax\([^)]*\)/g)).toHaveLength(shownColumns)
  })

  it('hides the same cells in the skeleton', () => {
    setup({ status: 'pending', games: [] }, { order: ['date', 'white', 'opening'], hidden: ['opening', 'white'] })
    const first = screen.getByTestId('games-loading').firstElementChild!
    const spans = Array.from(first.children)
    // The checkbox, date, white (md:hidden) and the columns new to the choice — no opening.
    const hiddenFromMd = spans.filter((span) => span.classList.contains('md:hidden'))
    expect(hiddenFromMd).toHaveLength(1)
    expect(hiddenFromMd[0]).toHaveClass('max-md:col-start-2')
    expect(spans.some((span) => span.classList.contains('md:min-w-47'))).toBe(false)
  })

  it('moves the delete to whichever shown column is last', () => {
    setup({}, { order: ['date', 'white', 'opening', 'notes'], hidden: ['notes'] })
    // Notes hidden and no collections: the columns new to the choice slot in after their
    // predecessors, so Flags is the last one shown, and it takes the bin.
    const remove = screen.getByRole('button', { name: 'Delete game 12' })
    const cell = remove.closest<HTMLElement>('[data-col]')!
    expect(cell).toHaveAttribute('data-col', 'flags')
    const shownFromMd = within(cell.closest<HTMLElement>('[role="row"]')!)
      .getAllByRole('cell')
      .filter((each) => !each.classList.contains('md:hidden'))
    expect(shownFromMd.at(-1)).toBe(cell)
    expect(cellOf('notes')).toBeUndefined()
    expect(screen.getAllByRole('columnheader').at(-1)!.lastElementChild).toHaveClass('size-6')
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
    // One copy per breakpoint; jsdom has no media queries, so both are in the tree. The
    // Collections column says the names as plain text, in the list's order, comma-separated;
    // the phone card's date line carries them as chips that link.
    expect(screen.getByText('45-45 League, Tough losses')).toBeInTheDocument()
    const league = screen.getAllByRole('link', { name: /45-45 League/ })
    expect(league).toHaveLength(1)
    expect(league[0]).toHaveAttribute('href', '/games?collection=3&whose=all')
    expect(screen.getAllByRole('link', { name: /Tough losses/ })).toHaveLength(1)
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

  it('gives collections a column of their own, last, after the flags and the notes', () => {
    withCollections([{ ...GAME, collections: [3] } as GameCard])
    const header = screen.getAllByRole('row')[0]!
    const heads = [...header.children].map((cell) => cell.textContent)
    expect(heads.slice(-3)).toEqual(['Flags', 'Notes', 'Collections'])
  })

  it('counts each game’s notes, a 0 included, and sorts by them', async () => {
    const onSortChange = vi.fn()
    setup({
      games: [
        { ...GAME, note_count: 3 } as GameCard,
        { ...GAME, id: 13, note_count: 0 } as GameCard,
      ],
      onSortChange,
    })
    const cells = screen.getAllByTestId('game-note-count')
    expect(cells.map((cell) => cell.textContent)).toEqual(['3', '0'])
    await userEvent.click(screen.getAllByRole('button', { name: /^Notes/ })[0]!)
    expect(onSortChange).toHaveBeenCalledWith({ key: 'notes', direction: 'desc' })
  })

  it('drops the Collections column while there are no collections', () => {
    setup()
    expect(screen.queryByText('Collections')).not.toBeInTheDocument()
    expect(screen.getByText('Flags')).toBeInTheDocument()
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
    // The held-back row says why it is quiet, in the cells the number and the flags would
    // be in: an empty Flags cell would read as a game without a mistake.
    expect(
      screen.getAllByRole('img', { name: 'Engine hidden on this game until you show it' }),
    ).toHaveLength(2)
    expect(screen.getByText('quietone')).toBeInTheDocument()
  })
})

describe('GamesTable queue state', () => {
  const fresh = { ...GAME, analyzed: false, requested: false, worst_moments: [] } as GameCard

  it('says a game is in the queue rather than offering to queue it again', () => {
    setup({ games: [{ ...fresh, queued: true } as GameCard] })
    expect(screen.getAllByText('In queue')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Analyse' })).not.toBeInTheDocument()
  })

  // The card is the one answer: once a refetch says a run was cancelled or cleared, the row
  // offers Analyse again rather than holding on to "In queue".
  it('offers Analyse whenever the card says the game is not queued', () => {
    setup({ games: [{ ...fresh, queued: false } as GameCard] })
    expect(screen.queryByText('In queue')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Analyse' }).length).toBeGreaterThan(0)
  })
})

describe('GamesTable with the engine hidden', () => {
  it('drops the Worst and Flags columns, and keeps the game', () => {
    setEngineHidden(true)
    setup()

    // The two columns that are the engine's verdict on how it was played, headers and all.
    expect(screen.queryByRole('button', { name: /Worst/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Flags')).not.toBeInTheDocument()
    expect(screen.queryByText('−80%')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('1 blunder')).not.toBeInTheDocument()
    // No eye either: that marks one game hidden on its own, and here the switch says why.
    expect(screen.queryByRole('img', { name: /Engine hidden/ })).not.toBeInTheDocument()

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
    await userEvent.click(screen.getAllByRole('button', { name: 'Analyse' })[0]!)
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
