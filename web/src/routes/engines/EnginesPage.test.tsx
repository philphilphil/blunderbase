import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import type {
  EngineResponse,
  RunnerEngine,
  RunnerResponse,
  RunnersStatus,
  TierStatusResponse,
} from '@/lib/api/types'

import { hostByEngineId } from '@/lib/engines/hosts'

import { EngineDetail } from './EngineDetail'
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

/**
 * Releases the routes a case asked to defer. Two reads answering in the same tick is what
 * hides a race between them, so a case that is about one can hold the other open.
 */
let release: () => void = () => {}

/** Returns the mock so a case can assert on what was *not* asked for. */
function stubFetch(routes: Record<string, Route>, defer: string[] = []) {
  const held = new Promise<void>((resolve) => {
    release = () => resolve()
  })
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const path = String(input).split('?')[0]!
    if (defer.includes(path)) await held
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
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function requestedPaths(fetchMock: ReturnType<typeof stubFetch>): string[] {
  return fetchMock.mock.calls.map(([input]) => String(input).split('?')[0]!)
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

function remoteEngine(over: Partial<RunnerEngine> & { id: number; name: string }): RunnerEngine {
  return {
    kind: 'uci',
    version: 'Stockfish 17',
    path: '/usr/games/stockfish',
    enabled: true,
    default_tier: 'deep',
    streams: true,
    ...over,
  }
}

function runner(over: Partial<RunnerResponse> & { id: number; name: string }): RunnerResponse {
  return {
    slots: 4,
    version: '0.1.0',
    connected: true,
    transport: 'websocket',
    last_seen_at: '2026-08-26T10:00:00Z',
    created_at: '2026-08-26T09:00:00Z',
    busy: 2,
    streams: 0,
    free_slots: 2,
    queued_eligible: 78,
    engines: [],
    ...over,
  }
}

function runnersStatus(runners: RunnerResponse[] = []): RunnersStatus {
  return {
    runners,
    local: {
      name: 'local',
      slots: 6,
      busy: 0,
      streams: 0,
      workers: true,
      queued: 0,
      running: 0,
      engines: [
        remoteEngine({ id: 1, name: 'stockfish', path: STOCKFISH.path, default_tier: 'quick' }),
      ],
    },
    queue: { queued: 0, running: 0 },
  }
}

/** The one advertised by `gpu-box`; its id is what joins it to `/engines`. */
const SF_REMOTE: EngineResponse = {
  id: 7,
  name: 'sf-remote',
  kind: 'uci',
  path: '/usr/games/stockfish',
  version: 'Stockfish 17',
  options: {},
  enabled: true,
  default_tier: 'deep',
  created_at: '2026-08-26T09:30:00Z',
}

const PROBE = {
  name: 'Stockfish 18',
  author: 'the Stockfish developers (see AUTHORS file)',
  options: [
    { name: 'Threads', type: 'spin', default: 1, min: 1, max: 1024, var: [], managed: false },
    { name: 'MultiPV', type: 'spin', default: 1, min: 1, max: 256, var: [], managed: true },
  ],
}

beforeEach(() => {
  release = () => {}
  vi.stubGlobal('WebSocket', FakeSocket as unknown as typeof WebSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('EnginesPage', () => {
  it('says nothing can be analysed when no engine is registered', async () => {
    stubFetch({
      '/api/engines': [],
      '/api/engines/tiers': [],
      '/api/runners/status': runnersStatus(),
    })
    renderPage(<EnginesPage />)

    expect(await screen.findByText('No engines are registered.')).toBeInTheDocument()
  })

  it('says in words why a tier cannot run', async () => {
    stubFetch({
      '/api/engines': [STOCKFISH],
      '/api/engines/tiers': TIERS,
      '/api/engines/probe': PROBE,
      '/api/runners/status': runnersStatus(),
    })
    renderPage(<EnginesPage />)

    expect(
      await screen.findByText('every registered engine is disabled or is a Maia model'),
    ).toBeInTheDocument()
  })

  it('edits the options the probe declares and refuses one the engine would reject', async () => {
    stubFetch({
      '/api/engines': [STOCKFISH],
      '/api/engines/tiers': TIERS,
      '/api/engines/probe': PROBE,
      '/api/runners/status': runnersStatus(),
    })
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
      '/api/runners/status': runnersStatus(),
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
      '/api/runners/status': runnersStatus(),
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

describe('EnginesPage — runners', () => {
  it('says everything runs here when no runner is registered', async () => {
    stubFetch({
      '/api/engines': [STOCKFISH],
      '/api/engines/tiers': TIERS,
      '/api/engines/probe': PROBE,
      '/api/runners/status': runnersStatus(),
    })
    renderPage(<EnginesPage />)

    expect(await screen.findByText('No runners are registered.')).toBeInTheDocument()
    // A deployment with no runners still labels its engines as this host's.
    expect(screen.getAllByText('local').length).toBeGreaterThan(0)
    expect(screen.queryByText('queue only')).not.toBeInTheDocument()
  })

  it('names the machine an engine is advertised by, and what its slots are doing', async () => {
    stubFetch({
      '/api/engines': [STOCKFISH, SF_REMOTE],
      '/api/engines/tiers': TIERS,
      '/api/engines/probe': PROBE,
      '/api/runners/status': runnersStatus([
        runner({
          id: 3,
          name: 'gpu-box',
          engines: [
            remoteEngine({ id: 7, name: 'sf-remote' }),
            remoteEngine({ id: 8, name: 'maia-remote', kind: 'maia', streams: false }),
          ],
        }),
      ]),
    })
    renderPage(<EnginesPage />)

    // Once on the roster row for sf-remote, once as the runner card's heading.
    expect((await screen.findAllByText('gpu-box')).length).toBeGreaterThan(1)
    expect(screen.getByText('connected · websocket')).toBeInTheDocument()
    expect(screen.getByText('2/4 slots')).toBeInTheDocument()
    // On the roster row and again in the runner's advertised list.
    expect(screen.getAllByText('sf-remote')).toHaveLength(2)
    expect(screen.getByText('maia-remote')).toBeInTheDocument()
    // A Maia never drives a board, whatever its host's transport is.
    expect(screen.getAllByText('queue only')).toHaveLength(1)
  })

  it('marks a polling runner queue only, on the engine row and on the card', async () => {
    stubFetch({
      '/api/engines': [STOCKFISH, SF_REMOTE],
      '/api/engines/tiers': TIERS,
      '/api/engines/probe': PROBE,
      '/api/runners/status': runnersStatus([
        runner({
          id: 3,
          name: 'gpu-box',
          transport: 'poll',
          engines: [remoteEngine({ id: 7, name: 'sf-remote' })],
        }),
      ]),
    })
    renderPage(<EnginesPage />)

    expect(
      await screen.findByText('connected · polling — queue only'),
    ).toBeInTheDocument()
    // The roster row and the advertised-engine row both say so.
    expect(screen.getAllByText('queue only')).toHaveLength(2)
  })

  it('shows a runner-bound engine as read-only, and never probes its remote path', async () => {
    const fetchMock = stubFetch({
      '/api/engines': [SF_REMOTE],
      '/api/engines/tiers': TIERS,
      '/api/runners/status': runnersStatus([
        runner({ id: 3, name: 'gpu-box', engines: [remoteEngine({ id: 7, name: 'sf-remote' })] }),
      ]),
    })
    renderPage(<EnginesPage />)

    expect(
      await screen.findByText(/rewritten every time it connects/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Options come from the runner.s own probe\./)).toBeInTheDocument()
    expect(screen.getByLabelText<HTMLInputElement>('Path')).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Test run' })).not.toBeInTheDocument()
    // Probing here would start whatever *this* host has at /usr/games/stockfish.
    await waitFor(() => expect(requestedPaths(fetchMock)).toContain('/api/runners/status'))
    expect(requestedPaths(fetchMock)).not.toContain('/api/engines/probe')
  })

  it('probes nothing while it is still unknown which machine an engine is on', async () => {
    // `/engines` is the lighter read and answers first; until `/runners/status` joins the
    // binding on, a runner-bound row is indistinguishable from a local one — and probing it
    // would spawn whatever *this* host has at a path that belongs to another machine.
    const fetchMock = stubFetch(
      {
        '/api/engines': [SF_REMOTE],
        '/api/engines/tiers': TIERS,
        '/api/engines/probe': PROBE,
        '/api/runners/status': runnersStatus([
          runner({ id: 3, name: 'gpu-box', engines: [remoteEngine({ id: 7, name: 'sf-remote' })] }),
        ]),
      },
      ['/api/runners/status'],
    )
    renderPage(<EnginesPage />)

    // The detail card is up, on a row whose host is not known yet.
    expect(await screen.findByText(/not known yet/)).toBeInTheDocument()
    expect(screen.getByLabelText<HTMLInputElement>('Path')).toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Probe' })).toBeDisabled()
    expect(requestedPaths(fetchMock)).not.toContain('/api/engines/probe')

    release()
    expect(await screen.findByText(/rewritten every time it connects/)).toBeInTheDocument()
    expect(requestedPaths(fetchMock)).not.toContain('/api/engines/probe')
  })

  it('does not claim a runner that is away is taking queue work', async () => {
    stubFetch({
      '/api/engines': [STOCKFISH, SF_REMOTE],
      '/api/engines/tiers': TIERS,
      '/api/engines/probe': PROBE,
      '/api/runners/status': runnersStatus([
        runner({
          id: 3,
          name: 'gpu-box',
          connected: false,
          transport: null,
          engines: [remoteEngine({ id: 7, name: 'sf-remote' })],
        }),
      ]),
    })
    renderPage(<EnginesPage />)

    expect(await screen.findByText('not connected')).toBeInTheDocument()
    // A machine that is away drains nothing; the grey dot beside its name is the whole
    // story, and "queue only" would be a claim about a link that is not there.
    expect(screen.queryByText('queue only')).not.toBeInTheDocument()
  })

  it('says why a revoke was refused instead of leaving the click unanswered', async () => {
    stubFetch({
      '/api/engines': [STOCKFISH],
      '/api/engines/tiers': TIERS,
      '/api/engines/probe': PROBE,
      '/api/runners/status': runnersStatus([runner({ id: 3, name: 'gpu-box' })]),
      '/api/runners/3': {
        status: 409,
        body: { error: 'runner_busy', detail: 'gpu-box is running two analysis boards' },
      },
    })
    renderPage(<EnginesPage />)

    await userEvent.click(await screen.findByRole('button', { name: 'Revoke' }))
    // The confirmation row is where the second click lands, so it is where the refusal has
    // to be readable — the card otherwise looks exactly as it did before the click.
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    expect(
      await screen.findByText('gpu-box is running two analysis boards'),
    ).toBeInTheDocument()
  })

  it('sends only what a rename actually changed', async () => {
    const fetchMock = stubFetch({
      '/api/engines': [STOCKFISH],
      '/api/engines/tiers': TIERS,
      '/api/engines/probe': PROBE,
      '/api/runners/status': runnersStatus([runner({ id: 3, name: 'gpu-box' })]),
      '/api/runners/3': runner({ id: 3, name: 'gpu-two' }),
    })
    renderPage(<EnginesPage />)

    await userEvent.click(await screen.findByRole('button', { name: 'Edit gpu-box' }))
    const field = screen.getByLabelText<HTMLInputElement>('Name of gpu-box')
    await userEvent.clear(field)
    await userEvent.type(field, 'gpu-two')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(requestedPaths(fetchMock)).toContain('/api/runners/3'))
    const patch = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/api/runners/3'))!
    expect(patch[1]?.method).toBe('PATCH')
    // The slot count was left alone, so it is not in the body at all.
    expect(JSON.parse(String(patch[1]?.body))).toEqual({ name: 'gpu-two' })
  })

  it('shows the token and the yaml once, then lets them go', async () => {
    stubFetch({
      '/api/engines': [STOCKFISH],
      '/api/engines/tiers': TIERS,
      '/api/engines/probe': PROBE,
      '/api/runners/status': runnersStatus(),
      '/api/runners': {
        status: 201,
        body: {
          runner: runner({ id: 3, name: 'gpu-box', connected: false, transport: null }),
          token: 'bb_rnr_kY3secret',
          config_yaml: 'server: "https://blunderbase.example.com"\ntoken: "bb_rnr_kY3secret"\n',
        },
      },
    })
    renderPage(<EnginesPage />)

    await userEvent.click(await screen.findByRole('button', { name: 'Add runner' }))
    // `Name` also labels the engine detail's field, so the new form's own input is
    // reached by its placeholder.
    await userEvent.type(screen.getByPlaceholderText('gpu-box'), 'gpu-box')
    await userEvent.click(screen.getByRole('button', { name: 'Register' }))

    expect(await screen.findByText('gpu-box is registered')).toBeInTheDocument()
    expect(screen.getByText('bb_rnr_kY3secret')).toBeInTheDocument()
    expect(
      screen.getByText(/Shown once. Nothing stores it, so nothing can show it again/),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByText('bb_rnr_kY3secret')).not.toBeInTheDocument())
  })
})

describe('EngineDetail', () => {
  it('follows a runner-bound row when the runner re-advertises it', () => {
    // The card is keyed on the engine id, so it does not remount when the row's *contents*
    // change — and a runner that reconnects with a renamed engine rewrites exactly those.
    // A read-only field has no draft to protect, so it says what the row says.
    const hosts = hostByEngineId(
      runnersStatus([
        runner({ id: 3, name: 'gpu-box', engines: [remoteEngine({ id: 7, name: 'sf-remote' })] }),
      ]),
    )
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const tree = (engine: EngineResponse) => (
      <Providers client={client}>
        <MemoryRouter>
          <EngineDetail
            engine={engine}
            host={hosts.get(7)}
            hostKnown
            tiers={[]}
            onDeleted={() => {}}
          />
        </MemoryRouter>
      </Providers>
    )

    const view = render(tree(SF_REMOTE))
    expect(screen.getByLabelText<HTMLInputElement>('Name')).toHaveValue('sf-remote')

    view.rerender(tree({ ...SF_REMOTE, name: 'sf-fast', path: '/opt/sf/stockfish' }))
    expect(screen.getByLabelText<HTMLInputElement>('Name')).toHaveValue('sf-fast')
    expect(screen.getByLabelText<HTMLInputElement>('Path')).toHaveValue('/opt/sf/stockfish')
    // The header of the same card, which never had a stale copy to disagree with.
    expect(screen.getAllByText('sf-fast').length).toBeGreaterThan(0)
  })
})
