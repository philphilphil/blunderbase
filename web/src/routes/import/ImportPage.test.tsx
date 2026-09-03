import { QueryClient } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import type { ImportJob } from '@/lib/api/types'
import { EventsProvider } from '@/lib/events/EventsProvider'

import { ImportPage } from './ImportPage'

/** A socket that never connects on its own, so a test decides what arrives and when. */
class FakeSocket {
  static last: FakeSocket | null = null
  opened = false
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  readonly url: string
  constructor(url: string) {
    this.url = url
    FakeSocket.last = this
  }
  close() {}
}

function stubFetch(routes: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input).split('?')[0]!
      const body = routes[path]
      if (body === undefined) {
        return new Response(JSON.stringify({ error: 'not_found', detail: path }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
}

/** Every POST this page sent to one path: the parsed body of each, in order. */
function postedTo(path: string): Record<string, unknown>[] {
  return vi
    .mocked(fetch)
    .mock.calls.filter(
      ([input, init]) => String(input).split('?')[0] === path && init?.method === 'POST',
    )
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>)
}

/** The same, for a route whose flags travel in the query rather than in a body. */
function urlsFor(path: string): string[] {
  return vi
    .mocked(fetch)
    .mock.calls.map(([input]) => String(input))
    .filter((url) => url.split('?')[0] === path)
}

/**
 * `Providers` no longer carries the `/events` socket — it hangs inside `AuthGate`, so a
 * signed-out browser never dials it. A test that mounts a page on its own is standing in
 * for the authenticated side of that gate, so it supplies the provider the gate would.
 */
function renderPage(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <Providers client={client}>
      <EventsProvider>
        <MemoryRouter>{ui}</MemoryRouter>
      </EventsProvider>
    </Providers>,
  )
}

/**
 * One frame down the socket. `onopen` fires once, the way a real one does: firing it
 * twice is a *re*connect, which makes the provider invalidate every query on purpose.
 */
function deliver(event: Record<string, unknown>) {
  act(() => {
    const socket = FakeSocket.last
    if (!socket) throw new Error('no socket was opened')
    if (!socket.opened) {
      socket.opened = true
      socket.onopen?.()
    }
    socket.onmessage?.({ data: JSON.stringify(event) } as MessageEvent<string>)
  })
}

const JOB: ImportJob = {
  id: 1,
  source: 'lichess',
  account_id: 1,
  status: 'done',
  cursor: '1481116673133',
  created_at: '2026-08-26T00:50:19Z',
  started_at: '2026-08-26T00:50:19Z',
  finished_at: '2026-08-26T00:50:20.9Z',
  games_seen: 15,
  games_imported: 15,
  games_skipped: 0,
  games_blocked: 0,
  games_failed: 0,
  errors: [],
  message: 'phib',
}

const PROFILE = {
  accounts: [{ id: 1, platform: 'lichess', username: 'phib', is_owner: true, games: 15 }],
  ratings: [],
  volume: {},
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeSocket as unknown as typeof WebSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
  FakeSocket.last = null
})

describe('ImportPage', () => {
  it('lists what every previous sync did', async () => {
    stubFetch({
      '/api/import/jobs': { jobs: [JOB], total: 1, limit: 25, offset: 0 },
      '/api/stats/profile': PROFILE,
      '/api/games': { games: [], total: 15, limit: 1, offset: 0 },
    })
    renderPage(<ImportPage />)

    expect(await screen.findByText('Sync history')).toBeInTheDocument()
    const row = (await screen.findAllByText('phib')).at(-1)!.closest('tr')!
    expect(within(row).getByText('Done')).toBeInTheDocument()
    // seen / imported / skipped / failed, as the job row records them.
    expect(within(row).getAllByText('15')).toHaveLength(2)
    expect(within(row).getByText('1.9s')).toBeInTheDocument()
  })

  it('pages the sync history rather than growing it forever', async () => {
    const rows = (from: number) =>
      Array.from({ length: 25 }, (_, index) => ({ ...JOB, id: from + index }))
    stubFetch({
      '/api/import/jobs': { jobs: rows(100), total: 30, limit: 25, offset: 0 },
      '/api/stats/profile': PROFILE,
      '/api/games': { games: [], total: 15, limit: 1, offset: 0 },
    })
    renderPage(<ImportPage />)

    expect(await screen.findByText('1–25 of 30')).toBeInTheDocument()
    expect(screen.getByLabelText('Previous page')).toBeDisabled()

    await userEvent.click(screen.getByLabelText('Next page'))

    await waitFor(() => {
      const asked = vi.mocked(fetch).mock.calls.map(([input]) => String(input))
      expect(asked.some((url) => url.includes('offset=25'))).toBe(true)
    })
  })

  it('shows no pager at all when one page is the whole history', async () => {
    stubFetch({
      '/api/import/jobs': { jobs: [JOB], total: 1, limit: 25, offset: 0 },
      '/api/stats/profile': PROFILE,
      '/api/games': { games: [], total: 15, limit: 1, offset: 0 },
    })
    renderPage(<ImportPage />)

    expect(await screen.findByText('Sync history')).toBeInTheDocument()
    expect(screen.queryByLabelText('Next page')).not.toBeInTheDocument()
  })

  it('prefills the connect form from the account the profile already knows', async () => {
    stubFetch({
      '/api/import/jobs': { jobs: [], total: 0, limit: 25, offset: 0 },
      '/api/stats/profile': PROFILE,
      '/api/games': { games: [], total: 15, limit: 1, offset: 0 },
    })
    renderPage(<ImportPage />)

    const username = await screen.findByLabelText<HTMLInputElement>('Username', {
      selector: '#lichess-username',
    })
    await waitFor(() => expect(username.value).toBe('phib'))
    expect(screen.getByRole('button', { name: /Sync/ })).toBeInTheDocument()
  })

  it('says nothing about evaluation until a sync is asked to skip it', async () => {
    stubFetch({
      '/api/import/jobs': { jobs: [], total: 0, limit: 25, offset: 0 },
      '/api/stats/profile': PROFILE,
      '/api/games': { games: [], total: 15, limit: 1, offset: 0 },
      '/api/import/lichess': { source: 'lichess', status: 'running', job_id: 9 },
    })
    renderPage(<ImportPage />)

    const username = await screen.findByLabelText<HTMLInputElement>('Username', {
      selector: '#lichess-username',
    })
    await waitFor(() => expect(username.value).toBe('phib'))
    await userEvent.click(screen.getByRole('button', { name: /Sync/ }))

    // Unticked, the request carries no opinion at all and the backend queues the pass.
    await waitFor(() => expect(postedTo('/api/import/lichess')).toHaveLength(1))
    expect(postedTo('/api/import/lichess')[0]).not.toHaveProperty('analyze')

    // One switch for the whole table: the answer is never different per source.
    const skip = screen.getByRole('checkbox', { name: 'Skip evaluation' })
    await userEvent.click(skip)
    expect(skip).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByRole('button', { name: /Sync/ }))

    await waitFor(() => expect(postedTo('/api/import/lichess')).toHaveLength(2))
    expect(postedTo('/api/import/lichess')[1]).toMatchObject({ username: 'phib', analyze: false })
  })

  it('tells a sync what the strip above the table says, not what a row does', async () => {
    stubFetch({
      '/api/import/jobs': { jobs: [], total: 0, limit: 25, offset: 0 },
      '/api/stats/profile': PROFILE,
      '/api/games': { games: [], total: 15, limit: 1, offset: 0 },
      '/api/import/lichess': { source: 'lichess', status: 'running', job_id: 11 },
    })
    renderPage(<ImportPage />)

    const username = await screen.findByLabelText<HTMLInputElement>('Username', {
      selector: '#lichess-username',
    })
    await waitFor(() => expect(username.value).toBe('phib'))

    // A native date input takes a value, not keystrokes.
    fireEvent.change(screen.getByLabelText('Since'), { target: { value: '2024-01-01' } })
    await userEvent.type(screen.getByLabelText('Max games'), '50')
    await userEvent.click(screen.getByRole('button', { name: /Sync/ }))

    await waitFor(() => expect(postedTo('/api/import/lichess')).toHaveLength(1))
    expect(postedTo('/api/import/lichess')[0]).toMatchObject({
      username: 'phib',
      since: '2024-01-01',
      max_games: 50,
    })
  })

  it('starts a sync at the beginning of the archive when asked to', async () => {
    stubFetch({
      '/api/import/jobs': { jobs: [], total: 0, limit: 25, offset: 0 },
      '/api/stats/profile': PROFILE,
      '/api/games': { games: [], total: 15, limit: 1, offset: 0 },
      '/api/import/lichess': { source: 'lichess', status: 'running', job_id: 12 },
    })
    renderPage(<ImportPage />)

    const username = await screen.findByLabelText<HTMLInputElement>('Username', {
      selector: '#lichess-username',
    })
    await waitFor(() => expect(username.value).toBe('phib'))
    // A date and "from the beginning" answer the same question, so the box wins and the
    // date it would have contradicted is taken out of the argument.
    fireEvent.change(screen.getByLabelText('Since'), { target: { value: '2024-01-01' } })
    await userEvent.click(screen.getByRole('checkbox', { name: 'From the beginning' }))
    expect(screen.getByLabelText('Since')).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: /Sync/ }))

    await waitFor(() => expect(postedTo('/api/import/lichess')).toHaveLength(1))
    expect(postedTo('/api/import/lichess')[0]).toMatchObject({ username: 'phib', since: 'all' })
  })

  it('carries the same skip into the PGN upload, where it is a query flag', async () => {
    stubFetch({
      '/api/import/jobs': { jobs: [], total: 0, limit: 25, offset: 0 },
      '/api/stats/profile': PROFILE,
      '/api/games': { games: [], total: 15, limit: 1, offset: 0 },
      '/api/import/pgn/upload': { source: 'pgn', status: 'running', job_id: 10 },
    })
    renderPage(<ImportPage />)
    await screen.findByText('Sync history')

    const file = new File(['[Event "Casual"]\n\n1. e4 e5 *\n'], 'games.pgn', {
      type: 'text/plain',
    })
    await userEvent.upload(screen.getByTestId('pgn-file-input'), file)
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }))

    await waitFor(() => expect(urlsFor('/api/import/pgn/upload')).toHaveLength(1))
    expect(urlsFor('/api/import/pgn/upload')[0]).not.toContain('analyze')

    // The same one switch the accounts above use.
    const skip = screen.getByRole('checkbox', { name: 'Skip evaluation' })
    await userEvent.click(skip)
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }))

    await waitFor(() => expect(urlsFor('/api/import/pgn/upload')).toHaveLength(2))
    expect(urlsFor('/api/import/pgn/upload')[1]).toContain('analyze=false')
  })

  it('asks whose games the PGN holds and only says so when they are not the owner’s', async () => {
    stubFetch({
      '/api/import/jobs': { jobs: [], total: 0, limit: 25, offset: 0 },
      '/api/stats/profile': PROFILE,
      '/api/games': { games: [], total: 15, limit: 1, offset: 0 },
      '/api/import/pgn/upload': { source: 'pgn', status: 'running', job_id: 10 },
    })
    renderPage(<ImportPage />)
    await screen.findByText('Sync history')

    const file = new File(['[Event "Casual"]\n\n1. e4 e5 *\n'], 'kasparov.pgn', {
      type: 'text/plain',
    })
    await userEvent.upload(screen.getByTestId('pgn-file-input'), file)

    // Mine is the default, and the default travels as nothing at all.
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }))
    await waitFor(() => expect(urlsFor('/api/import/pgn/upload')).toHaveLength(1))
    expect(urlsFor('/api/import/pgn/upload')[0]).not.toContain('mine')

    await userEvent.click(screen.getByRole('button', { name: 'Not mine' }))
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }))

    await waitFor(() => expect(urlsFor('/api/import/pgn/upload')).toHaveLength(2))
    expect(urlsFor('/api/import/pgn/upload')[1]).toContain('mine=false')
  })

  it('never seeds the username from a failed sync, whose message is the exception', async () => {
    // `services/import_service.py` overwrites the job's message with the exception text
    // when a sync throws, so a failed job's message is an error string, not a username —
    // seeding the field with it would post `AdapterError: …` as the username on Connect.
    stubFetch({
      '/api/import/jobs': {
        jobs: [
          {
            ...JOB,
            status: 'failed',
            account_id: null,
            games_imported: 0,
            games_seen: 0,
            message: 'AdapterError: lichess answered 404 for user fooo',
          },
        ],
        total: 1,
        limit: 25,
        offset: 0,
      },
      '/api/stats/profile': { accounts: [], ratings: [], volume: {} },
      '/api/games': { games: [], total: 0, limit: 1, offset: 0 },
    })
    renderPage(<ImportPage />)

    // The history has the job, so the query has resolved and any seeding has happened.
    expect(await screen.findByText(/lichess answered 404/)).toBeInTheDocument()
    const username = screen.getByLabelText<HTMLInputElement>('Username', {
      selector: '#lichess-username',
    })
    expect(username.value).toBe('')
    expect(username).toHaveAttribute('placeholder', 'lichess username')
  })

  it('says so when nothing has ever been synced', async () => {
    stubFetch({
      '/api/import/jobs': { jobs: [], total: 0, limit: 25, offset: 0 },
      '/api/stats/profile': { accounts: [], ratings: [], volume: {} },
      '/api/games': { games: [], total: 0, limit: 1, offset: 0 },
    })
    renderPage(<ImportPage />)

    expect(await screen.findByText('Nothing has been synced yet.')).toBeInTheDocument()
    // No account is connected yet, so every account row offers Connect rather than Sync.
    expect(screen.getAllByRole('button', { name: /Connect/ })).toHaveLength(3)
  })

  it('leaves the assistant config to its own page', async () => {
    stubFetch({
      '/api/import/jobs': { jobs: [], total: 0, limit: 25, offset: 0 },
      '/api/stats/profile': PROFILE,
      '/api/games': { games: [], total: 15, limit: 1, offset: 0 },
    })
    renderPage(<ImportPage />)

    await screen.findByText('Sync history')
    expect(screen.queryByRole('button', { name: /Copy config/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Export PGN/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Reset imported Library/ })).not.toBeInTheDocument()
  })

  it('opens the per-game failures of a sync that lost games', async () => {
    stubFetch({
      '/api/import/jobs': {
        jobs: [
          {
            ...JOB,
            games_imported: 14,
            games_failed: 1,
            errors: [{ ref: 'aBc12345', error: 'no moves in that game' }],
          },
        ],
        total: 1,
        limit: 25,
        offset: 0,
      },
      '/api/stats/profile': PROFILE,
      '/api/games': { games: [], total: 15, limit: 1, offset: 0 },
    })
    renderPage(<ImportPage />)

    const toggle = await screen.findByRole('button', { name: 'Show failures' })
    await userEvent.click(toggle)
    expect(screen.getByText('aBc12345')).toBeInTheDocument()
    expect(screen.getByText('no moves in that game')).toBeInTheDocument()
  })

  it('follows a running sync over the socket', async () => {
    stubFetch({
      '/api/import/jobs': { jobs: [], total: 0, limit: 25, offset: 0 },
      '/api/stats/profile': PROFILE,
      '/api/games': { games: [], total: 15, limit: 1, offset: 0 },
    })
    renderPage(<ImportPage />)
    await screen.findByText('Sync history')

    deliver({ event: 'import.started', job_id: 9, source: 'lichess', at: '2026-08-26T00:50:19Z' })
    // The progress block and the button both say it.
    expect(await screen.findAllByText('Syncing')).toHaveLength(2)

    deliver({
      event: 'import.game',
      job_id: 9,
      source: 'lichess',
      ref: 'aBc12345',
      status: 'failed',
      game_id: null,
      error: 'no moves in that game',
      seen: 3,
      imported: 2,
      skipped: 0,
      failed: 1,
    })
    expect(await screen.findByText('2 imported')).toBeInTheDocument()
    expect(screen.getByText('1 failed')).toBeInTheDocument()
    expect(screen.getByText('no moves in that game')).toBeInTheDocument()

    deliver({
      event: 'import.finished',
      job_id: 9,
      source: 'lichess',
      status: 'done',
      seen: 3,
      imported: 2,
      skipped: 0,
      failed: 1,
      message: 'phib',
      at: '2026-08-26T00:50:25Z',
    })
    expect(await screen.findByText('Finished — 1 failed')).toBeInTheDocument()
  })
})
