import { QueryClient } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import type { GameDetail, MoveRow, RunResponse, RunnersStatus } from '@/lib/api/types'

import { GamePage } from './GamePage'

// The events socket is not what most of these tests are about; a stub that never opens
// keeps the provider quiet. `emit` is there for the one test that does drive it.
class SilentSocket {
  static readonly OPEN = 1
  static instances: SilentSocket[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  constructor() {
    SilentSocket.instances.push(this)
  }
  close() {}
  emit(frame: Record<string, unknown>) {
    act(() => this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(frame) })))
  }
}

function move(ply: number, san: string, uci: string, extra: Partial<MoveRow> = {}): MoveRow {
  return { ply, move_number: Math.floor(ply / 2) + 1, san, uci, ...extra }
}

const DETAIL: GameDetail = {
  game: {
    id: 14,
    source: 'lichess',
    played_at: '2016-12-07T12:28:49Z',
    color: 'white',
    result: '0-1',
    outcome: 'loss',
    white: 'phib',
    black: 'lichess AI level 2',
    white_rating: 1500,
    eco: 'B01',
    opening: 'Scandinavian Defense',
    speed: 'correspondence',
    ply_count: 4,
  },
  ply_range: null,
  moves: [
    move(0, 'e4', 'e2e4', {
      classification: 'best',
      eval_before_cp: 45,
      eval_after_cp: 40,
      win_after: 53.68,
      best_move_uci: 'e2e4',
      best_lines: [{ multipv: 1, cp: 45, mate: null, pv: ['e2e4', 'e7e5'] }],
      run_id: 18,
    }),
    move(1, 'd5', 'd7d5', {
      classification: 'blunder',
      eval_before_cp: -40,
      eval_after_cp: -300,
      win_before: 46.32,
      win_after: 20,
      win_loss: 26.32,
      best_move_uci: 'c7c6',
      best_lines: [{ multipv: 1, cp: 40, mate: null, pv: ['c7c6', 'd2d4'] }],
      run_id: 18,
      maia: { '1500': [{ uci: 'd7d5', san: 'd5', rank: 1, p: 0.62 }] },
    }),
    move(2, 'exd5', 'e4d5', { eval_after_cp: 310, win_after: 80 }),
    move(3, 'Qxd5', 'd8d5', { eval_after_cp: 305, win_after: 21 }),
  ],
  runs: [
    {
      id: 18,
      tier: 'deep',
      status: 'done',
      engine: 'stockfish',
      engine_kind: 'uci',
      nodes: 400_000,
      multipv: 3,
      finished_at: new Date(Date.now() - 3 * 24 * 3600_000).toISOString(),
    },
  ],
  notes: [
    {
      id: 4,
      text: 'The Scandinavian invites the queen out early; you paid for it on move 2.',
      tags: ['opening'],
      ply: 1,
      scope: 'position',
      created_at: new Date(Date.now() - 2 * 24 * 3600_000).toISOString(),
      updated_at: new Date(Date.now() - 2 * 24 * 3600_000).toISOString(),
    } as GameDetail['notes'] extends (infer T)[] | null | undefined ? T : never,
  ],
}

const QUEUED_RUN: RunResponse = {
  id: 21,
  game_id: 14,
  tier: 'deep',
  status: 'queued',
  multipv: 4,
  priority: 10,
  attempts: 0,
  created_at: new Date().toISOString(),
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
        default_tier: 'deep',
        streams: true,
      },
    ],
  },
  runners: [],
  queue: { queued: 0, running: 0 },
}

let posted: { url: string; body: unknown }[] = []
/** Every `/streams` request, method included — an open and a close are not the same call. */
let streamCalls: { method: string; url: string; body: unknown }[] = []

function stubFetch(overrides: Record<string, unknown> = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.includes('/streams')) {
      const body = init?.body ? JSON.parse(String(init.body)) : null
      streamCalls.push({ method, url, body })
      if (method === 'DELETE') return new Response(null, { status: 204 })
      if (method === 'POST') {
        return json(
          {
            id: 'str_1',
            surface: 'game',
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
    if (method === 'POST') {
      posted.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return json(QUEUED_RUN, 202)
    }
    if (url.includes('/runners/status')) return json(RUNNERS_STATUS)
    for (const [fragment, payload] of Object.entries(overrides)) {
      if (url.includes(fragment)) return json(payload)
    }
    if (url.includes('/games/14')) return json(DETAIL)
    if (url.includes('/analysis/runs')) return json([])
    if (url.includes('/stats/worst-moments')) return json([])
    if (url.includes('/health')) return json({ status: 'ok' })
    if (url.includes('/live')) return json({ active: false, moves: [], arrows: [], squares: [], viewer_count: 0 })
    return json({ error: 'not_found', detail: url }, 404)
  })
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  return render(
    <Providers client={client}>
      <MemoryRouter initialEntries={['/games/14']}>
        <Routes>
          <Route path="/games/:id" element={<GamePage />} />
        </Routes>
      </MemoryRouter>
    </Providers>,
  )
}

beforeEach(() => {
  posted = []
  streamCalls = []
  SilentSocket.instances = []
  vi.stubGlobal('WebSocket', SilentSocket)
  vi.stubGlobal('fetch', stubFetch())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GamePage', () => {
  it('holds the three-column geometry while the payload is in flight', () => {
    renderPage()
    expect(screen.getByTestId('game-skeleton')).toBeInTheDocument()
  })

  it('renders the header, the board, the moves and the engine lines', async () => {
    renderPage()
    expect(await screen.findByText('Scandinavian Defense')).toBeInTheDocument()
    expect(screen.getByText('B01')).toBeInTheDocument()
    expect(screen.getByText('phib')).toBeInTheDocument()
    expect(screen.getByText('1500')).toBeInTheDocument()
    expect(screen.getByText('0–1')).toBeInTheDocument()
    expect(screen.getByText(/analysed .* ago/)).toBeInTheDocument()

    // Board is chessground, at the starting position.
    expect(screen.getByTestId('board').querySelectorAll('piece')).toHaveLength(32)
    expect(screen.getByText('ply 0 / 4')).toBeInTheDocument()

    // Engine lines describe the position on the board, from the run that produced them.
    expect(screen.getByText('stockfish')).toBeInTheDocument()
    expect(screen.getByText('MPV 3')).toBeInTheDocument()

    // The deep-analysis trigger lives in the board's transport row now, next to Flip and
    // Hints, rather than as a card of its own further down the column.
    const deepButton = screen.getByRole('button', { name: 'Deep' })
    expect(
      screen.getByRole('button', { name: '⇅ Flip' }).parentElement?.contains(deepButton),
    ).toBe(true)
  })

  it('puts the multi-PV box over the move table once a deep pass has run', async () => {
    renderPage()
    await screen.findByText('Scandinavian Defense')

    const engine = screen.getByTestId('engine-panel')
    const moveButton = screen.getByRole('button', { name: 'Qxd5' })
    // A finished deep run is in the payload, so the lines lead the column.
    expect(engine.compareDocumentPosition(moveButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('leaves the move table on top while nothing has been analysed', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({ '/games/14': { ...DETAIL, runs: [] } }),
    )
    renderPage()
    await screen.findByText('Scandinavian Defense')

    const engine = screen.getByTestId('engine-panel')
    const moveButton = screen.getByRole('button', { name: 'Qxd5' })
    expect(engine.compareDocumentPosition(moveButton) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  })

  it('steps through plies with the arrow keys and follows with the board', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Scandinavian Defense')

    await user.keyboard('{ArrowRight}')
    expect(screen.getByText('ply 1 / 4')).toBeInTheDocument()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByText('ply 2 / 4')).toBeInTheDocument()
    await user.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}')
    // Never past the starting position.
    expect(screen.getByText('ply 0 / 4')).toBeInTheDocument()
    await user.keyboard('{End}')
    expect(screen.getByText('ply 4 / 4')).toBeInTheDocument()
  })

  it('steps the game with the wheel over the board', async () => {
    renderPage()
    await screen.findByText('Scandinavian Defense')

    const board = screen.getByTestId('board')
    // Down is forwards, and the page underneath must not scroll with it.
    expect(fireEvent.wheel(board, { deltaY: 120 })).toBe(false)
    expect(screen.getByText('ply 1 / 4')).toBeInTheDocument()
    fireEvent.wheel(board, { deltaY: 120 })
    expect(screen.getByText('ply 2 / 4')).toBeInTheDocument()
    fireEvent.wheel(board, { deltaY: -120 })
    expect(screen.getByText('ply 1 / 4')).toBeInTheDocument()
  })

  it('jumps to the position the next flagged move was made from with J', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Scandinavian Defense')

    await user.keyboard('j')
    // The blunder is ply 1, so the board sits after ply 0 — where the decision was made.
    expect(screen.getByText('ply 1 / 4')).toBeInTheDocument()
    // Maia is a panel under the engine lines now, not a card floating over the board.
    expect(screen.getByTestId('maia-panel')).toHaveTextContent('Maia 1500')
    expect(screen.getByTestId('board').contains(screen.getByTestId('maia-panel'))).toBe(false)
    expect(screen.getByText('played')).toBeInTheDocument()
  })

  it('tints the played engine line only where the engine flagged it', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Scandinavian Defense')

    // Ply 0 was the engine's own top line, so the played row keeps the design's neutral
    // treatment rather than being painted as a verdict.
    const top = screen.getByTestId('engine-played-line')
    expect(top).not.toHaveAttribute('style')
    expect(top.querySelector('span')).toHaveClass('bg-cell-strong')

    // The blunder on ply 1 is tinted in its own colour — mixed from the token, so it
    // survives as CSS and follows the theme.
    await user.keyboard('j')
    const flagged = screen.getByTestId('engine-played-line')
    expect(flagged.style.background).toBe(
      'color-mix(in srgb, var(--bb-blunder) 6%, transparent)',
    )
    expect(flagged.querySelector('span')?.getAttribute('style')).toContain(
      'color-mix(in srgb, var(--bb-blunder) 13%, transparent)',
    )
    expect(screen.getByText('played').getAttribute('style')).toContain(
      'color-mix(in srgb, var(--bb-blunder) 35%, transparent)',
    )
  })

  it('seeks a note to the position it was written about, not one ply past it', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(
      await screen.findByRole('button', { name: /The Scandinavian invites the queen out early/ }),
    )
    // The note hangs off the position before 1…d5, so the board stops there and the engine
    // panel is about the blunder rather than about White's reply.
    expect(screen.getByText('ply 1 / 4')).toBeInTheDocument()
    expect(screen.getByText('played')).toBeInTheDocument()
  })

  it('jumps the board when a move in the list is clicked', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Scandinavian Defense')
    await user.click(screen.getByRole('button', { name: 'Qxd5' }))
    expect(screen.getByText('ply 4 / 4')).toBeInTheDocument()
  })

  it('shows the coach’s notes with their MCP attribution', async () => {
    renderPage()
    expect(await screen.findByText(/The Scandinavian invites the queen out early/)).toBeInTheDocument()
    expect(screen.getAllByText('blunderbase-mcp').length).toBeGreaterThan(0)
    expect(screen.getByText('via MCP')).toBeInTheDocument()
  })

  it('posts a deep run and then reflects the queued run in the chrome', async () => {
    const user = userEvent.setup()
    const { rerender } = renderPage()
    await screen.findByText('Scandinavian Defense')

    await user.click(screen.getByRole('button', { name: 'Deep' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].url).toContain('/analysis')
    expect(posted[0].body).toEqual({ game_id: 14, tier: 'deep' })

    // The run list now answers with the queued run; the button and the header follow it.
    vi.stubGlobal('fetch', stubFetch({ '/analysis/runs': [QUEUED_RUN] }))
    rerender(<div />)
    renderPage()
    await waitFor(() =>
      expect(screen.getAllByText('Queued').length).toBeGreaterThan(0),
    )
  })

  it('cannot be pressed into two deep passes while the run list catches up', async () => {
    // `POST /analysis` never dedupes, and `/analysis/runs` only learns about the run a
    // debounced invalidation and a refetch later. Between the two the button must already
    // be disabled, or an impatient second click queues a whole second pass.
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Scandinavian Defense')

    const trigger = screen.getByRole('button', { name: 'Deep' })
    await user.click(trigger)
    await waitFor(() => expect(posted).toHaveLength(1))

    // The run list still answers with [] — only the mutation's own run stands in, and the
    // button is disabled while it is active.
    expect(trigger).toBeDisabled()

    // Clicking a disabled button is not a second request.
    await user.click(trigger).catch(() => {})
    expect(posted).toHaveLength(1)
  })

  it('follows only the run the button is tracking through the progress frames', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Scandinavian Defense')
    await user.click(screen.getByRole('button', { name: 'Deep' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    // The mutation's own run stands in until the run list catches up: run 21, deep. No
    // progress frame has arrived yet, so the button just sits disabled.
    expect(screen.getByRole('button', { name: 'Deep' })).toBeDisabled()

    const socket = SilentSocket.instances.at(-1)!
    // The quick pass an import auto-queued over the same game is not this button's run.
    socket.emit({
      event: 'analysis.progress',
      run_id: 99,
      game_id: 14,
      tier: 'quick',
      status: 'running',
      done: 2,
      total: 4,
    })
    expect(screen.getByRole('button', { name: 'Deep' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '50%' })).toBeNull()

    socket.emit({
      event: 'analysis.progress',
      run_id: 21,
      game_id: 14,
      tier: 'deep',
      status: 'running',
      done: 3,
      total: 4,
    })
    expect(screen.getByRole('button', { name: '75%' })).toBeInTheDocument()

    // …and the quick run finishing does not wipe the deep run's counter.
    socket.emit({
      event: 'analysis.done',
      run_id: 99,
      game_id: 14,
      tier: 'quick',
      status: 'done',
    })
    expect(screen.getByRole('button', { name: '75%' })).toBeInTheDocument()
  })

  it('tells a 404 apart from a failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'unknown_game', detail: 'no game with id 14' }, 404)),
    )
    renderPage()
    expect(await screen.findByText('No such game')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to the library' })).toBeInTheDocument()
  })

  it('stays useful for a game nothing has analysed yet', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/games/14': {
          ...DETAIL,
          moves: DETAIL.moves.map((row) => ({
            ply: row.ply,
            move_number: row.move_number,
            san: row.san,
            uci: row.uci,
          })),
          runs: [],
          notes: [],
        },
      }),
    )
    renderPage()
    await screen.findByText('Scandinavian Defense')
    expect(screen.getByText('Unanalysed')).toBeInTheDocument()
    expect(screen.getByText(/No evaluations yet/)).toBeInTheDocument()
    expect(screen.getByText('No engine lines for this position.')).toBeInTheDocument()
    expect(screen.getByText(/No notes on this game yet/)).toBeInTheDocument()
    expect(screen.getByText('No engine run')).toBeInTheDocument()
    // The deep pass is the obvious next thing to do, so the button is idle and enabled
    // rather than describing a run that has already happened.
    expect(screen.getByRole('button', { name: 'Deep' })).toBeEnabled()
  })

  it('offers a live search under the stored run, and opens one when asked', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Scandinavian Defense')

    // Two panels, two claims: what the run concluded, and what an engine could find now.
    expect(screen.getByText('stockfish')).toBeInTheDocument()
    expect(screen.getByText('Analyse this position continuously.')).toBeInTheDocument()
    // Nothing is opened until the reader asks.
    expect(streamCalls).toHaveLength(0)

    await user.click(
      screen.getByRole('switch', { name: 'Analyse this position continuously' }),
    )
    await waitFor(() => expect(streamCalls.filter((c) => c.method === 'POST')).toHaveLength(1))
    expect(streamCalls[0]!.body).toMatchObject({
      surface: 'game',
      game_id: 14,
      ply: 0,
      engine_id: null,
      // The starting position, because that is where the board is.
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    })
  })

  it('reads the live lines in the same frame as the run stacked above them', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Scandinavian Defense')

    // Ply 1: Black to move, and the stored run says +0.40 — White's frame, the way
    // `MoveEval.best_lines` is written and every other evaluation on this page is drawn.
    await user.keyboard('{ArrowRight}')
    expect(screen.getByText('ply 1 / 4')).toBeInTheDocument()

    await user.click(
      screen.getByRole('switch', { name: 'Analyse this position continuously' }),
    )
    await waitFor(() => expect(streamCalls.filter((c) => c.method === 'POST')).toHaveLength(1))
    const { fen } = streamCalls[0]!.body as { fen: string }

    SilentSocket.instances.at(-1)!.emit({
      event: 'stream.snapshot',
      session_id: 'str_1',
      seq: 1,
      engine_id: 1,
      engine: 'stockfish',
      runner_id: null,
      fen,
      multipv: 3,
      depth: 22,
      nodes: 1_000,
      nps: 500,
      time_ms: 1_000,
      // The wire is side-to-move relative: Black, to move, is 0.40 worse off.
      lines: [{ multipv: 1, cp: -40, mate: null, pv: ['c7c6'] }],
      at: new Date().toISOString(),
    })

    const live = within(screen.getByTestId('infinite-analysis'))
    expect(live.getAllByTestId('infinite-analysis-line')).toHaveLength(1)
    // Not −0.40: the same engine may not disagree with itself between two panels an inch
    // apart, so the panel says what the run above it would have said.
    expect(live.getByText('+0.40')).toBeInTheDocument()
    expect(live.queryByText('−0.40')).not.toBeInTheDocument()
    // The stored run's own row for this position, unchanged, says the same number.
    expect(screen.getAllByText('+0.40').length).toBeGreaterThan(1)
  })
})
