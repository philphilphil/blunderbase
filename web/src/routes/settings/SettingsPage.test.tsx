import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import { useMaiaTargetElo } from '@/lib/api/queries'

import { SettingsPage } from './SettingsPage'

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

function json(status: number, body: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** The deployment's stored settings, as the backend would keep them across the calls. */
let target: number | null

function stubFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).split('?')[0]!
    const method = init?.method ?? 'GET'
    if (path.endsWith('/api/settings')) {
      if (method === 'PUT') {
        const sent = JSON.parse(String(init?.body)) as { maia_target_elo: number | null }
        target =
          sent.maia_target_elo === null
            ? null
            : Math.min(2000, Math.max(1100, sent.maia_target_elo))
      }
      return json(200, { maia_target_elo: target })
    }
    if (path.endsWith('/api/auth/status')) {
      return json(200, { setup_required: false, authenticated: true, maia_target_elo: target })
    }
    return json(404, { error: 'not_found', detail: path })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** The target elo as every other screen reads it — off the bootstrap payload. */
function Elsewhere() {
  const elo = useMaiaTargetElo()
  return <div data-testid="elsewhere">{elo === null ? 'none' : String(elo)}</div>
}

function draw({ withReader = false }: { withReader?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <Providers client={client}>
      <MemoryRouter>
        <SettingsPage />
        {withReader ? <Elsewhere /> : null}
      </MemoryRouter>
    </Providers>,
  )
  return client
}

function field() {
  return screen.getByLabelText('Target elo')
}

/** The field once the read has answered — everything before that is a skeleton. */
function loadedField() {
  return screen.findByLabelText('Target elo')
}

beforeEach(() => {
  target = null
  vi.stubGlobal('WebSocket', FakeSocket)
  stubFetch()
})

afterEach(() => vi.unstubAllGlobals())

describe('SettingsPage', () => {
  it('renders the stored level', async () => {
    target = 1700

    draw()

    await waitFor(() => expect(field()).toHaveValue(1700))
    expect(screen.getByText(/in force at 1700/i)).toBeInTheDocument()
  })

  it('says what an unset deployment does instead', async () => {
    draw()

    await waitFor(() => expect(field()).toHaveValue(null))
    expect(screen.getByText(/not set/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument()
  })

  it('saves a new level', async () => {
    draw()

    await userEvent.type(await loadedField(), '1700')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(screen.getByText(/in force at 1700/i)).toBeInTheDocument())
    expect(target).toBe(1700)
  })

  // The backend clamps rather than refusing, so the page must show what is in force
  // rather than go on displaying the number that was typed.
  it('shows the clamped level rather than what was typed', async () => {
    draw()

    await userEvent.type(await loadedField(), '2400')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(field()).toHaveValue(2000))
    expect(target).toBe(2000)
  })

  it('clears back to the default behaviour', async () => {
    target = 1700
    draw()
    await waitFor(() => expect(field()).toHaveValue(1700))

    await userEvent.click(screen.getByRole('button', { name: /clear/i }))

    await waitFor(() => expect(field()).toHaveValue(null))
    expect(target).toBeNull()
    expect(screen.getByText(/not set/i)).toBeInTheDocument()
  })

  it('does not offer to save what has not changed', async () => {
    target = 1700
    const fetchMock = vi.mocked(fetch)
    draw()
    await waitFor(() => expect(field()).toHaveValue(1700))

    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
  })

  it('moves the level every other screen reads, without a reload', async () => {
    target = 1700
    draw({ withReader: true })
    await waitFor(() => expect(screen.getByTestId('elsewhere')).toHaveTextContent('1700'))

    await userEvent.clear(await loadedField())
    await userEvent.type(field(), '1500')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(screen.getByTestId('elsewhere')).toHaveTextContent('1500'))
  })
})
