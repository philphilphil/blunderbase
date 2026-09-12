import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import { RuntimeCapabilitiesProvider } from '@/lib/runtime/RuntimeCapabilitiesProvider'

import { MachinesPage } from './MachinesPage'
import {
  FakeSocket,
  PROBE,
  ROLES,
  SETTINGS,
  STOCKFISH,
  memoryStorage,
  remoteEngine,
  requestedPaths,
  resetRelease,
  runner,
  runnersStatus,
  stubFetch,
} from './engines.fixtures'

function renderPage(ui: ReactNode = <MachinesPage />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <Providers client={client}>
      <MemoryRouter initialEntries={['/compute/machines']}>{ui}</MemoryRouter>
    </Providers>,
  )
}

/** The four reads the page makes, with one local Stockfish on four threads. */
const ROUTES = {
  '/api/engines': [{ ...STOCKFISH, options: { Threads: 4, Hash: 8192 } }],
  '/api/engines/roles': ROLES,
  '/api/engines/probe': PROBE,
  '/api/settings': SETTINGS,
  '/api/runners/status': runnersStatus(),
}

beforeEach(() => {
  resetRelease()
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('WebSocket', FakeSocket as unknown as typeof WebSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MachinesPage — this server', () => {
  it('shows the server and the browser when no remote runner is registered', async () => {
    stubFetch(ROUTES)
    renderPage()
    expect(await screen.findByText(/No remote runners are registered/)).toBeInTheDocument()
    expect(screen.getAllByText('This server').length).toBeGreaterThan(0)
    expect(screen.getAllByText('This browser').length).toBeGreaterThan(0)
    expect(screen.queryByText('queue only')).not.toBeInTheDocument()
  })

  it('adds the two caps up against the cores, at the engines’ own thread cost', async () => {
    stubFetch(ROUTES)
    renderPage()
    const budget = await screen.findByTestId('core-budget')
    // Six queue processes of the four-thread Stockfish, two search slots of the same: 32
    // threads on 8 cores, which the card says is more than the machine has. The searches
    // join once the settings have said the mode is on.
    await waitFor(() => expect(budget).toHaveTextContent('searches 2 × 4'))
    expect(budget).toHaveTextContent('queue 6 × 4 threads + searches 2 × 4 = 32 threads · 8 cores')
    expect(budget).toHaveTextContent(/more threads than cores/)
  })

  it('follows the boxes as they are typed, before anything is saved', async () => {
    stubFetch(ROUTES)
    renderPage()
    const budget = await screen.findByTestId('core-budget')
    await waitFor(() => expect(budget).toHaveTextContent('searches'))
    await userEvent.type(screen.getByLabelText('Queue processes'), '1')
    await userEvent.type(screen.getByLabelText('Search slots'), '1')
    expect(budget).toHaveTextContent('queue 1 × 4 threads + searches 1 × 4 = 8 threads')
    expect(budget).toHaveTextContent(/everything fits/)
  })

  it('saves both caps as part of the whole record', async () => {
    const fetchMock = stubFetch({
      ...ROUTES,
      'PUT /api/settings': { ...SETTINGS, analysis_concurrency: 2, correspondence_slots: 1 },
    })
    renderPage()
    await userEvent.type(await screen.findByLabelText('Queue processes'), '2')
    await userEvent.type(screen.getByLabelText('Search slots'), '1')
    await userEvent.click(screen.getByRole('button', { name: /Save/ }))

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true),
    )
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!
    // A PUT is a replace: every other key rides along untouched.
    expect(JSON.parse(String(put[1]?.body))).toMatchObject({
      analysis_concurrency: 2,
      correspondence_slots: 1,
      correspondence_enabled: 1,
      maia_elos: [2000],
    })
  })

  it('says a saved cap is not the one in force until the server restarts', async () => {
    stubFetch({
      ...ROUTES,
      '/api/settings': { ...SETTINGS, analysis_concurrency: 3 },
      '/api/runners/status': runnersStatus([], {
        slots: 6,
        slots_source: 'setting',
        slots_configured: 3,
      }),
    })
    renderPage()
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Saved 3; the queue is running on 6 until the server restarts.',
    )
  })

  it('shows the queue cap read-only when the environment pins it', async () => {
    stubFetch({
      ...ROUTES,
      '/api/runners/status': runnersStatus([], { slots_source: 'env', slots_configured: 6 }),
    })
    renderPage()
    const queue = await screen.findByLabelText<HTMLInputElement>('Queue processes')
    expect(queue).toHaveAttribute('readonly')
    expect(queue).toHaveValue('6')
    expect(screen.getByText('Set by BLUNDERBASE_ANALYSIS_CONCURRENCY')).toBeInTheDocument()
    // The other cap is still the owner's to set.
    expect(await screen.findByLabelText('Search slots')).not.toHaveAttribute('readonly')
  })

  it('hides the search slots and counts no searches while correspondence mode is off', async () => {
    stubFetch({ ...ROUTES, '/api/settings': { ...SETTINGS, correspondence_enabled: 0 } })
    renderPage()
    const budget = await screen.findByTestId('core-budget')
    // Wait for the settings to have answered, or "no searches" would be trivially true.
    await waitFor(() => expect(screen.getByText(/run the analysis passes/)).toBeInTheDocument())
    expect(budget).toHaveTextContent('queue 6 × 4 threads = 24 threads · 8 cores')
    expect(budget).not.toHaveTextContent('searches')
    // The slots exist only for correspondence searches, so the box goes with the mode.
    expect(screen.queryByLabelText('Search slots')).not.toBeInTheDocument()
  })

  it('calls this machine a computer, alone, when remote runners are unavailable', async () => {
    stubFetch(ROUTES)
    renderPage(
      <RuntimeCapabilitiesProvider
        capabilities={{ password_auth: false, mcp: false, remote_runners: false, read_only: false }}
      >
        <MachinesPage />
      </RuntimeCapabilitiesProvider>,
    )
    expect(
      await screen.findByText('How much this computer runs at once, and what is running now.'),
    ).toBeInTheDocument()
    expect((await screen.findAllByText('This computer')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /remote runner/i })).not.toBeInTheDocument()
    expect(screen.queryByText('This browser')).not.toBeInTheDocument()
  })
})

describe('MachinesPage — runners', () => {
  it('names the machine an engine is advertised by, and what its slots are doing', async () => {
    stubFetch({
      ...ROUTES,
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
    renderPage()
    expect((await screen.findAllByText('gpu-box')).length).toBeGreaterThan(0)
    // The status caption and the slot count are on the row itself, unopened.
    expect(screen.getByText('connected · websocket')).toBeInTheDocument()
    expect(screen.getByText('2/4')).toBeInTheDocument()
    // Its advertised engines are the detail — opening the row is what reveals them.
    await userEvent.click(screen.getByRole('button', { name: /expand gpu-box/i }))
    expect(screen.getByText('sf-remote')).toBeInTheDocument()
    expect(screen.getByText('maia-remote')).toBeInTheDocument()
    // A Maia never drives a board, whatever its host's transport is.
    expect(screen.getAllByText('queue only')).toHaveLength(1)
  })

  it('marks a polling runner queue only', async () => {
    stubFetch({
      ...ROUTES,
      '/api/runners/status': runnersStatus([
        runner({
          id: 3,
          name: 'gpu-box',
          transport: 'poll',
          engines: [remoteEngine({ id: 7, name: 'sf-remote' })],
        }),
      ]),
    })
    renderPage()
    expect(await screen.findByText('connected · polling — queue only')).toBeInTheDocument()
    // The advertised-engine detail repeats the transport limitation in its own context.
    await userEvent.click(screen.getByRole('button', { name: /expand gpu-box/i }))
    expect(screen.getAllByText(/queue only/i).length).toBeGreaterThanOrEqual(2)
  })

  it('does not claim a runner that is away is taking queue work', async () => {
    stubFetch({
      ...ROUTES,
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
    renderPage()
    expect(await screen.findByText('not connected')).toBeInTheDocument()
    // A machine that is away drains nothing; the grey dot beside its name is the whole
    // story, and "queue only" would be a claim about a link that is not there.
    expect(screen.queryByText('queue only')).not.toBeInTheDocument()
  })

  it('says why a revoke was refused instead of leaving the click unanswered', async () => {
    stubFetch({
      ...ROUTES,
      '/api/runners/status': runnersStatus([runner({ id: 3, name: 'gpu-box' })]),
      '/api/runners/3': {
        status: 409,
        body: { error: 'runner_busy', detail: 'gpu-box is running two analysis boards' },
      },
    })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /expand gpu-box/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    // The confirmation row is where the second click lands, so it is where the refusal has
    // to be readable — the row otherwise looks exactly as it did before the click.
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    expect(await screen.findByText('gpu-box is running two analysis boards')).toBeInTheDocument()
  })

  it('sends only what a rename actually changed', async () => {
    const fetchMock = stubFetch({
      ...ROUTES,
      '/api/runners/status': runnersStatus([runner({ id: 3, name: 'gpu-box' })]),
      '/api/runners/3': runner({ id: 3, name: 'gpu-two' }),
    })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /expand gpu-box/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Edit gpu-box' }))
    const field = screen.getByLabelText<HTMLInputElement>('Name of gpu-box')
    await userEvent.clear(field)
    await userEvent.type(field, 'gpu-two')
    await userEvent.click(within(field.closest('div')!).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(requestedPaths(fetchMock)).toContain('/api/runners/3'))
    const patch = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/api/runners/3'))!
    expect(patch[1]?.method).toBe('PATCH')
    // The slot count was left alone, so it is not in the body at all.
    expect(JSON.parse(String(patch[1]?.body))).toEqual({ name: 'gpu-two' })
  })

  it('shows the token and the yaml once, then lets them go', async () => {
    stubFetch({
      ...ROUTES,
      '/api/runners': {
        status: 201,
        body: {
          runner: runner({ id: 3, name: 'gpu-box', connected: false, transport: null }),
          token: 'bb_rnr_kY3secret',
          config_yaml: 'server: "https://blunderbase.example.com"\ntoken: "bb_rnr_kY3secret"\n',
        },
      },
    })
    renderPage()
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

  it('explains remote runners before registration', async () => {
    stubFetch(ROUTES)
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'How remote runners work' }))
    expect(screen.getByText(/connects outward to this Blunderbase deployment/)).toBeInTheDocument()
    expect(screen.getByText(/token shown once and a paste-ready/)).toBeInTheDocument()
  })
})
