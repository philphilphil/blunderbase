import { QueryClient } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import type {
  GameDetail,
  LineResponse,
  MoveRow,
  NoteResponse,
  RunResponse,
  RunnersStatus,
} from '@/lib/api/types'
import { EventsProvider } from '@/lib/events/EventsProvider'

import { toast } from '@/lib/toast'
import { MOBILE_QUERY } from '@/lib/ui/media'

import { COMPOSER_TEXT_ID } from './components/NoteComposer'
import { GamePage, MOVES_WIDTH_KEY } from './GamePage'
import { resetSessionVariations } from './sessionVariations'

// The Deep button has nowhere to put a red sentence, so a refused run is toasted. Mocked
// rather than rendered: what these tests are about is that the backend's own words get
// there, not how sonner draws them.
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }))

// jsdom builds PointerEvents but captures nothing, and the splitter asks for the capture
// before it reads a single delta.
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = function setPointerCapture() {}
  Element.prototype.releasePointerCapture = function releasePointerCapture() {}
  Element.prototype.hasPointerCapture = function hasPointerCapture() {
    return false
  }
}

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
  // The owner's own tree from the starting position: two continuations he has been down
  // before. Keyed by the ply the position precedes, as the service ships it.
  book: {
    0: {
      games: 9,
      moves: [
        { uci: 'e2e4', san: 'e4', games: 6, wins: 3, draws: 1, losses: 2, avg_win_loss: 9 },
        { uci: 'd2d4', san: 'd4', games: 3, wins: 0, draws: 1, losses: 2, avg_win_loss: 16 },
      ],
    },
  },
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
      // Written elsewhere — it names no game — and reaching this one through the position
      // it is about, which is what `scope: 'position'` means. The Notes panel marks such a
      // row as somebody else's, and the composer will not rewrite it.
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
        streams: true,
      },
    ],
  },
  runners: [],
  queue: { queued: 0, running: 0 },
}

let posted: { url: string; body: unknown }[] = []

/**
 * How the next POST is refused, when a test is about the refusal. `null` is the ordinary
 * case, where every write is accepted.
 */
let refusePost: { status: number; body: unknown } | null = null
/**
 * The pinned lines the stubbed backend is holding. Set by the tests that care; the fold of
 * pinned and session lines is exercised as a pure function in `variationRows.test.ts`, so
 * what these tests are about is the wiring — what is drawn, and what is written.
 */
let lineRows: LineResponse[] = []

const NOTE_TAGS = [{ tag: 'opening', notes: 3 }]

/** `POST /notes` answered the way the backend does: the note with its anchors resolved. */
function savedNote(body: Record<string, unknown>): NoteResponse {
  const now = new Date().toISOString()
  return {
    id: 99,
    text: String(body.text ?? ''),
    tags: (body.tags as string[] | undefined) ?? [],
    game_id: (body.game_id as number | undefined) ?? null,
    ply: (body.ply as number | undefined) ?? null,
    line_id: body.line ? 7 : ((body.line_id as number | undefined) ?? null),
    source: 'web',
    created_at: now,
    updated_at: now,
  }
}
/** Every `/streams` request, method included — an open and a close are not the same call. */
let streamCalls: { method: string; url: string; body: unknown }[] = []

/** What the live Maia endpoint answers after 1.e4 d5, at the deployment's target elo. */
const MAIA_LIVE = {
  elo: 1700,
  policy: [
    { uci: 'e4d5', san: 'exd5', rank: 1, p: 0.71 },
    { uci: 'b1c3', san: 'Nc3', rank: 2, p: 0.12 },
  ],
  rollout: [
    { uci: 'e4d5', san: 'exd5', p: 0.71 },
    { uci: 'd8d5', san: 'Qxd5', p: 0.64 },
  ],
}

function stubFetch(
  overrides: Record<string, unknown> = {},
  { maiaStatus = 200 }: { maiaStatus?: number } = {},
) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.includes('/maia/policy')) {
      posted.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      if (maiaStatus !== 200) {
        return json({ error: 'maia_unavailable', detail: 'No local Maia engine.' }, maiaStatus)
      }
      return json(MAIA_LIVE)
    }
    if (url.includes('/auth/status')) {
      return json({ setup_required: false, authenticated: true, maia_target_elo: 1700 })
    }
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
    if (url.includes('/notes/tags')) return json(NOTE_TAGS)
    // `/games/14/lines` would otherwise be answered by the `/games/14` fragment below, and
    // a game detail is not a list of lines.
    if (url.includes('/lines') || url.includes('/notes')) {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
      if (method === 'POST') {
        posted.push({ url, body })
        return url.includes('/notes')
          ? json(savedNote(body ?? {}), 201)
          : json(lineRows[0] ?? { id: 7, game_id: 14, base_ply: 0, moves: [], sans: [] }, 201)
      }
      if (method === 'DELETE') {
        posted.push({ url, body: null })
        return new Response(null, { status: 204 })
      }
      // Only an override that names this collection: `'/games/14'` is a fragment of
      // `/games/14/lines` too, and a game detail is not a list of lines.
      for (const [fragment, payload] of Object.entries(overrides)) {
        if ((fragment.includes('/lines') || fragment.includes('/notes')) && url.includes(fragment)) {
          return json(payload)
        }
      }
      return json(url.includes('/lines') ? lineRows : [])
    }
    if (method === 'POST') {
      posted.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      if (refusePost) return json(refusePost.body, refusePost.status)
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

/**
 * `Providers` no longer carries the `/events` socket — it hangs inside `AuthGate`, so a
 * signed-out browser never dials it. A test that mounts a page on its own is standing in
 * for the authenticated side of that gate, so it supplies the provider the gate would.
 */
function renderPage(entry = '/games/14') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  return render(
    <Providers client={client}>
      <EventsProvider>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/games/:id" element={<GamePage />} />
          </Routes>
        </MemoryRouter>
      </EventsProvider>
    </Providers>,
  )
}

beforeEach(() => {
  posted = []
  refusePost = null
  streamCalls = []
  lineRows = []
  vi.mocked(toast.error).mockClear()
  SilentSocket.instances = []
  // Kept lines are session-scoped, and a test file is one session: each test starts on a
  // game nobody has read yet.
  resetSessionVariations()
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
    expect(screen.getByText('0–1')).toBeInTheDocument()
    expect(screen.getByText(/analysed .* ago/)).toBeInTheDocument()

    // The players are no longer part of the header line: they are two slim rows flanking
    // the board, one per side, each with its own name and rating. The board is white-side
    // up (the owner's colour), so the black row is the one above it.
    const [top, bottom] = screen.getAllByTestId('player-row')
    expect([top?.dataset.side, bottom?.dataset.side]).toEqual(['black', 'white'])
    expect(within(bottom!).getByText('phib')).toBeInTheDocument()
    expect(within(bottom!).getByText('1500')).toBeInTheDocument()
    expect(within(top!).getByText('lichess AI level 2')).toBeInTheDocument()

    // Board is chessground, at the starting position. The board is playable (a move
    // branches an analysis line off the game), so chessground keeps a drag ghost of its
    // own alongside the 32 real pieces.
    expect(screen.getByTestId('board').querySelectorAll('piece:not(.ghost)')).toHaveLength(32)
    expect(screen.getByText('ply 0 / 4')).toBeInTheDocument()

    // Engine lines describe the position on the board, from the run that produced them —
    // named, with its spend, over the engine column of the one box that carries them.
    expect(within(screen.getByTestId('maia-panel')).getByText('stockfish')).toBeInTheDocument()
    expect(screen.getByText('MPV 3')).toBeInTheDocument()

    // The deep-analysis trigger lives in the board's transport row now, next to Flip and
    // Hints, rather than as a card of its own further down the column.
    const deepButton = screen.getByRole('button', { name: 'Deep' })
    expect(
      screen.getByRole('button', { name: '⇅ Flip' }).parentElement?.contains(deepButton),
    ).toBe(true)
  })

  it('puts both players’ Lichess-style totals to the left of the evaluation chart', async () => {
    const counted: GameDetail = {
      ...DETAIL,
      moves: DETAIL.moves.map((row, index) => ({
        ...row,
        by_owner: index % 2 === 0,
        classification:
          index === 0
            ? 'mistake'
            : index === 1 || index === 3
              ? 'blunder'
              : 'inaccuracy',
      })),
    }
    vi.stubGlobal('fetch', stubFetch({ '/games/14': counted }))

    renderPage()
    await screen.findByText('Evaluation')

    const summary = screen.getByTestId('player-summaries')
    const plot = screen.getByTestId('evaluation-plot')
    expect(screen.getByRole('checkbox', { name: 'only mine' })).toBeChecked()

    // Two labelled clusters now, white first — the half of the curve above the axis — each
    // naming its own player rather than saying You/Opponent, and each stating its counts as
    // a glyph-coloured number plus ACPL. The counts stay two-player whatever "only mine"
    // says: that checkbox hides the opponent's marks on the plot, not the arithmetic.
    const [white, black] = within(summary).getAllByRole('group')
    expect(white).toHaveAccessibleName(
      /^phib: 0 blunders, 1 mistakes, 1 inaccuracies, \d+ average centipawn loss$/,
    )
    expect(black).toHaveAccessibleName(
      /^lichess AI level 2: 2 blunders, 0 mistakes, 0 inaccuracies, .* centipawn loss$/,
    )
    // Count and glyph are separate cells, not one token: that is what lets the numbers line
    // up in a column of their own, which is the whole reason the block reads down the page.
    expect(within(white!).getByTitle('1 mistakes')).toHaveTextContent(/^1$/)
    expect(within(black!).getByTitle('2 blunders')).toHaveTextContent(/^2$/)
    expect(within(white!).getByText('??')).toBeInTheDocument()
    expect(within(white!).getByTitle('Average centipawn loss')).toHaveTextContent(/^ACPL$/)
    const tally = within(white!).getByTitle('0 blunders').parentElement!
    expect(
      Array.from(tally.children)
        .map((cell) => cell.getAttribute('title'))
        .filter(Boolean),
    ).toEqual(['0 blunders', '1 inaccuracies', '1 mistakes', 'Average centipawn loss'])
    expect(summary.compareDocumentPosition(plot)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('walks a book continuation on the board, as a line like any other', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Scandinavian Defense')

    // The board is at the start, where the fixture's book has two continuations.
    const row = await screen.findByRole('row', { name: /d4/ })
    await user.click(row)

    // Clicking one walks it: the board leaves the game line and the move joins the list as
    // a variation, exactly as clicking an engine line's first move does.
    expect(await screen.findByTestId('board-column')).toBeInTheDocument()
    expect(screen.getByText('Back to game')).toBeInTheDocument()
  })

  it('puts the multi-PV box over the move table once a deep pass has run', async () => {
    renderPage()
    await screen.findByText('Scandinavian Defense')

    const engine = screen.getByTestId('maia-panel')
    const moveButton = screen.getByRole('button', { name: 'Qxd5' })
    // A finished deep run is in the payload, so the lines lead the column.
    expect(engine.compareDocumentPosition(moveButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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
    // Scoped to the panel: the board draws a "played" badge of its own on the arrow when
    // the move the game played is also a move an engine recommends.
    expect(within(screen.getByTestId('maia-panel')).getByText('played')).toBeInTheDocument()
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
    expect(
      within(screen.getByTestId('maia-panel')).getByText('played').getAttribute('style'),
    ).toContain('color-mix(in srgb, var(--bb-blunder) 35%, transparent)')
  })

  it('jumps the board when a move in the list is clicked', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Scandinavian Defense')
    await user.click(screen.getByRole('button', { name: 'Qxd5' }))
    expect(screen.getByText('ply 4 / 4')).toBeInTheDocument()
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

  it('toasts the engine sentence when the deep run is refused', async () => {
    // Nothing falls back: if the engine assigned to Deep is on a machine that is away, the
    // press is refused with a sentence naming it, and the button's only trace of that is a
    // tint and a tooltip nobody hovers.
    const user = userEvent.setup()
    refusePost = {
      status: 409,
      body: {
        error: 'tier_unavailable',
        detail: "'sf-nuc' runs on 'nuc', which is not connected",
      },
    }
    renderPage()
    await screen.findByText('Scandinavian Defense')

    await user.click(screen.getByRole('button', { name: 'Deep' }))

    // The backend's own words, passed through rather than replaced by a generic one.
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("'sf-nuc' runs on 'nuc', which is not connected"),
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
    // An empty column is a bare dash, not a sentence.
    expect(within(screen.getByTestId('maia-panel')).getAllByText('–').length).toBeGreaterThan(0)
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
    expect(within(screen.getByTestId('maia-panel')).getByText('stockfish')).toBeInTheDocument()
    // At rest the live panel offers the switch itself — the continuous controls are on the
    // footer, not behind anything that has to be opened first.
    expect(
      screen.getByRole('switch', { name: 'Analyse this position continuously' }),
    ).toBeInTheDocument()
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

  it('follows the live search on the board’s eval bar, not the stored eval', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Scandinavian Defense')
    await user.keyboard('{ArrowRight}')
    expect(screen.getByText('ply 1 / 4')).toBeInTheDocument()

    // Before any live search, the bar says what the game's own run stored for this ply.
    const bar = () => screen.getByRole('img', { name: /Evaluation/ })
    expect(bar()).toHaveAttribute('title', expect.stringContaining('+0.40'))

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
      multipv: 1,
      depth: 22,
      nodes: 1_000,
      nps: 500,
      time_ms: 1_000,
      // Side-to-move (Black) relative: Black up five pawns — wildly unlike the stored
      // +0.40, so the assertion below can only pass if the bar switched to the live line.
      lines: [{ multipv: 1, cp: 500, mate: null, pv: ['c7c6'] }],
      at: new Date().toISOString(),
    })

    await waitFor(() => expect(bar()).toHaveAttribute('title', expect.stringContaining('−5.00')))
  })

  it('reads the human column at the deployment’s target elo, not at the game’s rating', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/games/14': {
          ...DETAIL,
          moves: DETAIL.moves.map((row) =>
            row.ply === 1
              ? {
                  ...row,
                  maia: {
                    '1500': [{ uci: 'd7d5', san: 'd5', rank: 1, p: 0.62 }],
                    '1700': [{ uci: 'd7d5', san: 'd5', rank: 1, p: 0.55 }],
                  },
                }
              : row,
          ),
        },
      }),
    )
    renderPage()
    await screen.findByText('Scandinavian Defense')
    await user.keyboard('j')

    // The game was played at 1500 and the blob still carries that band, but the pass was
    // pinned to 1700 — which is the level the panel and the board arrow speak for.
    await waitFor(() => expect(screen.getByTestId('maia-panel')).toHaveTextContent('Maia 1700'))
    expect(screen.getByTestId('maia-panel')).toHaveTextContent('55%')
  })

  it('puts the played move beside the engine’s own moves, and marks it', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Scandinavian Defense')
    await user.keyboard('j')

    const panel = screen.getByTestId('maia-panel')
    // 62% of players at this level walk into the blunder — popularity beside cost is the
    // whole reason the two columns are one card.
    expect(panel).toHaveTextContent('62%')
    expect(within(screen.getByTestId('maia-played-row')).getByText('d5')).toHaveClass(
      'text-blunder',
    )
    // The engine's own column is in the same card, over its stored line.
    expect(within(panel).getByText('stockfish')).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'c6' })).toBeInTheDocument()
  })

  it('goes live off the game line, and walks the rollout back onto the board', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Scandinavian Defense')
    await user.keyboard('j')

    // Playing the human column's own move branches an analysis line off the game.
    await user.click(screen.getByTestId('maia-played-row'))
    expect(screen.getByText('analysis +1')).toBeInTheDocument()

    // The affordance is immediate; the query behind it is debounced (see `useLiveMaia`),
    // so a reader clicking through a line does not ask about every position on the way.
    expect(screen.getByTestId('maia-live')).toBeInTheDocument()

    await waitFor(() =>
      expect(posted.filter((call) => call.url.includes('/maia/policy'))).toHaveLength(1),
    )
    expect(posted.filter((call) => call.url.includes('/maia/policy'))[0].body).toMatchObject({
      // The position after 1.e4 d5 — not the game position the line left from.
      fen: 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
      elo: 1700,
      rollout_plies: 8,
    })

    // The rollout is a line to walk into: clicking its second move plays both.
    const rollout = within(screen.getByTestId('maia-rollout'))
    await user.click(rollout.getByRole('button', { name: 'Qxd5' }))
    expect(screen.getByText('analysis +3')).toBeInTheDocument()

    // And back to the game, where the stored data is instant and nothing is queried.
    await user.click(screen.getByRole('button', { name: /Back to game/ }))
    expect(screen.getByText('ply 1 / 4')).toBeInTheDocument()
    expect(screen.queryByTestId('maia-live')).not.toBeInTheDocument()
  })

  it('empties the board’s eval bar once the reader steps off the game line', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Scandinavian Defense')
    await user.keyboard('j')

    // On the game line, the bar says the stored eval after 1.e4.
    const bar = () => screen.getByRole('img', { name: /Evaluation/ })
    expect(bar()).toHaveAttribute('title', expect.stringContaining('+0.40'))

    // Playing the human column's own move branches an analysis line off the game.
    await user.click(screen.getByTestId('maia-played-row'))
    expect(screen.getByText('analysis +1')).toBeInTheDocument()

    // No live search is running on the analysis position, so the bar goes to "not
    // analysed" rather than keep showing the game position's eval under a board that has
    // left it.
    expect(bar()).toHaveAttribute('title', 'not analysed')
  })

  it('keeps the analysis board walkable after a click the position cannot take', async () => {
    // The stub answers every position with the same policy, so deep in a line some of the
    // moves it offers are no longer legal. A click on one of those must be a no-op and
    // nothing more: the line the board is actually standing on is what the next click
    // extends, never the raw list an illegal move was appended to.
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Scandinavian Defense')
    await user.keyboard('j')

    await user.click(screen.getByTestId('maia-played-row'))
    const rollout = () => within(screen.getByTestId('maia-rollout'))
    await waitFor(() => expect(rollout().getByRole('button', { name: 'Qxd5' })).toBeEnabled())
    await user.click(rollout().getByRole('button', { name: 'Qxd5' }))
    expect(screen.getByText('analysis +3')).toBeInTheDocument()

    // exd5 belongs to the position two moves back; e4 is empty here, so the board holds.
    const panel = () => within(screen.getByTestId('maia-panel'))
    await waitFor(() =>
      expect(panel().getByTitle('Play exd5 on the analysis board')).toBeEnabled(),
    )
    await user.click(panel().getByTitle('Play exd5 on the analysis board'))
    expect(screen.getByText('analysis +3')).toBeInTheDocument()

    // And the next legal move still plays, rather than landing behind the dead one.
    await user.click(panel().getByTitle('Play Nc3 on the analysis board'))
    expect(screen.getByText('analysis +4')).toBeInTheDocument()
  })

  it('walks into a clicked engine line and keeps the rest of it to step through', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Scandinavian Defense')
    // The position the blunder was played from: the run's line here is 1…c6 2.d4.
    await user.keyboard('j')

    // Clicking its *first* move puts the board one move in — and keeps the second.
    const panel = () => within(screen.getByTestId('maia-panel'))
    await user.click(panel().getByRole('button', { name: 'c6' }))
    expect(screen.getByText('analysis +1')).toBeInTheDocument()

    // The line is in the move table, under move 1 — the move it branched from — with the
    // move the board is standing on lit and the rest of it still there.
    const variation = () => within(screen.getByTestId('move-variation'))
    expect(screen.getByTestId('move-variation')).toHaveTextContent('(1…c62.d4)')
    expect(variation().getByRole('button', { name: 'c6' }).className).toContain('bg-brilliant')
    expect(variation().getByRole('button', { name: 'd4' }).className).not.toContain('bg-brilliant')

    // The wheel over the board now walks the line rather than the game: forwards is the
    // rest of the line, and nothing about the game cursor moves.
    fireEvent.wheel(screen.getByTestId('board'), { deltaY: 120 })
    expect(screen.getByText('analysis +2')).toBeInTheDocument()
    expect(variation().getByRole('button', { name: 'd4' }).className).toContain('bg-brilliant')
    // …and the line ends there: it cannot be wheeled past its own last move.
    fireEvent.wheel(screen.getByTestId('board'), { deltaY: 120 })
    expect(screen.getByText('analysis +2')).toBeInTheDocument()

    // Clicking a move of the line is the same walk by hand.
    await user.click(variation().getByRole('button', { name: 'c6' }))
    expect(screen.getByText('analysis +1')).toBeInTheDocument()
  })

  it('steps back out of the line at its head, onto the game position it left', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Scandinavian Defense')
    await user.keyboard('j')

    await user.click(within(screen.getByTestId('maia-panel')).getByRole('button', { name: 'd4' }))
    expect(screen.getByText('analysis +2')).toBeInTheDocument()

    // Back through the line, move by move, to the position it branched from — where the
    // line is still on screen, waiting to be walked again.
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByText('analysis +1')).toBeInTheDocument()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByText('analysis +0')).toBeInTheDocument()
    expect(screen.getByTestId('move-variation')).toBeInTheDocument()

    // One more step back leaves it: the board is on the game, and the line is gone.
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByText('ply 1 / 4')).toBeInTheDocument()
    expect(screen.queryByTestId('move-variation')).not.toBeInTheDocument()

    // …and the game's own transport works again from there.
    await user.keyboard('{ArrowRight}')
    expect(screen.getByText('ply 2 / 4')).toBeInTheDocument()
  })

  it('empties the human column where the deployment has no Maia to ask', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', stubFetch({}, { maiaStatus: 409 }))
    renderPage()
    await screen.findByText('Scandinavian Defense')
    await user.keyboard('j')
    // Stored data is still there — the 409 is only about positions nobody analysed.
    expect(screen.getByTestId('maia-panel')).toHaveTextContent('Maia 1500')

    await user.click(screen.getByTestId('maia-played-row'))
    await waitFor(() =>
      expect(posted.filter((call) => call.url.includes('/maia/policy'))).toHaveLength(1),
    )
    // Degrade, don't error: the human column empties but keeps its place, and the box and
    // the analysis board stay.
    await waitFor(() => expect(screen.queryByTestId('maia-live')).not.toBeInTheDocument())
    const panel = screen.getByTestId('maia-panel')
    expect(
      within(panel).queryByText('No human model for this position.'),
    ).not.toBeInTheDocument()
    expect(within(panel).getByText('stockfish')).toBeInTheDocument()
    expect(screen.getByText('analysis +1')).toBeInTheDocument()
  })

  it('keeps a walked line in the move list once the board has left it', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Scandinavian Defense')
    await user.keyboard('j')

    // The run's line here is 1…c6 2.d4; clicking its first move walks into it.
    await user.click(within(screen.getByTestId('maia-panel')).getByRole('button', { name: 'c6' }))
    expect(screen.getByText('analysis +1')).toBeInTheDocument()

    // Leaving it no longer throws it away: it drops to the quiet list, whole — the tail the
    // reader never walked included.
    await user.click(screen.getByRole('button', { name: /Back to game/ }))
    expect(screen.getByText('ply 1 / 4')).toBeInTheDocument()
    expect(screen.queryByTestId('move-variation')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('kept-variation')).toHaveLength(1)
    expect(screen.getByTestId('kept-variation')).toHaveTextContent('(1…c62.d4)')
  })

  it('walks back into a kept line, from wherever the game cursor happens to be', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Scandinavian Defense')
    await user.keyboard('j')
    await user.click(within(screen.getByTestId('maia-panel')).getByRole('button', { name: 'c6' }))
    await user.click(screen.getByRole('button', { name: /Back to game/ }))

    // The board is taken to the far end of the game before going back in, so the line has
    // to bring the game cursor back to the position it hangs off rather than assume it.
    await user.keyboard('{End}')
    expect(screen.getByText('ply 4 / 4')).toBeInTheDocument()

    const kept = () => within(screen.getByTestId('kept-variation'))
    await user.click(kept().getByRole('button', { name: 'd4' }))
    // The board lands on the second move of the line, which is what was clicked.
    expect(screen.getByText('analysis +2')).toBeInTheDocument()

    // It is the active line now, drawn once: lit, walkable, and no longer listed twice.
    expect(screen.queryByTestId('kept-variation')).not.toBeInTheDocument()
    const variation = () => within(screen.getByTestId('move-variation'))
    expect(variation().getByRole('button', { name: 'd4' }).className).toContain('bg-brilliant')

    // …and it walks like a fresh one, back through its head and out onto the game position
    // it hangs off — ply 1, not the ply 4 the cursor was left on.
    fireEvent.wheel(screen.getByTestId('board'), { deltaY: -120 })
    expect(screen.getByText('analysis +1')).toBeInTheDocument()
    await user.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(screen.getByText('ply 1 / 4')).toBeInTheDocument()
    expect(screen.getByTestId('kept-variation')).toHaveTextContent('(1…c62.d4)')
  })

  it('holds the kept lines across a visit to another page and back', async () => {
    const user = userEvent.setup()
    const view = renderPage()
    await screen.findByText('Scandinavian Defense')
    await user.keyboard('j')
    await user.click(within(screen.getByTestId('maia-panel')).getByRole('button', { name: 'c6' }))
    await user.click(screen.getByRole('button', { name: /Back to game/ }))
    expect(screen.getByTestId('kept-variation')).toBeInTheDocument()

    // Navigating away unmounts the whole studio; the lines live outside it, so coming back
    // to the game finds the session's reading still in the table.
    view.unmount()
    renderPage()
    await screen.findByText('Scandinavian Defense')
    expect(await screen.findByTestId('kept-variation')).toHaveTextContent('(1…c62.d4)')
  })

  it('empties both engine columns when the hints are switched off', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Scandinavian Defense')
    await user.keyboard('j')

    const panel = () => screen.getByTestId('maia-panel')
    expect(panel()).toHaveTextContent('Maia 1500')
    expect(within(panel()).getByText('played')).toBeInTheDocument()

    // One gesture, one meaning: an answer is an answer whichever engine gives it, so the
    // human column and Stockfish's lines go quiet together. Both panes keep their place and
    // their header, so nothing on the page moves.
    await user.click(screen.getByRole('button', { name: 'Hints' }))
    expect(within(panel()).queryByText(/%$/)).not.toBeInTheDocument()
    expect(within(panel()).queryByText('played')).not.toBeInTheDocument()
    expect(within(panel()).getByText('stockfish')).toBeInTheDocument()
    expect(panel()).toHaveTextContent('Maia 1500')
  })
})

/**
 * The clamp is arithmetic over three things jsdom does not have: a laid-out row, a viewport
 * wide enough to be in a band, and a scaled root. `rowWidth` supplies the first two — the
 * row's measured width, and the `innerWidth` the floors are chosen by — and the third is
 * jsdom's own 16px `rem`, so a 1200px row is 75rem here.
 *
 * `viewport` defaults to the row's own width, which is the coherent case. The board-floor
 * test passes a wider one on purpose: below `xl` the board has no floor at all (`BANDS`),
 * so a drag can hand the right column the whole row, and only in the `xl` band and up is
 * there a board floor for the clamp to stop at.
 */
function rowWidth(px: number, viewport = px): HTMLElement {
  const row = screen.getByTestId('moves-column').parentElement!
  row.getBoundingClientRect = () => new DOMRect(0, 0, px, 800)
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewport })
  return screen.getByRole('separator', { name: 'Moves column width' })
}

function movesColumn(): HTMLElement {
  return screen.getByTestId('moves-column')
}

function boardColumn(): HTMLElement {
  return screen.getByTestId('board-column')
}

/** A whole drag: down where the line is, out to `to`, and let go. */
function drag(splitter: HTMLElement, from: number, to: number) {
  fireEvent.pointerDown(splitter, { button: 0, pointerId: 1, clientX: from })
  fireEvent.pointerMove(splitter, { pointerId: 1, clientX: to })
  fireEvent.pointerUp(splitter, { pointerId: 1, clientX: to })
}

/** jsdom in this setup exposes no `localStorage`, so the tests bring their own. */
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
  }
}

describe('the board/moves splitter', () => {
  let storage: Storage
  const viewport = window.innerWidth

  beforeEach(() => {
    storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
  })

  // `rowWidth` writes `innerWidth`, and the band it puts the page in decides both floors.
  // Left standing it would follow the next test into a different band.
  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewport })
  })

  it('sizes the board column to its board and gives the rest away, until the boundary is moved', async () => {
    renderPage()
    await screen.findByText('Scandinavian Defense')

    // Untouched, the board column is exactly as wide as the board it holds — the panel's own
    // height budget plus the column's padding — and the right column takes what is left. That
    // is what puts the splitter against the board's edge rather than at the end of a column
    // padded out with slack. jsdom applies no CSS, so what is asserted is the class and that
    // nothing has written an inline width.
    expect(boardColumn()).toHaveClass('w-[calc(100vh-9.5625rem)]', 'shrink', 'grow-0')
    expect(movesColumn()).toHaveClass('flex-1')
    expect(movesColumn().style.flexBasis).toBe('')
  })

  it('hands the width back to the reader once the boundary is dragged', async () => {
    renderPage()
    await screen.findByText('Scandinavian Defense')
    const splitter = rowWidth(1200)

    // The two swap roles on a drag: the right column takes the width that was chosen and the
    // board column flexes into the remainder, so an explicit choice beats the default.
    drag(splitter, 560, 460)
    expect(boardColumn()).toHaveClass('flex-1')
    expect(boardColumn()).not.toHaveClass('grow-0')
    expect(boardColumn().style.flexBasis).toBe('')
    expect(movesColumn()).toHaveClass('grow-0')
  })

  it('narrows the moves column with the drag, and stores where it settles', async () => {
    renderPage()
    await screen.findByText('Scandinavian Defense')
    const splitter = rowWidth(1200)

    fireEvent.pointerDown(splitter, { button: 0, pointerId: 1, clientX: 560 })
    fireEvent.pointerMove(splitter, { pointerId: 1, clientX: 624 })
    // Rightwards is the right column getting narrower: 64px is 4rem, off the 36rem a drag
    // starts from where jsdom has laid the column out to nothing (`DEFAULT_RIGHT_REM`).
    expect(movesColumn().style.flexBasis).toBe('32rem')
    expect(movesColumn()).not.toHaveClass('basis-[28rem]')
    // Storage is written where the drag settles, not once per pointer move.
    expect(storage.getItem(MOVES_WIDTH_KEY)).toBeNull()

    fireEvent.pointerUp(splitter, { pointerId: 1, clientX: 624 })
    expect(storage.getItem(MOVES_WIDTH_KEY)).toBe('32')
  })

  it('widens it again when the drag goes the other way', async () => {
    renderPage()
    await screen.findByText('Scandinavian Defense')
    const splitter = rowWidth(1200)

    drag(splitter, 560, 460)
    // 100px leftwards is 6.25rem onto the 36.
    expect(movesColumn().style.flexBasis).toBe('42.25rem')
    expect(storage.getItem(MOVES_WIDTH_KEY)).toBe('42.25')
  })

  it('narrows it no further than the column’s own floor', async () => {
    renderPage()
    await screen.findByText('Scandinavian Defense')
    const splitter = rowWidth(1200)

    // 1200px of viewport is the narrow band, whose floor is a 250-design-pixel move track
    // plus a readable book row beside it.
    drag(splitter, 560, 2400)
    expect(movesColumn().style.flexBasis).toBe('26.875rem')
    expect(storage.getItem(MOVES_WIDTH_KEY)).toBe('26.875')
  })

  it('widens it no further than the board’s floor allows', async () => {
    renderPage()
    await screen.findByText('Scandinavian Defense')
    // A 1600px viewport, where the board has a floor at all: below `xl` it has none and a
    // drag may hand the right column the whole row.
    const splitter = rowWidth(1200, 1600)

    drag(splitter, 560, -400)
    // 75rem of row, less the 26.25rem the board never drops under.
    expect(movesColumn().style.flexBasis).toBe('48.75rem')
  })

  it('nudges the boundary with the arrow keys without stepping the game', async () => {
    renderPage()
    await screen.findByText('Scandinavian Defense')
    const splitter = rowWidth(1200)

    fireEvent.keyDown(splitter, { key: 'ArrowRight' })
    expect(movesColumn().style.flexBasis).toBe('35rem')
    fireEvent.keyDown(splitter, { key: 'ArrowLeft' })
    fireEvent.keyDown(splitter, { key: 'ArrowLeft' })
    expect(movesColumn().style.flexBasis).toBe('37rem')
    // The board's own arrows are bound on `window`, and did not see these.
    expect(screen.getByText('ply 0 / 4')).toBeInTheDocument()
  })

  it('forgets the width on a double-click, back to the design’s basis', async () => {
    renderPage()
    await screen.findByText('Scandinavian Defense')
    const splitter = rowWidth(1200)

    drag(splitter, 560, 624)
    expect(movesColumn().style.flexBasis).toBe('32rem')

    // Back to the default, which is the board column sized to its board and this one taking
    // the remainder — not a stored basis.
    fireEvent.doubleClick(splitter)
    expect(movesColumn()).toHaveClass('flex-1')
    expect(boardColumn()).toHaveClass('shrink', 'grow-0')
    expect(movesColumn().style.flexBasis).toBe('')
    expect(storage.getItem(MOVES_WIDTH_KEY)).toBeNull()
  })

  it('opens on the width the last visit left it at', async () => {
    storage.setItem(MOVES_WIDTH_KEY, '30')
    renderPage()
    await screen.findByText('Scandinavian Defense')

    expect(movesColumn().style.flexBasis).toBe('30rem')
    expect(movesColumn()).not.toHaveClass('basis-[28rem]')
  })

  it('falls back to the default layout where the stored width is not a width', async () => {
    storage.setItem(MOVES_WIDTH_KEY, 'wide-ish')
    renderPage()
    await screen.findByText('Scandinavian Defense')

    expect(movesColumn()).toHaveClass('flex-1')
    expect(boardColumn()).toHaveClass('shrink', 'grow-0')
    expect(movesColumn().style.flexBasis).toBe('')
  })
})

/**
 * The phone layout (`MobileGameView`): a pinned board over one tabbed pane. jsdom lays
 * nothing out and the suite runs with `css: false`, so none of the sizing can be asserted
 * here — what is checked is the structure the media query chooses and the behaviour of the
 * strip: which panel is mounted, that the board never leaves, and that nothing that only
 * makes sense on a desktop is mounted at all.
 */
describe('the game view below md', () => {
  beforeEach(() => {
    // The shared setup answers every query "no". This one answers the phone query "yes";
    // `vi.unstubAllGlobals()` in the file's own `afterEach` puts it back.
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === MOBILE_QUERY,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  })

  /**
   * The phone strip itself. `NotesTrack` has a `Book | Notes` tablist of its own inside the
   * Notes tab, so "the Notes tab" is ambiguous unless the query is scoped to one of them.
   */
  const strip = () => within(screen.getByRole('tablist', { name: 'Game panels' }))

  /** A tab on the phone strip, by the name a screen reader reads — counts included. */
  const tab = (name: RegExp | string) => strip().getByRole('tab', { name })

  it('replaces the two sized panes with a tabbed pane', async () => {
    renderPage()
    await screen.findByRole('tab', { name: 'Moves' })

    expect(screen.getByTestId('mobile-tab-pane')).toBeInTheDocument()
    // Neither sized pane exists, so neither pane's floor can force a sideways scrollbar.
    expect(screen.queryByTestId('board-column')).not.toBeInTheDocument()
    expect(screen.queryByTestId('moves-column')).not.toBeInTheDocument()
  })

  it('leaves the splitter unmounted rather than merely hidden', async () => {
    renderPage()
    await screen.findByRole('tab', { name: 'Moves' })

    // Hiding it with a class would still install its pointer capture and take the body's
    // selection on a drag the phone cannot make.
    expect(screen.queryByRole('separator', { name: 'Moves column width' })).not.toBeInTheDocument()
  })

  it('opens on the moves, with the counts on the tabs that have them', async () => {
    renderPage()
    await screen.findByRole('tab', { name: 'Moves' })

    expect(tab('Moves')).toHaveAttribute('aria-selected', 'true')
    // Four tabs, in reading order: the moves, then the two panels about the position on the
    // board, then the one about what you wrote. There is no Flagged tab any more — the Eval
    // tab carries `FlaggedMoments` under the curve that explains it, and two doors to one
    // room is one too many on a strip this narrow.
    expect(strip().getAllByRole('tab').map((each) => each.textContent)).toEqual([
      'Moves',
      'Eval1',
      'Engine',
      'Notes1',
    ])
    // One blunder and one note in the payload, reported on the strip rather than inside a
    // panel nobody has opened yet. The flagged count rides Eval, where its list now lives.
    expect(tab(/^Eval/)).toHaveTextContent('1')
    expect(tab(/^Notes/)).toHaveTextContent('1')
    expect(screen.getByText('e4')).toBeInTheDocument()
  })

  it('shows one panel at a time, and never takes the board away', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('tab', { name: 'Moves' })

    // The engine box and the live search are in the moves column on a desktop; here they
    // are a tab, and they are not mounted until it is opened.
    expect(screen.queryByTestId('maia-panel')).not.toBeInTheDocument()
    await user.click(tab('Engine'))
    expect(tab('Engine')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('maia-panel')).toBeInTheDocument()
    expect(screen.getByTestId('infinite-analysis')).toBeInTheDocument()
    // Asserted on the table itself rather than on a move: the engine box prints SAN too,
    // so "e4" being on screen says nothing about which panel is open.
    expect(screen.queryByTestId('move-list')).not.toBeInTheDocument()

    await user.click(tab(/^Eval/))
    expect(screen.getByText('Evaluation')).toBeInTheDocument()
    expect(screen.queryByTestId('maia-panel')).not.toBeInTheDocument()
    expect(screen.getByTestId('flagged-moments')).toBeInTheDocument()

    // The whole point of the layout: the board is in the pinned head, so it survives every
    // one of those switches.
    expect(screen.getByTestId('board')).toBeInTheDocument()
  })

  it('reaches the flagged moves through Eval rather than a tab of their own', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('tab', { name: 'Moves' })

    // The rebuild dropped the Flagged tab: its filtered table and the Eval tab's
    // `FlaggedMoments` were the same list of the same moves, reached two ways.
    expect(strip().queryByRole('tab', { name: /^Flagged/ })).not.toBeInTheDocument()

    await user.click(tab(/^Eval/))
    // 1…d5 is the only flagged move; 1.e4 is `best` and is not in the list.
    const moments = within(screen.getByTestId('flagged-moments'))
    expect(moments.getByRole('button', { name: /d5/ })).toBeInTheDocument()
    expect(moments.queryByRole('button', { name: /exd5/ })).not.toBeInTheDocument()
  })

  it('keeps PGN reachable now that the table’s own tab row is gone', async () => {
    const writeText = vi.fn(async () => {})
    const user = userEvent.setup()
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    renderPage()
    await screen.findByRole('tab', { name: 'Moves' })

    // It moved to the phone header, which is pinned — so it is reachable from every tab.
    await user.click(tab('Engine'))
    await user.click(screen.getByRole('button', { name: 'PGN' }))
    expect(writeText).toHaveBeenCalled()
  })

  it('pairs the curve with a tappable list of what made it', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('tab', { name: 'Moves' })
    await user.click(tab(/^Eval/))

    // Curve and list scroll as one column. Split into a fixed curve over a scrolling list,
    // the curve was a `flex-none` box that could not yield and the list was left with 13
    // visible pixels of 426 — so what is asserted is that both sit inside the *same*
    // scroller, and that nothing between it and the list scrolls on its own.
    const scroller = screen.getByTestId('eval-scroll')
    expect(scroller).toHaveClass('overflow-y-auto')
    expect(scroller).toContainElement(screen.getByText('Evaluation'))
    expect(scroller).toContainElement(screen.getByTestId('flagged-moments'))
    for (
      let box = screen.getByTestId('flagged-moments'); box !== scroller; box = box.parentElement!
    ) {
      expect(box.className).not.toContain('overflow-y-auto')
    }

    const moments = screen.getByTestId('flagged-moments')
    const row = within(moments).getByRole('button', { name: /d5/ })
    expect(row).toHaveTextContent('26.3%')

    await user.click(row)
    // 1…d5 is ply 1, so the board stands on the position it was played from.
    expect(within(screen.getByTestId('mobile-header')).getByText('ply 1/4')).toBeInTheDocument()
  })

  it('stacks Maia over the engine, each with the width to itself', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('tab', { name: 'Moves' })
    await user.click(tab('Engine'))

    // A quarter of a phone is ~90px and three quarters ~270; side by side, the engine's
    // variations wrapped every second ply. jsdom lays nothing out, so what is asserted is
    // the rule: one column below `md`, over the desktop's quarter/three-quarters pair.
    const split = screen.getByTestId('maia-engine-lines').parentElement
    expect(split).toHaveClass('max-md:grid-cols-1')
    expect(split).toHaveClass('grid-cols-[minmax(9rem,1fr)_minmax(0,3fr)]')
    // Two panes divided by a rule, not two cards floating with a gap: the divider is on the
    // engine pane's left edge and turns into a top edge where the two stack.
    expect(split!.className).not.toContain('gap-')
    expect(screen.getByTestId('maia-engine-lines')).toHaveClass(
      'border-l',
      'max-md:border-t',
      'max-md:border-l-0',
    )
    // Maia first, the order the desktop reads them left to right.
    expect(split!.firstElementChild).not.toBe(screen.getByTestId('maia-engine-lines'))
  })

  it('reads the evaluation in the header, not on a line of its own under the board', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('tab', { name: 'Moves' })

    // A third wrapped line under the transport spent pinned height — the pane's height — on
    // one chip. The header's second line was already being drawn for the result.
    const header = screen.getByTestId('mobile-header')
    expect(within(header).getByText('+0.45')).toBeInTheDocument()
    expect(within(header).getByText('ply 0/4')).toBeInTheDocument()

    // And it follows the board, which is the whole point of it being on screen.
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(within(header).getByText('ply 1/4')).toBeInTheDocument()
  })

  it('goes to the Notes tab and puts the keyboard in the composer', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('tab', { name: 'Moves' })

    // The composer only exists in the Notes tab, so the Note button in the transport row
    // has to switch tabs before it can focus anything — and the focus has to wait for the
    // tab to render.
    expect(screen.queryByTestId('note-composer')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Note' }))
    expect(tab(/^Notes/)).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('note-composer')).toBeInTheDocument()
    expect(document.getElementById(COMPOSER_TEXT_ID)).toHaveFocus()
  })

  it('jumps to a flagged move from the row under the board, with no keyboard to press', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Scandinavian Defense')

    await user.click(screen.getByRole('button', { name: 'Next flagged move' }))
    // The blunder is ply 1, so the board lands on the position it was played from — the
    // same place `j` goes.
    expect(screen.getByText('ply 1 / 4')).toBeInTheDocument()
  })
})

/**
 * Notes and pinned lines on the game screen. The folding of pinned, kept and walked lines is
 * a pure function with its own file (`variationRows.test.ts`), and so is where a note hangs
 * (`notesModel.test.ts`); what is tested here is the wiring — what reaches the screen, what
 * is written to the server, and where a link drops the reader.
 */
describe('GamePage notes', () => {
  /** The pinned line 1…c6 2.d4 off the position the blunder was played from. */
  const PINNED: LineResponse = {
    id: 7,
    game_id: 14,
    base_ply: 1,
    moves: ['c7c6', 'd2d4'],
    sans: ['c6', 'd4'],
    created_at: '2026-08-01T09:00:00Z',
    updated_at: '2026-08-01T09:00:00Z',
  }

  /**
   * The Notes tab of the right column's second track. It is a `tab` in the track's own
   * `Book | Notes` tablist now, not the move table's tab row — that row's third tab is
   * gone, and so is the count it used to carry: the track prints "1 note" on the right of
   * the same row instead.
   */
  function notesTab() {
    return within(screen.getByRole('tablist', { name: 'Book and notes' })).getByRole('tab', {
      name: 'Notes',
    })
  }

  function noteBodies(): { url: string; body: Record<string, unknown> }[] {
    return posted
      .filter((call) => call.url.includes('/notes') && !call.url.includes('/notes/tags'))
      .map((call) => ({ url: call.url, body: call.body as Record<string, unknown> }))
  }

  it('lists the game’s notes in the Notes tab, with the move each is about', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Scandinavian Defense')

    // The payload's one note sits at count 1 — the position after 1.e4 — and the track's
    // tab row states how many there are beside the two tabs.
    await user.click(notesTab())
    expect(
      within(screen.getByRole('tablist', { name: 'Book and notes' })).getByText('1 note'),
    ).toBeInTheDocument()

    // A row is where the note hangs and the note itself, clamped. Its tags are not repeated
    // here: clicking the row loads it into the composer below, which is where they are read
    // and edited.
    const list = within(screen.getByTestId('game-notes'))
    expect(list.getByText(/The Scandinavian invites the queen out early/)).toBeInTheDocument()
    expect(list.getByText('1.e4')).toBeInTheDocument()
  })

  it('jumps to the ply a note is about when it is clicked', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Scandinavian Defense')
    await user.click(notesTab())

    await user.click(screen.getByText(/The Scandinavian invites the queen out early/))
    // Count 1 is the position after one half-move, which is `ply 1 / 4` on the transport.
    expect(screen.getByText('ply 1 / 4')).toBeInTheDocument()
  })

  it('marks the mainline move a note hangs off', async () => {
    renderPage()
    await screen.findByText('Scandinavian Defense')

    // 1.e4 produced the noted position, so it is e4 that is marked, not d5.
    expect(screen.getByTitle('1.e4 — noted')).toBeInTheDocument()
    expect(screen.getByTitle('1…d5')).toBeInTheDocument()
  })

  it('writes a note about the position on the board', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Scandinavian Defense')
    // The board on the position 1…d5 was played from.
    await user.keyboard('j')

    await user.click(screen.getByRole('button', { name: 'Note' }))
    const composer = within(screen.getByTestId('note-composer'))

    await user.type(composer.getByLabelText('Note text'), 'Play c6 here, not d5.')
    await user.type(composer.getByLabelText('Tags'), 'scandinavian{Enter}')
    await user.click(composer.getByRole('button', { name: /Save note/ }))

    await waitFor(() => expect(noteBodies()).toHaveLength(1))
    expect(noteBodies()[0]!.body).toMatchObject({
      text: 'Play c6 here, not d5.',
      tags: ['scandinavian'],
      game_id: 14,
      ply: 1,
      source: 'web',
    })
    // On the game's own line nothing is pinned.
    expect(noteBodies()[0]!.body.line).toBeNull()
    // The composer closes on a save rather than leaving the text sitting there.
    // The composer stays on screen after a save: the note is read where it was written.
    expect(screen.getByTestId('note-composer')).toBeInTheDocument()
  })

  it('saves a half-written note to its position before the wheel moves the board', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Scandinavian Defense')
    await user.keyboard('j')
    expect(screen.getByText('ply 1 / 4')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Note' }))
    const composer = within(screen.getByTestId('note-composer'))
    await user.type(composer.getByLabelText('Note text'), 'Play c6 here, not d5.')

    // The wheel moves nothing but the board — no click, no focus change — so the composer
    // has to be told it is being left. The note lands on ply 1, where it was typed.
    fireEvent.wheel(screen.getByTestId('board'), { deltaY: 120 })
    expect(screen.getByText('ply 2 / 4')).toBeInTheDocument()

    await waitFor(() => expect(noteBodies()).toHaveLength(1))
    expect(noteBodies()[0]!.body).toMatchObject({ text: 'Play c6 here, not d5.', ply: 1 })
  })

  it('pins the line first when the note is written inside a variation', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Scandinavian Defense')
    await user.keyboard('j')
    // Walk one move into the run's line 1…c6 2.d4.
    await user.click(within(screen.getByTestId('maia-panel')).getByRole('button', { name: 'c6' }))
    expect(screen.getByText('analysis +1')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Note' }))
    expect(screen.getByTestId('note-composer')).toHaveTextContent('pins the line')
    await user.type(screen.getByLabelText('Note text'), 'The Caro is the move.')
    await user.click(screen.getByRole('button', { name: /Save note/ }))

    await waitFor(() => expect(noteBodies()).toHaveLength(1))
    expect(noteBodies()[0]!.body).toMatchObject({
      ply: 2,
      // The whole walk is pinned, tail and all — not only the move the board stands on.
      line: { game_id: 14, base_ply: 1, moves: ['c7c6', 'd2d4'] },
    })
  })

  it('offers the composer’s tag suggestions from the tags already in use', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Scandinavian Defense')
    await user.click(screen.getByRole('button', { name: 'Note' }))

    // The suggestions are offered to the tag box while it is being used: over a composer
    // this short they would otherwise be sitting on top of the note itself.
    await user.click(screen.getByLabelText('Tags'))
    const suggestions = await screen.findByTestId('tag-suggestions')
    await user.click(within(suggestions).getByRole('button', { name: 'opening' }))
    await user.type(screen.getByLabelText('Note text'), 'Book move.')
    await user.click(screen.getByRole('button', { name: /Save note/ }))

    await waitFor(() => expect(noteBodies()).toHaveLength(1))
    expect(noteBodies()[0]!.body.tags).toEqual(['opening'])
  })

  it('pins a line the session walked, and hands it over to the server', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Scandinavian Defense')
    await user.keyboard('j')
    await user.click(within(screen.getByTestId('maia-panel')).getByRole('button', { name: 'c6' }))

    await user.click(screen.getByRole('button', { name: 'Pin this line' }))
    await waitFor(() =>
      expect(posted.filter((call) => call.url.endsWith('/lines'))).toHaveLength(1),
    )
    expect(posted.find((call) => call.url.endsWith('/lines'))?.body).toEqual({
      game_id: 14,
      base_ply: 1,
      moves: ['c7c6', 'd2d4'],
    })
  })

  it('draws a line the server holds, and unpins it on request', async () => {
    lineRows = [PINNED]
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Scandinavian Defense')

    // Pinned lines arrive with the game rather than having to be walked again.
    const row = await screen.findByTestId('kept-variation')
    expect(row).toHaveTextContent('(1…c62.d4)')
    expect(row.dataset.pinned).toBe('true')

    await user.click(screen.getByRole('button', { name: 'Unpin this line' }))
    await waitFor(() =>
      expect(posted.some((call) => call.url.includes('/lines/7'))).toBe(true),
    )
  })

  it('walks into a line the server holds like one of the session’s own', async () => {
    lineRows = [PINNED]
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Scandinavian Defense')
    await screen.findByTestId('kept-variation')

    await user.click(
      within(screen.getByTestId('kept-variation')).getByRole('button', { name: 'd4' }),
    )
    expect(screen.getByText('analysis +2')).toBeInTheDocument()
    // Drawn once, lit, and no longer listed as a line the board has left.
    expect(screen.queryByTestId('kept-variation')).not.toBeInTheDocument()
    expect(screen.getByTestId('move-variation')).toHaveTextContent('(1…c62.d4)')
  })

  it('marks the line move a pinned note hangs off, and lists it after the game’s own', async () => {
    lineRows = [
      {
        ...PINNED,
        notes: [
          {
            id: 12,
            text: 'This is the whole point of the Caro.',
            tags: [],
            game_id: 14,
            line_id: 7,
            ply: 2,
            created_at: '2026-08-02T10:00:00Z',
            updated_at: '2026-08-02T10:00:00Z',
          },
        ],
      },
    ]
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Scandinavian Defense')
    const row = await screen.findByTestId('kept-variation')

    // Count 2 is one move into a line off ply 1, so it is 1…c6 that carries the mark.
    expect(within(row).getByRole('button', { name: 'c6' }).title).toContain('noted')
    expect(within(row).getByRole('button', { name: 'd4' }).title).not.toContain('noted')

    await user.click(notesTab())
    const list = within(screen.getByTestId('game-notes'))
    // The row labels itself with the move inside the line — 1…c6, not the game's 1…d5 —
    // and says which of the two kinds of `1…` that is.
    expect(list.getByTitle('On a pinned variation')).toHaveTextContent('1…c6')
    expect(
      list.getByTitle('Written elsewhere, about a position this game reached'),
    ).toHaveTextContent('1.e4')
    // The game's own note leads; the variation's is the aside under it.
    const bodies = screen.getByTestId('game-notes').textContent ?? ''
    expect(bodies.indexOf('Scandinavian invites')).toBeLessThan(
      bodies.indexOf('whole point of the Caro'),
    )
  })

  it('walks into the line a note pinned when that note is clicked', async () => {
    lineRows = [
      {
        ...PINNED,
        notes: [
          {
            id: 12,
            text: 'This is the whole point of the Caro.',
            tags: [],
            game_id: 14,
            line_id: 7,
            ply: 3,
            created_at: '2026-08-02T10:00:00Z',
            updated_at: '2026-08-02T10:00:00Z',
          },
        ],
      },
    ]
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Scandinavian Defense')
    await screen.findByTestId('kept-variation')
    await user.click(notesTab())

    await user.click(screen.getByText('This is the whole point of the Caro.'))
    // Count 3 off a line based at ply 1 is two moves in.
    expect(screen.getByText('analysis +2')).toBeInTheDocument()
  })

  it('opens on the ply a link named', async () => {
    renderPage('/games/14?ply=3')
    await screen.findByText('Scandinavian Defense')
    expect(screen.getByText('ply 3 / 4')).toBeInTheDocument()
  })

  it('opens inside the line a link named, at the position it named', async () => {
    lineRows = [PINNED]
    renderPage('/games/14?ply=2&line=7')
    await screen.findByText('Scandinavian Defense')
    await waitFor(() => expect(screen.getByText('analysis +1')).toBeInTheDocument())
    expect(screen.getByTestId('move-variation')).toHaveTextContent('(1…c62.d4)')
  })

  it('falls back to the ply where the line a link named is no longer pinned', async () => {
    renderPage('/games/14?ply=2&line=7')
    await screen.findByText('Scandinavian Defense')
    await waitFor(() => expect(screen.getByText('ply 2 / 4')).toBeInTheDocument())
  })

})
