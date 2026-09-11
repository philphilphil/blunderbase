import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import type { CorrespondenceGameSummary } from '@/lib/api/types'

import { CorrespondencePage } from './CorrespondencePage'

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

function game(patch: Partial<CorrespondenceGameSummary> = {}): CorrespondenceGameSummary {
  return {
    game_id: 1,
    white: 'Baum',
    black: 'Kowalski, Marek',
    owner_color: 'white',
    source: 'iccf',
    source_id: '1258402',
    event: 'WS/M/168',
    result: '*',
    state: 'ongoing',
    finished: false,
    ply_count: 32,
    move_number: 17,
    to_move: 'white',
    your_move: true,
    moves_uci: [],
    moves_san: [],
    last_move_san: 'Nf6',
    start_fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    days_per_move: 10,
    reply_due: '2026-09-14T12:00:00+00:00',
    days_left: 3,
    created_at: '2026-06-03T10:00:00+00:00',
    updated_at: '2026-09-08T10:00:00+00:00',
    ...patch,
  }
}

const LIST = {
  games: [
    game({
      game_id: 1,
      black: 'Kowalski, Marek',
      your_move: true,
      searches: [
        {
          id: 7,
          node_id: 4,
          game_id: 1,
          engine_id: 1,
          engine_name: 'Stockfish 17',
          kind: 'search',
          status: 'running',
          warm: false,
          multipv: 3,
          snapshot: { search_id: 7, seq: 12, depth: 51, nodes: 7_200_000_000, lines: [] },
        },
      ],
    }),
    game({ game_id: 2, black: 'Jansen, Dirk', your_move: false, days_left: null }),
    game({
      game_id: 3,
      black: 'Haugen, Sven',
      your_move: false,
      finished: true,
      state: 'finished',
      result: '1/2-1/2',
    }),
  ],
  counts: { ongoing: 2, finished: 1, your_move: 1 },
}

const STATUS = {
  slots: 2,
  in_use: 1,
  queued: 0,
  paused: 1,
  parked: [
    { search_id: 8, node_id: 4, engine_id: 1, engine_name: 'Stockfish 17', hash_mb: 8192 },
  ],
  hosts: [
    { runner_id: null, host: 'this host', slots: 2, in_use: 1, parked: 1 },
    { runner_id: 3, host: 'studio', slots: 2, in_use: 1, parked: 0 },
  ],
  engines: [{ engine_id: 1, name: 'Stockfish 17', version: '17', default: true }],
}

const SEARCHES = {
  searches: [
    {
      id: 7,
      node_id: 4,
      game_id: 1,
      engine_id: 1,
      engine_name: 'Stockfish 17',
      kind: 'search',
      status: 'running',
      warm: false,
      multipv: 3,
      started_at: '2026-09-09T10:00:00+00:00',
      snapshot: {
        search_id: 7,
        seq: 12,
        depth: 51,
        nodes: 7_200_000_000,
        lines: [{ multipv: 1, cp: 34, pv: ['e7e6'] }],
      },
    },
    {
      id: 8,
      node_id: 9,
      game_id: 2,
      engine_id: 1,
      engine_name: 'Stockfish 17',
      kind: 'search',
      status: 'paused',
      warm: true,
      multipv: 3,
    },
  ],
}

let posted: { path: string; body: unknown }[]

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  posted = []
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      const method = init?.method ?? 'GET'
      if (method !== 'GET') {
        // Pause all and Resume all are bodyless posts; everything else carries JSON.
        posted.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null })
        if (path.includes('/correspondence/searches')) return json({ searches: [] })
        return json({ game: game({ game_id: 42 }), tree: null, searches: [] }, 201)
      }
      if (path.includes('/correspondence/status')) return json(STATUS)
      if (path.includes('/correspondence/searches')) return json(SEARCHES)
      if (path.includes('/correspondence/games')) return json(LIST)
      return json({})
    }),
  )
})

function draw() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <Providers client={client}>
      <MemoryRouter>
        <CorrespondencePage />
      </MemoryRouter>
    </Providers>,
  )
}

describe('the correspondence list', () => {
  it('files each game under the heading it belongs to', async () => {
    draw()
    expect(await screen.findByText('Kowalski, Marek')).toBeInTheDocument()

    const yours = screen.getByRole('heading', { name: 'Your move' }).closest('section')
    const waiting = screen
      .getByRole('heading', { name: 'Waiting for the opponent' })
      .closest('section')
    const finished = screen.getByRole('heading', { name: 'Finished' }).closest('section')

    expect(within(yours as HTMLElement).getByText('Kowalski, Marek')).toBeInTheDocument()
    expect(within(waiting as HTMLElement).getByText('Jansen, Dirk')).toBeInTheDocument()
    expect(within(finished as HTMLElement).getByText('Haugen, Sven')).toBeInTheDocument()
  })

  it('sends a finished game to the library rather than to a second reader', async () => {
    draw()
    expect(await screen.findByText('Haugen, Sven')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open in Games/ })).toHaveAttribute('href', '/games/3')
  })

  it('reads the capacity strip off the status: slots, parked memory and the other host', async () => {
    draw()
    const strip = await screen.findByTestId('correspondence-capacity')
    await waitFor(() => expect(strip).toHaveTextContent('1 of 2'))
    expect(strip).toHaveTextContent('1 engine parked')
    // 8192 MB is read as GB, because nobody thinks about a parked hash in megabytes.
    expect(strip).toHaveTextContent('8 GB')
    expect(strip).toHaveTextContent('studio')
    // The local host is the sentence, not a row: repeating it would say the same thing twice.
    expect(strip).not.toHaveTextContent('this host')
  })

  it('lists every engine on every game under Running now, parked ones marked', async () => {
    draw()
    const running = await screen.findByTestId('correspondence-running')
    const live = within(running).getByTestId('running-search-7')
    expect(live).toHaveTextContent('Stockfish 17')
    expect(live).toHaveTextContent('depth 51')
    expect(live).toHaveTextContent('+0.34')
    expect(within(running).getByTestId('running-search-8')).toHaveTextContent('parked, warm')
  })

  it('offers Pause all while anything is running, and asks the server for it', async () => {
    draw()
    const pause = await screen.findByRole('button', { name: /Pause all/ })
    // Enabled only once the search list has landed — with nothing running there is nothing
    // to pause, and the button says so by staying off.
    await waitFor(() => expect(pause).toBeEnabled())
    await userEvent.click(pause)
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].path).toContain('/correspondence/searches/pause-all')
  })

  it('puts an engine chip with its depth on the row that is being searched', async () => {
    draw()
    await screen.findByText('Kowalski, Marek')
    const chip = await screen.findByTestId('engine-chip-7')
    expect(chip).toHaveTextContent('Stockfish 17')
    expect(chip).toHaveTextContent('d51')
  })
})

describe('the New game dialog', () => {
  it('will not create a game until it knows which side you are', async () => {
    draw()
    await userEvent.click(await screen.findByRole('button', { name: /New game/ }))
    await userEvent.type(screen.getByLabelText('White'), 'Baum')
    await userEvent.type(screen.getByLabelText('Black'), 'Kowalski')
    expect(screen.getByRole('button', { name: /Create game/ })).toBeDisabled()
  })

  it('posts the names, the colour and only the optional fields that were filled in', async () => {
    draw()
    await userEvent.click(await screen.findByRole('button', { name: /New game/ }))
    await userEvent.type(screen.getByLabelText('White'), 'Baum')
    await userEvent.type(screen.getByLabelText('Black'), 'Kowalski')
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Which one is you' })).getByRole('button', {
        name: /Baum/,
      }),
    )
    await userEvent.type(screen.getByLabelText('ICCF game number'), '1258402')
    await userEvent.click(screen.getByRole('button', { name: /Create game/ }))

    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].path).toContain('/correspondence/games')
    expect(posted[0].body).toMatchObject({
      white: 'Baum',
      black: 'Kowalski',
      owner_color: 'white',
      iccf_id: '1258402',
      event: null,
      url: null,
      start_fen: null,
      reply_due: null,
    })
  })
})

describe('the Import PGN dialog', () => {
  it('posts the pasted game with the colour, and nothing it was not given', async () => {
    draw()
    await userEvent.click(await screen.findByRole('button', { name: /Import PGN/ }))
    await userEvent.type(screen.getByLabelText('PGN'), '1. e4 c5')
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Which one is you' })).getByRole('button', {
        name: 'I am Black',
      }),
    )
    await userEvent.click(screen.getByRole('button', { name: /Import game/ }))

    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].path).toContain('/correspondence/games/import')
    expect(posted[0].body).toMatchObject({
      pgn: '1. e4 c5',
      owner_color: 'black',
      days_per_move: null,
      reply_due: null,
    })
  })
})
