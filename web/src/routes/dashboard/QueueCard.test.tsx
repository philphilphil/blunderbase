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
    tier: 'quick',
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
  it('calls a Maia fill a fill and not the tier it was queued under', async () => {
    activity.current = [run({ maiaOnly: true })]
    draw()

    expect(await screen.findByText('maia')).toBeInTheDocument()
    expect(screen.queryByText('quick')).not.toBeInTheDocument()
  })

  it('still names the tier of a run that searched', async () => {
    activity.current = [run({ tier: 'deep' })]
    draw()

    expect(await screen.findByText('deep')).toBeInTheDocument()
  })

  it('retries a failed fill as a fill, not as a whole pass over the game', async () => {
    activity.current = [run({ maiaOnly: true, status: 'failed', error: 'no maia' })]
    draw()

    await userEvent.click(await screen.findByRole('button', { name: 'retry' }))

    await waitFor(() => expect(calls).toContain('POST /api/analysis/maia-fill'))
    expect(calls).not.toContain('POST /api/analysis')
  })

  it('retries an ordinary run with a pass of the same tier', async () => {
    activity.current = [run({ tier: 'deep', status: 'failed', error: 'engine exited' })]
    draw()

    await userEvent.click(await screen.findByRole('button', { name: 'retry' }))

    await waitFor(() => expect(calls).toContain('POST /api/analysis'))
    expect(calls).not.toContain('POST /api/analysis/maia-fill')
  })

  it('toasts a failed retry, since the row has no panel of its own to say so in', async () => {
    activity.current = [run({ tier: 'deep', status: 'failed', error: 'engine exited' })]
    routes['POST /api/analysis'] = () =>
      json(409, { error: 'no_engine', detail: 'no engine is registered for deep' })
    draw()

    await userEvent.click(await screen.findByRole('button', { name: 'retry' }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('no engine is registered for deep'),
    )
  })
})
