import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthGate } from '@/app/AuthGate'
import { Providers } from '@/app/Providers'

import { AccountMenu } from './AccountMenu'

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

let routes: Record<string, () => Response>

/** The chip lives in the titlebar, which only exists once there is a session — so it is
 * mounted behind the same gate here, and signing out has somewhere real to land. */
function draw() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <Providers client={client}>
      <AuthGate>
        <MemoryRouter>
          <AccountMenu />
        </MemoryRouter>
      </AuthGate>
    </Providers>,
  )
  return client
}

beforeEach(() => {
  routes = {
    'GET /api/auth/status': () => json(200, { setup_required: false, authenticated: true }),
    'GET /api/stats/profile': () =>
      json(200, {
        accounts: [
          { id: 1, platform: 'lichess', username: 'kn1ghtmare', is_owner: true, games: 1042 },
        ],
      }),
  }
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${String(input).split('?')[0]}`
      return routes[key]?.() ?? json(404, { error: 'not_found', detail: key })
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

async function openMenu() {
  await userEvent.click(await screen.findByRole('button', { name: /account/i }))
}

describe('AccountMenu', () => {
  it('carries the connected account and the two things an owner does to a session', async () => {
    draw()
    // The trigger is a person icon, never initials — the name it answers to is the owner's.
    const trigger = await screen.findByRole('button', { name: /kn1ghtmare · lichess/i })
    expect(trigger.textContent).toBe('')
    expect(trigger.querySelector('svg')).not.toBeNull()
    await openMenu()

    expect(screen.getByRole('menu')).toHaveTextContent('kn1ghtmare')
    expect(screen.queryByRole('menuitem', { name: /^settings$/i })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /connected accounts/i })).toHaveAttribute(
      'href',
      '/import',
    )
    expect(screen.getByRole('menuitem', { name: /^assistant$/i })).toHaveAttribute(
      'href',
      '/assistant',
    )
    expect(screen.getByRole('menuitem', { name: /how analysis works/i })).toHaveAttribute(
      'href',
      '/help',
    )
    expect(screen.getByRole('menuitem', { name: /change password/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeInTheDocument()
  })

  it('shows no server credentials or MCP setup in the desktop runtime', async () => {
    routes['GET /api/auth/status'] = () =>
      json(200, {
        setup_required: false,
        authenticated: true,
        capabilities: { password_auth: false, mcp: false, remote_runners: false },
      })
    draw()
    await openMenu()

    expect(screen.queryByRole('menuitem', { name: /^assistant$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /change password/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /sign out/i })).not.toBeInTheDocument()
  })

  it('heads the menu with every connected account, the owner marked', async () => {
    routes['GET /api/stats/profile'] = () =>
      json(200, {
        accounts: [
          { id: 1, platform: 'lichess', username: 'kn1ghtmare', is_owner: true, games: 1042 },
          {
            id: 2,
            platform: 'chesscom',
            username: 'sofia_g',
            display_name: 'Sofia Grover',
            games: 217,
          },
        ],
      })
    draw()
    await screen.findByRole('button', { name: /kn1ghtmare · lichess/i })
    await openMenu()
    const menu = screen.getByRole('menu')

    expect(menu).toHaveTextContent('kn1ghtmare')
    expect(menu).toHaveTextContent('lichess · owner')
    expect(menu).toHaveTextContent('1,042')
    // The second account is not the owner's, so it is listed without the mark.
    expect(menu).toHaveTextContent('Sofia Grover')
    expect(menu).toHaveTextContent('217')
    expect(screen.getByText('chesscom')).toBeInTheDocument()
  })

  it('says so when nothing is connected yet', async () => {
    routes['GET /api/stats/profile'] = () => json(200, { accounts: [] })
    draw()
    await openMenu()

    expect(await screen.findByText('No account connected')).toBeInTheDocument()
    expect(screen.getByRole('menu')).toHaveTextContent('signed in as the owner')
  })

  it('signs out to the login screen and forgets what the session cached', async () => {
    routes['POST /api/auth/logout'] = () => new Response(null, { status: 204 })
    const client = draw()
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: /sign out/i }))

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(client.getQueryData(['stats', 'profile'])).toBeUndefined()
  })

  it('keeps this browser signed in after the password is changed', async () => {
    routes['POST /api/auth/password'] = () =>
      json(200, { setup_required: false, authenticated: true })
    draw()
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: /change password/i }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/every other browser is signed out/i)
    await userEvent.type(screen.getByLabelText('Current password'), 'the old one')
    await userEvent.type(screen.getByLabelText('New password'), 'the newer one')
    await userEvent.type(screen.getByLabelText('Repeat the new one'), 'the newer one')
    await userEvent.click(screen.getByRole('button', { name: /change it/i }))

    expect(await screen.findByText(/still signed in here/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument()
  })

  it('does not send a change the two new fields disagree about', async () => {
    draw()
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: /change password/i }))
    await userEvent.type(await screen.findByLabelText('Current password'), 'the old one')
    await userEvent.type(screen.getByLabelText('New password'), 'the newer one')
    await userEvent.type(screen.getByLabelText('Repeat the new one'), 'the newer oue')
    await userEvent.click(screen.getByRole('button', { name: /change it/i }))

    expect(screen.getByRole('alert')).toHaveTextContent('those two do not match')
    expect(vi.mocked(fetch).mock.calls.some((call) => String(call[0]).includes('/auth/password'))).toBe(
      false,
    )
  })
})
