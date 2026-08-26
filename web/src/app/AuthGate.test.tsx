import { QueryClient, useQuery } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import { http } from '@/lib/api/client'
import type { AuthStatus } from '@/lib/api/types'

import { AuthGate } from './AuthGate'

/** A socket that never connects on its own — the gate is not what this file is testing. */
class FakeSocket {
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((event?: CloseEvent) => void) | null = null
  readonly url: string
  constructor(url: string) {
    this.url = url
  }
  close() {}
}

function json(status: number, body: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const SIGNED_IN: AuthStatus = { setup_required: false, authenticated: true }
const SIGNED_OUT: AuthStatus = { setup_required: false, authenticated: false }
const FRESH: AuthStatus = { setup_required: true, authenticated: false }

/** Every route the test wants to answer, keyed `METHOD /api/path`. */
type Routes = Record<string, () => Response>

let routes: Routes

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${String(input).split('?')[0]}`
      const route = routes[key]
      if (!route) return json(404, { error: 'not_found', detail: key })
      return route()
    }),
  )
}

/** A page inside the gate: a marker, and one guarded query to be refused mid-session. */
function TheApp() {
  const games = useQuery({ queryKey: ['games'], queryFn: () => http.get<unknown>('/games') })
  return <div>the app{games.isError ? ' (games failed)' : ''}</div>
}

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <Providers client={client}>
      <AuthGate>
        <TheApp />
      </AuthGate>
    </Providers>,
  )
  return client
}

beforeEach(() => {
  routes = { 'GET /api/games': () => json(200, { total: 0, limit: 0, offset: 0, games: [] }) }
  vi.stubGlobal('WebSocket', FakeSocket)
  stubFetch()
})

afterEach(() => vi.unstubAllGlobals())

describe('AuthGate', () => {
  it('sends a deployment nobody has configured to the setup screen', async () => {
    routes['GET /api/auth/status'] = () => json(200, FRESH)
    renderApp()

    expect(await screen.findByRole('heading', { name: /choose the owner/i })).toBeInTheDocument()
    expect(screen.queryByText('the app')).not.toBeInTheDocument()
  })

  it('sends a deployment with a password and no session to the login screen', async () => {
    routes['GET /api/auth/status'] = () => json(200, SIGNED_OUT)
    renderApp()

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('renders the app for a session that is already signed in', async () => {
    routes['GET /api/auth/status'] = () => json(200, SIGNED_IN)
    renderApp()

    expect(await screen.findByText('the app')).toBeInTheDocument()
    // Nothing of either door flashed past on the way there.
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument()
  })

  it('shows neither door while the status call is still in flight', () => {
    routes['GET /api/auth/status'] = () => json(200, SIGNED_IN)
    renderApp()

    expect(screen.getByTestId('auth-loading')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument()
    expect(screen.queryByText('the app')).not.toBeInTheDocument()
  })

  it('goes straight into the app once the password is accepted', async () => {
    routes['GET /api/auth/status'] = () => json(200, SIGNED_OUT)
    routes['POST /api/auth/login'] = () => json(200, SIGNED_IN)
    renderApp()

    const field = await screen.findByLabelText('Password')
    expect(field).toHaveFocus()
    await userEvent.type(field, 'correct horse battery{enter}')

    expect(await screen.findByText('the app')).toBeInTheDocument()
  })

  it('keeps the login screen and says so when the password is wrong', async () => {
    routes['GET /api/auth/status'] = () => json(200, SIGNED_OUT)
    routes['POST /api/auth/login'] = () =>
      json(401, { error: 'invalid_password', detail: 'that is not the password' })
    renderApp()

    await userEvent.type(await screen.findByLabelText('Password'), 'nope{enter}')

    expect(await screen.findByRole('alert')).toHaveTextContent('that is not the password')
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('repeats the lockout wait the server named, rather than inventing one', async () => {
    // The seconds are in `detail` and nowhere else — no header, no numeric field.
    routes['GET /api/auth/status'] = () => json(200, SIGNED_OUT)
    routes['POST /api/auth/login'] = () =>
      json(429, {
        error: 'locked_out',
        detail: 'too many failed attempts; try again in 40 seconds',
      })
    renderApp()

    await userEvent.type(await screen.findByLabelText('Password'), 'nope{enter}')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'too many failed attempts; try again in 40 seconds',
    )
  })

  it('signs the owner in as part of choosing the password', async () => {
    routes['GET /api/auth/status'] = () => json(200, FRESH)
    routes['POST /api/auth/setup'] = () => json(200, SIGNED_IN)
    renderApp()

    await userEvent.type(await screen.findByLabelText('Password'), 'a good long one')
    await userEvent.type(screen.getByLabelText('Repeat it'), 'a good long one')
    await userEvent.click(screen.getByRole('button', { name: /set the password/i }))

    expect(await screen.findByText('the app')).toBeInTheDocument()
  })

  it('drops to the login screen when a guarded request is refused mid-session', async () => {
    routes['GET /api/auth/status'] = () => json(200, SIGNED_IN)
    const client = renderApp()
    expect(await screen.findByText('the app')).toBeInTheDocument()
    await waitFor(() => expect(client.getQueryData(['games'])).toBeDefined())

    // The session expires: the next guarded call comes back 401 `unauthorized`.
    routes['GET /api/games'] = () =>
      json(401, { error: 'unauthorized', detail: 'sign in at POST /auth/login' })
    await client.refetchQueries({ queryKey: ['games'] })

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    // What the session cached went with it, so nothing stale is waiting behind the door.
    await waitFor(() => expect(client.getQueryData(['games'])).toBeUndefined())
    expect(client.getQueryData(['auth'])).toEqual(SIGNED_OUT)
  })

  it('drops to the setup screen when the refusal says the deployment has no password', async () => {
    routes['GET /api/auth/status'] = () => json(200, SIGNED_IN)
    const client = renderApp()
    expect(await screen.findByText('the app')).toBeInTheDocument()

    routes['GET /api/games'] = () =>
      json(401, { error: 'setup_required', detail: 'no password has been set yet' })
    await client.refetchQueries({ queryKey: ['games'] })

    expect(await screen.findByRole('heading', { name: /choose the owner/i })).toBeInTheDocument()
  })

  it('does not ask again after being refused', async () => {
    routes['GET /api/auth/status'] = () => json(200, SIGNED_IN)
    const client = renderApp()
    expect(await screen.findByText('the app')).toBeInTheDocument()

    const calls = () =>
      vi.mocked(fetch).mock.calls.filter((call) => String(call[0]).startsWith('/api/games')).length
    routes['GET /api/games'] = () => json(401, { error: 'unauthorized', detail: 'sign in' })
    await client.refetchQueries({ queryKey: ['games'] })
    const afterRefusal = calls()

    await screen.findByRole('heading', { name: 'Sign in' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(calls()).toBe(afterRefusal)
  })
})
