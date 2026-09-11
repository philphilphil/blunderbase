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
    game({ game_id: 1, black: 'Kowalski, Marek', your_move: true }),
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
        posted.push({ path, body: JSON.parse(String(init?.body)) })
        return json({ game: game({ game_id: 42 }), tree: null, searches: [] }, 201)
      }
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

  it('holds the capacity strip open for the searches that are not built yet', async () => {
    draw()
    expect(await screen.findByTestId('correspondence-capacity')).toHaveTextContent(
      'No engine is searching a correspondence position yet.',
    )
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
