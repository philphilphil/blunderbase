import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import type { McpKeyResponse } from '@/lib/api/types'
import { MCP_SERVER_NAME } from '@/lib/mcp/status'

import { McpPage } from './McpPage'

type Route = unknown | { status: number; body: unknown }

/** `METHOD /path`, with the `/api` prefix the client adds taken back off. */
function routeKey(input: RequestInfo | URL, init?: RequestInit): string {
  const path = String(input).split('?')[0]!.replace(/^\/api/, '')
  return `${init?.method ?? 'GET'} ${path}`
}

/**
 * Routes are keyed by `METHOD /path` so a case can answer the list one way and the create
 * another. Returns the mock so a case can assert on what was asked for.
 */
function stubFetch(routes: Record<string, Route>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = routeKey(input, init)
    const route = routes[key]
    if (route === undefined) {
      return new Response(JSON.stringify({ error: 'not_found', detail: key }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    }
    const shaped =
      route !== null && typeof route === 'object' && 'status' in route
        ? (route as { status: number; body: unknown })
        : { status: 200, body: route }
    if (shaped.status === 204) return new Response(null, { status: 204 })
    return new Response(JSON.stringify(shaped.body), {
      status: shaped.status,
      headers: { 'content-type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function requested(fetchMock: ReturnType<typeof stubFetch>): string[] {
  return fetchMock.mock.calls.map(([input, init]) => routeKey(input, init))
}

function renderPage(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <Providers client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </Providers>,
  )
}

const LAPTOP: McpKeyResponse = {
  id: 1,
  name: 'laptop',
  created_at: '2026-08-20T10:00:00Z',
  last_used_at: '2026-08-27T10:00:00Z',
}

const FRESH: McpKeyResponse = {
  id: 2,
  name: 'claude-code',
  created_at: '2026-08-28T10:00:00Z',
  last_used_at: null,
}

const TOKEN = 'bb_mcp_0123456789abcdef0123456789abcdef'

function withClipboard() {
  const writeText = vi.fn(async (_text: string) => {})
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return writeText
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('McpPage', () => {
  it('hands an MCP client a config pointed at this origin, secret left blank', async () => {
    stubFetch({ 'GET /mcp-keys': [] })
    const writeText = withClipboard()
    renderPage(<McpPage />)

    await userEvent.click(await screen.findByRole('button', { name: /Copy config/ }))

    expect(writeText).toHaveBeenCalledTimes(1)
    const config = JSON.parse(writeText.mock.calls[0]![0])
    // The same name the titlebar shows, so the config and the chrome agree.
    const server = config.mcpServers[MCP_SERVER_NAME]
    expect(server.type).toBe('http')
    expect(server.url).toBe(`${window.location.origin}/mcp`)
    // A placeholder, never the password: this page cannot know it and must not carry it.
    expect(server.headers.Authorization).toBe('Bearer <your bearer key>')
    expect(await screen.findByRole('button', { name: /Copied/ })).toBeInTheDocument()
  })

  it('falls back to the placeholder in every connect command until a key is minted', async () => {
    stubFetch({ 'GET /mcp-keys': [] })
    const writeText = withClipboard()
    renderPage(<McpPage />)

    await userEvent.click(await screen.findByRole('button', { name: /Copy command$/ }))
    expect(writeText).toHaveBeenLastCalledWith(
      `claude mcp add --transport http ${MCP_SERVER_NAME} ${window.location.origin}/mcp --header "Authorization: Bearer <your bearer key>"`,
    )

    await userEvent.click(screen.getByRole('button', { name: /Copy commands/ }))
    const codex = writeText.mock.calls.at(-1)![0]
    expect(codex).toContain('export BLUNDERBASE_MCP_KEY="<your bearer key>"')
    expect(codex).toContain(
      `codex mcp add ${MCP_SERVER_NAME} --url ${window.location.origin}/mcp --bearer-token-env-var BLUNDERBASE_MCP_KEY`,
    )
  })

  it('says so when there is no clipboard to copy the config to', async () => {
    // An insecure origin, which a self-hosted Blunderbase on a LAN often is.
    stubFetch({ 'GET /mcp-keys': [] })
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    renderPage(<McpPage />)

    await userEvent.click(await screen.findByRole('button', { name: /Copy config/ }))

    expect(await screen.findByRole('button', { name: /No clipboard/ })).toBeInTheDocument()
  })

  it('lists the minted keys with when each was last used', async () => {
    stubFetch({ 'GET /mcp-keys': [LAPTOP, FRESH] })
    renderPage(<McpPage />)

    expect(await screen.findByText('laptop')).toBeInTheDocument()
    const fresh = screen.getByText('claude-code').closest('li')!
    expect(within(fresh).getByText(/last used never/)).toBeInTheDocument()
    expect(screen.getByText('2 active')).toBeInTheDocument()
  })

  it('shows a new key once and threads it into the connect commands', async () => {
    stubFetch({
      'GET /mcp-keys': [],
      'POST /mcp-keys': { status: 201, body: { key: FRESH, token: TOKEN } },
    })
    const writeText = withClipboard()
    renderPage(<McpPage />)

    await userEvent.type(await screen.findByLabelText('New key name'), 'claude-code')
    await userEvent.click(screen.getByRole('button', { name: /Create/ }))

    expect(await screen.findByText(/this key is shown once/)).toBeInTheDocument()
    expect(screen.getByText(TOKEN)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Copy command$/ }))
    expect(writeText.mock.calls.at(-1)![0]).toContain(`Bearer ${TOKEN}"`)
    await userEvent.click(screen.getByRole('button', { name: /Copy config/ }))
    const config = JSON.parse(writeText.mock.calls.at(-1)![0])
    expect(config.mcpServers[MCP_SERVER_NAME].headers.Authorization).toBe(`Bearer ${TOKEN}`)

    // Done drops the token: it lived in component state only, and the snippets go back to
    // the placeholder rather than keeping a secret around on the page.
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByText(TOKEN)).not.toBeInTheDocument()
    // The Codex button has not been pressed yet, so it still carries its own label rather
    // than "Copied".
    await userEvent.click(screen.getByRole('button', { name: /Copy commands/ }))
    expect(writeText.mock.calls.at(-1)![0]).toContain('BLUNDERBASE_MCP_KEY="<your bearer key>"')
    expect(writeText.mock.calls.at(-1)![0]).not.toContain(TOKEN)
  })

  it('shows a refused name inline instead of a reveal panel', async () => {
    stubFetch({
      'GET /mcp-keys': [LAPTOP],
      'POST /mcp-keys': {
        status: 409,
        body: { error: 'duplicate_name', detail: 'a key named laptop already exists' },
      },
    })
    renderPage(<McpPage />)

    await userEvent.type(await screen.findByLabelText('New key name'), 'laptop')
    await userEvent.click(screen.getByRole('button', { name: /Create/ }))

    expect(await screen.findByText('a key named laptop already exists')).toBeInTheDocument()
    expect(screen.queryByText(/this key is shown once/)).not.toBeInTheDocument()
  })

  it('revokes a key only after a confirm', async () => {
    const fetchMock = stubFetch({
      'GET /mcp-keys': [LAPTOP],
      'DELETE /mcp-keys/1': { status: 204, body: null },
    })
    renderPage(<McpPage />)

    await userEvent.click(await screen.findByRole('button', { name: /Revoke/ }))
    expect(requested(fetchMock)).not.toContain('DELETE /mcp-keys/1')
    expect(screen.getByText(/stops its token dead/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(requested(fetchMock)).toContain('DELETE /mcp-keys/1'))
    // The list is re-read once the row is gone.
    await waitFor(() =>
      expect(requested(fetchMock).filter((r) => r === 'GET /mcp-keys').length).toBeGreaterThan(1),
    )
  })

  it('points at the import page for a database with nothing in it yet', () => {
    stubFetch({ 'GET /mcp-keys': [] })
    renderPage(<McpPage />)

    expect(screen.getByRole('link', { name: 'Import some games' })).toHaveAttribute(
      'href',
      '/library/import',
    )
  })
})
