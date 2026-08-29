import { QueryClient } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import { AppShell } from '@/components/shell/AppShell'
import { BACKFILL_RUN_KEY, resetBackfillRun, type BackfillRun } from '@/lib/analysis'
import { queryKeys } from '@/lib/api/keys'
import type {
  BackfillCancelled,
  BackfillPreview,
  BackfillStarted,
  GameCard,
  QueueStatus,
} from '@/lib/api/types'

import { GamesPage } from './GamesPage'

/**
 * What a running whole-library pass does to the app: takes it over until the queue drains.
 *
 * Started from the Analysis page (`routes/analysis/LibraryActions.test.tsx` covers the
 * confirm-and-post half), but what it takes over is any screen, so the library is the one
 * rendered here. The shell is rendered for real because the takeover's contract is with
 * the shell — it replaces it, rather than covering it.
 */

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

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const GAMES = [11, 12].map(
  (id) =>
    ({
      id,
      source: 'lichess',
      played_at: '2026-04-01T20:00:00Z',
      color: 'white',
      result: '1-0',
      outcome: 'win',
      opponent: `opponent-${id}`,
      eco: 'C65',
      opening: 'Ruy Lopez: Berlin Defense',
      speed: 'blitz',
      ply_count: 40,
      analyzed: false,
      deep: false,
      eval_curve: [],
      worst_moments: [],
    }) as unknown as GameCard,
)

let preview: BackfillPreview
let queue: QueueStatus
let started: BackfillStarted
let cancelled: BackfillCancelled

function idle(): QueueStatus {
  return { queued: 0, running: 0, workers: true, busy: 0, destinations: [] }
}

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).split('?')[0]!
      const method = init?.method ?? 'GET'
      if (path.endsWith('/api/analysis/backfill/cancel')) return json(200, cancelled)
      if (path.endsWith('/api/analysis/backfill')) {
        return method === 'POST' ? json(202, started) : json(200, preview)
      }
      if (path.endsWith('/api/analysis/queue')) return json(200, queue)
      if (path.endsWith('/api/games')) {
        return json(200, { games: GAMES, total: GAMES.length, limit: 50, offset: 0 })
      }
      return json(404, { error: 'not_found', detail: path })
    }),
  )
}

/** Every POST to one path: the parsed body of each, in order. */
function postedTo(path: string): Record<string, unknown>[] {
  return vi
    .mocked(fetch)
    .mock.calls.filter(
      ([input, init]) => String(input).split('?')[0].endsWith(path) && init?.method === 'POST',
    )
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>)
}

/** A pass this browser is already watching, as a reload would find it. */
function stored(run: Partial<BackfillRun> = {}) {
  window.localStorage.setItem(
    BACKFILL_RUN_KEY,
    JSON.stringify({ tier: 'quick', total: 10_000, startedAt: Date.now() - 600_000, ...run }),
  )
  resetBackfillRun()
}

function draw() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <Providers client={client}>
      <MemoryRouter initialEntries={['/games']}>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route path="games" element={<GamesPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </Providers>,
  )
  return client
}

/** Take the reading the takeover would take on its next poll, now. */
async function poll(client: QueryClient) {
  await act(async () => {
    await client.invalidateQueries({ queryKey: queryKeys.queue() })
  })
}

beforeEach(() => {
  preview = { tier: 'quick', pending: 8_412 }
  queue = idle()
  started = { tier: 'quick', queued: 8_412, outstanding: 8_412 }
  cancelled = { tier: 'quick', dropped: 8_000, outstanding: 4 }
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal('localStorage', memoryStorage())
  resetBackfillRun()
  stubFetch()
})

afterEach(() => {
  resetBackfillRun()
  vi.unstubAllGlobals()
})

describe('the backfill takeover', () => {
  it('comes back after a reload and counts the pass down off the queue', async () => {
    stored({ total: 10_000, startedAt: Date.now() - 600_000 })
    queue = { ...idle(), queued: 6_000, running: 4 }
    draw()

    expect(await screen.findByText('Analysing your library')).toBeInTheDocument()
    expect(await screen.findByText('3,996')).toBeInTheDocument()
    expect(screen.getByText('of 10,000')).toBeInTheDocument()
    // 3,996 games in ten minutes puts the remaining 6,004 about a quarter of an hour out.
    expect(screen.getByText('~15m remaining · 4 running')).toBeInTheDocument()
  })

  it('says so and hands the app back when the queue drains', async () => {
    stored({ total: 10_000 })
    queue = { ...idle(), queued: 40, running: 2 }
    const client = draw()

    expect(await screen.findByText('Analysing your library')).toBeInTheDocument()
    // Wait for the reading that has work in it: a takeover that never saw any assumes the
    // pass ended while the tab was shut, which is the case the next test covers.
    expect(await screen.findByText('9,958')).toBeInTheDocument()

    queue = idle()
    await poll(client)

    expect(await screen.findByText('Your library is analysed')).toBeInTheDocument()
    expect(await screen.findByLabelText('Select game 11', undefined, { timeout: 5_000 })).toBeInTheDocument()
    expect(window.localStorage.getItem(BACKFILL_RUN_KEY)).toBeNull()
  }, 10_000)

  it('releases without ceremony when the pass finished while the tab was shut', async () => {
    stored({ total: 10_000 })
    queue = idle()
    draw()

    expect(await screen.findByLabelText('Select game 11')).toBeInTheDocument()
    expect(screen.queryByText('Your library is analysed')).not.toBeInTheDocument()
    await waitFor(() => expect(window.localStorage.getItem(BACKFILL_RUN_KEY)).toBeNull())
  })

  it('cancels the rest of the queue and is honest about what still runs', async () => {
    stored({ total: 10_000 })
    queue = { ...idle(), queued: 6_000, running: 4 }
    const user = userEvent.setup()
    draw()

    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(
      screen.getByText(/The 4 games already on an engine will finish/),
    ).toBeInTheDocument()
    expect(postedTo('/analysis/backfill/cancel')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: /stop the queued runs/i }))

    await waitFor(() =>
      expect(postedTo('/analysis/backfill/cancel')).toEqual([{ tier: 'quick' }]),
    )
    expect(await screen.findByLabelText('Select game 11')).toBeInTheDocument()
    expect(window.localStorage.getItem(BACKFILL_RUN_KEY)).toBeNull()
  })
})
