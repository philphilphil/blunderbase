import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import type { NoteResponse, TagCount } from '@/lib/api/types'

import { NotesPage } from './NotesPage'

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
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const FEN = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 5 4'

const NOTES: NoteResponse[] = [
  {
    id: 1,
    text: 'The bishop has nothing to do on b5 here.',
    tags: ['opening'],
    game_id: 10,
    ply: 8,
    fen: FEN,
    source: 'web',
    game: { id: 10, white: 'phib', black: 'maia', result: '1-0', date: '2026-08-20' },
    created_at: '2026-08-20T10:00:00Z',
    updated_at: '2026-08-20T10:00:00Z',
  },
  {
    id: 2,
    text: 'Loose thought about rook endings.',
    tags: ['endgame'],
    source: 'mcp',
    created_at: '2026-08-21T10:00:00Z',
    updated_at: '2026-08-21T10:00:00Z',
  },
]

const TAGS: TagCount[] = [
  { tag: 'opening', notes: 4 },
  { tag: 'endgame', notes: 2 },
]

/** The note `?note=` names when it is not in the filtered list. */
const LINKED: NoteResponse = {
  id: 99,
  text: 'A note about a bare position.',
  tags: [],
  fen: FEN,
  created_at: '2026-08-01T10:00:00Z',
  updated_at: '2026-08-01T10:00:00Z',
}

function stubFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const path = url.split('?')[0]!
    if (path.endsWith('/notes/tags')) return json(200, TAGS)
    if (path.endsWith('/notes/export')) {
      return new Response('# notes', {
        status: 200,
        headers: {
          'content-type': 'text/markdown',
          'content-disposition': 'attachment; filename="blunderbase-notes.md"',
        },
      })
    }
    if (path.endsWith('/notes/99')) return json(200, LINKED)
    if (path.endsWith('/notes')) return json(200, NOTES)
    return json(404, { error: 'not_found', detail: path })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Every URL the page asked `GET /notes` for, in order. */
function listedWith(): string[] {
  return vi
    .mocked(fetch)
    .mock.calls.map(([input]) => String(input))
    .filter((url) => /\/notes(\?|$)/.test(url))
}

function draw(entry = '/notes') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <Providers client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <NotesPage />
      </MemoryRouter>
    </Providers>,
  )
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeSocket)
  stubFetch()
})

afterEach(() => vi.unstubAllGlobals())

describe('NotesPage', () => {
  it('groups the notes under their game and puts the loose ones last', async () => {
    draw()

    expect(await screen.findByText('phib vs maia')).toBeInTheDocument()
    expect(screen.getByText('1–0 · 2026-08-20')).toBeInTheDocument()
    expect(screen.getByText('Opening lines and loose notes')).toBeInTheDocument()

    const headings = screen.getAllByText(/phib vs maia|Opening lines and loose notes/)
    expect(headings.map((node) => node.textContent)).toEqual([
      'phib vs maia',
      'Opening lines and loose notes',
    ])
    // The game note draws its position, and links into the game at its ply.
    expect(screen.getByRole('img', { name: 'The position at 4…' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open the game at 4…' })).toHaveAttribute(
      'href',
      '/games/10?ply=8',
    )
  })

  it('re-asks with the tag when a tag chip is clicked', async () => {
    const user = userEvent.setup()
    draw()
    await screen.findByText('phib vs maia')

    await user.click(screen.getByRole('button', { name: 'endgame' }))

    // `tag=` in the address, `tags=` to the API — the two vocabularies are not the same.
    await waitFor(() => expect(listedWith().some((url) => url.includes('tags=endgame'))).toBe(true))
  })

  it('fetches the note a link named when the filters do not show it', async () => {
    draw('/notes?note=99&scope=game')

    expect(await screen.findByText('The note you followed')).toBeInTheDocument()
    expect(screen.getByText('A note about a bare position.')).toBeInTheDocument()
  })

  it('exports over the filters on screen', async () => {
    const user = userEvent.setup()
    const created = vi.fn(() => 'blob:notes')
    vi.stubGlobal('URL', Object.assign(Object.create(URL), URL, {
      createObjectURL: created,
      revokeObjectURL: vi.fn(),
    }))
    draw('/notes?scope=free')
    await screen.findByText('Opening lines and loose notes')

    await user.click(screen.getByRole('button', { name: /markdown/i }))

    await waitFor(() => {
      const exported = vi
        .mocked(fetch)
        .mock.calls.map(([input]) => String(input))
        .filter((url) => url.includes('/notes/export'))
      expect(exported).toHaveLength(1)
      expect(exported[0]).toContain('scope=free')
      expect(exported[0]).toContain('format=md')
    })
    await waitFor(() => expect(created).toHaveBeenCalled())
  })
})
