import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TableFooter, type TableFooterProps } from './TableFooter'

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input).split('?')[0]!
      if (path.endsWith('/api/collections')) {
        return json(200, {
          collections: [
            {
              id: 3,
              name: '45-45 League',
              color: 'accent',
              description: null,
              rule: null,
              game_count: 8,
              created_at: '2026-09-01T00:00:00Z',
            },
          ],
        })
      }
      return json(404, { error: 'not_found' })
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

function setup(over: Partial<TableFooterProps> = {}) {
  const props: TableFooterProps = {
    selectedCount: 0,
    loadedCount: 3,
    total: 3,
    queueing: false,
    deleting: false,
    onQueue: vi.fn(),
    onDelete: vi.fn(),
    onClearSelection: vi.fn(),
    message: null,
    page: 1,
    pageCount: 1,
    onPageChange: vi.fn(),
    pageSize: 50,
    onPageSizeChange: vi.fn(),
    rowsPerPage: 50,
    fitRows: 25,
    ...over,
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <TableFooter {...props} />
    </QueryClientProvider>,
  )
  return props
}

describe('TableFooter — the selection', () => {
  it('lays the commands out in the grammar’s order, with Queue analysis the one primary', () => {
    setup({ selectedCount: 2, selectedGames: [{ id: 11 }, { id: 12 }] })
    const names = screen
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent?.trim())
    const order = ['Clear selection', 'Add to', 'Queue analysis', 'Delete…']
    expect(names.filter((name) => order.includes(name ?? ''))).toEqual(order)
    // One filled button in the region: Queue analysis; Delete… is only red-outlined.
    const filled = screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('bg-accent-teal'))
    expect(filled.map((button) => button.textContent?.trim())).toEqual(['Queue analysis'])
    expect(screen.getByRole('button', { name: 'Delete…' }).className).toContain('text-blunder')
    // The count is data, not a link.
    expect(screen.getByText('2 selected').className).not.toContain('accent')
  })

  it('pages with the Rows picker and the pager', async () => {
    const user = userEvent.setup()
    const props = setup({ page: 1, pageCount: 3 })
    expect(screen.getByLabelText('Previous page')).toBeDisabled()
    await user.click(screen.getByLabelText('Next page'))
    expect(props.onPageChange).toHaveBeenCalledWith(2)
    expect(screen.getByText('Rows:')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Rows'), 'fit')
    expect(props.onPageSizeChange).toHaveBeenCalledWith('fit')
  })
})

describe('TableFooter — collections', () => {
  it('says a selection can go into a collection, or out of the one the page is', () => {
    setup()
    expect(screen.getByText(/add them to a collection/)).toBeInTheDocument()
  })

  it('says what a selection on a collection’s page is for', () => {
    setup({ inCollection: true })
    expect(screen.getByText(/remove them from this collection/)).toBeInTheDocument()
  })

  it('opens the checklist over the selection, and hands "new collection" to the page', async () => {
    const user = userEvent.setup()
    const props = setup({
      selectedCount: 2,
      selectedGames: [
        { id: 11, collections: [3] },
        { id: 12, collections: [] },
      ],
      onNewCollection: vi.fn(),
    })

    await user.click(screen.getByRole('button', { name: 'Add to' }))
    // Half the selection is in the league: the half tick.
    const row = await screen.findByRole('checkbox', { name: /45-45 League/ })
    expect(row).toHaveAttribute('aria-checked', 'mixed')

    await user.click(screen.getByRole('button', { name: /New collection from these 2 games/ }))
    expect(props.onNewCollection).toHaveBeenCalledOnce()
    // The dialog takes over; the panel under it goes.
    expect(screen.queryByRole('dialog', { name: 'Add to a collection' })).not.toBeInTheDocument()
  })

  it('closes the checklist on Escape', async () => {
    const user = userEvent.setup()
    setup({ selectedCount: 1, selectedGames: [{ id: 11, collections: [] }] })
    await user.click(screen.getByRole('button', { name: 'Add to' }))
    expect(screen.getByRole('dialog', { name: 'Add to a collection' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Add to a collection' })).not.toBeInTheDocument()
  })

  it('offers "Remove from collection" only on a collection’s page', () => {
    setup({ selectedCount: 1, selectedGames: [{ id: 11 }], onRemoveFromCollection: vi.fn() })
    expect(screen.queryByRole('button', { name: 'Remove from collection' })).not.toBeInTheDocument()
  })

  it('takes the selection out of the collection the page is', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    setup({
      selectedCount: 1,
      selectedGames: [{ id: 11, collections: [3] }],
      inCollection: true,
      onRemoveFromCollection: onRemove,
    })
    await user.click(screen.getByRole('button', { name: 'Remove from collection' }))
    expect(onRemove).toHaveBeenCalledOnce()
  })
})
