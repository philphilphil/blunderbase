import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Collection } from '@/lib/api/types'

import { CollectionChip, CollectionChips } from './CollectionChip'

function collection(id: number, name: string, color: Collection['color']): Collection {
  return {
    id,
    name,
    color,
    description: null,
    rule: null,
    game_count: 1,
    created_at: '2026-09-26T10:00:00Z',
  }
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          collections: [collection(1, '45-45 League', 'accent'), collection(2, 'Tough losses', 'way-back')],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ),
  )
})

function wrap(children: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('CollectionChip', () => {
  it('wears its colour and links to the collection when told where', () => {
    wrap(<CollectionChip collection={{ name: 'Club', color: 'otb' }} to="/games?collection=2" />)
    const link = screen.getByRole('link', { name: 'Club' })
    expect(link).toHaveAttribute('href', '/games?collection=2')
    expect(link.className).toContain('text-otb')
  })

  it('is a plain label without a destination', () => {
    wrap(<CollectionChip collection={{ name: 'Club', color: 'otb' }} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Club')).toBeInTheDocument()
  })
})

describe('CollectionChips', () => {
  it('draws a game’s collections from its ids, skipping ids the list does not know', async () => {
    wrap(<CollectionChips ids={[2, 1, 99]} />)
    const league = await screen.findByRole('link', { name: '45-45 League' })
    expect(league).toHaveAttribute('href', '/games?collection=1')
    expect(screen.getByRole('link', { name: 'Tough losses' })).toHaveAttribute(
      'href',
      '/games?collection=2',
    )
    expect(screen.getAllByRole('link')).toHaveLength(2)
  })

  it('draws nothing for a game in no collection', () => {
    const { container } = wrap(<CollectionChips ids={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
