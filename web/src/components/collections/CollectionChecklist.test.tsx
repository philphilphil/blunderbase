import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Collection } from '@/lib/api/types'

import { CollectionChecklist, type ChecklistGame } from './CollectionChecklist'

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function collection(id: number, name: string, overrides: Partial<Collection> = {}): Collection {
  return {
    id,
    name,
    color: 'accent',
    description: null,
    rule: null,
    game_count: 0,
    created_at: '2026-09-26T10:00:00Z',
    ...overrides,
  }
}

const COLLECTIONS = [
  collection(1, '45-45 League', { color: 'accent' }),
  collection(2, 'Club · OTB', { color: 'otb' }),
  collection(3, 'Tough losses', { color: 'way-back' }),
]

/** Every membership write the case saw, as `add 1 [4,5]` / `remove 1 [4,5]`. */
let writes: string[]
let failWrites: boolean

beforeEach(() => {
  writes = []
  failWrites = false
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).split('?')[0]!
      if (path.endsWith('/api/collections') && (init?.method ?? 'GET') === 'GET') {
        return json(200, { collections: COLLECTIONS })
      }
      const match = /\/api\/collections\/(\d+)\/games(\/remove)?$/.exec(path)
      if (match) {
        if (failWrites) return json(500, { error: 'boom', detail: 'boom' })
        const body = JSON.parse(String(init?.body)) as { game_ids: number[] }
        writes.push(`${match[2] ? 'remove' : 'add'} ${match[1]} [${body.game_ids.join(',')}]`)
        const owner = COLLECTIONS.find((each) => each.id === Number(match[1]))!
        return json(200, match[2]
          ? { removed: body.game_ids.length, collection: owner }
          : { added: body.game_ids.length, collection: owner })
      }
      return json(404, { error: 'not_found', detail: path })
    }),
  )
})

function draw(games: ChecklistGame[], onNew?: () => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CollectionChecklist games={games} onNew={onNew} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('CollectionChecklist', () => {
  const selection: ChecklistGame[] = [
    { id: 4, collections: [1] },
    { id: 5, collections: [] },
    { id: 6, collections: [] },
  ]

  it('ticks, half-ticks and leaves empty by where the games in hand stand', async () => {
    draw([
      { id: 4, collections: [1, 2] },
      { id: 5, collections: [2] },
    ])
    const league = await screen.findByRole('checkbox', { name: /45-45 League/ })
    expect(league).toHaveAttribute('aria-checked', 'mixed')
    expect(league).toHaveTextContent('1 of 2')
    expect(screen.getByRole('checkbox', { name: /Club · OTB/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('checkbox', { name: /Tough losses/ })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  it('puts every game in when a half-ticked row is clicked, and says so at once', async () => {
    const user = userEvent.setup()
    draw(selection)
    const league = await screen.findByRole('checkbox', { name: /45-45 League/ })
    await user.click(league)
    await waitFor(() => expect(writes).toEqual(['add 1 [4,5,6]']))
    await waitFor(() => expect(league).toHaveAttribute('aria-checked', 'true'))
  })

  it('takes every game out when a ticked row is clicked', async () => {
    const user = userEvent.setup()
    draw([{ id: 9, collections: [3] }])
    const tough = await screen.findByRole('checkbox', { name: /Tough losses/ })
    expect(tough).toHaveAttribute('aria-checked', 'true')
    await user.click(tough)
    await waitFor(() => expect(writes).toEqual(['remove 3 [9]']))
    await waitFor(() => expect(tough).toHaveAttribute('aria-checked', 'false'))
  })

  it('keeps the box as it was when the write fails', async () => {
    failWrites = true
    const user = userEvent.setup()
    draw(selection)
    const club = await screen.findByRole('checkbox', { name: /Club · OTB/ })
    await user.click(club)
    await waitFor(() => expect(club).not.toBeDisabled())
    expect(club).toHaveAttribute('aria-checked', 'false')
  })

  it('offers a new collection made from the games in hand', async () => {
    const user = userEvent.setup()
    const onNew = vi.fn()
    draw(selection, onNew)
    await user.click(await screen.findByRole('button', { name: /New collection from these 3 games/ }))
    expect(onNew).toHaveBeenCalledOnce()
  })

  it('names one game as this game', async () => {
    draw([{ id: 4, collections: [] }], () => {})
    expect(await screen.findByText('This game is in')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /New collection from this game/ })).toBeInTheDocument()
  })
})
