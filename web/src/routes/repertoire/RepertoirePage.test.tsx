import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import type { RepertoireTree } from '@/lib/api/types'

import { RepertoirePage } from './RepertoirePage'

// chessground needs a laid-out box jsdom will not give it, and what these tests are about
// is the position and the writes, not chessground's rendering — so the board is stood in
// for by its props, the same stand-in `ExplorerPage.test.tsx` uses. It also exposes the
// `onMove` callback as a button, which is how "the owner played a move" is expressed here
// without dragging a piece through a fake DOM.
const boardSet = vi.fn()
let playMove: ((orig: string, dest: string) => void) | undefined
vi.mock('@/components/board/Board', () => ({
  Board: ({
    fen,
    orientation,
    lastMove,
    arrows,
    onMove,
    ref,
  }: {
    fen: string
    orientation?: string
    lastMove?: string | [string, string] | null
    arrows?: { from: string; to: string; color?: string }[]
    onMove?: (orig: string, dest: string) => void
    ref?: { current: unknown }
  }) => {
    if (ref && typeof ref === 'object') ref.current = { set: boardSet }
    playMove = onMove
    return (
      <div
        data-testid="board"
        data-fen={fen}
        data-orientation={orientation}
        data-last-move={typeof lastMove === 'string' ? lastMove : (lastMove?.join('') ?? '')}
        data-arrows={(arrows ?? []).map((arrow) => `${arrow.from}${arrow.to}:${arrow.color}`).join(' ')}
      />
    )
  },
}))

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

/** 1.e4 e5 2.Nf3, with 1…c5 as a commented sideline — the shape the contract describes. */
const WHITE_TREE: RepertoireTree = {
  color: 'white',
  moves: [
    {
      id: 10,
      uci: 'e2e4',
      san: 'e4',
      comment: 'the move I actually play',
      rank: 0,
      epd: 'epd-e4',
      children: [
        {
          id: 20,
          uci: 'e7e5',
          san: 'e5',
          comment: '',
          rank: 0,
          epd: 'epd-e5',
          children: [
            { id: 40, uci: 'g1f3', san: 'Nf3', comment: '', rank: 0, epd: 'epd-nf3', children: [] },
          ],
        },
        { id: 30, uci: 'c7c5', san: 'c5', comment: '', rank: 1, epd: 'epd-c5', children: [] },
      ],
    },
  ],
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Every request the page can make, with the tree read answering from one fixture.
 *
 * `gate` holds the POSTs open, which is how a write still being in flight is expressed: the
 * page's own ordering rules are about what it does before an answer comes back.
 */
function stubApi(tree: RepertoireTree = WHITE_TREE, gate?: Promise<unknown>) {
  const seen: { url: string; method: string; body: unknown }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      seen.push({
        url,
        method,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      })
      if (method === 'POST' && url.includes('/repertoire/')) {
        if (gate) await gate
        return json({ created: 1, tip: { id: 99, uci: 'd2d4', san: 'd4', comment: '', rank: 1, epd: 'epd-d4' } }, 201)
      }
      if (method === 'PATCH' && url.includes('/repertoire/moves/')) {
        return json({ id: 10, uci: 'e2e4', san: 'e4', comment: 'noted', rank: 0, epd: 'epd-e4' })
      }
      if (method === 'DELETE' && url.includes('/repertoire/moves/')) {
        return new Response(null, { status: 204 })
      }
      if (url.includes('/repertoire/')) return json(tree)
      return json({ error: 'not_found', detail: url }, 404)
    }),
  )
  return seen
}

function renderPage(entry = '/repertoire') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  return render(
    <Providers client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/repertoire" element={<RepertoirePage />} />
        </Routes>
      </MemoryRouter>
    </Providers>,
  )
}

describe('RepertoirePage', () => {
  it('renders the stored tree as movetext and asks for the colour in the URL', async () => {
    const seen = stubApi()
    renderPage('/repertoire?color=white')

    expect(await screen.findByText('1.e4')).toBeInTheDocument()
    expect(screen.getByText('1…e5')).toBeInTheDocument()
    expect(screen.getByText('1…c5')).toBeInTheDocument()
    expect(screen.getByText('2.Nf3')).toBeInTheDocument()
    expect(seen[0].url).toContain('/repertoire/white')
    // The board looks at the repertoire's own colour without being flipped, and a page
    // opened with no line stands on the initial array.
    expect(screen.getByTestId('board')).toHaveAttribute('data-orientation', 'white')
    expect(screen.getByTestId('board')).toHaveAttribute('data-fen', START_FEN)

    vi.unstubAllGlobals()
  })

  it('offers the empty repertoire an explanation rather than an empty pane', async () => {
    stubApi({ color: 'black', moves: [] })
    renderPage('/repertoire?color=black')

    expect(
      await screen.findByText(/Play moves on the board to start your black repertoire/),
    ).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('draws the continuations as arrows, the main move in the strong brush', async () => {
    stubApi()
    renderPage()

    const board = await screen.findByTestId('board')
    await waitFor(() => expect(board).toHaveAttribute('data-arrows', 'e2e4:accent'))

    // One ply in, the two replies are drawn apart: the main one accented, the sideline pale.
    await userEvent.click(screen.getByText('1.e4'))
    await waitFor(() =>
      expect(board).toHaveAttribute('data-arrows', 'e7e5:accent c7c5:paleAccent'),
    )

    vi.unstubAllGlobals()
  })

  it('extends the line without writing anything when the move is already in the tree', async () => {
    const seen = stubApi()
    renderPage()

    const board = await screen.findByTestId('board')
    await waitFor(() => expect(board).toHaveAttribute('data-arrows', 'e2e4:accent'))

    playMove?.('e2', 'e4')
    await waitFor(() => expect(board).toHaveAttribute('data-last-move', 'e2e4'))
    expect(seen.some((call) => call.method === 'POST')).toBe(false)

    vi.unstubAllGlobals()
  })

  it('posts the whole path when the move played is new to the repertoire', async () => {
    const seen = stubApi()
    renderPage()

    const board = await screen.findByTestId('board')
    await waitFor(() => expect(board).toHaveAttribute('data-arrows', 'e2e4:accent'))

    playMove?.('d2', 'd4')
    await waitFor(() => expect(seen.some((call) => call.method === 'POST')).toBe(true))
    const post = seen.find((call) => call.method === 'POST')
    expect(post?.url).toContain('/repertoire/white/line')
    expect(post?.body).toEqual({ ucis: ['d2d4'] })
    // The line moved anyway — the URL does not wait for the write.
    expect(board).toHaveAttribute('data-last-move', 'd2d4')

    vi.unstubAllGlobals()
  })

  it('sends the full path from the initial array, not just the new move', async () => {
    const seen = stubApi()
    renderPage('/repertoire?line=e2e4,e7e5')

    const board = await screen.findByTestId('board')
    await waitFor(() => expect(board).toHaveAttribute('data-arrows', 'g1f3:accent'))

    playMove?.('b1', 'c3')
    await waitFor(() => expect(seen.some((call) => call.method === 'POST')).toBe(true))
    expect(seen.find((call) => call.method === 'POST')?.body).toEqual({
      ucis: ['e2e4', 'e7e5', 'b1c3'],
    })

    vi.unstubAllGlobals()
  })

  it('saves the selected move’s comment when the box loses focus', async () => {
    const user = userEvent.setup()
    const seen = stubApi()
    renderPage('/repertoire?line=e2e4,e7e5')

    const box = await screen.findByLabelText('Comment on e5')
    await user.click(box)
    await user.type(box, 'the open game')
    await user.tab()

    await waitFor(() => expect(seen.some((call) => call.method === 'PATCH')).toBe(true))
    const patch = seen.find((call) => call.method === 'PATCH')
    expect(patch?.url).toContain('/repertoire/moves/20')
    expect(patch?.body).toEqual({ comment: 'the open game' })
    expect(await screen.findByRole('status')).toHaveTextContent('saved')

    vi.unstubAllGlobals()
  })

  it('writes nothing when the box is opened and left unchanged', async () => {
    const user = userEvent.setup()
    const seen = stubApi()
    renderPage('/repertoire?line=e2e4')

    const box = await screen.findByLabelText('Comment on e4')
    expect(box).toHaveValue('the move I actually play')
    await user.click(box)
    await user.tab()

    expect(seen.some((call) => call.method === 'PATCH')).toBe(false)

    vi.unstubAllGlobals()
  })

  it('promotes a sideline, and offers no such button on a move that is already main', async () => {
    const user = userEvent.setup()
    const seen = stubApi()
    renderPage('/repertoire?line=e2e4,c7c5')

    await user.click(await screen.findByText('Promote to main'))
    await waitFor(() => expect(seen.some((call) => call.method === 'PATCH')).toBe(true))
    const patch = seen.find((call) => call.method === 'PATCH')
    expect(patch?.url).toContain('/repertoire/moves/30')
    expect(patch?.body).toEqual({ promote: true })

    // The mainline reply has nothing to promote.
    await user.click(screen.getByText('1…e5'))
    await waitFor(() => expect(screen.queryByText('Promote to main')).not.toBeInTheDocument())

    vi.unstubAllGlobals()
  })

  it('takes two clicks to delete a branch, and walks back off it', async () => {
    const user = userEvent.setup()
    const seen = stubApi()
    renderPage('/repertoire?line=e2e4,c7c5')

    const button = await screen.findByText('Delete branch')
    await user.click(button)
    expect(seen.some((call) => call.method === 'DELETE')).toBe(false)

    await user.click(screen.getByText('Confirm — delete branch'))
    await waitFor(() => expect(seen.some((call) => call.method === 'DELETE')).toBe(true))
    expect(seen.find((call) => call.method === 'DELETE')?.url).toContain('/repertoire/moves/30')
    // The line cannot stay standing on a move that no longer exists.
    await waitFor(() =>
      expect(screen.getByTestId('board')).toHaveAttribute('data-last-move', 'e2e4'),
    )

    vi.unstubAllGlobals()
  })

  it('writes two moves played back to back one after the other, not at once', async () => {
    let open = () => {}
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    const seen = stubApi(WHITE_TREE, gate)
    renderPage()
    const posts = () => seen.filter((call) => call.method === 'POST')

    const board = await screen.findByTestId('board')
    await waitFor(() => expect(board).toHaveAttribute('data-arrows', 'e2e4:accent'))

    playMove?.('d2', 'd4')
    await waitFor(() => expect(posts()).toHaveLength(1))

    // The second move is played before the first write has answered. Sending it now would
    // send a line whose first move does not exist yet, and the backend would create `d4`
    // twice — a find-or-create per node cannot see a row that is not committed.
    playMove?.('d7', 'd5')
    await waitFor(() => expect(board).toHaveAttribute('data-last-move', 'd7d5'))
    expect(posts()).toHaveLength(1)
    // Nothing is called missing while the write that adds it is still out.
    expect(screen.queryByText(/is not in your white repertoire yet/)).not.toBeInTheDocument()

    open()
    await waitFor(() => expect(posts()).toHaveLength(2))
    expect(posts()[1].body).toEqual({ ucis: ['d2d4', 'd7d5'] })

    vi.unstubAllGlobals()
  })

  it('leaves the line behind when the other repertoire is opened', async () => {
    const user = userEvent.setup()
    const seen = stubApi()
    renderPage('/repertoire?color=white&line=e2e4,c7c5')

    await screen.findByLabelText('Comment on c5')
    await user.click(screen.getByRole('button', { name: 'black' }))

    await waitFor(() =>
      expect(seen.some((call) => call.url.includes('/repertoire/black'))).toBe(true),
    )
    // A White line means nothing in the Black tree, so the board starts over rather than
    // standing on moves the pane beside it is not showing.
    expect(screen.getByTestId('board')).toHaveAttribute('data-fen', START_FEN)

    vi.unstubAllGlobals()
  })

  it('does not walk forward onto the branch it just deleted', async () => {
    const user = userEvent.setup()
    stubApi()
    renderPage('/repertoire?line=e2e4,c7c5')

    await user.click(await screen.findByText('Delete branch'))
    await user.click(screen.getByText('Confirm — delete branch'))
    const board = screen.getByTestId('board')
    await waitFor(() => expect(board).toHaveAttribute('data-last-move', 'e2e4'))

    await user.click(screen.getByLabelText('Forward one move'))

    // The deleted move went out of the trail with the branch, so ▶ has nowhere to go —
    // otherwise one keystroke would offer to add back what was just deleted.
    expect(board).toHaveAttribute('data-last-move', 'e2e4')

    vi.unstubAllGlobals()
  })

  it('does not claim a line is missing when it could not read the repertoire at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'server_error', detail: 'no' }, 500)),
    )
    renderPage('/repertoire?line=e2e4,e7e6')

    expect(await screen.findByText('Could not read the repertoire')).toBeInTheDocument()
    expect(screen.queryByText(/is not in your white repertoire yet/)).not.toBeInTheDocument()
    expect(screen.queryByText('Add this line')).not.toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('offers to add a line it walked to that the repertoire does not hold', async () => {
    const user = userEvent.setup()
    const seen = stubApi()
    renderPage('/repertoire?line=e2e4,e7e6')

    await user.click(await screen.findByText('Add this line'))
    await waitFor(() => expect(seen.some((call) => call.method === 'POST')).toBe(true))
    expect(seen.find((call) => call.method === 'POST')?.body).toEqual({
      ucis: ['e2e4', 'e7e6'],
    })

    vi.unstubAllGlobals()
  })
})
