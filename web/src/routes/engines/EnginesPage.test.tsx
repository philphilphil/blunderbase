import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import type { EngineResponse, TierStatusResponse } from '@/lib/api/types'

import { EnginesPage } from './EnginesPage'

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

type Route = unknown | { status: number; body: unknown }

function stubFetch(routes: Record<string, Route>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input).split('?')[0]!
      const route = routes[path]
      if (route === undefined) {
        return new Response(JSON.stringify({ error: 'not_found', detail: path }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        })
      }
      const shaped =
        route !== null && typeof route === 'object' && 'status' in route
          ? (route as { status: number; body: unknown })
          : { status: 200, body: route }
      return new Response(JSON.stringify(shaped.body), {
        status: shaped.status,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
}

function renderPage(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <Providers client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </Providers>,
  )
}

const STOCKFISH: EngineResponse = {
  id: 1,
  name: 'stockfish',
  kind: 'uci',
  path: '/opt/homebrew/bin/stockfish',
  version: 'Stockfish 18',
  options: {},
  enabled: true,
  default_tier: 'quick',
  created_at: '2026-08-26T00:50:11Z',
}

const TIERS: TierStatusResponse[] = [
  { tier: 'quick', engine_id: 1, engine_name: 'stockfish', available: true, reason: null },
  {
    tier: 'deep',
    engine_id: null,
    engine_name: null,
    available: false,
    reason: 'every registered engine is disabled or is a Maia model',
  },
]

const PROBE = {
  name: 'Stockfish 18',
  author: 'the Stockfish developers (see AUTHORS file)',
  options: [
    { name: 'Threads', type: 'spin', default: 1, min: 1, max: 1024, var: [], managed: false },
    { name: 'MultiPV', type: 'spin', default: 1, min: 1, max: 256, var: [], managed: true },
  ],
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeSocket as unknown as typeof WebSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('EnginesPage', () => {
  it('says nothing can be analysed when no engine is registered', async () => {
    stubFetch({ '/api/engines': [], '/api/engines/tiers': [] })
    renderPage(<EnginesPage />)

    expect(await screen.findByText('No engines are registered.')).toBeInTheDocument()
  })

  it('says in words why a tier cannot run', async () => {
    stubFetch({ '/api/engines': [STOCKFISH], '/api/engines/tiers': TIERS, '/api/engines/probe': PROBE })
    renderPage(<EnginesPage />)

    expect(
      await screen.findByText('every registered engine is disabled or is a Maia model'),
    ).toBeInTheDocument()
  })

  it('edits the options the probe declares and refuses one the engine would reject', async () => {
    stubFetch({ '/api/engines': [STOCKFISH], '/api/engines/tiers': TIERS, '/api/engines/probe': PROBE })
    renderPage(<EnginesPage />)

    const threads = await screen.findByLabelText<HTMLInputElement>('Threads')
    // The driver sets MultiPV per analysis, so it is shown but not editable.
    expect(screen.queryByLabelText('MultiPV')).not.toBeInTheDocument()
    expect(screen.getByText('set per analysis')).toBeInTheDocument()

    const save = screen.getByRole('button', { name: 'Save changes' })
    expect(save).toBeDisabled()

    await userEvent.type(threads, '8')
    await waitFor(() => expect(save).toBeEnabled())

    await userEvent.clear(threads)
    await userEvent.type(threads, '9000')
    expect(await screen.findByText('at most 1024')).toBeInTheDocument()
    expect(save).toBeDisabled()
    expect(screen.getByText('Fix the options above first')).toBeInTheDocument()
  })

  it('surfaces a probe that failed instead of an empty option list', async () => {
    stubFetch({
      '/api/engines': [STOCKFISH],
      '/api/engines/tiers': TIERS,
      '/api/engines/probe': {
        status: 422,
        body: {
          error: 'engine_probe_failed',
          detail: '/opt/homebrew/bin/stockfish is not a usable uci engine: no handshake',
        },
      },
    })
    renderPage(<EnginesPage />)

    expect(await screen.findByText('The binary could not be probed.')).toBeInTheDocument()
    expect(
      screen.getByText('/opt/homebrew/bin/stockfish is not a usable uci engine: no handshake'),
    ).toBeInTheDocument()
  })

  it('runs the engine on one position and shows what it said', async () => {
    stubFetch({
      '/api/engines': [STOCKFISH],
      '/api/engines/tiers': TIERS,
      '/api/engines/probe': PROBE,
      '/api/engines/1/test-run': {
        engine_id: 1,
        engine_name: 'stockfish',
        kind: 'uci',
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        elapsed_ms: 412,
        depth: 18,
        nodes: 200_000,
        cp: 31,
        mate: null,
        best_move: { uci: 'e2e4', san: 'e4' },
        lines: [{ multipv: 1, cp: 31, mate: null, pv: ['e2e4', 'e7e5'] }],
      },
    })
    renderPage(<EnginesPage />)

    await userEvent.click(await screen.findByRole('button', { name: 'Test run' }))

    expect(await screen.findByText('412 ms')).toBeInTheDocument()
    // The headline eval and the one line it came from.
    expect(screen.getAllByText('+0.31')).toHaveLength(2)
    expect(screen.getByText('e4')).toBeInTheDocument()
    expect(screen.getByText('e2e4 e7e5')).toBeInTheDocument()
  })
})
