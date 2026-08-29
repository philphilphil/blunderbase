import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RunResponse } from '@/lib/api/types'

import { FailedRuns } from './FailedRuns'

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** What `POST /analysis/runs/retry-failed` answers with, per case. */
let retryAnswer: { status: number; body: unknown }
/** The failed runs the listing reads. */
let failures: RunResponse[]
/** The query string the listing asked with, so a case can check what it narrowed by. */
let listedWith: string | null

function failure(overrides: Partial<RunResponse> = {}): RunResponse {
  return {
    id: 1,
    game_id: 42,
    tier: 'quick',
    status: 'failed',
    multipv: 1,
    priority: 0,
    attempts: 2,
    created_at: '2026-08-01T10:00:00Z',
    finished_at: '2026-08-01T10:00:04Z',
    error: 'no engine is registered for the quick tier',
    ...overrides,
  }
}

function stubFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const path = url.split('?')[0]!
    if (path.endsWith('/api/analysis/runs/retry-failed')) {
      return json(retryAnswer.status, retryAnswer.body)
    }
    if (path.endsWith('/api/analysis/runs')) {
      listedWith = url.includes('?') ? url.slice(url.indexOf('?') + 1) : ''
      return json(200, failures)
    }
    return json(404, { error: 'not_found', detail: path })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function draw(failed: number) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <FailedRuns failed={failed} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function retryButton() {
  return screen.getByRole('button', { name: /retry them all/i })
}

beforeEach(() => {
  retryAnswer = { status: 202, body: { queued: 0, skipped: 0 } }
  failures = []
  listedWith = null
  stubFetch()
})

afterEach(() => vi.unstubAllGlobals())

describe('FailedRuns', () => {
  it('asks for the failures newest first, narrowed by status', async () => {
    failures = [failure()]
    draw(1)

    await screen.findByText(/no engine is registered/)
    expect(listedWith).toContain('status=failed')
    expect(listedWith).toContain('limit=50')
    // No game to narrow by: this listing is about the status, not about one game.
    expect(listedWith).not.toContain('game_id')
  })

  /**
   * On the owner's library 372 of 382 failures share one message. One row per message is
   * what says "this is one deployment mistake"; 382 rows would hide it.
   */
  it('groups the failures by their message', async () => {
    failures = [
      ...Array.from({ length: 5 }, (_, index) => failure({ id: index + 1, game_id: index + 1 })),
      failure({ id: 99, game_id: 99, tier: 'deep', error: 'the engine went away mid-search' }),
    ]
    draw(6)

    await screen.findByText('5×')
    expect(screen.getByText('1×')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    // The first few games are named, the rest counted.
    expect(screen.getByRole('link', { name: '#1' })).toHaveAttribute('href', '/games/1')
    expect(screen.getByText('and 1 more')).toBeInTheDocument()
  })

  it('shows the receipt a retry came back with', async () => {
    failures = [failure()]
    retryAnswer = { status: 202, body: { queued: 372, skipped: 10 } }
    draw(382)

    await screen.findByText(/no engine is registered/)
    await userEvent.click(retryButton())

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Queued 372 games; skipped 10.',
    )
  })

  it('says so when a retry queued nothing at all', async () => {
    failures = [failure()]
    retryAnswer = { status: 202, body: { queued: 0, skipped: 4 } }
    draw(4)

    await screen.findByText(/no engine is registered/)
    await userEvent.click(retryButton())

    expect(await screen.findByRole('status')).toHaveTextContent('Nothing queued — all 4')
  })

  /**
   * The refusal worth naming: the tier behind these failures still has no engine, so a
   * retry would fail exactly the same way. Saying that, and where to fix it, is the whole
   * difference between a useful page and a red stack trace.
   */
  it('explains the 409 rather than passing the failure through', async () => {
    failures = [failure()]
    retryAnswer = {
      status: 409,
      body: { error: 'tier_unavailable', detail: 'no engine is available for tier quick' },
    }
    draw(1)

    await screen.findByText(/no engine is registered/)
    await userEvent.click(retryButton())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('still has no engine that can take them')
    expect(screen.getByRole('link', { name: /register or enable an engine/i })).toHaveAttribute(
      'href',
      '/engines',
    )
  })

  it('shows any other refusal as it came', async () => {
    failures = [failure()]
    retryAnswer = { status: 500, body: { error: 'internal_error', detail: 'the database is gone' } }
    draw(1)

    await screen.findByText(/no engine is registered/)
    await userEvent.click(retryButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('the database is gone')
  })

  it('has nothing to retry on a library where nothing failed', async () => {
    draw(0)

    await waitFor(() => expect(retryButton()).toBeDisabled())
    expect(screen.getByText(/Nothing has failed/)).toBeInTheDocument()
  })

  it('says the listing is only the newest of them', async () => {
    failures = Array.from({ length: 50 }, (_, index) =>
      failure({ id: index + 1, game_id: index + 1 }),
    )
    draw(382)

    expect(await screen.findByText(/Showing the newest 50 of 382/)).toBeInTheDocument()
  })
})
