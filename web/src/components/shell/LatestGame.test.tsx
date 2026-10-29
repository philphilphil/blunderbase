import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'

import { LatestGame } from './LatestGame'

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

let games: unknown[]
let queries: string[]

function draw(path = '/stats') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[path]}>
          <LatestGame />
          <Routes>
            <Route path="/games/:id" element={<p>game page</p>} />
            <Route path="*" element={null} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

const game = {
  id: 42,
  source: 'lichess',
  opponent: 'Kowalski',
  played_at: new Date(Date.now() - 3 * 60_000).toISOString(),
}

beforeEach(() => {
  window.localStorage.clear()
  queries = []
  games = [game]
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.split('?')[0] !== '/api/games') return json(404, { error: 'not_found' })
      queries.push(url.split('?')[1] ?? '')
      return json(200, { games, total: games.length, limit: 1, offset: 0 })
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

describe('the latest game in the titlebar', () => {
  it('names the newest game by when it was played and opens it', async () => {
    draw()
    const link = await screen.findByRole('link', { name: /latest game.*vs Kowalski, 3m ago/i })
    // An icon alone: the opponent and the age are the name and the tooltip, not text.
    expect(link).not.toHaveTextContent('Kowalski')
    // One game, in the list's default order: played, newest first.
    expect(queries[0]).toContain('limit=1')
    expect(queries[0]).not.toContain('order=')

    await userEvent.click(link)
    expect(await screen.findByText('game page')).toBeInTheDocument()
  })

  it('marks a game not opened yet until its page is visited', async () => {
    draw()
    const link = await screen.findByRole('link', { name: /not opened yet/i })
    await userEvent.click(link)
    expect(await screen.findByRole('link', { name: /^Open your latest game: vs Kowalski/ }))
      .toBeInTheDocument()
    expect(window.localStorage.getItem('bb.latestGameSeen')).toBe('42')
  })

  it('remembers a game already opened in this browser', async () => {
    window.localStorage.setItem('bb.latestGameSeen', '42')
    draw()
    expect(await screen.findByRole('link', { name: /^Open your latest game: vs Kowalski/ }))
      .toBeInTheDocument()
  })

  it('is absent while the library holds no game', async () => {
    games = []
    draw()
    await vi.waitFor(() => expect(queries).toHaveLength(1))
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
