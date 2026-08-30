import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import type { ExplorerResponse, PositionOccurrence } from '@/lib/api/types'

import { ExplorerPage } from './ExplorerPage'

// chessground needs a laid-out box jsdom will not give it. What these tests are about is
// the preview *position* fed to the board, not chessground's own rendering, so the board is
// stood in for by its props — the same stand-in `BoardPanel.test.tsx` uses.
//
// The stand-in also publishes a `set` spy through the ref the real `Board` publishes its
// chessground `Api` on, because the page arms the board's legal destinations through it and
// emptying those is how a preview is made undraggable.
const boardSet = vi.fn()
vi.mock('@/components/board/Board', () => ({
  Board: ({
    fen,
    lastMove,
    turnColor,
    viewOnly,
    ref,
  }: {
    fen: string
    lastMove?: string | [string, string] | null
    turnColor?: string
    viewOnly?: boolean
    ref?: { current: unknown }
  }) => {
    if (ref && typeof ref === 'object') ref.current = { set: boardSet }
    return (
      <div
        data-testid="board"
        data-fen={fen}
        data-last-move={typeof lastMove === 'string' ? lastMove : (lastMove?.join('') ?? '')}
        data-turn={turnColor}
        data-view-only={String(!!viewOnly)}
      />
    )
  },
}))

/** The `dests` map of the most recent `set()` the page made on the board. */
function lastDests(): Map<string, string[]> | undefined {
  const calls = boardSet.mock.calls
  return calls.at(-1)?.[0]?.movable?.dests
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
/** After 1.e4 — the position hovering the `1.e4` row would preview. */
const AFTER_E4_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'

const TREE: ExplorerResponse = {
  fen: START_FEN,
  side_to_move: 'white',
  path: [],
  totals: { games: 4, wins: 2, draws: 1, losses: 1 },
  moves: [
    { uci: 'e2e4', san: 'e4', games: 4, wins: 2, draws: 1, losses: 1, score: 0.625 },
  ],
  main_line: [{ uci: 'e2e4', san: 'e4', games: 4 }],
  book_depth: 0,
  leaves_book_because: 'novelty',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function renderPage(entry = '/explorer') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  return render(
    <Providers client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/explorer" element={<ExplorerPage />} />
        </Routes>
      </MemoryRouter>
    </Providers>,
  )
}

describe('ExplorerPage hover preview', () => {
  it('plays a hovered continuation on the board and restores the real line on leave', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/explorer/positions')) return json([])
        if (url.includes('/explorer')) return json(TREE)
        return json({ error: 'not_found', detail: url }, 404)
      }),
    )

    renderPage()

    const row = await screen.findByText('1.e4')
    const board = screen.getByTestId('board')
    expect(board).toHaveAttribute('data-fen', START_FEN)
    expect(lastDests()?.size).toBeGreaterThan(0)

    await user.hover(row)
    await waitFor(() => expect(board).toHaveAttribute('data-fen', AFTER_E4_FEN))
    expect(board).toHaveAttribute('data-last-move', 'e2e4')
    expect(board).toHaveAttribute('data-turn', 'black')
    // Nothing is draggable on a position nobody selected — but by emptying the
    // destinations, never by `viewOnly`, which chessground reads only at creation and which
    // would therefore rebuild the board on every hover and leave the rebuilt one unarmed.
    expect(lastDests()?.size).toBe(0)

    await user.unhover(row)
    await waitFor(() => expect(board).toHaveAttribute('data-fen', START_FEN))
    // The real line's destinations come back, so the board still accepts a drag afterwards.
    expect(lastDests()?.size).toBeGreaterThan(0)

    vi.unstubAllGlobals()
  })

  it('never toggles viewOnly, which would rebuild the board mid-hover', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/explorer/positions')) return json([])
        if (url.includes('/explorer')) return json(TREE)
        return json({ error: 'not_found', detail: url }, 404)
      }),
    )

    renderPage()

    const row = await screen.findByText('1.e4')
    const board = screen.getByTestId('board')
    expect(board).toHaveAttribute('data-view-only', 'false')

    await user.hover(row)
    await waitFor(() => expect(board).toHaveAttribute('data-fen', AFTER_E4_FEN))
    expect(board).toHaveAttribute('data-view-only', 'false')

    vi.unstubAllGlobals()
  })
})

/** A game whose ECO tag is all the page used to have to name a position with. */
const TAGGED: PositionOccurrence[] = [
  {
    game: {
      id: 7,
      source: 'lichess',
      opponent: 'someone',
      played_at: '2016-12-27T12:00:00Z',
      result: '1-0',
      outcome: 'win',
      eco: 'C42',
      opening: 'Petrov Defense',
    },
    ply: 4,
  },
]

describe('ExplorerPage opening name', () => {
  it('sends the line it is standing on and shows what the book calls it', async () => {
    const seen: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        seen.push(url)
        if (url.includes('/explorer/positions')) return json([])
        if (url.includes('/explorer')) {
          return json({
            ...TREE,
            opening: { eco: 'C65', name: 'Ruy Lopez: Berlin Defense', ply: 6 },
          })
        }
        return json({ error: 'not_found', detail: url }, 404)
      }),
    )

    renderPage('/explorer?line=e2e4,e7e5,g1f3,b8c6,f1b5,g8f6')

    expect(await screen.findByText('Ruy Lopez: Berlin Defense')).toBeInTheDocument()
    expect(screen.getByText('C65')).toBeInTheDocument()
    // Naming is the backend's job because the book stops a few plies in, so the whole line
    // has to travel — the FEN alone would leave a deep position nameless.
    const tree = seen.find((url) => url.includes('/explorer?'))
    expect(tree).toContain('line=e2e4%2Ce7e5%2Cg1f3%2Cb8c6%2Cf1b5%2Cg8f6')

    vi.unstubAllGlobals()
  })

  it('falls back to the ECO tags on the owner’s own games where the book has nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/explorer/positions')) return json(TAGGED)
        if (url.includes('/explorer')) return json({ ...TREE, opening: null })
        return json({ error: 'not_found', detail: url }, 404)
      }),
    )

    renderPage('/explorer?line=e2e4,e7e5,g1f3,g8f6')

    expect(await screen.findByText('Petrov Defense')).toBeInTheDocument()
    expect(screen.getByText('C42')).toBeInTheDocument()

    vi.unstubAllGlobals()
  })
})

/** A position the owner has a book from: two plies of it, then an improvisation. */
const BOOKED: ExplorerResponse = {
  ...TREE,
  main_line: [
    { uci: 'e2e4', san: 'e4', games: 4 },
    { uci: 'e7e5', san: 'e5', games: 3 },
    { uci: 'g1f3', san: 'Nf3', games: 1 },
  ],
  book_depth: 2,
  leaves_book_with: { ply: 2, uci: 'g1f3', san: 'Nf3', games: 1 },
  leaves_book_because: 'novelty',
}

function stubTree(tree: ExplorerResponse, seen: string[] = []) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      seen.push(url)
      if (url.includes('/explorer/positions')) return json([])
      if (url.includes('/explorer')) return json(tree)
      return json({ error: 'not_found', detail: url }, 404)
    }),
  )
  return seen
}

describe('ExplorerPage book run', () => {
  it('says how deep the book runs and where it is left, in moves rather than plies', async () => {
    stubTree(BOOKED)
    renderPage()

    // Two plies is one move, and the departing move is numbered from the position on the
    // board — this is the only place either fact is shown.
    expect(await screen.findByText(/Your book runs 1 move deep from here/)).toBeInTheDocument()
    expect(screen.getByText('2.Nf3')).toBeInTheDocument()
    expect(screen.getByText('Follow it')).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('says nothing at all when there is no book from here', async () => {
    stubTree(TREE)
    renderPage()

    await screen.findByText('1.e4')
    expect(screen.queryByText(/Your book runs/)).not.toBeInTheDocument()
    expect(screen.queryByText('Follow it')).not.toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('previews the whole book line on hovering the follow action', async () => {
    const user = userEvent.setup()
    stubTree(BOOKED)
    renderPage()

    const follow = await screen.findByText('Follow it')
    const board = screen.getByTestId('board')
    await user.hover(follow)
    await waitFor(() => expect(board).toHaveAttribute('data-last-move', 'e7e5'))
    expect(board).toHaveAttribute('data-turn', 'white')

    await user.unhover(follow)
    await waitFor(() => expect(board).toHaveAttribute('data-last-move', ''))

    vi.unstubAllGlobals()
  })

  it('previews the book line plus the improvised move on hovering it', async () => {
    const user = userEvent.setup()
    stubTree(BOOKED)
    renderPage()

    const leaves = await screen.findByText('2.Nf3')
    const board = screen.getByTestId('board')
    await user.hover(leaves)
    await waitFor(() => expect(board).toHaveAttribute('data-last-move', 'g1f3'))
    expect(board).toHaveAttribute('data-turn', 'black')

    vi.unstubAllGlobals()
  })

  it('mirrors the book-line preview on keyboard focus and blur', async () => {
    stubTree(BOOKED)
    renderPage()

    const follow = await screen.findByText('Follow it')
    const board = screen.getByTestId('board')
    follow.focus()
    await waitFor(() => expect(board).toHaveAttribute('data-last-move', 'e7e5'))
    follow.blur()
    await waitFor(() => expect(board).toHaveAttribute('data-last-move', ''))

    vi.unstubAllGlobals()
  })

  it('walks the whole book line when the follow action is clicked', async () => {
    const seen = stubTree(BOOKED)
    renderPage()

    await userEvent.click(await screen.findByText('Follow it'))
    await waitFor(() =>
      expect(seen.some((url) => url.includes('line=e2e4%2Ce7e5'))).toBe(true),
    )

    vi.unstubAllGlobals()
  })
})
