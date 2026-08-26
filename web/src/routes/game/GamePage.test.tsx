import { QueryClient } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import type { GameDetail, MoveRow, RunResponse } from '@/lib/api/types'

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

let posted: { url: string; body: unknown }[] = []

function stubFetch(overrides: Record<string, unknown> = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === 'POST') {
      posted.push({ url, body: init.body ? JSON.parse(String(init.body)) : null })
      return json(QUEUED_RUN, 202)
    }
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

  it('jumps to the position the next flagged move was made from with J', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Scandinavian Defense')

    await user.keyboard('j')
    // The blunder is ply 1, so the board sits after ply 0 — where the decision was made.
    expect(screen.getByText('ply 1 / 4')).toBeInTheDocument()
    expect(screen.getByTestId('maia-overlay')).toHaveTextContent('Maia 1500')
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

    await user.click(screen.getByRole('button', { name: 'Request deep analysis' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].url).toContain('/analysis')
    expect(posted[0].body).toEqual({ game_id: 14, tier: 'deep' })

    // The run list now answers with the queued run; the card and the header follow it.
    vi.stubGlobal('fetch', stubFetch({ '/analysis/runs': [QUEUED_RUN] }))
    rerender(<div />)
    renderPage()
    await waitFor(() =>
      expect(screen.getAllByText('Queued').length).toBeGreaterThan(0),
    )
  })

  it('follows only the run the card is tracking through the progress frames', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Scandinavian Defense')
    await user.click(screen.getByRole('button', { name: 'Request deep analysis' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    // The mutation's own run stands in until the run list catches up: run 21, deep.
    expect(await screen.findByText('run #21')).toBeInTheDocument()

    const socket = SilentSocket.instances.at(-1)!
    // The quick pass an import auto-queued over the same game is not this card's run.
    socket.emit({
      event: 'analysis.progress',
      run_id: 99,
      game_id: 14,
      tier: 'quick',
      status: 'running',
      done: 2,
      total: 4,
    })
    expect(screen.getByText('run #21')).toBeInTheDocument()
    expect(screen.queryByText('2/4')).not.toBeInTheDocument()

    socket.emit({
      event: 'analysis.progress',
      run_id: 21,
      game_id: 14,
      tier: 'deep',
      status: 'running',
      done: 3,
      total: 4,
    })
    expect(screen.getByText('3/4')).toBeInTheDocument()

    // …and the quick run finishing does not wipe the deep run's counter.
    socket.emit({
      event: 'analysis.done',
      run_id: 99,
      game_id: 14,
      tier: 'quick',
      status: 'done',
    })
    expect(screen.getByText('3/4')).toBeInTheDocument()
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
    // The deep pass is the obvious next thing to do, so the card offers it rather than
    // describing a run that has already happened.
    expect(screen.getByRole('button', { name: 'Request deep analysis' })).toBeInTheDocument()
  })
})
