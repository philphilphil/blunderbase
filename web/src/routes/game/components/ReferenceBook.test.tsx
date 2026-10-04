import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ReferenceBook, type ReferenceBookProps } from './ReferenceBook'

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

/** What `/reference/explorer` answers for the initial position. Made-up numbers. */
const ANSWER = {
  source: 'masters',
  fen: START_FEN,
  opening: null,
  totals: { games: 400_000, white: 150_000, draws: 160_000, black: 90_000 },
  moves: [
    { uci: 'e2e4', san: 'e4', games: 210_000, white: 80_000, draws: 80_000, black: 50_000, name: "King's Pawn Game" },
    { uci: 'd2d4', san: 'd4', games: 160_000, white: 60_000, draws: 70_000, black: 30_000, name: null },
  ],
  top_games: [
    {
      id: 'game0001',
      white: { name: 'Example, White', rating: 2700 },
      black: { name: 'Example, Black', rating: 2690 },
      winner: 'white',
      year: 2001,
    },
  ],
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** The answer for every reference request, and the URLs that were asked. */
function stub(payload: unknown = ANSWER, status = 200): string[] {
  const seen: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      seen.push(url)
      if (url.includes('/reference/explorer')) return json(payload, status)
      return json({ error: 'not_found', detail: url }, 404)
    }),
  )
  return seen
}

function Where() {
  const location = useLocation()
  return <span data-testid="where">{location.pathname}</span>
}

function renderBook(props: Partial<ReferenceBookProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrap = (children: ReactNode) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/games/7']}>
        <Routes>
          <Route path="*" element={<>{children}<Where /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
  return render(wrap(<ReferenceBook source="masters" fen={START_FEN} ply={0} {...props} />))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ReferenceBook', () => {
  it('lists the book’s continuations and its games for the position on the board', async () => {
    stub()
    renderBook()

    expect(await screen.findByText('1.e4')).toBeInTheDocument()
    expect(screen.getByText('210.0k')).toBeInTheDocument()
    expect(screen.getByText("King's Pawn Game")).toBeInTheDocument()
    expect(screen.getByText('Masters games')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Example, White.*Example, Black/ })).toBeInTheDocument()
  })

  it('asks Lichess with the filters, and Masters without them', async () => {
    const lichess = stub({ ...ANSWER, source: 'lichess' })
    renderBook({ source: 'lichess', speeds: ['blitz', 'rapid'], ratings: [1800, 2000] })
    await screen.findByText('1.e4')
    const asked = new URL(lichess[0]!, 'http://localhost')
    expect(asked.searchParams.get('source')).toBe('lichess')
    expect(asked.searchParams.get('speeds')).toBe('blitz,rapid')
    expect(asked.searchParams.get('ratings')).toBe('1800,2000')
    vi.unstubAllGlobals()

    const masters = stub()
    renderBook({ speeds: ['blitz'], ratings: [1800] })
    await screen.findAllByText('1.e4')
    const plain = new URL(masters[0]!, 'http://localhost')
    expect(plain.searchParams.get('source')).toBe('masters')
    expect(plain.searchParams.has('speeds')).toBe(false)
  })

  it('plays a continuation on the board, and previews it on hover', async () => {
    stub()
    const onPlay = vi.fn()
    const onPreview = vi.fn()
    renderBook({ onPlay, onPreview })

    const row = await screen.findByRole('row', { name: /1\.d4/ })
    await userEvent.hover(row)
    expect(onPreview).toHaveBeenLastCalledWith(['d2d4'])
    await userEvent.click(row)
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ uci: 'd2d4' }))
  })

  it('opens a game read-only in the reference viewer', async () => {
    stub()
    renderBook()

    await userEvent.click(await screen.findByRole('button', { name: /Example, White/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/reference/masters/game0001')
  })

  it('offers Connect Lichess where Lichess has not been connected', async () => {
    stub({ error: 'lichess_token_missing', detail: 'no token stored' }, 409)
    renderBook()

    expect(await screen.findByRole('button', { name: 'Connect Lichess' })).toBeInTheDocument()
  })

  it('says so where nobody in the book reached the position', async () => {
    stub({ ...ANSWER, moves: [], top_games: [] })
    renderBook()

    expect(await screen.findByTestId('reference-book-empty')).toHaveTextContent(
      'No masters game reached this position.',
    )
  })
})
