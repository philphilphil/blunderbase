import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import type {
  EngineResponse,
  EngineRoleName,
  EngineRolesResponse,
  EngineRoleStatus,
  RunnerEngine,
  RunnerResponse,
  RunnersStatus,
} from '@/lib/api/types'

import { hostByEngineId } from '@/lib/engines/hosts'

import { EngineDetail } from './EngineDetail'
import { EnginesPage } from './EnginesPage'

/** jsdom in this setup exposes no `localStorage`, so the tests bring their own (see
 *  `games/savedFilters.test.ts`). */
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

/**
 * Returns the mock so a case can assert on what was *not* asked for.
 *
 * A route may be keyed by path, or by `"<METHOD> <path>"` when a case needs the write to
 * answer differently from the read — `/engines/roles` is both a read and a write, and a
 * refused assignment is only a refusal of the PUT.
 */
function stubFetch(routes: Record<string, Route>, defer: string[] = []) {
  const held = new Promise<void>((resolve) => {
    release = () => resolve()
  })
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).split('?')[0]!
    if (defer.includes(path)) await held
    const route = routes[`${(init?.method ?? 'GET').toUpperCase()} ${path}`] ?? routes[path]
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

/** `at` is the URL the page starts on — the tab lives in a search param. */
function renderPage(ui: ReactNode, at = '/engines') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <Providers client={client}>
      <MemoryRouter initialEntries={[at]}>{ui}</MemoryRouter>
    </Providers>,
  )
}

/** Inventory details are closed at rest; tests open only the engine behavior they exercise. */
async function openEngine(name: string) {
  await userEvent.click(await screen.findByRole('button', { name: `Edit ${name}` }))
}

async function openMoreSettings(name: string) {
  await openEngine(name)
  await userEvent.click(screen.getByRole('button', { name: /More settings/ }))
}

/** The Machines half: runners, this browser, tokens. */
const MACHINES = '/engines?tab=machines'

const STOCKFISH: EngineResponse = {
  id: 1,
  name: 'stockfish',
  kind: 'uci',
  path: '/opt/homebrew/bin/stockfish',
  version: 'Stockfish 18',
  options: {},
  enabled: true,
  created_at: '2026-08-26T00:50:11Z',
}

const MAIA: EngineResponse = {
  id: 2,
  name: 'maia3',
  kind: 'maia',
  path: '/models/maia-1500.pb.gz',
  version: 'lc0 maia-1500',
  options: {},
  enabled: true,
  created_at: '2026-08-26T00:51:00Z',
}

/** One role status, defaulted to the shape of a role nobody has assigned anything to. */
function role(
  over: Partial<EngineRoleStatus> & { role: EngineRoleName },
): EngineRoleStatus {
  return {
    engine_id: null,
    engine_name: null,
    available: false,
    configured: false,
    reason: `no engine is assigned to ${over.role === 'human' ? 'human moves' : `the ${over.role} tier`}`,
    ...over,
  }
}

/** Quick on `stockfish`, Deep on an engine that is away, and no human-move model at all. */
function roles(...over: EngineRoleStatus[]): EngineRolesResponse {
  const base = new Map<EngineRoleName, EngineRoleStatus>([
    [
      'quick',
      role({
        role: 'quick',
        engine_id: 1,
        engine_name: 'stockfish',
        available: true,
        configured: true,
        reason: null,
      }),
    ],
    [
      'deep',
      role({
        role: 'deep',
        engine_id: 7,
        engine_name: 'sf-remote',
        configured: true,
        reason: "'sf-remote' runs on 'gpu-box', which is not connected",
      }),
    ],
    ['human', role({ role: 'human' })],
  ])
  for (const status of over) base.set(status.role, status)
  return { roles: [...base.values()] }
}

const ROLES = roles()

function remoteEngine(over: Partial<RunnerEngine> & { id: number; name: string }): RunnerEngine {
  return {
    kind: 'uci',
    version: 'Stockfish 17',
    path: '/usr/games/stockfish',
    enabled: true,
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
      engines: [remoteEngine({ id: 1, name: 'stockfish', path: STOCKFISH.path })],
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
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('WebSocket', FakeSocket as unknown as typeof WebSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('EnginesPage', () => {
  it('says nothing can be analysed when no engine is registered', async () => {
    stubFetch({
      '/api/engines': [],
      '/api/engines/roles': roles(role({ role: 'quick' }), role({ role: 'deep' })),
      '/api/runners/status': runnersStatus(),
    })
    renderPage(<EnginesPage />)

    expect(await screen.findByText('No engines are registered.')).toBeInTheDocument()
  })

  it('says in the backend’s own words why an assigned role cannot run', async () => {
    stubFetch({
      '/api/engines': [STOCKFISH],
      '/api/engines/roles': ROLES,
      '/api/engines/probe': PROBE,
      '/api/runners/status': runnersStatus(),
    })
    renderPage(<EnginesPage />)

    // Verbatim: it is the sentence a deep run would fail with, and rewording it here would
    // make the two look like two different problems.
    expect(
      await screen.findByText("'sf-remote' runs on 'gpu-box', which is not connected"),
    ).toBeInTheDocument()
  })

  it('offers one picker per role, human moves beside the two tiers', async () => {
    stubFetch({
      '/api/engines': [STOCKFISH, MAIA],
      '/api/engines/roles': roles(
        role({
          role: 'human',
          engine_id: 2,
          engine_name: 'maia3',
          available: true,
          configured: true,
          reason: null,
        }),
      ),
      '/api/engines/probe': PROBE,
      '/api/runners/status': runnersStatus(),
    })
    renderPage(<EnginesPage />)

    expect(await screen.findByText('What runs what')).toBeInTheDocument()
    expect(screen.getByLabelText<HTMLSelectElement>('Quick')).toHaveValue('1')
    expect(screen.getByLabelText<HTMLSelectElement>('Deep')).toHaveValue('7')
    expect(screen.getByLabelText<HTMLSelectElement>('Human moves')).toHaveValue('2')
  })

  it('offers a role only the engines whose kind can serve it', async () => {
    stubFetch({
      '/api/engines': [STOCKFISH, MAIA],
      '/api/engines/roles': ROLES,
      '/api/engines/probe': PROBE,
      '/api/runners/status': runnersStatus(),
    })
    renderPage(<EnginesPage />)

    const quick = await screen.findByLabelText<HTMLSelectElement>('Quick')
    // The engine, and where it lives — two engines of the same name on two machines is the
    // case this form exists for.
    expect([...quick.options].map((option) => option.text)).toEqual([
      'Nothing assigned',
      'stockfish · local',
    ])
    // A human-move model answers with a policy rather than a search, so it is not offered
    // for a tier; the backend refuses it, and a dropdown offering it offers a refusal. This
    // model is not in the status read, so there is no host to name beside it.
    const human = screen.getByLabelText<HTMLSelectElement>('Human moves')
    expect([...human.options].map((option) => option.text)).toEqual(['Nothing assigned', 'maia3'])
  })

  it('keeps an engine that cannot run the role as the selected option', async () => {
    // `sf-remote` is on a machine that is away. It is still what is stored, and a select
    // showing something else would be lying about the assignment.
    stubFetch({
      '/api/engines': [STOCKFISH],
      '/api/engines/roles': ROLES,
      '/api/engines/probe': PROBE,
      '/api/runners/status': runnersStatus(),
    })
    renderPage(<EnginesPage />)

    const deep = await screen.findByLabelText<HTMLSelectElement>('Deep')
    expect(deep).toHaveValue('7')
    expect([...deep.options].map((option) => option.text)).toContain('sf-remote')
  })

  it('writes one role and leaves the other two out of the body', async () => {
    const fetchMock = stubFetch({
      '/api/engines': [STOCKFISH],
      '/api/engines/roles': ROLES,
      '/api/engines/probe': PROBE,
      '/api/runners/status': runnersStatus(),
    })
    renderPage(<EnginesPage />)

    await userEvent.selectOptions(await screen.findByLabelText('Deep'), '1')

    await waitFor(() => expect(requestedPaths(fetchMock)).toContain('/api/engines/roles'))
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!
    // Absence means "leave alone": saving one dropdown must not clear the other two.
    expect(JSON.parse(String(put[1]?.body))).toEqual({ deep: 1 })
  })

  it('says in the form why an assignment was refused', async () => {
    stubFetch({
      '/api/engines': [STOCKFISH],
      '/api/engines/roles': ROLES,
      'PUT /api/engines/roles': {
        status: 422,
        body: { error: 'invalid_engine', detail: 'no engine with id 1 to assign to the deep tier' },
      },
      '/api/engines/probe': PROBE,
      '/api/runners/status': runnersStatus(),
    })
    renderPage(<EnginesPage />)

    await userEvent.selectOptions(await screen.findByLabelText('Deep'), '1')

    // It is a form, so it owns its errors: the refusal is read beside the select that
    // caused it, not in a toast that has gone by the time the owner looks up.
    expect(
      await screen.findByText('no engine with id 1 to assign to the deep tier'),
    ).toBeInTheDocument()
    // And the select is back to what is actually stored.
    expect(screen.getByLabelText<HTMLSelectElement>('Deep')).toHaveValue('7')
  })

  it('says calmly, not in red, that a deployment simply has no human-move model', async () => {
    stubFetch({
      '/api/engines': [STOCKFISH],
      '/api/engines/roles': ROLES,
      '/api/engines/probe': PROBE,
      '/api/runners/status': runnersStatus(),
    })
    renderPage(<EnginesPage />)

    expect(await screen.findByText('no engine is assigned to human moves')).toBeInTheDocument()
    // A role that was chosen and cannot run is a fault and gets the red dot; one nobody has
    // chosen yet is a deployment with one fewer column, and gets neither.
    expect(screen.getByLabelText('not set up')).toBeInTheDocument()
  })

  it('reports a model that is switched off as a fault, unlike one nobody chose', async () => {
    stubFetch({
      '/api/engines': [STOCKFISH, { ...MAIA, enabled: false }],
      '/api/engines/roles': roles(
        role({
          role: 'human',
          engine_id: 2,
          engine_name: 'maia3',
          configured: true,
          reason: "'maia3' is assigned to human moves and is switched off",
        }),
      ),
      '/api/engines/probe': PROBE,
      '/api/runners/status': runnersStatus(),
    })
    renderPage(<EnginesPage />)

    expect(
      await screen.findByText("'maia3' is assigned to human moves and is switched off"),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('not set up')).not.toBeInTheDocument()
  })

  it('labels every roster row with its kind, in the owner’s words', async () => {
    // Not `UCI`/`Maia`: UCI is a protocol nobody chose and Maia is a model family they may
    // not have heard of. The distinction they make is normal engine versus plays-like-a-person.
    stubFetch({
      '/api/engines': [STOCKFISH, MAIA],
      '/api/engines/roles': ROLES,
      '/api/engines/probe': PROBE,
      '/api/runners/status': runnersStatus(),
    })
    renderPage(<EnginesPage />)

    expect(await screen.findAllByText('Engine')).not.toHaveLength(0)
    expect(screen.getByText('Human')).toBeInTheDocument()
    expect(screen.queryByText('UCI')).not.toBeInTheDocument()
  })

  it('labels a roster row with the roles it holds, and the rest with an em dash', async () => {
    stubFetch({
      '/api/engines': [STOCKFISH, { ...SF_REMOTE, id: 4, name: 'sf-spare' }],
      '/api/engines/roles': roles(
        role({
          role: 'deep',
          engine_id: 1,
          engine_name: 'stockfish',
          available: true,
          configured: true,
          reason: null,
        }),
      ),
      '/api/engines/probe': PROBE,
      '/api/runners/status': runnersStatus(),
    })
    renderPage(<EnginesPage />)

    expect(await screen.findByText('Quick + Deep')).toBeInTheDocument()
    expect(screen.getByTitle('Assigned to nothing right now')).toHaveTextContent('—')
  })

  it('keeps paths off the roster, where they cannot be edited anyway', async () => {
    stubFetch({
      '/api/engines': [STOCKFISH, MAIA],
      '/api/engines/roles': ROLES,
      '/api/engines/probe': PROBE,
      '/api/runners/status': runnersStatus(),
    })
    renderPage(<EnginesPage />)

    // Paths stay out of the comparable summary; opening one engine reveals only its field.
    await openEngine('stockfish')
    expect(await screen.findByLabelText<HTMLInputElement>('Path')).toHaveValue(STOCKFISH.path)
    expect(screen.queryByText(STOCKFISH.path)).not.toBeInTheDocument()
    expect(screen.queryByText(MAIA.path)).not.toBeInTheDocument()
  })

  it('edits the options the probe declares and refuses one the engine would reject', async () => {
    stubFetch({
      '/api/engines': [STOCKFISH],
      '/api/engines/roles': ROLES,
      '/api/engines/probe': PROBE,
      '/api/runners/status': runnersStatus(),
    })
    renderPage(<EnginesPage />)

    await openMoreSettings('stockfish')
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
      '/api/engines/roles': ROLES,
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

    await openMoreSettings('stockfish')
    expect(await screen.findByText('The binary could not be probed.')).toBeInTheDocument()
    expect(
      screen.getByText('/opt/homebrew/bin/stockfish is not a usable uci engine: no handshake'),
    ).toBeInTheDocument()
  })

  it('runs the engine on one position and shows what it said', async () => {
    stubFetch({
      '/api/engines': [STOCKFISH],
      '/api/engines/roles': ROLES,
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

    await openMoreSettings('stockfish')
    await userEvent.click(await screen.findByRole('button', { name: 'Test run' }))

    expect(await screen.findByText('412 ms')).toBeInTheDocument()
    // The headline eval and the one line it came from.
    expect(screen.getAllByText('+0.31')).toHaveLength(2)
    expect(screen.getByText('e4')).toBeInTheDocument()
    expect(screen.getByText('e2e4 e7e5')).toBeInTheDocument()
  })
})

describe('EnginesPage — runners', () => {
  it('shows server and browser capacity when no remote runner is registered', async () => {
    stubFetch({
      '/api/engines': [STOCKFISH],
      '/api/engines/roles': ROLES,
      '/api/engines/probe': PROBE,
      '/api/runners/status': runnersStatus(),
    })
    renderPage(<EnginesPage />, MACHINES)

    expect(await screen.findByText(/No remote runners are registered/)).toBeInTheDocument()
    expect(screen.getAllByText('This server').length).toBeGreaterThan(0)
    expect(screen.getAllByText('This browser').length).toBeGreaterThan(0)
    expect(screen.queryByText('queue only')).not.toBeInTheDocument()
  })

  it('labels every engine with where it runs on the same page as capacity', async () => {
    stubFetch({
      '/api/engines': [STOCKFISH, SF_REMOTE],
      '/api/engines/roles': ROLES,
      '/api/engines/probe': PROBE,
      '/api/runners/status': runnersStatus([
        runner({ id: 3, name: 'gpu-box', engines: [remoteEngine({ id: 7, name: 'sf-remote' })] }),
      ]),
    })
    renderPage(<EnginesPage />)

    expect((await screen.findAllByText('gpu-box')).length).toBeGreaterThan(1)
    expect(screen.getAllByText('This server').length).toBeGreaterThan(0)
    expect(screen.getByText('Compute capacity')).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  it('names the machine an engine is advertised by, and what its slots are doing', async () => {
    stubFetch({
      '/api/engines': [STOCKFISH, SF_REMOTE],
      '/api/engines/roles': ROLES,
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
    renderPage(<EnginesPage />, MACHINES)

    expect((await screen.findAllByText('gpu-box')).length).toBeGreaterThan(1)
    // The status caption and the slot count are on the row itself, unopened.
    expect(screen.getByText('connected · websocket')).toBeInTheDocument()
    expect(screen.getByText('2/4')).toBeInTheDocument()
    // Its advertised engines are the detail — opening the row is what reveals them.
    await userEvent.click(screen.getByRole('button', { name: /expand gpu-box/i }))
    expect(screen.getAllByText('sf-remote').length).toBeGreaterThan(1)
    expect(screen.getByText('maia-remote')).toBeInTheDocument()
    // A Maia never drives a board, whatever its host's transport is.
    expect(screen.getAllByText('queue only')).toHaveLength(1)
  })

  it('marks a polling runner queue only in both inventories', async () => {
    stubFetch({
      '/api/engines': [STOCKFISH, SF_REMOTE],
      '/api/engines/roles': ROLES,
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
    renderPage(<EnginesPage />, MACHINES)

    expect(
      await screen.findByText('connected · polling — queue only'),
    ).toBeInTheDocument()
    // The flat engine inventory says it before any detail is opened.
    expect(screen.getAllByText(/queue only/i).length).toBeGreaterThanOrEqual(2)
    // The advertised-engine detail repeats the transport limitation in its own context.
    await userEvent.click(screen.getByRole('button', { name: /expand gpu-box/i }))
    expect(screen.getAllByText(/queue only/i).length).toBeGreaterThanOrEqual(3)
  })

  it('shows a runner-bound engine as read-only, and never probes its remote path', async () => {
    const fetchMock = stubFetch({
      '/api/engines': [SF_REMOTE],
      '/api/engines/roles': ROLES,
      '/api/runners/status': runnersStatus([
        runner({ id: 3, name: 'gpu-box', engines: [remoteEngine({ id: 7, name: 'sf-remote' })] }),
      ]),
    })
    renderPage(<EnginesPage />)

    await openMoreSettings('sf-remote')
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
        '/api/engines/roles': ROLES,
        '/api/engines/probe': PROBE,
        '/api/runners/status': runnersStatus([
          runner({ id: 3, name: 'gpu-box', engines: [remoteEngine({ id: 7, name: 'sf-remote' })] }),
        ]),
      },
      ['/api/runners/status'],
    )
    renderPage(<EnginesPage />)

    await openMoreSettings('sf-remote')
    // The requested detail is up, on a row whose host is not known yet.
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
      '/api/engines/roles': ROLES,
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
    renderPage(<EnginesPage />, MACHINES)

    expect(await screen.findByText('not connected')).toBeInTheDocument()
    // A machine that is away drains nothing; the grey dot beside its name is the whole
    // story, and "queue only" would be a claim about a link that is not there.
    expect(screen.queryByText('queue only')).not.toBeInTheDocument()
  })

  it('says why a revoke was refused instead of leaving the click unanswered', async () => {
    stubFetch({
      '/api/engines': [STOCKFISH],
      '/api/engines/roles': ROLES,
      '/api/engines/probe': PROBE,
      '/api/runners/status': runnersStatus([runner({ id: 3, name: 'gpu-box' })]),
      '/api/runners/3': {
        status: 409,
        body: { error: 'runner_busy', detail: 'gpu-box is running two analysis boards' },
      },
    })
    renderPage(<EnginesPage />, MACHINES)

    await userEvent.click(await screen.findByRole('button', { name: /expand gpu-box/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    // The confirmation row is where the second click lands, so it is where the refusal has
    // to be readable — the row otherwise looks exactly as it did before the click.
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    expect(
      await screen.findByText('gpu-box is running two analysis boards'),
    ).toBeInTheDocument()
  })

  it('sends only what a rename actually changed', async () => {
    const fetchMock = stubFetch({
      '/api/engines': [STOCKFISH],
      '/api/engines/roles': ROLES,
      '/api/engines/probe': PROBE,
      '/api/runners/status': runnersStatus([runner({ id: 3, name: 'gpu-box' })]),
      '/api/runners/3': runner({ id: 3, name: 'gpu-two' }),
    })
    renderPage(<EnginesPage />, MACHINES)

    await userEvent.click(await screen.findByRole('button', { name: /expand gpu-box/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Edit gpu-box' }))
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
      '/api/engines/roles': ROLES,
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
    renderPage(<EnginesPage />, MACHINES)

    await userEvent.click(await screen.findByRole('button', { name: 'Remote runner' }))
    await userEvent.type(screen.getByPlaceholderText('gpu-box'), 'gpu-box')
    await userEvent.click(screen.getByRole('button', { name: 'Register remote runner' }))

    expect(await screen.findByText('gpu-box is registered')).toBeInTheDocument()
    expect(screen.getByText('bb_rnr_kY3secret')).toBeInTheDocument()
    expect(
      screen.getByText(/Shown once. Nothing stores it, so nothing can show it again/),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByText('bb_rnr_kY3secret')).not.toBeInTheDocument())
  })
})

describe('EnginesPage — delete engine', () => {
  it('confirms before deleting, and cancels without sending anything', async () => {
    const fetchMock = stubFetch({
      '/api/engines': [STOCKFISH],
      '/api/engines/roles': ROLES,
      '/api/engines/probe': PROBE,
      '/api/runners/status': runnersStatus(),
    })
    renderPage(<EnginesPage />)

    await openEngine('stockfish')
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(
      await screen.findByText(/Remove stockfish\? Analysis already stored keeps its runs\./),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(
      screen.queryByText(/Analysis already stored keeps its runs\./),
    ).not.toBeInTheDocument()
    expect(requestedPaths(fetchMock)).not.toContain('/api/engines/1')
  })

  it('deletes the engine on confirm and closes its detail', async () => {
    const fetchMock = stubFetch({
      '/api/engines': [STOCKFISH],
      '/api/engines/roles': ROLES,
      '/api/engines/probe': PROBE,
      '/api/runners/status': runnersStatus(),
      '/api/engines/1': { status: 200, body: { unqueued: 2 } },
    })
    renderPage(<EnginesPage />)

    await openEngine('stockfish')
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(requestedPaths(fetchMock)).toContain('/api/engines/1'))
    const call = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/api/engines/1'))!
    expect(call[1]?.method).toBe('DELETE')
    await waitFor(() => expect(screen.queryByText('Engine settings')).not.toBeInTheDocument())
  })

  it('does not offer deletion for a runner-owned engine', async () => {
    stubFetch({
      '/api/engines': [SF_REMOTE],
      '/api/engines/roles': ROLES,
      '/api/runners/status': runnersStatus([
        runner({ id: 3, name: 'gpu-box', engines: [remoteEngine({ id: 7, name: 'sf-remote' })] }),
      ]),
    })
    renderPage(<EnginesPage />)

    await openEngine('sf-remote')
    expect(await screen.findByText(/open gpu-box under Compute capacity below/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
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

  it('describes a browser engine as where it runs, never as a file', () => {
    // `wasm:stockfish-18` is an identifier, not a location. Under a label reading "Path" it
    // would have the owner looking for a file, and the remote wording would send them to a
    // `runner.yaml` on a machine that is a browser tab.
    const hosts = hostByEngineId(
      runnersStatus([
        runner({
          id: 5,
          name: 'Chrome on macOS',
          browser: true,
          slots: 1,
          engines: [
            remoteEngine({
              id: 8,
              name: 'Stockfish (Chrome on macOS)',
              path: 'wasm:stockfish-18',
              path_scheme: 'wasm',
              version: 'Stockfish 18',
            }),
          ],
        }),
      ]),
    )
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <Providers client={client}>
        <MemoryRouter>
          <EngineDetail
            engine={{
              id: 8,
              name: 'Stockfish (Chrome on macOS)',
              kind: 'uci',
              path: 'wasm:stockfish-18',
              path_scheme: 'wasm',
              version: 'Stockfish 18',
              options: { Threads: 8 },
              enabled: true,
              created_at: '2026-08-29T07:00:00Z',
            }}
            host={hosts.get(8)}
            hostKnown
            onDeleted={() => {}}
          />
        </MemoryRouter>
      </Providers>,
    )

    expect(screen.getByLabelText<HTMLInputElement>('Where it runs')).toHaveValue(
      'In Chrome on macOS',
    )
    expect(screen.queryByLabelText('Path')).toBeNull()
    expect(screen.queryByText(/wasm:stockfish-18/)).toBeNull()
    expect(screen.queryByText(/runner\.yaml/)).toBeNull()
    expect(screen.getByText(/no file on any machine/)).toBeInTheDocument()
  })
})

describe('EnginesPage — one page', () => {
  const routes = {
    '/api/engines': [STOCKFISH],
    '/api/engines/roles': ROLES,
    '/api/engines/probe': PROBE,
    '/api/runners/status': runnersStatus(),
  }

  it('shows assignments, inventory and capacity together without tabs', async () => {
    stubFetch(routes)
    renderPage(<EnginesPage />)

    expect(await screen.findByText('What runs what')).toBeInTheDocument()
    expect(screen.getByText('Engine inventory')).toBeInTheDocument()
    expect(screen.getByText('Compute capacity')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remote runner' })).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  it('explains remote runners before registration', async () => {
    stubFetch(routes)
    renderPage(<EnginesPage />)

    await userEvent.click(await screen.findByRole('button', { name: 'How remote runners work' }))
    expect(screen.getByText(/connects outward to this Blunderbase deployment/)).toBeInTheDocument()
    expect(screen.getByText(/token shown once and a paste-ready/)).toBeInTheDocument()
    expect(screen.getByText(/documentation is ready/)).toBeInTheDocument()
  })

  it('keeps only one engine or capacity detail open', async () => {
    stubFetch(routes)
    renderPage(<EnginesPage />)

    await openEngine('stockfish')
    expect(await screen.findByLabelText('Path')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Expand this server' }))
    expect(await screen.findByText(/queued and .* running here/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Path')).not.toBeInTheDocument()
  })
})

describe('EnginesPage — more settings', () => {
  it('reveals options and test run for that engine', async () => {
    stubFetch({
      '/api/engines': [STOCKFISH],
      '/api/engines/roles': ROLES,
      '/api/engines/probe': PROBE,
      '/api/runners/status': runnersStatus(),
    })
    renderPage(<EnginesPage />)

    await openMoreSettings('stockfish')

    expect(await screen.findByLabelText('Threads')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Test run' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /More settings/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('closes advanced settings without closing the engine', async () => {
    stubFetch({
      '/api/engines': [STOCKFISH],
      '/api/engines/roles': ROLES,
      '/api/engines/probe': PROBE,
      '/api/runners/status': runnersStatus(),
    })
    renderPage(<EnginesPage />)

    await openMoreSettings('stockfish')
    await screen.findByLabelText('Threads')
    await userEvent.click(screen.getByRole('button', { name: /More settings/ }))

    expect(screen.queryByLabelText('Threads')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Path')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /More settings/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })
})
