import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { NoteResponse } from '@/lib/api/types'

import { PositionNotes } from './PositionNotes'

const FEN = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -'

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function note(over: Partial<NoteResponse> = {}): NoteResponse {
  return {
    id: 1,
    text: 'the open games, when I want a fight',
    tags: [],
    source: 'web',
    fen: FEN,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  } as NoteResponse
}

/** What the fake backend is holding, newest first — the order `GET /notes` answers in. */
let stored: NoteResponse[]
/** Every write the card made, in order, so a test can assert that it made none. */
let writes: { method: string; body: Record<string, unknown> }[]

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).split('?')[0]!
      const body = init?.body === undefined ? {} : (JSON.parse(String(init.body)) as never)
      const method = init?.method ?? 'GET'
      if (method === 'GET') return json(200, stored)
      writes.push({ method, body })
      if (method === 'POST') {
        const sent = body as { text: string }
        const saved = note({ id: 7, text: sent.text })
        stored = [saved, ...stored]
        return json(201, saved)
      }
      if (method === 'PATCH') {
        const sent = body as { text?: string }
        stored = stored.map((row) =>
          row.id === 1 ? { ...row, text: sent.text ?? row.text } : row,
        )
        return json(200, stored.find((row) => row.id === 1))
      }
      if (method === 'DELETE') {
        stored = []
        return new Response(null, { status: 204 })
      }
      return json(404, { error: 'not_found', detail: path })
    }),
  )
}

function draw() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <PositionNotes fen={FEN} />
    </QueryClientProvider>,
  )
}

/** Click away from the box, which is the only thing that saves it. */
async function clickAway(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText('Your notes on this position'))
}

beforeEach(() => {
  stored = []
  writes = []
  stubFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PositionNotes', () => {
  it('invites the first note where there is nothing to show', async () => {
    draw()
    expect(await screen.findByText(/Nothing written about this position yet/)).toBeInTheDocument()
  })

  it('saves a new note when the box loses focus, and says that it did', async () => {
    const user = userEvent.setup()
    draw()

    await user.click(await screen.findByText(/Nothing written about this position yet/))
    await user.type(screen.getByLabelText('Note text'), 'stop playing this on autopilot')
    await clickAway(user)

    await waitFor(() => expect(writes).toHaveLength(1))
    // The FEN rides along, which is the whole anchor: a note here is about a position.
    expect(writes[0]).toEqual({
      method: 'POST',
      body: { text: 'stop playing this on autopilot', fen: FEN },
    })
    expect(await screen.findByText('stop playing this on autopilot')).toBeInTheDocument()
    // With no button to press, this is the only confirmation there is.
    expect(await screen.findByRole('status')).toHaveTextContent('saved')
    expect(screen.queryByLabelText('Note text')).not.toBeInTheDocument()
  })

  it('writes nothing when the box was opened and left alone', async () => {
    stored = [note()]
    const user = userEvent.setup()
    draw()

    await user.click(await screen.findByLabelText('Edit this note'))
    await clickAway(user)

    expect(screen.queryByLabelText('Note text')).not.toBeInTheDocument()
    expect(writes).toEqual([])
    // An empty new note is not a note either: no POST the API would answer 422 to.
    await user.click(screen.getByText('Add note'))
    await clickAway(user)
    expect(writes).toEqual([])
  })

  it('rewrites a note that is already there', async () => {
    stored = [note()]
    const user = userEvent.setup()
    draw()

    await user.click(await screen.findByLabelText('Edit this note'))
    const box = screen.getByLabelText('Note text')
    await user.clear(box)
    await user.type(box, 'the Italian, and only the Italian')
    await clickAway(user)

    expect(await screen.findByText('the Italian, and only the Italian')).toBeInTheDocument()
    // A rewrite is a PATCH of the note that hangs here, never a second note beside it.
    expect(writes.map((write) => write.method)).toEqual(['PATCH'])
  })

  it('leaves the note alone when the box is cleared to nothing', async () => {
    // Blur is not a decision — emptying the box must not be able to destroy a note.
    stored = [note()]
    const user = userEvent.setup()
    draw()

    await user.click(await screen.findByLabelText('Edit this note'))
    await user.clear(screen.getByLabelText('Note text'))
    await clickAway(user)

    expect(writes).toEqual([])
    expect(screen.getByText('the open games, when I want a fight')).toBeInTheDocument()
  })

  it('throws away an edit on Escape', async () => {
    stored = [note()]
    const user = userEvent.setup()
    draw()

    await user.click(await screen.findByLabelText('Edit this note'))
    await user.type(screen.getByLabelText('Note text'), ' — and never the Ruy')
    await user.keyboard('{Escape}')

    expect(screen.queryByLabelText('Note text')).not.toBeInTheDocument()
    expect(writes).toEqual([])
    expect(screen.getByText('the open games, when I want a fight')).toBeInTheDocument()
  })

  it('forgets a note when asked explicitly', async () => {
    stored = [note()]
    const user = userEvent.setup()
    draw()

    await user.click(await screen.findByLabelText('Delete this note'))
    expect(await screen.findByText(/Nothing written about this position yet/)).toBeInTheDocument()
    expect(writes.map((write) => write.method)).toEqual(['DELETE'])
  })

  it('keeps the coach’s provenance visible and off the owner’s own notes', async () => {
    stored = [note({ id: 2, text: 'you keep losing the d-pawn here', source: 'mcp' }), note()]
    draw()

    const coach = (await screen.findByText('you keep losing the d-pawn here')).closest('div')!
    expect(coach).toHaveTextContent('note via MCP')
    expect(coach.className).toContain('border-l-mistake')

    const own = screen.getByText('the open games, when I want a fight').closest('div')!
    expect(own).not.toHaveTextContent('note via MCP')
    expect(own.className).not.toContain('border-l-mistake')
  })
})
