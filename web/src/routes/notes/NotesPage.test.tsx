import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import type { NoteResponse, TagCount } from '@/lib/api/types'

import { NotesPage } from './NotesPage'
import { NOTE_VIEW_KEY, resetNoteView } from './viewMode'

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
    game: {
      id: 10,
      white: 'phib',
      black: 'maia',
      result: '1-0',
      date: '2026-08-20',
      is_owner_game: true,
    },
    move: { ply: 8, move_number: 4, color: 'black', san: 'Bb4', label: '4... Bb4' },
    position_games: 3,
    position_reference_games: 1,
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
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const path = url.split('?')[0]!
    if ((init?.method ?? 'GET') === 'PATCH') {
      const sent = JSON.parse(String(init?.body)) as { text?: string }
      return json(200, { ...NOTES[0], text: sent.text ?? NOTES[0]!.text })
    }
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

/** jsdom in this setup exposes no `localStorage`, so the tests bring their own (see
 *  `dashboard/RatingCard.test.tsx`). */
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
  }
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
  vi.stubGlobal('localStorage', memoryStorage())
  stubFetch()
  resetNoteView()
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetNoteView()
})

describe('NotesPage', () => {
  it('lists the notes flat under date rules, newest first', async () => {
    draw()

    // No game headings any more — a game is where a note was written, not what it is
    // about, and the rules that replaced them are cut from when it was written.
    expect(await screen.findByText('The bishop has nothing to do on b5 here.')).toBeInTheDocument()
    expect(screen.queryByText('phib vs maia')).not.toBeInTheDocument()
    expect(screen.queryByText('Opening lines and loose notes')).not.toBeInTheDocument()
    expect(screen.getByText('August 2026')).toBeInTheDocument()

    // The game note draws its position, and links into the game at its ply.
    expect(screen.getByRole('img', { name: 'The position at 4... Bb4' })).toBeInTheDocument()
    const origin = screen.getByRole('link', { name: /Written on 4\.\.\. Bb4 in phib vs maia/ })
    expect(origin).toHaveAttribute('href', '/games/10?ply=8')
  })

  it('says where a note was written and where else the position turns up', async () => {
    draw()

    // Both counts, kept apart: the owner's games are what the explorer will show for the
    // position, and a model game is outside every one of their statistics.
    const explorer = await screen.findByRole('link', {
      name: 'In 3 of your games and 1 model game',
    })
    expect(explorer).toHaveAttribute('href', `/explorer?fen=${encodeURIComponent(FEN)}`)

    // A loose note came from nowhere and applies nowhere: no provenance row at all.
    const loose = document.querySelector('[data-note-id="2"]')!
    expect(loose.querySelectorAll('a')).toHaveLength(0)
  })

  it('opens in the stream, switches to the sheet, and remembers the sheet', async () => {
    const user = userEvent.setup()
    draw()
    await screen.findByText('The bishop has nothing to do on b5 here.')

    // The stream is the default and draws no placeholder: a note with no position simply
    // has no board beside it.
    expect(screen.getByRole('radio', { name: 'Stream' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByText('no position')).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Sheet' }))

    // Same notes, same rules, different shape — and the boardless note says what it is
    // rather than leaving a hole in the grid.
    expect(screen.getByText('The bishop has nothing to do on b5 here.')).toBeInTheDocument()
    expect(screen.getByText('August 2026')).toBeInTheDocument()
    expect(screen.getByText('no position')).toBeInTheDocument()
    expect(window.localStorage.getItem(NOTE_VIEW_KEY)).toBe('sheet')

    await user.click(screen.getByRole('radio', { name: 'Stream' }))
    expect(screen.queryByText('no position')).not.toBeInTheDocument()
  })

  it('rewrites a note in either view, because a view you cannot write from is one you leave', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(NOTE_VIEW_KEY, 'sheet')
    resetNoteView()
    draw()
    await screen.findByText('The bishop has nothing to do on b5 here.')

    await user.click(screen.getAllByRole('button', { name: 'Rewrite this note' })[0]!)
    const box = screen.getByRole('textbox', { name: 'Note' })
    await user.clear(box)
    await user.type(box, 'the bishop is fine, it was the knight')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      const written = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PATCH')
      expect(written).toHaveLength(1)
      expect(String(written[0]![0])).toContain('/notes/1')
    })
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Note' })).toBeNull())
  })

  it('re-asks with the tag when a tag chip is clicked', async () => {
    const user = userEvent.setup()
    draw()
    await screen.findByText('Loose thought about rook endings.')

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
    await screen.findByText('Loose thought about rook endings.')

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
