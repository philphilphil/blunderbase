import { QueryClient } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import type { ReferenceGame } from '@/lib/api/types'
import { EventsProvider } from '@/lib/events/EventsProvider'
import { resetSessionVariations } from '@/routes/game/sessionVariations'

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
      data-view-only={String(viewOnly !== false)}
    />
  ),
}))

// The studio mounts the events socket for the live search. Nothing here drives it; a stub
// that never opens keeps the provider quiet.
class SilentSocket {
  static readonly OPEN = 1
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  close() {}
}

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
      <EventsProvider>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/reference/:source/:gameId" element={<ReferenceGamePage />} />
            <Route path="/games/:id" element={<div>library game</div>} />
          </Routes>
        </MemoryRouter>
      </EventsProvider>
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
      if (url.includes('/settings')) return json({})
      if (url.includes('/runners')) return json({ runners: [] })
      return json({ error: 'not_found', detail: url }, 404)
    }),
  )
  return seen
}

beforeEach(() => {
  resetSessionVariations()
  vi.stubGlobal('WebSocket', SilentSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ReferenceGamePage', () => {
  it('opens the model game in the studio, not in a viewer of its own', async () => {
    const seen = stubGame()
    renderPage()

    // The studio's own furniture, around somebody else's game: player rows flanking the
    // board, the paired move table, the engine band.
    expect(await screen.findByText(/Kasparov, G/)).toBeInTheDocument()
    const [top, bottom] = screen.getAllByTestId('player-row')
    expect(within(top!).getByText('Karpov, A')).toBeInTheDocument()
    expect(within(bottom!).getByText('Kasparov, G')).toBeInTheDocument()
    expect(screen.getByTestId('move-list')).toBeInTheDocument()
    expect(screen.getByTestId('maia-panel')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nf3' })).toBeInTheDocument()
    expect(seen.some((url) => url.includes('/reference/games/masters/abcd1234'))).toBe(true)
  })

  it('opens on the initial position and steps with the arrow keys', async () => {
    stubGame()
    renderPage()

    await screen.findByRole('button', { name: 'e4' })
    const board = screen.getByTestId('board')
    expect(board).toHaveAttribute('data-fen', START_FEN)

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    await waitFor(() => expect(screen.getByTestId('board')).toHaveAttribute('data-last-move', 'e2e4'))
  })

  it('asks the server for nothing that needs a game row', async () => {
    const seen = stubGame()
    renderPage()
    await screen.findByRole('button', { name: 'e4' })

    // No runs, no pinned lines, no notes: there is no library row for any of them to hang
    // off, and asking would be a 404 per render.
    expect(seen.some((url) => url.includes('/runs'))).toBe(false)
    expect(seen.some((url) => url.includes('/lines'))).toBe(false)
    expect(seen.some((url) => /\/games\/\d/.test(url))).toBe(false)
  })

  it('leaves out every affordance that would write something', async () => {
    stubGame()
    renderPage()
    await screen.findByRole('button', { name: 'e4' })

    // Nothing to queue a run against, nothing to hang a note on, nothing to pin a line to.
    expect(screen.queryByRole('button', { name: /Quick/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Deep/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Note/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Notes hang off a game in your library/)).toBeInTheDocument()

    // What is left is the board itself, which is the point of opening it here.
    expect(screen.getByRole('button', { name: 'Hints' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Board settings' })).toBeInTheDocument()
  })

  it('reports a failure with something to press rather than an empty page', async () => {
    stubGame({ error: 'not_found', detail: 'no such game' }, 404)
    renderPage()

    expect(await screen.findByTestId('game-error')).toBeInTheDocument()
  })

  it('names the token when that is what failed, instead of a retry that cannot work', async () => {
    // A masters game is fetched with the owner's token, so a revoked one fails here the way
    // it fails on the explorer — and pressing "try again" would only ask for the same 409.
    stubGame({ error: 'lichess_token_rejected', detail: 'upstream 401' }, 409)
    renderPage()

    expect(await screen.findByText('Lichess refused that token')).toBeInTheDocument()
    expect(screen.getByLabelText('Lichess API token')).toBeInTheDocument()
    expect(screen.queryByTestId('game-error')).not.toBeInTheDocument()
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
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: '+ Add to library' }))

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

    expect(await screen.findByTestId('game-error')).toHaveTextContent(
      'is not a reference game',
    )
    expect(seen.some((url) => url.includes('/reference/games/'))).toBe(false)
  })
})
