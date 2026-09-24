import { QueryClient } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import {
  SERVER_CAPABILITIES,
  type LiveState,
  type RunnersStatus,
  type RuntimeCapabilities,
} from '@/lib/api/types'
import { EventsProvider } from '@/lib/events/EventsProvider'
import { RuntimeCapabilitiesContext } from '@/lib/runtime/capabilities'

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

/** Every `/streams` request, method included — an open and a close are not the same call. */
let streamCalls: { method: string; path: string; body: unknown }[] = []
/** Every write to the board, in order. */
let boardCalls: { path: string; body: unknown }[] = []

/**
 * Method-aware, because the page now opens and closes analysis sessions on the same path.
 * `/runners/status` answers for every case: the panel reads it to fill its engine picker.
 */
function stubFetch(routes: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).split('?')[0]!
      const method = init?.method ?? 'GET'

      if (path.startsWith('/api/streams')) {
        const body = init?.body ? JSON.parse(String(init.body)) : null
        streamCalls.push({ method, path, body })
        if (method === 'DELETE') return new Response(null, { status: 204 })
        if (method === 'POST') {
          return json(
            {
              id: 'str_1',
              surface: 'live',
              fen: String((body as { fen?: string })?.fen ?? ''),
              multipv: 3,
              engine_id: 1,
              engine: 'stockfish',
              runner_id: null,
              runner: null,
              state: 'starting',
              seq: 0,
              created_at: new Date().toISOString(),
            },
            201,
          )
        }
        return json([])
      }
      if (path === '/api/runners/status') return json(RUNNERS_STATUS)
      if (path.startsWith('/api/live/') && method === 'POST') {
        boardCalls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null })
      }

      const body = routes[path]
      if (body === undefined) return json({ error: 'not_found', detail: path }, 404)
      return json(body)
    }),
  )
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * `Providers` no longer carries the `/events` socket — it hangs inside `AuthGate`, so a
 * signed-out browser never dials it. A test that mounts a page on its own is standing in
 * for the authenticated side of that gate, so it supplies the provider the gate would.
 */
function renderPage(ui: ReactNode, capabilities: RuntimeCapabilities = SERVER_CAPABILITIES) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <Providers client={client}>
      <RuntimeCapabilitiesContext.Provider value={capabilities}>
        <EventsProvider>
          <MemoryRouter>{ui}</MemoryRouter>
        </EventsProvider>
      </RuntimeCapabilitiesContext.Provider>
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

/** Where engine work can run. One local engine, no runners — today's single-host install. */
const RUNNERS_STATUS: RunnersStatus = {
  local: {
    name: 'local',
    slots: 2,
    busy: 0,
    streams: 0,
    workers: true,
    queued: 0,
    running: 0,
    engines: [
      {
        id: 1,
        name: 'stockfish',
        kind: 'uci',
        path: '/usr/games/stockfish',
        enabled: true,
        streams: true,
      },
    ],
  },
  runners: [],
  queue: { queued: 0, running: 0 },
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
  streamCalls = []
  boardCalls = []
  vi.stubGlobal('WebSocket', FakeSocket as unknown as typeof WebSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
  FakeSocket.last = null
})

describe('LivePage', () => {
  it('shows an empty board as the starting position, ready to be played on', async () => {
    stubFetch({ '/api/live': IDLE })
    renderPage(<LivePage />)

    expect(
      await screen.findByText('Play a move on the board, or load a FEN or a PGN.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Starting position')).toBeInTheDocument()
    // A board that can be dragged on also carries chessground's drag ghost.
    expect((await screen.findByTestId('board')).querySelectorAll('piece:not(.ghost)')).toHaveLength(32)
  })

  it('renders the coach’s board, marks and comment', async () => {
    stubFetch({ '/api/live': SHOWING, '/api/games/7': GAME })
    renderPage(<LivePage />)

    expect(
      await screen.findByText('Nine moves of careful improving, one move of generosity.'),
    ).toBeInTheDocument()
    expect(await screen.findByText('kn1ghtmare — phib · ply 1')).toBeInTheDocument()
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
    await screen.findByText('Starting position')

    deliver({ event: 'live.updated', ...SHOWING })

    expect(
      await screen.findByText('Nine moves of careful improving, one move of generosity.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Starting position')).not.toBeInTheDocument()

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

  it('offers the engine on the starting position of an empty board', async () => {
    stubFetch({ '/api/live': IDLE })
    renderPage(<LivePage />)
    await screen.findByText('Starting position')

    const toggle = screen.getByRole('switch', {
      name: 'Analyse this position continuously',
    })
    expect(toggle).toBeEnabled()
    expect(streamCalls).toHaveLength(0)
    await userEvent.click(toggle)
    await waitFor(() => expect(streamCalls.filter((c) => c.method === 'POST')).toHaveLength(1))
    expect(streamCalls[0]!.body).toMatchObject({
      surface: 'live',
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    })
  })

  it('analyses the coach’s position when asked', async () => {
    stubFetch({ '/api/live': SHOWING, '/api/games/7': GAME })
    renderPage(<LivePage />)
    await screen.findByText('kn1ghtmare — phib · ply 1')

    // At rest the panel offers the switch and says what it is for. Nothing has been asked
    // of the server yet.
    expect(screen.getByText('Analyse this position continuously.')).toBeInTheDocument()
    expect(streamCalls).toHaveLength(0)

    await userEvent.click(
      screen.getByRole('switch', { name: 'Analyse this position continuously' }),
    )
    await waitFor(() => expect(streamCalls.filter((c) => c.method === 'POST')).toHaveLength(1))
    expect(streamCalls[0]!.body).toMatchObject({
      surface: 'live',
      fen: AFTER_E4,
      game_id: 7,
      ply: 1,
      engine_id: null,
    })
    // The engine picker knows what this deployment can offer.
    expect(
      screen.getByRole('option', { name: 'stockfish · local' }),
    ).toBeInTheDocument()
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

    expect(await screen.findByText('The board could not be read.')).toBeInTheDocument()
    expect(screen.getByText('the session is gone')).toBeInTheDocument()
  })
})

it('navigates queued positions and resets the shared session', async () => {
  const first = { ...SHOWING, position_index: 0, position_count: 2 }
  stubFetch({ '/api/live': first, '/api/games/7': GAME,
    '/api/live/positions/1': { ...first, position_index: 1 },
    '/api/live/positions/0': first, '/api/live/reset': IDLE })
  renderPage(<LivePage />)
  expect(await screen.findByText('1 / 2')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Prev' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(await screen.findByText('2 / 2')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Prev' }))
  expect(await screen.findByText('1 / 2')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
  expect(await screen.findByText('Starting position')).toBeInTheDocument()
})

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const WITH_LINE: LiveState = {
  ...SHOWING,
  line_positions: [
    { ply: 0, fen: START, san: null, uci: null },
    { ply: 1, fen: AFTER_E4, san: 'e4', uci: 'e2e4' },
  ],
}

describe('the owner’s board', () => {
  it('walks the game in the move list — a click is a step on the shared board', async () => {
    stubFetch({
      '/api/live': WITH_LINE,
      '/api/games/7': GAME,
      '/api/live/goto': { ...WITH_LINE, ply: 0, fen: START, last_move: null },
    })
    renderPage(<LivePage />)
    await screen.findByText('kn1ghtmare — phib · ply 1')
    expect(screen.getByRole('button', { name: 'e4' })).toHaveAttribute('aria-current', 'step')

    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(boardCalls).toEqual([{ path: '/api/live/goto', body: { ply: 0, cursor: 0 } }]))
    expect(await screen.findByText('kn1ghtmare — phib · ply 0')).toBeInTheDocument()
  })

  it('steps with the arrow keys', async () => {
    stubFetch({ '/api/live': WITH_LINE, '/api/games/7': GAME, '/api/live/goto': WITH_LINE })
    renderPage(<LivePage />)
    await screen.findByText('kn1ghtmare — phib · ply 1')

    await userEvent.keyboard('{ArrowRight}')
    expect(boardCalls).toHaveLength(0) // already at the end
    await userEvent.keyboard('{ArrowLeft}')
    await waitFor(() => expect(boardCalls).toEqual([{ path: '/api/live/goto', body: { ply: 0, cursor: 0 } }]))
  })

  it('loads a pasted FEN through the dialog', async () => {
    stubFetch({ '/api/live': IDLE, '/api/live/load': { ...SHOWING, game_id: null, ply: null } })
    renderPage(<LivePage />)
    await screen.findByText('Starting position')

    await userEvent.click(screen.getByRole('button', { name: 'Load…' }))
    const box = screen.getByLabelText('FEN or PGN')
    await userEvent.type(box, AFTER_E4)
    expect(screen.getByLabelText('FEN')).toBe(box)
    await userEvent.click(screen.getByRole('button', { name: 'Load' }))

    await waitFor(() => expect(boardCalls).toEqual([{ path: '/api/live/load', body: { fen: AFTER_E4 } }]))
    expect(await screen.findByText('Ad-hoc position')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps the dialog open and says why when the server refuses the paste', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).split('?')[0]!
        if (path === '/api/live/load' && init?.method === 'POST') {
          return json({ error: 'unprocessable', detail: 'that PGN has no moves' }, 422)
        }
        if (path === '/api/live') return json(IDLE)
        if (path === '/api/runners/status') return json(RUNNERS_STATUS)
        return json([])
      }),
    )
    renderPage(<LivePage />)
    await screen.findByText('Starting position')

    await userEvent.click(screen.getByRole('button', { name: 'Load…' }))
    await userEvent.click(screen.getByLabelText('FEN or PGN'))
    // Pasted into the box, where the page's own paste handler stands down.
    await userEvent.paste('[Event "x"]')
    await userEvent.click(screen.getByRole('button', { name: 'Load' }))

    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(
      'that PGN has no moves',
    )
  })

  it('loads a PGN pasted anywhere on the page', async () => {
    stubFetch({ '/api/live': IDLE, '/api/live/load': WITH_LINE, '/api/games/7': GAME })
    renderPage(<LivePage />)
    await screen.findByText('Starting position')

    const paste = new Event('paste', { bubbles: true }) as ClipboardEvent
    Object.defineProperty(paste, 'clipboardData', {
      value: { getData: () => '1. e4 e5 2. Nf3 *' },
    })
    act(() => {
      document.body.dispatchEvent(paste)
    })
    await waitFor(() =>
      expect(boardCalls).toEqual([{ path: '/api/live/load', body: { pgn: '1. e4 e5 2. Nf3 *' } }]),
    )
  })

  it('keeps the board in the tab on a read-only deployment', async () => {
    stubFetch({})
    renderPage(<LivePage />, { ...SERVER_CAPABILITIES, read_only: true })
    expect(await screen.findByText('Starting position')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Load…' }))
    await userEvent.type(screen.getByLabelText('FEN or PGN'), '1. e4 e5 2. Nf3 Nc6 *')
    await userEvent.click(screen.getByRole('button', { name: 'Load' }))

    expect(await screen.findByText('Pasted game · ply 4')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nc6' })).toHaveAttribute('aria-current', 'step')
    await userEvent.click(screen.getByRole('button', { name: 'e5' }))
    expect(await screen.findByText('Pasted game · ply 2')).toBeInTheDocument()
    // Nothing went to the server: not the reads, and not the writes it would refuse.
    expect(boardCalls).toHaveLength(0)
    const fetched = vi.mocked(fetch).mock.calls.map(([input]) => String(input))
    expect(fetched.some((path) => path.startsWith('/api/live'))).toBe(false)
  })
})
