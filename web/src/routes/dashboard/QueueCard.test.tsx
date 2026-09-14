import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@/lib/toast'

import { QueueCard } from './QueueCard'
import type { RunActivity } from './useRunActivity'

/** The socket's rows, which this card only reads: the hook has its own tests. */
const activity = vi.hoisted(() => ({ current: [] as RunActivity[] }))
vi.mock('./useRunActivity', () => ({ useRunActivity: () => activity.current }))

vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }))

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

let routes: Record<string, () => Response>
let calls: string[]

function draw() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <QueueCard />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function run(overrides: Partial<RunActivity> = {}): RunActivity {
  return {
    runId: 1,
    gameId: 42,
    nodes: 500_000,
    depth: null,
    seconds: null,
    multipv: 2,
    requested: false,
    maiaOnly: false,
    status: 'done',
    progress: 100,
    error: null,
    updatedAt: 0,
    ...overrides,
  }
}

beforeEach(() => {
  calls = []
  activity.current = []
  routes = {
    'GET /api/analysis/queue': () =>
      json(200, { queued: 0, running: 0, workers: true, busy: 0, destinations: [] }),
    'GET /api/games': () => json(200, { total: 0, limit: 50, offset: 0, games: [] }),
    'POST /api/analysis': () => json(202, { id: 2 }),
    'POST /api/analysis/runs/retry-failed': () => json(202, { queued: 1, skipped: 0 }),
    'POST /api/analysis/maia-fill': () => json(202, { queued: 1, already_complete: 0 }),
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${String(input).split('?')[0]}`
      calls.push(key)
      return routes[key]?.() ?? json(404, { error: 'not_found', detail: key })
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

describe('QueueCard', () => {
  it('calls a Maia fill a fill and not the budget it was queued with', async () => {
    activity.current = [run({ maiaOnly: true })]
    draw()

    expect(await screen.findByText('maia')).toBeInTheDocument()
    expect(screen.queryByText(/500k/)).not.toBeInTheDocument()
  })

  it('says what a run that searched stops at, coloured when somebody asked for it', async () => {
    activity.current = [
      run({ runId: 1, nodes: null, depth: 24, multipv: 3, requested: true }),
      run({ runId: 2, gameId: 43 }),
    ]
    draw()

    expect(await screen.findByText('d24 · 3 lines')).toHaveClass('text-deep')
    expect(screen.getByText('500k · 2 lines')).not.toHaveClass('text-deep')
  })

  it('retries a failed fill as a fill, not as a whole pass over the game', async () => {
    activity.current = [run({ maiaOnly: true, status: 'failed', error: 'no maia' })]
    draw()

    await userEvent.click(await screen.findByRole('button', { name: 'retry' }))

    await waitFor(() => expect(calls).toContain('POST /api/analysis/maia-fill'))
    expect(calls).not.toContain('POST /api/analysis')
  })

  /**
   * By id, so the run comes back with its own engine, limit, window and priority — a POST
   * to `/analysis` would have turned an import pass into a requested one.
   */
  it('retries an ordinary run by its id, as the run it was', async () => {
    activity.current = [
      run({ runId: 17, depth: 30, nodes: null, requested: true, status: 'failed', error: 'engine exited' }),
    ]
    const fetchMock = vi.mocked(fetch)
    draw()

    await userEvent.click(await screen.findByRole('button', { name: 'retry' }))

    await waitFor(() => expect(calls).toContain('POST /api/analysis/runs/retry-failed'))
    const sent = fetchMock.mock.calls.find(([input]) =>
      String(input).includes('/analysis/runs/retry-failed'),
    )
    expect(JSON.parse(String(sent?.[1]?.body))).toMatchObject({ run_ids: [17] })
    expect(calls).not.toContain('POST /api/analysis')
    expect(calls).not.toContain('POST /api/analysis/maia-fill')
  })

  it('toasts a failed retry, since the row has no panel of its own to say so in', async () => {
    activity.current = [run({ status: 'failed', error: 'engine exited' })]
    routes['POST /api/analysis/runs/retry-failed'] = () =>
      json(409, { error: 'engine_unavailable', detail: 'no engine is assigned to the analysis role' })
    draw()

    await userEvent.click(await screen.findByRole('button', { name: 'retry' }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('no engine is assigned to the analysis role'),
    )
  })
})
