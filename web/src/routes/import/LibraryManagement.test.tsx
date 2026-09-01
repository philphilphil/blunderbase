import { QueryClient } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
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

let finishBackupPreparation: ((response: Response) => void) | undefined

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:library'),
    revokeObjectURL: vi.fn(),
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input).split('?')[0]
    if (path.endsWith('/api/games/export')) {
      return new Response('[Event "Library"]\n\n*', {
        status: 200,
        headers: {
          'content-type': 'application/x-chess-pgn',
          'content-disposition': 'attachment; filename="blunderbase-library.pgn"',
        },
      })
    }
    if (path.endsWith('/api/library/backup/estimate')) {
      return json({ estimated_bytes: 1_350_000_000 })
    }
    if (path.endsWith('/api/library/backup/prepare')) {
      return await new Promise<Response>((resolve) => {
        finishBackupPreparation = resolve
      })
    }
    if (path.endsWith('/api/games/delete-all')) {
      return json({ games: 6, runs: 4, notes: 1, import_jobs: 2 })
    }
    if (path.endsWith('/api/games')) return json({ games: [], total: 6, limit: 1, offset: 0 })
    return json({})
  }))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('LibraryManagement', () => {
  it('keeps the destructive library reset on the manage surface', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<Providers client={client}><LibraryManagement /></Providers>)

    expect(await screen.findByText(/Delete 6 games/)).toBeInTheDocument()
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

    await screen.findByText(/Delete 6 games/)
    await userEvent.click(screen.getByRole('button', { name: /reset imported library/i }))
    expect(screen.queryByLabelText('Your password')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /delete them/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('downloads every game as one PGN from the library row', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<Providers client={client}><LibraryManagement /></Providers>)

    await userEvent.click(await screen.findByRole('button', { name: /export pgn/i }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/games/export',
        expect.objectContaining({ method: 'GET' }),
      )
      expect(URL.createObjectURL).toHaveBeenCalled()
    })
  })

  it('offers a technical database backup and explains that restore uses the CLI', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<Providers client={client}><LibraryManagement /></Providers>)

    expect(await screen.findByText('Technical')).toBeInTheDocument()
    expect(screen.getByText(/Restoring it requires the CLI/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Restore guide/ })).toHaveAttribute(
      'href',
      expect.stringContaining('docs/reference.md#export-backup-and-restore'),
    )
    expect(await screen.findByText(/Estimated backup size: about 1.4 GB/)).toBeInTheDocument()

    const backup = screen.getByRole('button', { name: /download backup/i })
    await userEvent.click(backup)

    expect(backup).toBeDisabled()
    expect(backup.querySelector('.animate-spin')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith(
      '/api/library/backup/prepare',
      expect.objectContaining({ method: 'POST' }),
    )

    act(() => {
      finishBackupPreparation?.(
        json({
          token: 'prepared-token',
          filename: 'blunderbase-backup-2026-09-01.db',
          bytes: 1_350_000_000,
        }),
      )
    })

    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled())
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })
})
