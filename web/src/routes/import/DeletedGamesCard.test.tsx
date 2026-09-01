import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import type { DeletedGame } from '@/lib/api/types'

import { DeletedGamesCard } from './DeletedGamesCard'

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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const LICHESS: DeletedGame = {
  id: 1,
  source: 'lichess',
  source_id: 'aBcD1234',
  dedup_hash: '9f2b7c1d4e5a6b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c',
  white_name: 'blunderbase',
  black_name: 'kn1ghtmare',
  played_at: '2026-08-30T18:22:00Z',
  deleted_at: '2026-09-01T09:00:00Z',
}

/** A PGN game has no source ID: the hash is the only identity it ever had. */
const FROM_PGN: DeletedGame = {
  ...LICHESS,
  id: 2,
  source: 'pgn',
  source_id: null,
  white_name: 'someone',
  black_name: 'blunderbase',
}

let listed: DeletedGame[]
/** What `POST /library/deleted-games/forget` answers next. */
let forgetAnswer: { status: number; body: unknown }

function stub() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input).split('?')[0]!
      if (path.endsWith('/api/library/deleted-games/forget')) {
        return json(forgetAnswer.body, forgetAnswer.status)
      }
      if (path.endsWith('/api/library/deleted-games')) {
        return json({ games: listed, total: listed.length })
      }
      return json({})
    }),
  )
}

/** Every POST to the forget route, as parsed bodies. */
function forgotten(): Record<string, unknown>[] {
  return vi
    .mocked(fetch)
    .mock.calls.filter(([input, init]) =>
      String(input).endsWith('/api/library/deleted-games/forget') && init?.method === 'POST',
    )
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>)
}

function draw() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <Providers client={client}>
      <DeletedGamesCard />
    </Providers>,
  )
}

beforeEach(() => {
  listed = [LICHESS, FROM_PGN]
  forgetAnswer = { status: 200, body: { forgotten: 1 } }
  vi.stubGlobal('WebSocket', FakeSocket)
  stub()
})

afterEach(() => vi.unstubAllGlobals())

describe('DeletedGamesCard', () => {
  it('says nothing at all on a library that has deleted nothing', async () => {
    listed = []
    draw()

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled())
    expect(screen.queryByText('Deleted games')).not.toBeInTheDocument()
  })

  it('names the game behind each record, with the hash standing in for a missing ID', async () => {
    const user = userEvent.setup()
    draw()

    expect(await screen.findByText('Deleted games')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /show list/i }))

    expect(screen.getByText('aBcD1234')).toBeInTheDocument()
    expect(screen.getByText('blunderbase vs kn1ghtmare')).toBeInTheDocument()
    // The PGN row has no ID of its own, so it shows the head of the hash it is matched by.
    expect(screen.getByText('9f2b7c1d4e5a…')).toBeInTheDocument()
  })

  it('forgets one record by id', async () => {
    const user = userEvent.setup()
    draw()
    await screen.findByText('Deleted games')
    await user.click(screen.getByRole('button', { name: /show list/i }))

    await user.click(
      screen.getByRole('button', { name: /forget the deletion of blunderbase vs kn1ghtmare/i }),
    )

    await waitFor(() => expect(forgotten()).toHaveLength(1))
    expect(forgotten()[0]).toEqual({ ids: [1] })
  })

  it('forgets every record with no ids at all', async () => {
    const user = userEvent.setup()
    draw()
    await screen.findByText('Deleted games')

    await user.click(screen.getByRole('button', { name: 'Forget all' }))

    await waitFor(() => expect(forgotten()).toHaveLength(1))
    expect(forgotten()[0]).toEqual({})
  })

  it('shows what the backend refused rather than dropping it', async () => {
    forgetAnswer = { status: 500, body: { error: 'internal_error', detail: 'the database is locked' } }
    const user = userEvent.setup()
    draw()
    await screen.findByText('Deleted games')

    await user.click(screen.getByRole('button', { name: 'Forget all' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('the database is locked')
  })
})
