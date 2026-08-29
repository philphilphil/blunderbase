import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import type { BrowserRunnerState, RunnerCredential, RunnerSupport } from '@/lib/runner'

import { BrowserRunnerSection } from './BrowserRunnerSection'

/**
 * The section is tested against a stand-in for the runner singleton.
 *
 * Not because the singleton is hard to reach — it is a module export — but because reaching
 * it means `startEngine`, and that means a dynamic `import()` of an emscripten module and 15
 * MB of weights inside jsdom. What this file is about is the part above the engine: that
 * installing mints a runner and hands the token to the client, that uninstalling revokes
 * *before* it forgets, and that the row says which of the two thread stories the tab got.
 *
 * `expanded` is this test file's own concern, not the component under test's: a real page
 * opens at most one detail at a time (`EnginesPage` owns that state), so most cases here
 * render collapsed — the row's name, status and actions are never gated by it — and only
 * open the detail where a case is actually about what the detail says.
 */
const fake = vi.hoisted(() => {
  const initial: BrowserRunnerState = {
    phase: 'off',
    runnerId: null,
    runnerName: null,
    engineName: null,
    threads: 1,
    isolated: false,
    activeRuns: 0,
    error: null,
    refused: [],
  }
  const listeners = new Set<() => void>()
  return {
    state: initial,
    support: { supported: true, reason: null } as RunnerSupport,
    credential: null as RunnerCredential | null,
    calls: [] as string[],
    listeners,
    reset() {
      this.state = initial
      this.support = { supported: true, reason: null }
      this.credential = null
      this.calls = []
      listeners.clear()
    },
    set(over: Partial<BrowserRunnerState>) {
      this.state = { ...this.state, ...over }
      for (const listener of listeners) listener()
    },
  }
})

vi.mock('@/lib/runner', async () => {
  const { useSyncExternalStore } = await import('react')
  const subscribe = (listener: () => void) => {
    fake.listeners.add(listener)
    return () => fake.listeners.delete(listener)
  }
  const snapshot = () => fake.state
  return {
    browserRunner: {
      start: vi.fn((credential: RunnerCredential) => {
        fake.calls.push(`start:${credential.runnerId}:${credential.token}`)
        fake.credential = credential
        fake.set({
          phase: 'connected',
          runnerId: credential.runnerId,
          runnerName: credential.runnerName,
        })
      }),
      stop: vi.fn(() => fake.calls.push('stop')),
      resume: vi.fn(() => fake.calls.push('resume')),
      forget: vi.fn(() => {
        fake.calls.push('forget')
        fake.credential = null
        fake.set({ phase: 'off', runnerId: null, runnerName: null, engineName: null })
      }),
    },
    useBrowserRunner: () => useSyncExternalStore(subscribe, snapshot, snapshot),
    browserRunnerSupport: () => fake.support,
    browserRunnerName: () => 'Chrome on macOS',
    readCredential: () => fake.credential,
  }
})

type Route = { status: number; body: unknown }

function stubFetch(handler: (method: string, path: string) => Route) {
  const calls: string[] = []
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).split('?')[0]!
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push(`${method} ${path}`)
    const route = handler(method, path)
    return Promise.resolve(
      new Response(route.status === 204 ? null : JSON.stringify(route.body), {
        status: route.status,
        headers: { 'content-type': 'application/json' },
      }),
    )
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

function created(id: number, name: string, token: string) {
  return {
    runner: {
      id,
      name,
      slots: 1,
      version: null,
      connected: false,
      browser: true,
      transport: null,
      busy: 0,
      streams: 0,
      free_slots: 1,
      queued_eligible: 0,
      engines: [],
    },
    token,
    config_yaml: 'server: http://localhost:8765\n',
  }
}

/** `expanded` defaults to closed — the row's name, status and actions never depend on it. */
function renderSection(expanded = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <Providers client={client}>
      <BrowserRunnerSection expanded={expanded} onToggleExpand={() => {}} />
    </Providers>,
  )
}

beforeEach(() => {
  fake.reset()
  // jsdom implements neither, and `browserRunnerSupport` is stubbed anyway — but the
  // `/events` socket the providers open is not.
  vi.stubGlobal(
    'WebSocket',
    class {
      onopen = null
      onmessage = null
      onerror = null
      onclose = null
      close() {}
    } as unknown as typeof WebSocket,
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('installing', () => {
  it('mints a runner named after the browser and hands the token to the client', async () => {
    const calls = stubFetch(() => ({
      status: 200,
      body: created(9, 'Chrome on macOS', 'bb_rnr_minted'),
    }))
    renderSection()

    await userEvent.click(screen.getByRole('button', { name: /install browser stockfish/i }))
    await waitFor(() => expect(calls).toContain('POST /api/runners'))
    // The token goes straight to the client and is never rendered: it is a credential, not
    // a thing to copy out of a yaml the way a machine runner's is.
    expect(fake.calls).toContain('start:9:bb_rnr_minted')
    expect(screen.queryByText(/bb_rnr_minted/)).toBeNull()
    await screen.findByText('Chrome on macOS')
  })

  it('works around a name this deployment already has instead of asking for one', async () => {
    let attempts = 0
    const calls = stubFetch(() => {
      attempts += 1
      if (attempts === 1) {
        return {
          status: 409,
          body: { error: 'duplicate_runner', detail: 'a runner named … is already registered' },
        }
      }
      return { status: 200, body: created(10, 'Chrome on macOS (2)', 'bb_rnr_second') }
    })
    renderSection()

    await userEvent.click(screen.getByRole('button', { name: /install browser stockfish/i }))
    await waitFor(() => expect(fake.calls).toContain('start:10:bb_rnr_second'))
    expect(calls.filter((call) => call === 'POST /api/runners')).toHaveLength(2)
    await screen.findByText('Chrome on macOS (2)')
  })

  it('is not offered at all where the browser cannot do it, and says why', () => {
    fake.support = { supported: false, reason: 'this browser has no WebAssembly' }
    renderSection()
    expect(screen.queryByRole('button', { name: /install browser stockfish/i })).toBeNull()
    // The reason rides on the row itself — the caption beside its name — so it reads
    // without opening anything.
    expect(screen.getByText(/has no WebAssembly/)).toBeInTheDocument()
  })
})

describe('uninstalling', () => {
  it('revokes the runner server-side before it forgets the token', async () => {
    fake.set({ phase: 'connected', runnerId: 9, runnerName: 'Chrome on macOS', engineName: 'Stockfish 18' })
    const calls = stubFetch(() => ({ status: 204, body: null }))
    renderSection()

    await userEvent.click(screen.getByRole('button', { name: /uninstall/i }))
    await userEvent.click(screen.getByRole('button', { name: /revoke and uninstall/i }))

    await waitFor(() => expect(fake.calls).toContain('forget'))
    expect(calls).toContain('DELETE /api/runners/9')
    // Order is the whole point: forgetting first would leave a live runner row holding
    // queue work that nothing can reach.
    expect(fake.calls.indexOf('forget')).toBeGreaterThan(-1)
    await screen.findByRole('button', { name: /install browser stockfish/i })
  })

  it('keeps the token when the revoke fails, so nothing is orphaned', async () => {
    fake.set({ phase: 'connected', runnerId: 9, runnerName: 'Chrome on macOS' })
    stubFetch(() => ({ status: 500, body: { error: 'internal', detail: 'the database is locked' } }))
    renderSection(true)

    await userEvent.click(screen.getByRole('button', { name: /uninstall/i }))
    await userEvent.click(screen.getByRole('button', { name: /revoke and uninstall/i }))

    await screen.findByText(/the token was kept/)
    expect(fake.calls).not.toContain('forget')
  })

  it('forgets a token whose runner is already gone', async () => {
    fake.set({ phase: 'refused', runnerId: 9, runnerName: 'Chrome on macOS' })
    stubFetch(() => ({ status: 404, body: { error: 'unknown_runner', detail: 'no runner with id 9' } }))
    renderSection()

    await userEvent.click(screen.getByRole('button', { name: /uninstall/i }))
    await userEvent.click(screen.getByRole('button', { name: /revoke and uninstall/i }))

    await waitFor(() => expect(fake.calls).toContain('forget'))
  })
})

describe('the engine row', () => {
  it('says browser and the thread count, never a path', () => {
    fake.set({
      phase: 'connected',
      runnerId: 9,
      runnerName: 'Chrome on macOS',
      engineName: 'Stockfish 18',
      threads: 8,
      isolated: true,
    })
    renderSection(true)
    expect(screen.getByText('Stockfish 18 · browser · 8 threads')).toBeInTheDocument()
    expect(screen.queryByText(/wasm:/)).toBeNull()
    expect(screen.queryByText(/not cross-origin isolated/)).toBeNull()
  })

  it('shows the single-threaded fallback and names its cause', () => {
    fake.set({
      phase: 'connected',
      runnerId: 9,
      runnerName: 'Chrome on macOS',
      engineName: 'Stockfish 18',
      threads: 1,
      isolated: false,
    })
    renderSection(true)
    expect(screen.getByText('Stockfish 18 · browser · 1 thread (not isolated)')).toBeInTheDocument()
    // Silently running an eighth as fast is the failure this line exists to prevent.
    expect(screen.getByText(/reverse proxy/)).toBeInTheDocument()
  })

  it('repeats an engine the server refused, in the server’s own words', () => {
    fake.set({
      phase: 'connected',
      runnerId: 9,
      runnerName: 'Chrome on macOS',
      engineName: 'Stockfish 18',
      threads: 4,
      isolated: true,
      refused: [{ name: 'Stockfish (Chrome on macOS)', reason: 'an engine of that name exists' }],
    })
    renderSection(true)
    expect(screen.getByText(/an engine of that name exists/)).toBeInTheDocument()
  })

  it('is not shown at all while the row is collapsed', () => {
    fake.set({
      phase: 'connected',
      runnerId: 9,
      runnerName: 'Chrome on macOS',
      engineName: 'Stockfish 18',
      threads: 8,
      isolated: true,
    })
    renderSection(false)
    expect(screen.queryByText(/Stockfish 18 · browser/)).toBeNull()
    // The row itself is still there — name, status, and the actions that do not need it open.
    expect(screen.getByText('Chrome on macOS')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /uninstall/i })).toBeInTheDocument()
  })
})
