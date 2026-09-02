import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import type { ReferenceGame } from '@/lib/api/types'

import { ReferenceGamePage } from './ReferenceGamePage'

// chessground wants a laid-out box jsdom will not give it; what these tests are about is
// the position handed to the board, so it is stood in for by its props — the same stand-in
// `ExplorerPage.test.tsx` uses.
vi.mock('@/components/board/Board', () => ({
  Board: ({
    fen,
    lastMove,
    viewOnly,
  }: {
    fen: string
    lastMove?: string | [string, string] | null
    viewOnly?: boolean
  }) => (
    <div
      data-testid="board"
      data-fen={fen}
      data-last-move={typeof lastMove === 'string' ? lastMove : (lastMove?.join('') ?? '')}
      // `Board` defaults to view-only, and a model game must never be draggable.
      data-view-only={String(viewOnly !== false)}
    />
  ),
}))

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

const GAME: ReferenceGame = {
  source: 'masters',
  id: 'abcd1234',
  white: { name: 'Kasparov, G', rating: 2812 },
  black: { name: 'Karpov, A', rating: 2775 },
  result: '1-0',
  event: 'World Championship',
  site: 'Lyon',
  date: '1990.12.15',
  moves: [
    { ply: 0, uci: 'e2e4', san: 'e4' },
    { ply: 1, uci: 'e7e5', san: 'e5' },
    { ply: 2, uci: 'g1f3', san: 'Nf3' },
  ],
  lichess_url: null,
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function renderPage(entry = '/reference/masters/abcd1234') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  return render(
    <Providers client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/reference/:source/:gameId" element={<ReferenceGamePage />} />
        </Routes>
      </MemoryRouter>
    </Providers>,
  )
}

function stubGame(game: unknown = GAME, status = 200, seen: string[] = []): string[] {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      seen.push(url)
      if (url.includes('/reference/games/')) return json(game, status)
      return json({ error: 'not_found', detail: url }, 404)
    }),
  )
  return seen
}

describe('ReferenceGamePage', () => {
  it('fetches the game by source and id and renders its header and movetext', async () => {
    const seen = stubGame()
    renderPage()

    expect(await screen.findByText(/Kasparov, G/)).toBeInTheDocument()
    expect(screen.getByText('1–0')).toBeInTheDocument()
    expect(screen.getByText(/World Championship/)).toBeInTheDocument()
    expect(screen.getByText('e4')).toBeInTheDocument()
    expect(screen.getByText('Nf3')).toBeInTheDocument()
    expect(seen.some((url) => url.includes('/reference/games/masters/abcd1234'))).toBe(true)
  })

  it('opens on the initial position with a board nobody can move', async () => {
    stubGame()
    renderPage()

    await screen.findByText('e4')
    const board = screen.getByTestId('board')
    expect(board).toHaveAttribute('data-fen', START_FEN)
    expect(board).toHaveAttribute('data-view-only', 'true')
  })

  it('steps the cursor with the arrow keys', async () => {
    stubGame()
    renderPage()

    await screen.findByText('e4')
    const board = screen.getByTestId('board')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await waitFor(() => expect(board).toHaveAttribute('data-last-move', 'e2e4'))

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await waitFor(() => expect(board).toHaveAttribute('data-last-move', 'e7e5'))

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    await waitFor(() => expect(board).toHaveAttribute('data-last-move', 'e2e4'))
  })

  it('never steps past either end of the game', async () => {
    stubGame()
    renderPage()

    await screen.findByText('e4')
    const board = screen.getByTestId('board')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    expect(board).toHaveAttribute('data-fen', START_FEN)

    for (let index = 0; index < 6; index += 1) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    }
    await waitFor(() => expect(board).toHaveAttribute('data-last-move', 'g1f3'))
    expect(screen.getByText('ply 3 of 3')).toBeInTheDocument()
  })

  it('jumps to a move when it is clicked in the movetext', async () => {
    stubGame()
    renderPage()

    await userEvent.click(await screen.findByText('e5'))
    expect(screen.getByTestId('board')).toHaveAttribute('data-last-move', 'e7e5')
    expect(screen.getByText('ply 2 of 3')).toBeInTheDocument()
  })

  it('offers the Lichess link only when the game has one', async () => {
    stubGame()
    const view = renderPage()
    await screen.findByText('e4')
    expect(screen.queryByText('Open on Lichess')).not.toBeInTheDocument()
    view.unmount()
    vi.unstubAllGlobals()

    stubGame({ ...GAME, source: 'lichess', lichess_url: 'https://lichess.org/abcd1234' })
    renderPage('/reference/lichess/abcd1234')
    expect(await screen.findByText('Open on Lichess')).toHaveAttribute(
      'href',
      'https://lichess.org/abcd1234',
    )
  })

  it('reports a failure with something to press rather than an empty page', async () => {
    stubGame({ error: 'not_found', detail: 'no such game' }, 404)
    renderPage()

    expect(await screen.findByText('Could not read that game')).toBeInTheDocument()
    expect(screen.getByText('Try again')).toBeInTheDocument()
  })

  it('names the token when that is what failed, instead of a retry that cannot work', async () => {
    // A masters game is fetched with the owner's token, so a revoked one fails here the way
    // it fails on the explorer — and pressing "try again" would only ask for the same 409.
    stubGame({ error: 'lichess_token_rejected', detail: 'upstream 401' }, 409)
    renderPage()

    expect(await screen.findByText('Lichess refused that token')).toBeInTheDocument()
    expect(screen.getByLabelText('Lichess API token')).toBeInTheDocument()
    expect(screen.queryByText('Could not read that game')).not.toBeInTheDocument()
    expect(screen.queryByText('Try again')).not.toBeInTheDocument()
  })

  it('adds the game to the library and opens it there', async () => {
    const calls: { url: string; method: string }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? 'GET'
        calls.push({ url, method })
        if (method === 'POST' && url.endsWith('/import')) {
          return json({ game: { id: 42, source: 'masters', is_owner_game: false }, created: true })
        }
        if (url.includes('/reference/games/')) return json(GAME)
        return json({ error: 'not_found', detail: url }, 404)
      }),
    )
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
    })
    render(
      <Providers client={client}>
        <MemoryRouter initialEntries={['/reference/masters/abcd1234']}>
          <Routes>
            <Route path="/reference/:source/:gameId" element={<ReferenceGamePage />} />
            <Route path="/games/:id" element={<div>library game</div>} />
          </Routes>
        </MemoryRouter>
      </Providers>,
    )

    await userEvent.click(await screen.findByRole('button', { name: 'Add to library' }))

    expect(await screen.findByText('library game')).toBeInTheDocument()
    expect(
      calls.some(
        (call) =>
          call.method === 'POST' && call.url.includes('/reference/games/masters/abcd1234/import'),
      ),
    ).toBe(true)
  })

  it('fetches nothing at all for a source that is not one of the two books', async () => {
    const seen = stubGame()
    renderPage('/reference/library/7')

    expect(await screen.findByText('That is not a reference game.')).toBeInTheDocument()
    expect(seen).toHaveLength(0)
  })
})
