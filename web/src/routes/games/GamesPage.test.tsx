import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import type { BatchAnalysisResponse, GameCard } from '@/lib/api/types'

import { GamesPage } from './GamesPage'

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

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const GAMES = [11, 12, 13].map(
  (id) =>
    ({
      id,
      source: 'lichess',
      played_at: '2026-04-01T20:00:00Z',
      color: 'white',
      result: '1-0',
      outcome: 'win',
      white: 'phib',
      black: `opponent-${id}`,
      white_rating: 1650,
      black_rating: 1600,
      opponent: `opponent-${id}`,
      opponent_rating: 1600,
      eco: 'C65',
      opening: 'Ruy Lopez: Berlin Defense',
      time_control: '300+0',
      speed: 'blitz',
      ply_count: 40,
      analyzed: false,
      deep: false,
      eval_curve: [],
      worst_moments: [],
    }) as unknown as GameCard,
)

/** What `/analysis/batch` answers next, and what the library serves under it. */
let receipt: BatchAnalysisResponse

function stubFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input).split('?')[0]!
    if (path.endsWith('/api/analysis/batch')) return json(202, receipt)
    if (path.endsWith('/api/games')) {
      return json(200, { games: GAMES, total: GAMES.length, limit: 50, offset: 0 })
    }
    return json(404, { error: 'not_found', detail: path })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Every POST the page sent to one path: the parsed body of each, in order. */
function postedTo(path: string): Record<string, unknown>[] {
  return vi
    .mocked(fetch)
    .mock.calls.filter(
      ([input, init]) => String(input).split('?')[0].endsWith(path) && init?.method === 'POST',
    )
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>)
}

function draw() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <Providers client={client}>
      <MemoryRouter>
        <GamesPage />
      </MemoryRouter>
    </Providers>,
  )
}

/** The rows, once the first page has answered. */
async function loaded() {
  await screen.findByLabelText('Select game 11')
}

beforeEach(() => {
  receipt = {
    queued: GAMES.map((game, index) => ({ game_id: game.id, run_id: 90 + index })),
    refused: [],
  }
  vi.stubGlobal('WebSocket', FakeSocket)
  stubFetch()
})

afterEach(() => vi.unstubAllGlobals())

describe('GamesPage — filtering analysis coverage', () => {
  it('requests only games with no finished analysis', async () => {
    const user = userEvent.setup()
    draw()
    await loaded()

    await user.click(screen.getByRole('button', { name: /^Analysis/ }))
    await user.click(screen.getByRole('button', { name: 'Unanalysed' }))

    await waitFor(() => {
      const requests = vi.mocked(fetch).mock.calls.map(([input]) => String(input))
      expect(requests.some((request) => request.includes('analyzed=false'))).toBe(true)
    })
    expect(screen.getByRole('button', { name: /Analysis:unanalysed/ })).toBeInTheDocument()
  })
})

describe('GamesPage — queueing analysis over a selection', () => {
  it('sends one request for the whole selection, not one per game', async () => {
    const user = userEvent.setup()
    draw()
    await loaded()

    await user.click(screen.getByLabelText('Select every game on this page'))
    await user.click(screen.getByRole('button', { name: /queue quick analysis/i }))

    await waitFor(() => expect(postedTo('/analysis/batch')).toHaveLength(1))
    expect(postedTo('/analysis/batch')[0]).toEqual({ game_ids: [11, 12, 13], tier: 'quick' })
    expect(await screen.findByText('3 quick runs queued')).toBeInTheDocument()
  })

  it('reads the receipt for what the batch would not take', async () => {
    receipt = { queued: [{ game_id: 11, run_id: 90 }], refused: [{ game_id: 12, reason: 'gone' }] }
    const user = userEvent.setup()
    draw()
    await loaded()

    await user.click(screen.getByLabelText('Select game 11'))
    await user.click(screen.getByLabelText('Select game 12'))
    await user.click(screen.getByRole('button', { name: /queue deep analysis/i }))

    expect(await screen.findByText('1 queued, 1 refused')).toBeInTheDocument()
    expect(postedTo('/analysis/batch')[0]).toEqual({ game_ids: [11, 12], tier: 'deep' })
  })

  it('queues a single row through the same call', async () => {
    receipt = { queued: [{ game_id: 12, run_id: 90 }], refused: [] }
    const user = userEvent.setup()
    draw()
    await loaded()

    const row = screen.getByLabelText('Select game 12').closest('[role="row"]') as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'analyse' }))

    await waitFor(() => expect(postedTo('/analysis/batch')).toHaveLength(1))
    expect(postedTo('/analysis/batch')[0]).toEqual({ game_ids: [12], tier: 'quick' })
    expect(await screen.findByText('1 quick run queued')).toBeInTheDocument()
  })

  it('counts a call that never landed as the whole selection refused', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const path = String(input).split('?')[0]!
      if (path.endsWith('/api/analysis/batch')) {
        return json(409, { error: 'tier_unavailable', detail: 'no engine serves deep' })
      }
      return json(200, { games: GAMES, total: GAMES.length, limit: 50, offset: 0 })
    })
    const user = userEvent.setup()
    draw()
    await loaded()

    await user.click(screen.getByLabelText('Select every game on this page'))
    await user.click(screen.getByRole('button', { name: /queue deep analysis/i }))

    expect(
      await screen.findByText('0 queued, 3 refused — no engine serves deep'),
    ).toBeInTheDocument()
  })

  it('says what the server refused a whole selection for', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const path = String(input).split('?')[0]!
      if (path.endsWith('/api/analysis/batch')) {
        return json(422, { error: 'too_many_games', detail: 'a batch takes at most 500 games' })
      }
      return json(200, { games: GAMES, total: GAMES.length, limit: 50, offset: 0 })
    })
    const user = userEvent.setup()
    draw()
    await loaded()

    await user.click(screen.getByLabelText('Select every game on this page'))
    await user.click(screen.getByRole('button', { name: /queue quick analysis/i }))

    expect(
      await screen.findByText('0 queued, 3 refused — a batch takes at most 500 games'),
    ).toBeInTheDocument()
  })
})

describe('GamesPage — deleting games', () => {
  /** `/games/delete` answers with what went; the table re-reads what is left. */
  function stubDelete(status = 200, body: unknown = { games: 2, runs: 1, notes: 0, lines: 0 }) {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).split('?')[0]!
      if (path.endsWith('/api/games/delete')) return json(status, body)
      if (path.endsWith('/api/games')) {
        return json(200, { games: GAMES, total: GAMES.length, limit: 25, offset: 0 })
      }
      return json(404, { error: 'not_found', detail: `${path} ${init?.method ?? 'GET'}` })
    })
  }

  it('sends the whole selection in one call, once it is confirmed', async () => {
    stubDelete()
    const user = userEvent.setup()
    draw()
    await loaded()

    await user.click(screen.getByLabelText('Select game 11'))
    await user.click(screen.getByLabelText('Select game 12'))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    // Nothing has gone yet: the dialog is the confirmation, and it names the count.
    expect(screen.getByRole('dialog')).toHaveTextContent('Delete 2 games')
    expect(postedTo('/games/delete')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Delete them' }))

    await waitFor(() => expect(postedTo('/games/delete')).toHaveLength(1))
    expect(postedTo('/games/delete')[0]).toEqual({ game_ids: [11, 12] })
    expect(await screen.findByText('2 games deleted')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('deletes one game from its own row through the same call', async () => {
    stubDelete(200, { games: 1, runs: 0, notes: 0, lines: 0 })
    const user = userEvent.setup()
    draw()
    await loaded()

    await user.click(screen.getByRole('button', { name: 'Delete game 13' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Delete 1 game')
    await user.click(screen.getByRole('button', { name: 'Delete it' }))

    await waitFor(() => expect(postedTo('/games/delete')).toHaveLength(1))
    expect(postedTo('/games/delete')[0]).toEqual({ game_ids: [13] })
    expect(await screen.findByText('1 game deleted')).toBeInTheDocument()
  })

  it('keeps the dialog up with the reason when the delete is refused', async () => {
    stubDelete(422, { error: 'invalid_request', detail: 'a delete takes at most 500 games' })
    const user = userEvent.setup()
    draw()
    await loaded()

    await user.click(screen.getByRole('button', { name: 'Delete game 11' }))
    await user.click(screen.getByRole('button', { name: 'Delete it' }))

    expect(await screen.findByText('a delete takes at most 500 games')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('GamesPage — paging and ordering', () => {
  /** A library of 120 games served one page at a time, honouring limit and offset. */
  function stubPages(total = 120) {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      if (!url.pathname.endsWith('/api/games')) return json(404, { error: 'not_found' })
      const limit = Number(url.searchParams.get('limit'))
      const offset = Number(url.searchParams.get('offset'))
      const games = Array.from({ length: Math.max(Math.min(limit, total - offset), 0) }, (_, i) => ({
        ...GAMES[0],
        id: offset + i + 1,
      }))
      return json(200, { games, total, limit, offset })
    })
  }

  /** The query string of the last `/games` request. */
  function lastGamesQuery(): URLSearchParams {
    const calls = vi.mocked(fetch).mock.calls.map(([input]) => String(input))
    const last = calls.filter((url) => url.split('?')[0]!.endsWith('/api/games')).at(-1)!
    return new URL(last, 'http://localhost').searchParams
  }

  it('walks the library a page at a time', async () => {
    stubPages()
    const user = userEvent.setup()
    draw()
    await screen.findByLabelText('Select game 1')

    // jsdom measures nothing, so "Fit" falls back to 25 rows.
    expect(lastGamesQuery().get('limit')).toBe('25')
    expect(screen.getByText('1–25 of 120')).toBeInTheDocument()
    expect(screen.getByLabelText('Previous page')).toBeDisabled()

    await user.click(screen.getByLabelText('Next page'))

    await screen.findByLabelText('Select game 26')
    expect(lastGamesQuery().get('offset')).toBe('25')
    expect(screen.getByText('26–50 of 120')).toBeInTheDocument()
  })

  it('starts again at the first page when the page size changes', async () => {
    stubPages()
    const user = userEvent.setup()
    draw()
    await screen.findByLabelText('Select game 1')
    await user.click(screen.getByLabelText('Next page'))
    await screen.findByLabelText('Select game 26')

    await user.selectOptions(screen.getByLabelText('Rows per page'), '100')

    await waitFor(() => expect(lastGamesQuery().get('limit')).toBe('100'))
    expect(lastGamesQuery().get('offset')).toBe('0')
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
  })

  it('sorts by asking the backend, not by reordering the page', async () => {
    stubPages()
    const user = userEvent.setup()
    draw()
    await screen.findByLabelText('Select game 1')

    // The exact name is the column header, so the filter chips do not match it.
    await user.click(screen.getByRole('button', { name: 'Black' }))

    await waitFor(() => expect(lastGamesQuery().get('order')).toBe('black'))
    expect(lastGamesQuery().get('direction')).toBe('asc')
  })
})
