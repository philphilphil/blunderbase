import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import { RuntimeCapabilitiesProvider } from '@/lib/runtime/RuntimeCapabilitiesProvider'

import { LibraryManagement } from './LibraryManagement'

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

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input).split('?')[0]
    if (path.endsWith('/api/games/delete-all')) {
      return json({ games: 6, runs: 4, notes: 1, import_jobs: 2 })
    }
    if (path.endsWith('/api/games')) return json({ games: [], total: 6, limit: 1, offset: 0 })
    return json({})
  }))
})

afterEach(() => vi.unstubAllGlobals())

describe('LibraryManagement', () => {
  it('keeps the destructive library reset on the import surface', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<Providers client={client}><LibraryManagement /></Providers>)

    expect(await screen.findByText('6 games in this database')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /reset imported library/i }))
    await userEvent.type(screen.getByLabelText('Your password'), 'correct password')
    await userEvent.click(screen.getByRole('button', { name: /delete them/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('status')).toHaveTextContent('Deleted 6 games, 4 analysis runs and 1 note.')
  })

  it('uses the destructive confirmation without asking desktop users for a password', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <Providers client={client}>
        <RuntimeCapabilitiesProvider
          capabilities={{ password_auth: false, mcp: false, remote_runners: false }}
        >
          <LibraryManagement />
        </RuntimeCapabilitiesProvider>
      </Providers>,
    )

    await screen.findByText('6 games in this database')
    await userEvent.click(screen.getByRole('button', { name: /reset imported library/i }))
    expect(screen.queryByLabelText('Your password')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /delete them/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
