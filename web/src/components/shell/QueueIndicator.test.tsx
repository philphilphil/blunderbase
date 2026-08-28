import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'

import { QueueIndicator } from './QueueIndicator'

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
      <TooltipProvider>
        <QueueIndicator />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

const queue = (queued: number, running = 0) => ({
  queued,
  running,
  workers: true,
  busy: running,
  destinations: [],
})

beforeEach(() => {
  calls = []
  routes = {
    'GET /api/analysis/queue': () => json(200, queue(825, 4)),
    'POST /api/analysis/queue/clear': () => json(200, { dropped: 825, outstanding: 4 }),
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

describe('QueueIndicator', () => {
  it('offers no Clear while nothing is queued', async () => {
    routes['GET /api/analysis/queue'] = () => json(200, queue(0, 0))
    draw()
    await screen.findByText('Idle')
    expect(screen.queryByTestId('clear-queue')).not.toBeInTheDocument()
  })

  it('asks once, with the count, and clears on the second click only', async () => {
    draw()
    const button = await screen.findByTestId('clear-queue')
    expect(button).toHaveTextContent('Clear')

    await userEvent.click(button)
    expect(button).toHaveTextContent('Clear 825?')
    expect(calls.filter((call) => call.startsWith('POST'))).toHaveLength(0)

    await userEvent.click(button)
    await waitFor(() =>
      expect(calls.filter((call) => call === 'POST /api/analysis/queue/clear')).toHaveLength(1),
    )
  })
})
