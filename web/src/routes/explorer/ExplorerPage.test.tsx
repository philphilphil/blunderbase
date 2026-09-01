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

/** What `/reference/explorer` answers for the initial position, masters source. */
const REFERENCE = {
  source: 'masters',
  fen: START_FEN,
  opening: null,
  totals: { games: 400_000, white: 150_000, draws: 160_000, black: 90_000 },
  moves: [
    {
      uci: 'd2d4',
      san: 'd4',
      games: 200_000,
      white: 70_000,
      draws: 90_000,
      black: 40_000,
      average_rating: 2503,
    },
  ],
  top_games: [
    {
      id: 'abcd1234',
      white: { name: 'Kasparov, G', rating: 2812 },
      black: { name: 'Karpov, A', rating: 2775 },
      winner: 'white',
      year: 1990,
      month: '1990-12',
    },
  ],
}

/**
 * `/reference/explorer` before `/explorer`, because the first URL contains the second and
 * the page's whole point is that the two are different databases.
 */
function stubSources(
  reference: unknown = REFERENCE,
  status = 200,
  seen: string[] = [],
): string[] {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      seen.push(url)
      if (url.includes('/reference/explorer')) return json(reference, status)
      if (url.includes('/explorer/positions')) return json(TAGGED)
      if (url.includes('/explorer')) return json(TREE)
      return json({ error: 'not_found', detail: url }, 404)
    }),
  )
  return seen
}

describe('ExplorerPage sources', () => {
  it('reads the owner’s own games and asks no outside database by default', async () => {
    const seen = stubSources()
    renderPage()

    expect(await screen.findByText('1.e4')).toBeInTheDocument()
    expect(screen.getByText('Games in this line')).toBeInTheDocument()
    // The wall: nothing leaves for Lichess until the owner asks it a question.
    expect(seen.some((url) => url.includes('/reference/'))).toBe(false)

    vi.unstubAllGlobals()
  })

  it('shows the reference table and drops the owner-only panels on a reference source', async () => {
    const seen = stubSources()
    renderPage('/explorer?source=masters')

    // The reference row, with its own columns.
    expect(await screen.findByText('1.d4')).toBeInTheDocument()
    expect(screen.getByText('2503')).toBeInTheDocument()
    expect(screen.getByText('Model games')).toBeInTheDocument()
    expect(screen.getByText('Kasparov, G')).toBeInTheDocument()

    // Everything that is a statement about the owner's library is gone, not blanked: the
    // colour scope, the games in this line, and their own tree's table.
    expect(screen.queryByText('Games in this line')).not.toBeInTheDocument()
    expect(screen.queryByText('as white')).not.toBeInTheDocument()
    expect(screen.queryByText('1.e4')).not.toBeInTheDocument()
    // The note on the position stays — it is about the board, not about a database.
    expect(screen.getByTestId('position-notes')).toBeInTheDocument()

    // And the owner's own tree was never fetched for this position.
    expect(
      seen.some((url) => url.includes('/explorer?') && !url.includes('/reference/')),
    ).toBe(false)

    vi.unstubAllGlobals()
  })

  it('switches source through the URL, and back again', async () => {
    stubSources()
    renderPage('/explorer?source=masters')

    await screen.findByText('1.d4')
    await userEvent.click(screen.getByText('my games'))

    expect(await screen.findByText('1.e4')).toBeInTheDocument()
    expect(screen.getByText('Games in this line')).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('sends the lichess filters, and only for the lichess database', async () => {
    const seen = stubSources()
    renderPage('/explorer?source=lichess&speeds=blitz&ratings=2000,2200')

    await screen.findByText('1.d4')
    const asked = seen.find((url) => url.includes('/reference/explorer'))
    expect(asked).toContain('source=lichess')
    expect(asked).toContain('speeds=blitz')
    expect(asked).toContain('ratings=2000%2C2200')
    // The chips are on screen and say what is on.
    expect(screen.getByRole('button', { name: 'blitz' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'rapid' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )

    vi.unstubAllGlobals()
  })

  it('offers no speed or rating chips for the masters database', async () => {
    stubSources()
    renderPage('/explorer?source=masters')

    await screen.findByText('1.d4')
    expect(screen.queryByRole('button', { name: 'blitz' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '2500+' })).not.toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('asks for a token instead of an error when Lichess has not been given one', async () => {
    stubSources({ error: 'lichess_token_missing', detail: 'no token stored' }, 409)
    renderPage('/explorer?source=masters')

    expect(await screen.findByText('Lichess needs a token')).toBeInTheDocument()
    expect(screen.getByLabelText('Lichess API token')).toHaveAttribute('type', 'password')
    expect(screen.getByText('Create one on lichess.org')).toHaveAttribute(
      'href',
      'https://lichess.org/account/oauth/token',
    )
    // Not an error card: there is nothing to retry until a token exists.
    expect(screen.queryByText('Try again')).not.toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('says the token was refused when Lichess rejects the stored one', async () => {
    stubSources({ error: 'lichess_token_rejected', detail: 'upstream 401' }, 409)
    renderPage('/explorer?source=lichess')

    expect(await screen.findByText('Lichess refused that token')).toBeInTheDocument()
    // Nothing is stored as far as the status read knows, so there is nothing to remove.
    expect(screen.queryByText('Remove the stored token')).not.toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('offers to take out a revoked token, and only when one is stored', async () => {
    const seen: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        seen.push(`${init?.method ?? 'GET'} ${url}${init?.body ? ` ${String(init.body)}` : ''}`)
        if (url.includes('/reference/token')) return json({ configured: true })
        if (url.includes('/reference/explorer')) {
          return json({ error: 'lichess_token_rejected' }, 409)
        }
        return json({ error: 'not_found', detail: url }, 404)
      }),
    )
    renderPage('/explorer?source=masters')

    await userEvent.click(await screen.findByText('Remove the stored token'))
    await waitFor(() =>
      expect(
        seen.some((entry) => entry.startsWith('PUT ') && entry.includes('"token":null')),
      ).toBe(true),
    )

    vi.unstubAllGlobals()
  })

  it('stores a pasted token and asks the database again', async () => {
    const seen = stubSources({ error: 'lichess_token_missing' }, 409)
    renderPage('/explorer?source=masters')

    await screen.findByText('Lichess needs a token')
    // The second answer is the real one: storing a token is what makes the failed,
    // cached-forever query run again.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        seen.push(`${init?.method ?? 'GET'} ${url}`)
        if (url.includes('/reference/token')) return json({ configured: true })
        if (url.includes('/reference/explorer')) return json(REFERENCE)
        return json({ error: 'not_found', detail: url }, 404)
      }),
    )

    await userEvent.type(screen.getByLabelText('Lichess API token'), 'lip_secret')
    await userEvent.click(screen.getByText('Save'))

    expect(await screen.findByText('1.d4')).toBeInTheDocument()
    expect(seen.some((url) => url.startsWith('PUT ') && url.includes('/reference/token'))).toBe(
      true,
    )

    vi.unstubAllGlobals()
  })

  it('plays a reference move into the line the same way the owner’s own table does', async () => {
    const seen = stubSources()
    renderPage('/explorer?source=masters')

    await userEvent.click(await screen.findByText('1.d4'))
    // Still the reference database being asked, now about the position after 1.d4 — the
    // pawn on d4 is `3P4` in the FEN, which the initial position does not contain.
    await waitFor(() =>
      expect(
        seen.some((url) => url.includes('/reference/explorer') && url.includes('3P4')),
      ).toBe(true),
    )

    vi.unstubAllGlobals()
  })
})
