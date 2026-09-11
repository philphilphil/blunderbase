import { QueryClient } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import type {
  CorrespondenceGameDetail,
  CorrespondenceGameSummary,
  CorrespondenceTreeNode,
} from '@/lib/api/types'

import { CorrespondenceGamePage } from './CorrespondenceGamePage'

class FakeSocket {
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  readonly url: string
  constructor(url: string) {
    this.url = url
  }
  close() {}
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'

function node(patch: Partial<CorrespondenceTreeNode> = {}): CorrespondenceTreeNode {
  return {
    id: 1,
    game_id: 7,
    parent_id: null,
    uci: null,
    san: null,
    epd: 'epd',
    ply: 0,
    move_number: 1,
    rank: 0,
    played: true,
    conditional: false,
    comment: '',
    fen: START,
    turn: 'white',
    frame: 'white',
    evals: [],
    searches: [],
    disagree: false,
    flags: {},
    children: [],
    ...patch,
  }
}

/** A game standing on the initial position, with three candidate first moves in the tree. */
function detail(patch: Partial<CorrespondenceGameSummary> = {}): CorrespondenceGameDetail {
  const nf3 = node({
    id: 4,
    uci: 'g1f3',
    played: false,
    san: 'Nf3',
    ply: 1,
    rank: 2,
    parent_id: 1,
    fen: AFTER_E4,
    turn: 'black',
    own: { cp: 5 },
  })
  const d4 = node({
    id: 3,
    uci: 'd2d4',
    played: false,
    san: 'd4',
    ply: 1,
    rank: 1,
    parent_id: 1,
    fen: AFTER_E4,
    turn: 'black',
    own: { cp: 12 },
    backed: { cp: 40 },
  })
  const e4 = node({
    id: 2,
    uci: 'e2e4',
    played: false,
    san: 'e4',
    ply: 1,
    rank: 0,
    parent_id: 1,
    fen: AFTER_E4,
    turn: 'black',
    own: { cp: 34 },
    backed: { cp: 12 },
  })
  return {
    game: {
      game_id: 7,
      white: 'Baum',
      black: 'Kowalski, Marek',
      owner_color: 'white',
      source: 'iccf',
      source_id: '1258402',
      event: 'WS/M/168',
      result: '*',
      state: 'ongoing',
      finished: false,
      ply_count: 0,
      move_number: 1,
      to_move: 'white',
      your_move: true,
      moves_uci: [],
      moves_san: [],
      start_fen: START,
      days_per_move: 10,
      reply_due: '2026-09-14T12:00:00+00:00',
      days_left: 3,
      created_at: '2026-06-03T10:00:00+00:00',
      updated_at: '2026-09-08T10:00:00+00:00',
      current_node_id: 1,
      ...patch,
    },
    tree: node({ children: [e4, d4, nf3] }),
    searches: [],
  }
}

/** What the masters book says about the initial position: one move the tree has, one it has not. */
const MASTERS = {
  source: 'masters',
  fen: START,
  totals: { games: 1000, white: 400, draws: 400, black: 200 },
  moves: [
    { uci: 'e2e4', san: 'e4', games: 600, white: 250, draws: 250, black: 100 },
    { uci: 'c2c4', san: 'c4', games: 400, white: 150, draws: 150, black: 100 },
  ],
  top_games: [],
}

let payload: CorrespondenceGameDetail
let posted: { path: string; method: string; body: unknown }[]

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  payload = detail()
  posted = []
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      const method = init?.method ?? 'GET'
      if (method !== 'GET') {
        posted.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : null })
        // A node create answers with the node it walked to, not with the game.
        if (path.includes('/correspondence/nodes')) {
          return json({ game_id: 7, created: 1, tip: node({ id: 9, parent_id: 1, ply: 1 }) })
        }
        return json({ ...payload, queued_runs: [] })
      }
      if (path.includes('/correspondence/games/7')) return json(payload)
      if (path.includes('/notes')) return json([])
      if (path.includes('/reference/token')) return json({ configured: true })
      if (path.includes('/reference/explorer')) return json(MASTERS)
      return json({})
    }),
  )
})

function draw() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <Providers client={client}>
      <MemoryRouter initialEntries={['/correspondence/7']}>
        <Routes>
          <Route path="/correspondence/:id" element={<CorrespondenceGamePage />} />
        </Routes>
      </MemoryRouter>
    </Providers>,
  )
}

describe('the correspondence game view', () => {
  it('names both players, says whose move it is and when the reply is due', async () => {
    draw()
    expect(await screen.findByText('Kowalski, Marek')).toBeInTheDocument()
    expect(screen.getByText('Your move')).toBeInTheDocument()
    expect(screen.getByLabelText('Reply due')).toHaveValue('2026-09-14')
  })

  it('orders the candidates by what the tree has backed up, not by the engine\'s own number', async () => {
    draw()
    await screen.findByTestId('candidate-2')
    const moves = screen
      .getAllByTestId(/^candidate-/)
      .map((row) => within(row).getAllByRole('cell')[0].textContent)
    expect(moves).toEqual(['d4', 'e4', 'Nf3'])
  })

  it('says that no engine has been here, which is the whole of step one', async () => {
    draw()
    expect(
      await screen.findByText('No engine has looked at this position yet.'),
    ).toBeInTheDocument()
  })

  it('plays the candidate the tree is standing on', async () => {
    draw()
    await userEvent.click(await screen.findByTestId('candidate-3'))
    await userEvent.click(screen.getByRole('button', { name: 'Play d4' }))

    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].path).toContain('/correspondence/games/7/moves')
    expect(posted[0].body).toEqual({ uci: 'd2d4' })
  })

  it('takes the move that arrived by mail in the notation it arrived in', async () => {
    draw()
    await userEvent.click(await screen.findByRole('button', { name: /Opponent played/ }))
    await userEvent.type(screen.getByLabelText('Move'), 'Nf3')
    await userEvent.click(screen.getByRole('button', { name: 'Play it' }))

    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].body).toEqual({ uci: 'g1f3' })
  })

  it('refuses a move that is not legal in the position the game stands in', async () => {
    draw()
    await userEvent.click(await screen.findByRole('button', { name: /Opponent played/ }))
    await userEvent.type(screen.getByLabelText('Move'), 'Nf6')
    expect(screen.getByText('Not a legal move in this position.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Play it' })).toBeDisabled()
  })

  it('finishes the game with a result and how it ended', async () => {
    draw()
    await userEvent.click(await screen.findByRole('button', { name: /Finish…/ }))
    await userEvent.click(screen.getByRole('button', { name: '1-0' }))
    await userEvent.type(screen.getByLabelText('How it ended'), 'Resignation')
    await userEvent.click(screen.getByRole('button', { name: 'Finish game' }))

    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].path).toContain('/correspondence/games/7/finish')
    expect(posted[0].body).toEqual({ result: '1-0', termination: 'Resignation' })
  })

  it('writes the deadline back as an instant when the box is changed', async () => {
    draw()
    const box = await screen.findByLabelText('Reply due')
    fireEvent.change(box, { target: { value: '2026-09-20' } })

    await waitFor(() => expect(posted.length).toBeGreaterThan(0))
    const last = posted.at(-1)
    expect(last?.method).toBe('PATCH')
    expect(String((last?.body as { reply_due: string } | undefined)?.reply_due)).toContain(
      '2026-09-20',
    )
  })

  it('shows the opening reference at the selected node, and a row sends its move to the tree', async () => {
    draw()
    await userEvent.click(await screen.findByRole('button', { name: 'Book' }))
    const table = await screen.findByTestId('correspondence-book-masters')
    expect(within(table).getByText('1.e4')).toBeInTheDocument()

    // c4 is not in the tree, so reading it and keeping it are the same click.
    await userEvent.click(within(table).getByText('1.c4'))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].path).toContain('/correspondence/nodes')
    expect(posted[0].body).toEqual({ parent_id: 1, uci: 'c2c4' })
  })

  it('numbers the book rows with the move that follows the node, not the one into it', async () => {
    // Standing after 1...e5: the node's own move number is 1, and White's continuations are
    // move 2. Half the tree is reached by a Black move, so half of it printed "1.Nf3".
    const e5 = node({
      id: 3,
      parent_id: 2,
      uci: 'e7e5',
      san: 'e5',
      ply: 2,
      move_number: 1,
      turn: 'white',
      played: true,
    })
    const e4 = node({
      id: 2,
      parent_id: 1,
      uci: 'e2e4',
      san: 'e4',
      ply: 1,
      move_number: 1,
      fen: AFTER_E4,
      turn: 'black',
      played: true,
      children: [e5],
    })
    payload = {
      ...detail({
        ply_count: 2,
        to_move: 'white',
        your_move: true,
        moves_uci: ['e2e4', 'e7e5'],
        moves_san: ['e4', 'e5'],
        current_node_id: 3,
      }),
      tree: node({ children: [e4] }),
    }
    draw()
    await userEvent.click(await screen.findByRole('button', { name: 'Book' }))
    const table = await screen.findByTestId('correspondence-book-masters')
    expect(within(table).getByText('2.e4')).toBeInTheDocument()
    expect(within(table).queryByText('1.e4')).not.toBeInTheDocument()
  })

  it('walks into the branch the tree already has rather than adding it twice', async () => {
    draw()
    await userEvent.click(await screen.findByRole('button', { name: 'Book' }))
    const table = await screen.findByTestId('correspondence-book-masters')
    await userEvent.click(within(table).getByText('1.e4'))

    expect(posted).toHaveLength(0)
    await waitFor(() =>
      expect(screen.getByTestId('tree-node-2')).toHaveAttribute('data-selected', 'true'),
    )
  })

  it('offers none of the moving verbs once the game is over', async () => {
    payload = detail({ finished: true, state: 'finished', result: '1-0' })
    draw()
    expect(await screen.findByText('Kowalski, Marek')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Opponent played/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Finish…/ })).not.toBeInTheDocument()
  })

  it('writes a move comment while the game runs', async () => {
    draw()
    expect(await screen.findByLabelText('Comment on the move')).toBeInTheDocument()
  })

  it('shows a finished game’s comment as text, because the tree takes no more writes', async () => {
    // The service answers a comment on a finished tree with a 409, so the box is not
    // offered at all — but what was written while the game ran still reads.
    payload = {
      ...detail({ finished: true, state: 'finished', result: '1-0' }),
      tree: node({ comment: 'Sealed the file before the time control.' }),
    }
    draw()
    // Both layouts are in the tree at once and CSS decides which is seen, so the comment
    // is counted rather than found once.
    expect(await screen.findAllByText('Sealed the file before the time control.')).not.toHaveLength(
      0,
    )
    expect(screen.queryByLabelText('Comment on the move')).not.toBeInTheDocument()
  })
})
