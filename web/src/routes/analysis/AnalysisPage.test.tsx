import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import type { AnalysisCoverage } from '@/lib/api/types'
import { EventsProvider } from '@/lib/events/EventsProvider'

import { AnalysisPage } from './AnalysisPage'

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

/** The owner's library, as `/analysis/coverage` reports it. */
const OWNERS_LIBRARY: AnalysisCoverage = {
  total: 7714,
  no_pass: 6879,
  quick_only: 374,
  deep: 461,
  missing: { quick: 6879, deep: 7253 },
  failed: 382,
  maia: {
    configured: [1700],
    games_with_any: 835,
    per_level: [{ elo: 1700, games: 300 }],
    missing_games: 535,
    orphan_levels: [{ elo: 1234, games: 1 }],
  },
  estimates: {
    quick_seconds: 12 * 3600,
    deep_seconds: 160 * 3600,
    maia_seconds: 40 * 60,
    concurrency: 4,
  },
}

let coverage: { status: number; body: unknown }
/** Every path the page asked the backend for. */
let asked: string[]

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input).split('?')[0]!
      asked.push(path)
      if (path.endsWith('/api/analysis/coverage')) return json(coverage.status, coverage.body)
      if (path.endsWith('/api/analysis/runs')) return json(200, [])
      if (path.endsWith('/api/analysis/queue')) {
        return json(200, { queued: 0, running: 0, workers: true, busy: 0, destinations: [] })
      }
      if (path.endsWith('/api/games')) return json(200, { games: [], total: 7714, limit: 50, offset: 0 })
      if (path.endsWith('/api/auth/status')) {
        return json(200, {
          setup_required: false,
          authenticated: true,
          maia_target_elo: 1700,
          maia_elos: [1700],
        })
      }
      return json(404, { error: 'not_found', detail: path })
    }),
  )
}

/**
 * `Providers` no longer carries the `/events` socket — it hangs inside `AuthGate`, so a
 * signed-out browser never dials it. A test that mounts a page on its own is standing in
 * for the authenticated side of that gate, so it supplies the provider the gate would.
 */
function draw() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <Providers client={client}>
      <EventsProvider>
        <MemoryRouter>
          <AnalysisPage />
        </MemoryRouter>
      </EventsProvider>
    </Providers>,
  )
}

beforeEach(() => {
  coverage = { status: 200, body: OWNERS_LIBRARY }
  asked = []
  vi.stubGlobal('WebSocket', FakeSocket)
  stubFetch()
})

afterEach(() => vi.unstubAllGlobals())

describe('AnalysisPage', () => {
  it('builds the whole picture from one read', async () => {
    draw()

    await screen.findByText('6,879')
    // The split, the backlogs, the levels and the failures all come off `/coverage`: a page
    // that asked six questions could show a breakdown that fails to add up to its total.
    expect(asked.filter((path) => path.endsWith('/api/analysis/coverage'))).toHaveLength(1)
    expect(screen.getByText('Coverage')).toBeInTheDocument()
    expect(screen.getByText('Maia levels')).toBeInTheDocument()
    expect(screen.getByText('Failed runs')).toBeInTheDocument()
    expect(screen.getByText('382')).toBeInTheDocument()
  })

  it('says how much of the library an engine has been over', async () => {
    draw()

    expect(
      await screen.findByText('835 of 7,714 games have had an engine over them.'),
    ).toBeInTheDocument()
  })

  it('offers all four library-wide passes', async () => {
    draw()

    await screen.findByText('6,879')
    for (const name of [/backfill quick/i, /backfill deep/i, /fill missing levels/i, /clear the queue/i]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    // Said once, where the estimates are, rather than beside each of them.
    expect(screen.getByText(/Times are approximate/)).toBeInTheDocument()
  })

  it('shows the read failing rather than an empty page', async () => {
    coverage = { status: 500, body: { error: 'internal_error', detail: 'the database is gone' } }
    draw()

    expect(await screen.findByText('The coverage could not be read.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(asked.filter((path) => path.endsWith('/api/analysis/coverage')).length).toBeGreaterThan(1)
  })
})
