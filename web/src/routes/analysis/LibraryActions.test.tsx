import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AnalysisCoverage } from '@/lib/api/types'

import { LibraryActions } from './LibraryActions'

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Every backfill POST the case saw, as the bodies it sent (none, since there is one pass). */
let started: unknown[]
/** What the queue reports, which is what the clear button is enabled by. */
let queued: number
/** Whether the fill was asked for, and with which ids. */
let filled: number[] | null | undefined

function stubFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).split('?')[0]!
    const body = init?.body === undefined ? {} : (JSON.parse(String(init.body)) as never)
    if (path.endsWith('/api/analysis/backfill')) {
      started.push(init?.body)
      return json(202, { queued: 12, outstanding: 12 })
    }
    if (path.endsWith('/api/analysis/queue')) {
      return json(200, { queued, running: 0, workers: true, busy: 0, destinations: [] })
    }
    if (path.endsWith('/api/analysis/queue/clear')) {
      const dropped = queued
      queued = 0
      return json(200, { dropped, outstanding: 0 })
    }
    if (path.endsWith('/api/analysis/maia-fill')) {
      filled = (body as { game_ids?: number[] }).game_ids
      return json(202, { queued: 300, already_complete: 40 })
    }
    return json(404, { error: 'not_found', detail: path })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function coverage(overrides: Partial<AnalysisCoverage> = {}): AnalysisCoverage {
  return {
    total: 7714,
    analysed: 835,
    no_pass: 6879,
    missing: 6879,
    failed: 0,
    maia: {
      configured: [1700],
      games_with_any: 800,
      per_level: [{ elo: 1700, games: 300 }],
      missing_games: 340,
      orphan_levels: [],
    },
    estimates: {
      analysis_seconds: 12 * 3600,
      maia_seconds: 40 * 60,
      concurrency: 4,
    },
    ...overrides,
  }
}

function draw(data = coverage()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LibraryActions coverage={data} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  started = []
  queued = 0
  filled = undefined
  stubFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('LibraryActions', () => {
  it('puts the count and the wall-clock estimate on every button', () => {
    draw()

    // 6,879 games and twelve engine-hours over four runners.
    expect(screen.getByText('6,879 games')).toBeInTheDocument()
    expect(screen.getByText('~3h')).toBeInTheDocument()
    expect(screen.getByText('340 games')).toBeInTheDocument()
    expect(screen.getByText('~10m')).toBeInTheDocument()
  })

  it('leaves the cost blank where the deployment has measured nothing', () => {
    draw(
      coverage({
        estimates: {
          analysis_seconds: null,
          maia_seconds: null,
          concurrency: 4,
        },
      }),
    )

    expect(screen.queryByText(/^~/)).not.toBeInTheDocument()
  })

  /**
   * One pass, one button, and a body that names nothing: the budget is the Settings page's,
   * read by the backend when the runs are queued, so there is nothing for the press to say.
   */
  it('starts the backfill with no body and says what it queued', async () => {
    draw()

    expect(screen.getAllByRole('button', { name: /backfill/i })).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: /backfill/i }))

    await waitFor(() => expect(started).toEqual([undefined]))
    // The runs go into the ordinary queue, and the card says what it put there.
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Queued 12 games; 12 runs outstanding.',
    )
  })

  /**
   * The press is the whole gesture. A pass is ordinary queued work now — watched from the
   * titlebar's queue widget and stopped from the card next door — so nothing stands
   * between the button and the POST.
   */
  it('asks nothing before it queues the pass', async () => {
    draw()

    await userEvent.click(screen.getByRole('button', { name: /backfill/i }))

    await waitFor(() => expect(started).toHaveLength(1))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('offers no backfill when nothing is outstanding', () => {
    draw(coverage({ missing: 0 }))

    expect(screen.getByRole('button', { name: /backfill/i })).toBeDisabled()
    expect(screen.getAllByText('nothing to queue')).toHaveLength(1)
  })

  it('calls a non-zero estimate remaining when there is nothing new to queue', () => {
    draw(
      coverage({
        missing: 0,
        estimates: {
          analysis_seconds: 1200,
          maia_seconds: 0,
          concurrency: 4,
        },
      }),
    )

    expect(screen.getByText('~5m remaining')).toBeInTheDocument()
  })

  it('queues the fill over the whole library and says what it queued', async () => {
    draw()

    await userEvent.click(screen.getByRole('button', { name: /fill missing levels/i }))

    // The whole library, not a selection: this is about the deployment's levels.
    await waitFor(() => expect(filled).toBeUndefined())
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Queued 300 games; 40 games already complete.',
    )
  })

  it('clears the queue and reports what it dropped', async () => {
    queued = 1200
    draw()

    const clear = await screen.findByRole('button', { name: /clear the queue/i })
    await waitFor(() => expect(clear).toBeEnabled())
    await userEvent.click(clear)

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Dropped 1,200 runs; 0 runs still outstanding.',
    )
  })

  it('does not offer to clear a queue with nothing in it', async () => {
    draw()

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /clear the queue/i })).toBeDisabled(),
    )
    expect(screen.getByText('nothing queued')).toBeInTheDocument()
  })
})
