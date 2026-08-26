import { QueryClient } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import type { LiveState } from '@/lib/api/types'

import { LivePage } from './LivePage'

class FakeSocket {
  static last: FakeSocket | null = null
  opened = false
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  readonly url: string
  constructor(url: string) {
    this.url = url
    FakeSocket.last = this
  }
  close() {}
}

function stubFetch(routes: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input).split('?')[0]!
      const body = routes[path]
      if (body === undefined) {
        return new Response(JSON.stringify({ error: 'not_found', detail: path }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
}

function renderPage(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <Providers client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </Providers>,
  )
}

/**
 * One frame down the socket. `onopen` fires once, the way a real one does: firing it
 * twice is a *re*connect, which makes the provider invalidate everything on purpose.
 */
function deliver(event: Record<string, unknown>) {
  act(() => {
    const socket = FakeSocket.last
    if (!socket) throw new Error('no socket was opened')
    if (!socket.opened) {
      socket.opened = true
      socket.onopen?.()
    }
    socket.onmessage?.({ data: JSON.stringify(event) } as MessageEvent<string>)
  })
}

const IDLE: LiveState = {
  active: false,
  game_id: null,
  ply: null,
  fen: null,
  turn: null,
  moves: [],
  last_move: null,
  arrows: [],
  squares: [],
  text: null,
  viewer_count: 0,
  updated_at: null,
}

const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'

const SHOWING: LiveState = {
  ...IDLE,
  active: true,
  game_id: 7,
  ply: 1,
  fen: AFTER_E4,
  turn: 'black',
  last_move: 'e2e4',
  arrows: [{ from: 'e2', to: 'e4', color: 'blue' }],
  squares: [{ square: 'f7', color: 'red' }],
  text: 'Nine moves of careful improving, one move of generosity.',
  viewer_count: 1,
  updated_at: '2026-08-26T00:50:19Z',
}

const GAME = {
  game: {
    id: 7,
    source: 'lichess',
    color: 'black',
    white: 'kn1ghtmare',
    black: 'phib',
    opening: 'Sicilian, Alapin',
  },
  moves: [],
  runs: [],
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeSocket as unknown as typeof WebSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
  FakeSocket.last = null
})

describe('LivePage', () => {
  it('says how to start a session when the board is empty', async () => {
    stubFetch({ '/api/live': IDLE })
    renderPage(<LivePage />)

    expect(await screen.findByText('Nothing is on the board.')).toBeInTheDocument()
    expect(screen.getByText('Nothing on the board')).toBeInTheDocument()
    // The board is still there, dimmed, rather than a hole in the page.
    expect(screen.getByTestId('board').querySelectorAll('piece')).toHaveLength(32)
  })

  it('renders the coach’s board, marks and comment', async () => {
    stubFetch({ '/api/live': SHOWING, '/api/games/7': GAME })
    renderPage(<LivePage />)

    expect(
      await screen.findByText('Nine moves of careful improving, one move of generosity.'),
    ).toBeInTheDocument()
    expect(await screen.findByText('kn1ghtmare — phib · ply 1')).toBeInTheDocument()
    expect(screen.getByText('on air')).toBeInTheDocument()
    expect(screen.getByText('1 viewer')).toBeInTheDocument()
    expect(screen.getByText('1 arrow · 1 square')).toBeInTheDocument()

    const board = screen.getByTestId('board')
    expect(board.querySelectorAll('square.last-move')).toHaveLength(2)
    // The owner played Black, so the board faces the way they saw it.
    expect(board).toHaveClass('orientation-black')
  })

  it('follows live.updated without refetching', async () => {
    stubFetch({ '/api/live': IDLE, '/api/games/7': GAME })
    renderPage(<LivePage />)
    await screen.findByText('Nothing is on the board.')

    deliver({ event: 'live.updated', ...SHOWING })

    expect(
      await screen.findByText('Nine moves of careful improving, one move of generosity.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Nothing is on the board.')).not.toBeInTheDocument()

    deliver({
      event: 'live.updated',
      ...SHOWING,
      ply: 2,
      fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
      last_move: 'e7e5',
      arrows: [],
      squares: [],
      text: null,
    })
    expect(await screen.findByText('kn1ghtmare — phib · ply 2')).toBeInTheDocument()
    expect(screen.getByText('0 arrows · 0 squares')).toBeInTheDocument()
  })

  it('flips the board on request', async () => {
    stubFetch({ '/api/live': SHOWING, '/api/games/7': GAME })
    renderPage(<LivePage />)

    await screen.findByText('kn1ghtmare — phib · ply 1')
    expect(screen.getByTestId('board')).toHaveClass('orientation-black')

    await userEvent.click(screen.getByRole('button', { name: 'Flip the board' }))
    expect(screen.getByTestId('board')).toHaveClass('orientation-white')
  })

  it('says so when the live session cannot be read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: 'internal_error', detail: 'the session is gone' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    renderPage(<LivePage />)

    expect(await screen.findByText('The live session could not be read.')).toBeInTheDocument()
    expect(screen.getByText('the session is gone')).toBeInTheDocument()
  })
})
