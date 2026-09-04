import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SERVER_CAPABILITIES } from '@/lib/api/types'
import { RuntimeCapabilitiesProvider } from '@/lib/runtime/RuntimeCapabilitiesProvider'

import { ANCHOR_WAIT_MS, TourProvider, useTour } from './TourProvider'

/**
 * Stand-ins for the screens the tour walks, carrying the same `data-tour` names the real
 * ones do. The point is the runner — where it navigates, what it does when the thing it
 * wanted is not there — so the pages themselves are one div each.
 */
function Screen({ anchors }: { anchors: string[] }) {
  return (
    <>
      {anchors.map((anchor) => (
        <div key={anchor} data-tour={anchor} />
      ))}
    </>
  )
}

function Probe() {
  const { step, position, total, anchor, next, back, dismiss } = useTour()
  const { pathname } = useLocation()
  return (
    <div>
      <span data-testid="step">{step?.id ?? 'none'}</span>
      <span data-testid="counter">{`${position} of ${total}`}</span>
      <span data-testid="anchor">{anchor ? 'found' : 'none'}</span>
      <span data-testid="path">{pathname}</span>
      <button onClick={next}>next</button>
      <button onClick={back}>back</button>
      <button onClick={dismiss}>skip</button>
    </div>
  )
}

function json(status: number, body: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** jsdom in this setup exposes no `localStorage`, and the demo's flag lives in one. */
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

let routes: Record<string, () => Response>
let calls: { key: string; body: string | undefined }[]

interface Options {
  demo?: boolean
  /** Off is a deployment with no assistant page for the last step to visit. */
  mcp?: boolean
  /** What `/notes` renders — empty is a step with nothing to point at. */
  notes?: string[]
}

function draw({ demo = false, mcp = true, notes = ['notes'] }: Options = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RuntimeCapabilitiesProvider capabilities={{ ...SERVER_CAPABILITIES, read_only: demo, mcp }}>
        <MemoryRouter>
          <TourProvider>
            <Probe />
            <div data-tour="account-menu" />
            <Routes>
              <Route path="/library/import" element={<Screen anchors={['sources']} />} />
              <Route path="/engines" element={<Screen anchors={['engines']} />} />
              <Route path="/notes" element={<Screen anchors={notes} />} />
              <Route path="/assistant" element={<Screen anchors={['assistant']} />} />
              <Route path="/games/:id" element={<Screen anchors={['board-settings']} />} />
            </Routes>
          </TourProvider>
        </MemoryRouter>
      </RuntimeCapabilitiesProvider>
    </QueryClientProvider>,
  )
}

const press = (name: string) => userEvent.click(screen.getByRole('button', { name }))
const step = () => screen.getByTestId('step').textContent

beforeEach(() => {
  calls = []
  routes = {
    'GET /api/settings/tour': () => json(200, { seen: false }),
    'PUT /api/settings/tour': () => json(200, { seen: true }),
    'GET /api/games': () => json(200, { games: [{ id: 42 }], total: 1 }),
  }
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${String(input).split('?')[0]}`
      calls.push({ key, body: init?.body as string | undefined })
      return routes[key]?.() ?? json(404, { error: 'not_found', detail: key })
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

describe('the tour', () => {
  it('starts itself on an installation that has not seen it', async () => {
    draw()

    // The step is chosen a render before its element has been looked for, so the anchor is
    // what says the first coachmark is actually up.
    await waitFor(() => expect(screen.getByTestId('anchor')).toHaveTextContent('found'))
    expect(step()).toBe('library')
    expect(screen.getByTestId('path')).toHaveTextContent('/library/import')
    expect(screen.getByTestId('counter')).toHaveTextContent('1 of 5')
  })

  it('stays out of the way once the deployment says it has been seen', async () => {
    routes['GET /api/settings/tour'] = () => json(200, { seen: true })
    draw()

    // Nothing to wait for, so wait for the flag to have landed and then check.
    await waitFor(() => expect(calls.some((call) => call.key.endsWith('/settings/tour'))).toBe(true))
    expect(step()).toBe('none')
  })

  it('walks to the screen a step is about', async () => {
    draw()
    await waitFor(() => expect(step()).toBe('library'))

    await press('next')
    await waitFor(() => expect(step()).toBe('engines'))
    await press('next')

    await waitFor(() => expect(step()).toBe('board-settings'))
    await waitFor(() => expect(screen.getByTestId('anchor')).toHaveTextContent('found'))
    expect(screen.getByTestId('path')).toHaveTextContent('/games/42')
  })

  it('skips the step an empty library has nothing to show for', async () => {
    routes['GET /api/games'] = () => json(200, { games: [], total: 0 })
    draw()
    await waitFor(() => expect(step()).toBe('library'))

    await press('next')
    await waitFor(() => expect(step()).toBe('engines'))
    await press('next')

    // Straight past the board settings: there is no game to open the board on.
    await waitFor(() => expect(step()).toBe('notes'))
    expect(screen.getByTestId('path')).toHaveTextContent('/notes')
  })

  it('drops a step whose element never appears', async () => {
    draw({ notes: [] })
    await waitFor(() => expect(step()).toBe('library'))
    await press('next')
    await waitFor(() => expect(step()).toBe('engines'))
    await press('next')
    await waitFor(() => expect(step()).toBe('board-settings'))

    await press('next')

    // The notes screen is on and has nothing the tour recognises — a rebuild that moved the
    // name, say. The step is given up on rather than left pointing at nothing, and the tour
    // carries on to the last one.
    await waitFor(() => expect(step()).toBe('assistant'), { timeout: ANCHOR_WAIT_MS + 2000 })
  })

  it('leaves the assistant out of a deployment that does not serve it', async () => {
    draw({ mcp: false })
    await waitFor(() => expect(step()).toBe('library'))
    for (const expected of ['engines', 'board-settings', 'notes']) {
      await press('next')
      await waitFor(() => expect(step()).toBe(expected))
    }

    await press('next')

    // Nowhere to go, so the tour ends on the notes step rather than on a redirect.
    await waitFor(() => expect(step()).toBe('none'))
  })

  it('goes back the way it came', async () => {
    draw()
    await waitFor(() => expect(step()).toBe('library'))
    await press('next')
    await waitFor(() => expect(step()).toBe('engines'))

    await press('back')

    await waitFor(() => expect(step()).toBe('library'))
    expect(screen.getByTestId('counter')).toHaveTextContent('1 of 5')
  })

  it('records the tour as seen when it is skipped', async () => {
    draw()
    await waitFor(() => expect(step()).toBe('library'))

    await press('skip')

    expect(step()).toBe('none')
    await waitFor(() =>
      expect(calls).toContainEqual({
        key: 'PUT /api/settings/tour',
        body: JSON.stringify({ seen: true }),
      }),
    )
  })

  it('ends after the last step, and counts that as seen', async () => {
    draw()
    await waitFor(() => expect(step()).toBe('library'))
    for (const expected of ['engines', 'board-settings', 'notes', 'assistant']) {
      await press('next')
      await waitFor(() => expect(step()).toBe(expected))
    }

    await press('next')

    await waitFor(() => expect(step()).toBe('none'))
    expect(calls.some((call) => call.key === 'PUT /api/settings/tour')).toBe(true)
  })

  it('keeps the demo out of the deployment, and remembers in the browser instead', async () => {
    draw({ demo: true })
    await waitFor(() => expect(step()).toBe('library'))

    await press('skip')

    expect(window.localStorage.getItem('blunderbase.tourSeen')).toBe('true')
    // The demo refuses every write, so it must not have tried one — and it has no owner
    // whose flag it could have read either.
    expect(calls.some((call) => call.key.endsWith('/settings/tour'))).toBe(false)
  })
})
