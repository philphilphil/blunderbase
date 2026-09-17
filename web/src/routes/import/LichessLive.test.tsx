import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import type { LichessConnection } from '@/lib/api/types'

import { LichessLive } from './LichessLive'

const bridge = vi.hoisted(() => ({ desktop: false, opened: [] as string[] }))

vi.mock('@/lib/desktop/nativeBridge', () => ({
  hasNativeBridge: () => bridge.desktop,
  openNatively: async (url: string) => {
    bridge.opened.push(url)
  },
}))

const APPROVAL = 'https://lichess.org/oauth?state=s'

function stub(connection: Partial<LichessConnection>, disabled: string[] = []) {
  const calls: { path: string; method: string; body: unknown }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).split('?')[0]
      const method = init?.method ?? 'GET'
      calls.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : null })
      const reply = (body: unknown, status = 200) =>
        new Response(status === 204 ? null : JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        })
      if (path === '/api/lichess/connection' && method === 'DELETE') return reply(null, 204)
      if (path === '/api/lichess/connection') {
        return reply({ connected: false, username: null, synced: false, stream: 'off', ...connection })
      }
      if (path === '/api/lichess/connect') return reply({ url: APPROVAL })
      if (path === '/api/import/schedule') return reply({ minutes: null, disabled_sources: disabled })
      return reply({ error: 'not_found', detail: path }, 404)
    }),
  )
  return calls
}

function draw() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <Providers client={client}>
      <LichessLive />
    </Providers>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  bridge.desktop = false
  bridge.opened = []
})

describe('the Lichess connection line', () => {
  it('offers to connect, and on the desktop app signs in through the browser', async () => {
    bridge.desktop = true
    const calls = stub({})
    draw()

    await userEvent.click(await screen.findByRole('button', { name: 'Connect Lichess' }))

    expect(await screen.findByText(/Finish signing in in your browser/)).toBeInTheDocument()
    expect(bridge.opened).toEqual([APPROVAL])
    const started = calls.find((call) => call.path === '/api/lichess/connect')
    // The callback is named from where the page is loaded, not guessed by the server.
    expect(started?.body).toMatchObject({
      desktop: true,
      redirect_uri: `${window.location.origin}/api/lichess/callback`,
    })
  })

  it('says new games arrive live once connected and following', async () => {
    stub({ connected: true, username: 'phib', synced: true, stream: 'live' })
    draw()

    expect(await screen.findByText('phib')).toBeInTheDocument()
    expect(screen.getByText('Live: new games arrive as soon as they end.')).toBeInTheDocument()
  })

  it('says why live import is off for an account the library has not synced', async () => {
    stub({ connected: true, username: 'phib', synced: false, stream: 'off' })
    draw()

    expect(await screen.findByText('Sync phib once to import new games live.')).toBeInTheDocument()
  })

  it('offers a reconnect for a token pasted before the button existed', async () => {
    stub({ connected: true, username: null })
    draw()

    expect(await screen.findByRole('button', { name: 'Reconnect Lichess' })).toBeInTheDocument()
  })

  it('disconnects', async () => {
    const calls = stub({ connected: true, username: 'phib', synced: true, stream: 'live' })
    draw()

    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))

    await waitFor(() =>
      expect(
        calls.some((call) => call.path === '/api/lichess/connection' && call.method === 'DELETE'),
      ).toBe(true),
    )
  })
})
