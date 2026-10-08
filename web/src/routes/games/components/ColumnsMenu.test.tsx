import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { queryKeys } from '@/lib/api/keys'
import type { GameColumns } from '@/lib/api/types'
import { GAME_COLUMNS_KEY } from '@/lib/games/demoColumns'
import { setEngineHidden } from '@/lib/ui/engineVisibility'

import { ColumnsMenu } from './ColumnsMenu'

vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }))

const DEFAULT_ORDER = [
  'date',
  'white',
  'white_rating',
  'black',
  'black_rating',
  'opening',
  'result',
  'time',
  'moves',
  'worst',
  'source',
  'tier',
  'flags',
  'notes',
  'collections',
]

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** The bodies of the PUTs the menu sent, in order. */
function puts(): { order: string[] | null; hidden: string[] }[] {
  return vi
    .mocked(fetch)
    .mock.calls.filter(([, init]) => init?.method === 'PUT')
    .map(([, init]) => JSON.parse(String(init!.body)))
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).split('?')[0]!
      if (path.endsWith('/api/settings/game-columns') && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as GameColumns | { order: null }
        return json(200, body.order === null ? { order: [], hidden: [] } : body)
      }
      return json(404, { error: 'not_found', detail: path })
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  setEngineHidden(false)
  localStorage.removeItem(GAME_COLUMNS_KEY)
})

/**
 * The menu over a client that has the owner's choice (or none) and their collections
 * already, and asks the server for nothing else.
 */
function draw({
  columns = { order: [], hidden: [] },
  collections = 1,
}: { columns?: GameColumns | null; collections?: number } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  // What the server answers with no choice stored is an empty order; `null` is no answer yet.
  if (columns) client.setQueryData(queryKeys.gameColumns(), columns)
  client.setQueryData(queryKeys.collectionList(), {
    collections: Array.from({ length: collections }, (_, index) => ({ id: index + 1, name: `C${index}` })),
  })
  render(
    <QueryClientProvider client={client}>
      <ColumnsMenu />
    </QueryClientProvider>,
  )
  return client
}

async function openMenu() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Columns' }))
  return { user, panel: screen.getByRole('dialog', { name: 'Columns' }) }
}

const rows = (panel: HTMLElement) =>
  within(panel)
    .getAllByRole('checkbox')
    .map((box) => box.textContent)

describe('ColumnsMenu', () => {
  it('opens a checklist of the columns by their whole names, the first box focused', async () => {
    draw()
    const trigger = screen.getByRole('button', { name: 'Columns' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    // Closed, it is not in the document at all, so no column name is on screen twice.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    const { panel } = await openMenu()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(rows(panel)).toEqual([
      'Date',
      'White',
      "White's rating",
      'Black',
      "Black's rating",
      'Opening',
      'Result',
      'Time',
      'Moves',
      'Worst',
      'Source',
      'Analysis',
      'Flags',
      'Notes',
      'Collections',
    ])
    expect(within(panel).getByRole('checkbox', { name: 'Date' })).toHaveFocus()
  })

  it('saves the whole arrangement when a box is unticked', async () => {
    draw()
    const { user, panel } = await openMenu()
    await user.click(within(panel).getByRole('checkbox', { name: 'Opening' }))

    expect(within(panel).getByRole('checkbox', { name: 'Opening' })).toHaveAttribute('aria-checked', 'false')
    await waitFor(() => expect(puts()).toHaveLength(1))
    expect(puts()[0]).toEqual({ order: DEFAULT_ORDER, hidden: ['opening'] })
  })

  it('moves a column with its arrows, keeping the focus on the arrow pressed', async () => {
    draw()
    const { user, panel } = await openMenu()
    await user.click(within(panel).getByRole('button', { name: 'Move Opening up' }))

    expect(rows(panel).slice(4, 6)).toEqual(['Opening', "Black's rating"])
    expect(within(panel).getByRole('button', { name: 'Move Opening up' })).toHaveFocus()
    await waitFor(() => expect(puts()).toHaveLength(1))
    expect(puts()[0]!.order!.slice(3, 6)).toEqual(['black', 'opening', 'black_rating'])
  })

  it('cannot move the first row up or the last down, and hands the focus over at an end', async () => {
    draw()
    const { user, panel } = await openMenu()
    expect(within(panel).getByRole('button', { name: 'Move Date up' })).toBeDisabled()
    expect(within(panel).getByRole('button', { name: 'Move Collections down' })).toBeDisabled()

    await user.click(within(panel).getByRole('button', { name: 'Move White up' }))
    // White is first now: its up arrow is spent, so the focus goes to its down arrow.
    expect(rows(panel)[0]).toBe('White')
    expect(within(panel).getByRole('button', { name: 'Move White up' })).toBeDisabled()
    expect(within(panel).getByRole('button', { name: 'Move White down' })).toHaveFocus()
  })

  it('leaves Collections out while there are none, and moves past it', async () => {
    draw({ collections: 0 })
    const { user, panel } = await openMenu()
    expect(rows(panel)).not.toContain('Collections')
    expect(within(panel).getByRole('button', { name: 'Move Notes down' })).toBeDisabled()

    await user.click(within(panel).getByRole('button', { name: 'Move Notes up' }))
    await waitFor(() => expect(puts()).toHaveLength(1))
    expect(puts()[0]!.order!.slice(-3)).toEqual(['notes', 'flags', 'collections'])
  })

  it('keeps one column: the last box nothing else can take away is disabled', async () => {
    const hidden = DEFAULT_ORDER.filter((id) => !['date', 'worst', 'flags', 'collections'].includes(id))
    draw({ columns: { order: DEFAULT_ORDER, hidden } })
    const { panel } = await openMenu()
    const date = within(panel).getByRole('checkbox', { name: 'Date' })
    expect(date).toBeDisabled()
    expect(date).toHaveAttribute('title', 'One column has to stay')
    // Worst, Flags and Collections do not count: ⇧E or the last collection going takes
    // them away, and the list would be empty.
    expect(within(panel).getByRole('checkbox', { name: 'Worst' })).toBeEnabled()
  })

  it('says Worst and Flags are off under ⇧E, and still lets the choice be made', async () => {
    setEngineHidden(true)
    draw()
    const { panel } = await openMenu()
    const worst = within(panel).getByRole('checkbox', { name: 'Worst' })
    expect(worst).toBeEnabled()
    expect(worst).toHaveAccessibleDescription('Off while the engine is hidden')
    expect(within(panel).getByRole('checkbox', { name: 'Flags' })).toHaveAccessibleDescription(
      'Off while the engine is hidden',
    )
    expect(within(panel).getByRole('checkbox', { name: 'Opening' })).not.toHaveAccessibleDescription()
  })

  it('offers Reset to default only away from the default, and resets the whole choice', async () => {
    draw()
    const { user, panel } = await openMenu()
    const reset = within(panel).getByRole('button', { name: 'Reset to default' })
    expect(reset).toBeDisabled()

    await user.click(within(panel).getByRole('checkbox', { name: 'Source' }))
    expect(reset).toBeEnabled()
    await user.click(reset)

    expect(reset).toBeDisabled()
    expect(within(panel).getByRole('checkbox', { name: 'Source' })).toHaveAttribute('aria-checked', 'true')
    expect(within(panel).getByRole('checkbox', { name: 'Date' })).toHaveFocus()
    await waitFor(() => expect(puts()).toHaveLength(2))
    expect(puts()[1]).toEqual({ order: null, hidden: [] })
  })

  it('closes on Escape with the focus back on its button, and on a click outside', async () => {
    draw()
    const { user } = await openMenu()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Columns' })).toHaveFocus()

    await openMenu()
    await user.click(document.body)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('gives every row a grip named for its column', async () => {
    draw()
    const { panel } = await openMenu()
    const grips = within(panel).getAllByRole('button', { name: /^Drag .* to another place$/ })
    expect(grips).toHaveLength(15)
    expect(grips[0]).toHaveAccessibleName('Drag Date to another place')
  })

  it('takes an Escape during a keyboard drag as cancelling the drag, not closing the panel', async () => {
    draw()
    const { user, panel } = await openMenu()
    within(panel).getByRole('button', { name: 'Drag Opening to another place' }).focus()
    // Space picks the row up (dnd-kit's keyboard sensor); Escape puts it back.
    await user.keyboard(' ')
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: 'Columns' })).toBeInTheDocument()
    expect(puts()).toHaveLength(0)
    // With the drag over, Escape is the panel's again.
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('cannot be opened over a stand-in for the owner’s choice', async () => {
    // Nothing read yet, only this browser's old copy to draw with: a save from here would
    // be the whole arrangement, the copy's, over whatever the server holds.
    localStorage.setItem(GAME_COLUMNS_KEY, JSON.stringify({ order: ['opening', 'date'], hidden: [] }))
    draw({ columns: null })
    const trigger = screen.getByRole('button', { name: 'Columns' })
    expect(trigger).toBeDisabled()
    await userEvent.setup().click(trigger)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(puts()).toEqual([])
  })

  it('says so when the choice could not be read', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <ColumnsMenu />
      </QueryClientProvider>,
    )
    // The stub answers the read with a 404.
    const trigger = screen.getByRole('button', { name: 'Columns' })
    await waitFor(() => expect(trigger).toHaveAttribute('title', 'Could not read the column choice'))
    expect(trigger).toBeDisabled()
  })
})
