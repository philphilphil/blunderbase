import { QueryClient } from '@tanstack/react-query'
import { render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import type { BatchAnalysisResponse, GameCard } from '@/lib/api/types'
import { ChromeActions, ChromeCrumbs } from '@/test/chrome'

import { resetTrail, useGameTrail, useLibraryAddress } from './gameTrail'
import { GamesPage } from './GamesPage'
import { PAGE_SIZE_KEY } from './paging'

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

const GAMES = [11, 12, 13].map(
  (id) =>
    ({
      id,
      source: 'lichess',
      played_at: '2026-04-01T20:00:00Z',
      color: 'white',
      result: '1-0',
      outcome: 'win',
      white: 'phib',
      black: `opponent-${id}`,
      white_rating: 1650,
      black_rating: 1600,
      opponent: `opponent-${id}`,
      opponent_rating: 1600,
      eco: 'C65',
      opening: 'Ruy Lopez: Berlin Defense',
      time_control: '300+0',
      speed: 'blitz',
      ply_count: 40,
      analyzed: false,
      requested: false,
      eval_curve: [],
      worst_moments: [],
    }) as unknown as GameCard,
)

/** What `/analysis/batch` answers next, and what the library serves under it. */
let receipt: BatchAnalysisResponse

function stubFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input).split('?')[0]!
    if (path.endsWith('/api/analysis/batch')) return json(202, receipt)
    if (path.endsWith('/api/games')) {
      return json(200, { games: GAMES, total: GAMES.length, limit: 50, offset: 0 })
    }
    return json(404, { error: 'not_found', detail: path })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Every POST the page sent to one path: the parsed body of each, in order. */
function postedTo(path: string): Record<string, unknown>[] {
  return vi
    .mocked(fetch)
    .mock.calls.filter(
      ([input, init]) => String(input).split('?')[0].endsWith(path) && init?.method === 'POST',
    )
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>)
}

function draw(at = '/games') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <Providers client={client}>
      <MemoryRouter initialEntries={[at]}>
        <GamesPage />
        <ChromeCrumbs />
        <ChromeActions />
      </MemoryRouter>
    </Providers>,
  )
  return client
}

/** The rows, once the first page has answered. */
async function loaded() {
  await screen.findByLabelText('Select game 11')
}

beforeEach(() => {
  receipt = {
    queued: GAMES.map((game, index) => ({ game_id: game.id, run_id: 90 + index })),
    refused: [],
  }
  vi.stubGlobal('WebSocket', FakeSocket)
  stubFetch()
})

afterEach(() => vi.unstubAllGlobals())

describe('GamesPage — filtering analysis coverage', () => {
  it('requests only games with no finished analysis', async () => {
    const user = userEvent.setup()
    draw()
    await loaded()

    await user.click(screen.getByRole('button', { name: /^Analysis/ }))
    await user.click(screen.getByRole('button', { name: 'Unanalysed' }))

    await waitFor(() => {
      const requests = vi.mocked(fetch).mock.calls.map(([input]) => String(input))
      expect(requests.some((request) => request.includes('analyzed=false'))).toBe(true)
    })
    const chip = screen.getByRole('button', { name: /Analysis: unanalysed/ })
    // A set chip wears the one selected state, so a glance down the bar finds it.
    expect(chip.parentElement).toHaveClass('bg-selected')
    // `expanded`: the chip, not the Source column's sort button.
    expect(
      screen.getByRole('button', { name: /^Source/, expanded: false }).parentElement,
    ).not.toHaveClass('bg-selected')
  })

  it('keeps Mine / Others / All a labelled one-of-three choice', async () => {
    draw()
    await loaded()
    const group = screen.getByRole('radiogroup', { name: 'Whose games' })
    expect(group).toBeInTheDocument()
    expect(within(group).getByRole('radio', { name: 'Mine' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(within(group).getByRole('radio', { name: 'All' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })
})

describe('GamesPage — queueing analysis over a selection', () => {
  it('sends one request for the whole selection, not one per game', async () => {
    const user = userEvent.setup()
    draw()
    await loaded()

    await user.click(screen.getByLabelText('Select every game on this page'))
    // One button: the selection gets the import pass, and nothing deeper is on offer here.
    expect(screen.getAllByRole('button', { name: /queue .*analysis/i })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: /^queue analysis$/i }))

    await waitFor(() => expect(postedTo('/analysis/batch')).toHaveLength(1))
    // Ids and nothing else — no tier, no budget, no priority for the client to get wrong.
    expect(postedTo('/analysis/batch')[0]).toEqual({ game_ids: [11, 12, 13] })
    expect(await screen.findByText('3 runs queued')).toBeInTheDocument()
  })

  it('reads the receipt for what the batch would not take', async () => {
    receipt = { queued: [{ game_id: 11, run_id: 90 }], refused: [{ game_id: 12, reason: 'gone' }] }
    const user = userEvent.setup()
    draw()
    await loaded()

    await user.click(screen.getByLabelText('Select game 11'))
    await user.click(screen.getByLabelText('Select game 12'))
    await user.click(screen.getByRole('button', { name: /^queue analysis$/i }))

    expect(await screen.findByText('1 queued, 1 refused')).toBeInTheDocument()
    expect(postedTo('/analysis/batch')[0]).toEqual({ game_ids: [11, 12] })
  })

  it('queues a single row through the same call', async () => {
    receipt = { queued: [{ game_id: 12, run_id: 90 }], refused: [] }
    const user = userEvent.setup()
    draw()
    await loaded()

    const row = screen.getByLabelText('Select game 12').closest('[role="row"]') as HTMLElement
    await user.click(within(row).getAllByRole('button', { name: 'Analyse' })[0]!)

    await waitFor(() => expect(postedTo('/analysis/batch')).toHaveLength(1))
    expect(postedTo('/analysis/batch')[0]).toEqual({ game_ids: [12] })
    expect(await screen.findByText('1 run queued')).toBeInTheDocument()
    // Queued, the row says so rather than offering the button again.
    expect(within(row).getAllByText('In queue')).toHaveLength(2)
    expect(within(row).queryByRole('button', { name: 'Analyse' })).not.toBeInTheDocument()
  })

  it('counts a call that never landed as the whole selection refused', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const path = String(input).split('?')[0]!
      if (path.endsWith('/api/analysis/batch')) {
        return json(409, { error: 'engine_unavailable', detail: 'no engine is assigned to the analysis role' })
      }
      return json(200, { games: GAMES, total: GAMES.length, limit: 50, offset: 0 })
    })
    const user = userEvent.setup()
    draw()
    await loaded()

    await user.click(screen.getByLabelText('Select every game on this page'))
    await user.click(screen.getByRole('button', { name: /^queue analysis$/i }))

    expect(
      await screen.findByText('0 queued, 3 refused — no engine is assigned to the analysis role'),
    ).toBeInTheDocument()
  })

  it('says what the server refused a whole selection for', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const path = String(input).split('?')[0]!
      if (path.endsWith('/api/analysis/batch')) {
        return json(422, { error: 'too_many_games', detail: 'a batch takes at most 500 games' })
      }
      return json(200, { games: GAMES, total: GAMES.length, limit: 50, offset: 0 })
    })
    const user = userEvent.setup()
    draw()
    await loaded()

    await user.click(screen.getByLabelText('Select every game on this page'))
    await user.click(screen.getByRole('button', { name: /^queue analysis$/i }))

    expect(
      await screen.findByText('0 queued, 3 refused — a batch takes at most 500 games'),
    ).toBeInTheDocument()
  })
})

describe('GamesPage — deleting games', () => {
  /** `/games/delete` answers with what went; the table re-reads what is left. */
  function stubDelete(status = 200, body: unknown = { games: 2, runs: 1, notes: 0, lines: 0 }) {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).split('?')[0]!
      if (path.endsWith('/api/games/delete')) return json(status, body)
      if (path.endsWith('/api/games')) {
        return json(200, { games: GAMES, total: GAMES.length, limit: 25, offset: 0 })
      }
      return json(404, { error: 'not_found', detail: `${path} ${init?.method ?? 'GET'}` })
    })
  }

  it('sends the whole selection in one call, once it is confirmed', async () => {
    stubDelete()
    const user = userEvent.setup()
    draw()
    await loaded()

    await user.click(screen.getByLabelText('Select game 11'))
    await user.click(screen.getByLabelText('Select game 12'))
    await user.click(screen.getByRole('button', { name: 'Delete…' }))

    // Nothing has gone yet: the dialog is the confirmation, and it names the count.
    expect(screen.getByRole('dialog')).toHaveTextContent('Delete 2 games')
    expect(postedTo('/games/delete')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Delete them' }))

    await waitFor(() => expect(postedTo('/games/delete')).toHaveLength(1))
    expect(postedTo('/games/delete')[0]).toEqual({ game_ids: [11, 12] })
    expect(await screen.findByText('2 games deleted')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('deletes one game from its own row through the same call', async () => {
    stubDelete(200, { games: 1, runs: 0, notes: 0, lines: 0 })
    const user = userEvent.setup()
    draw()
    await loaded()

    await user.click(screen.getByRole('button', { name: 'Delete game 13' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Delete 1 game')
    await user.click(screen.getByRole('button', { name: 'Delete it' }))

    await waitFor(() => expect(postedTo('/games/delete')).toHaveLength(1))
    expect(postedTo('/games/delete')[0]).toEqual({ game_ids: [13] })
    expect(await screen.findByText('1 game deleted')).toBeInTheDocument()
  })

  it('keeps the dialog up with the reason when the delete is refused', async () => {
    stubDelete(422, { error: 'invalid_request', detail: 'a delete takes at most 500 games' })
    const user = userEvent.setup()
    draw()
    await loaded()

    await user.click(screen.getByRole('button', { name: 'Delete game 11' }))
    await user.click(screen.getByRole('button', { name: 'Delete it' }))

    expect(await screen.findByText('a delete takes at most 500 games')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('GamesPage — paging and ordering', () => {
  /** A library of 120 games served one page at a time, honouring limit and offset. */
  function stubPages(total = 120) {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      if (!url.pathname.endsWith('/api/games')) return json(404, { error: 'not_found' })
      const limit = Number(url.searchParams.get('limit'))
      const offset = Number(url.searchParams.get('offset'))
      const games = Array.from({ length: Math.max(Math.min(limit, total - offset), 0) }, (_, i) => ({
        ...GAMES[0],
        id: offset + i + 1,
      }))
      return json(200, { games, total, limit, offset })
    })
  }

  /** The query string of the last `/games` request. */
  function lastGamesQuery(): URLSearchParams {
    const calls = vi.mocked(fetch).mock.calls.map(([input]) => String(input))
    const last = calls.filter((url) => url.split('?')[0]!.endsWith('/api/games')).at(-1)!
    return new URL(last, 'http://localhost').searchParams
  }

  it('walks the library a page at a time', async () => {
    stubPages()
    const user = userEvent.setup()
    draw()
    await screen.findByLabelText('Select game 1')

    // jsdom measures nothing, so "Fit" falls back to 25 rows.
    expect(lastGamesQuery().get('limit')).toBe('25')
    expect(screen.getByText('1–25 of 120')).toBeInTheDocument()
    expect(screen.getByLabelText('Previous page')).toBeDisabled()

    await user.click(screen.getByLabelText('Next page'))

    await screen.findByLabelText('Select game 26')
    expect(lastGamesQuery().get('offset')).toBe('25')
    expect(screen.getByText('26–50 of 120')).toBeInTheDocument()
  })

  it('starts again at the first page when the page size changes', async () => {
    stubPages()
    const user = userEvent.setup()
    draw()
    await screen.findByLabelText('Select game 1')
    await user.click(screen.getByLabelText('Next page'))
    await screen.findByLabelText('Select game 26')

    await user.selectOptions(screen.getByLabelText('Rows'), '100')

    await waitFor(() => expect(lastGamesQuery().get('limit')).toBe('100'))
    expect(lastGamesQuery().get('offset')).toBe('0')
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
  })

  it('sorts by asking the backend, not by reordering the page', async () => {
    stubPages()
    const user = userEvent.setup()
    draw()
    await screen.findByLabelText('Select game 1')

    // The exact name is the column header, so the filter chips do not match it.
    await user.click(screen.getByRole('button', { name: 'Black' }))

    await waitFor(() => expect(lastGamesQuery().get('order')).toBe('black'))
    expect(lastGamesQuery().get('direction')).toBe('asc')
  })

  /** The library under a real route table, with a game screen that only has a Back button. */
  function drawRoutes() {
    // The size an earlier test chose is kept in storage; these read at the default "Fit".
    window.localStorage.removeItem(PAGE_SIZE_KEY)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    function GameStub() {
      const navigate = useNavigate()
      return (
        <button type="button" onClick={() => navigate(-1)}>
          back
        </button>
      )
    }
    function Where() {
      return <output data-testid="where">{useLocation().search}</output>
    }
    render(
      <Providers client={client}>
        <MemoryRouter initialEntries={['/games']}>
          <Routes>
            <Route path="/games" element={<GamesPage />} />
            <Route path="/games/:id" element={<GameStub />} />
          </Routes>
          <Where />
        </MemoryRouter>
      </Providers>,
    )
  }

  it('comes back from a game to the page and sort it was opened from', async () => {
    stubPages()
    const user = userEvent.setup()
    drawRoutes()
    await screen.findByLabelText('Select game 1')

    await user.click(screen.getByRole('button', { name: 'Black' }))
    await user.click(screen.getByLabelText('Next page'))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('?order=black&page=2'))
    await screen.findByLabelText('Select game 26')

    await user.click(screen.getByLabelText('Select game 27').closest<HTMLElement>('[role="row"]')!)
    await user.click(await screen.findByRole('button', { name: 'back' }))

    await screen.findByLabelText('Select game 26')
    expect(screen.getByText('26–50 of 120')).toBeInTheDocument()
    expect(lastGamesQuery().get('order')).toBe('black')
    expect(lastGamesQuery().get('offset')).toBe('25')
  })

  it('starts a new filter at the first page, keeping the sort, and never spells a default', async () => {
    stubPages()
    const user = userEvent.setup()
    drawRoutes()
    await screen.findByLabelText('Select game 1')
    expect(screen.getByTestId('where')).toHaveTextContent(/^$/)

    await user.click(screen.getByRole('button', { name: 'Black' }))
    await user.click(screen.getByLabelText('Next page'))
    await screen.findByLabelText('Select game 26')

    await user.type(screen.getByLabelText('Search games'), 'berlin{Enter}')

    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('?q=berlin&order=black'),
    )
    await waitFor(() => expect(lastGamesQuery().get('offset')).toBe('0'))
    expect(lastGamesQuery().get('order')).toBe('black')
  })
})

describe('GamesPage — the keyboard, and the run it hands on', () => {
  it('focuses the search box on /', async () => {
    const user = userEvent.setup()
    draw()
    await loaded()

    const box = screen.getByLabelText('Search games')
    expect(document.activeElement).not.toBe(box)
    await user.keyboard('/')
    expect(document.activeElement).toBe(box)
    // And the slash does not land in the box along with the intention to type in it.
    expect(box).toHaveValue('')
  })

  it('leaves / alone while a modal is open over the table', async () => {
    const user = userEvent.setup()
    draw()
    await loaded()

    const modal = document.createElement('div')
    modal.setAttribute('role', 'dialog')
    modal.setAttribute('aria-modal', 'true')
    const swatch = document.createElement('button')
    modal.append(swatch)
    document.body.append(modal)
    swatch.focus()
    await user.keyboard('/')

    expect(document.activeElement).toBe(swatch)
    modal.remove()
  })

  it('leaves the search box on Esc, keeping what was typed', async () => {
    const user = userEvent.setup()
    draw()
    await loaded()

    const box = screen.getByLabelText('Search games')
    await user.keyboard('/')
    await user.keyboard('berlin')
    await user.keyboard('{Escape}')

    expect(document.activeElement).not.toBe(box)
    expect(box).toHaveValue('berlin')
  })

  it('hands the query it was showing to the game it opens', async () => {
    resetTrail()
    const user = userEvent.setup()
    draw()
    await loaded()

    await user.click(screen.getByRole('row', { name: /opponent-12/ }))

    // The query and where in it that row sat — not the page of ids — so the game screen's
    // [ and ] walk the whole filtered library rather than stopping at the end of a page.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useGameTrail(12), {
      wrapper: ({ children }) => <Providers client={client}>{children}</Providers>,
    })
    await waitFor(() => expect(result.current).toEqual({ previous: 11, next: 13 }))
  })

  it('hands over its own address, for the game screen’s Library crumb', async () => {
    resetTrail()
    const user = userEvent.setup()
    draw('/games?color=black&order=black&direction=desc')
    await loaded()

    await user.click(screen.getByRole('row', { name: /opponent-12/ }))

    const { result } = renderHook(() => useLibraryAddress(12))
    const back = new URL(result.current, 'http://localhost')
    expect(back.pathname).toBe('/games')
    expect(back.searchParams.get('color')).toBe('black')
    expect(back.searchParams.get('order')).toBe('black')
    expect(back.searchParams.get('direction')).toBe('desc')
  })
})

describe('GamesPage — collections', () => {
  const LEAGUE = {
    id: 7,
    name: '45-45 League',
    color: 'accent',
    description: 'Lichess 45+45 League, this season',
    rule: { source: 'lichess', time_control: '2700+45', rated: true },
    game_count: 8,
    created_at: '2026-08-01T00:00:00Z',
  }
  /** The library as before, plus one collection the filter can be set to. */
  function stubCollections() {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).split('?')[0]!
      if (path.endsWith('/api/collections')) return json(200, { collections: [LEAGUE] })
      if (path.endsWith('/api/collections/7/games/remove') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { game_ids: number[] }
        return json(200, { removed: body.game_ids.length, collection: LEAGUE })
      }
      if (path.endsWith('/api/games')) {
        return json(200, { games: GAMES, total: GAMES.length, limit: 50, offset: 0 })
      }
      return json(404, { error: 'not_found', detail: path })
    })
  }

  function lastGamesQuery(): URLSearchParams {
    const calls = vi.mocked(fetch).mock.calls.map(([input]) => String(input))
    const last = calls.filter((url) => url.split('?')[0]!.endsWith('/api/games')).at(-1)!
    return new URL(last, 'http://localhost').searchParams
  }

  it('is the library with one more filter, and the collection editable from the bar', async () => {
    stubCollections()
    draw('/games?collection=7&whose=all')
    await loaded()

    // The picker names it once the list is in.
    expect(await screen.findByRole('button', { name: /Collection: 45-45 League/ })).toBeInTheDocument()
    expect(lastGamesQuery().get('collection')).toBe('7')
    expect(lastGamesQuery().get('whose')).toBe('all')
    // The address a pinned rail row opens is that collection's place: the title says so, as
    // the rail does (`useLibraryPlace`), with Collections as the way back.
    const crumbs = within(screen.getByTestId('crumbs'))
    expect(crumbs.getByText('Collections')).toBeInTheDocument()
    expect(await crumbs.findByText('45-45 League')).toBeInTheDocument()
    const titlebar = screen.getByTestId('titlebar')
    expect(within(titlebar).getByRole('link', { name: 'Import games' })).toBeInTheDocument()
    expect(screen.queryByText(/Your games: score/)).not.toBeInTheDocument()
    expect(screen.queryByText('Lichess 45+45 League, this season')).not.toBeInTheDocument()

    // The collection is the place, so it is edited from here as from its card.
    await userEvent.click(within(titlebar).getByRole('button', { name: 'Edit collection…' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Name')).toHaveValue('45-45 League')
  })

  it('offers no Edit collection… while the list is anything but one collection', async () => {
    stubCollections()
    draw('/games?collection=7&whose=all&color=black')
    await loaded()
    await screen.findByRole('button', { name: /Collection: 45-45 League/ })
    expect(screen.queryByRole('button', { name: 'Edit collection…' })).not.toBeInTheDocument()
  })

  it('reads a collection over the owner’s own games unless the link says otherwise', async () => {
    stubCollections()
    draw('/games?collection=7')
    await loaded()

    expect(lastGamesQuery().get('collection')).toBe('7')
    expect(lastGamesQuery().get('whose')).toBeNull()
    const whose = screen.getByRole('radiogroup', { name: 'Whose games' })
    expect(within(whose).getByRole('radio', { name: 'Mine' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('clears the collection with every other filter', async () => {
    stubCollections()
    const user = userEvent.setup()
    draw('/games?collection=7&color=black')
    await loaded()

    await user.click(screen.getByRole('button', { name: 'Clear 2' }))

    await waitFor(() => expect(lastGamesQuery().get('color')).toBeNull())
    expect(lastGamesQuery().get('collection')).toBeNull()
  })

  it('keeps an explicit All when a collection is added and cleared again', async () => {
    stubCollections()
    const user = userEvent.setup()
    draw('/games?whose=all')
    await loaded()

    await user.click(screen.getByRole('button', { name: /^Collection/ }))
    await user.click(await screen.findByRole('button', { name: /45-45 League/ }))
    await waitFor(() => expect(lastGamesQuery().get('collection')).toBe('7'))
    expect(lastGamesQuery().get('whose')).toBe('all')

    await user.click(screen.getByRole('button', { name: 'Clear Collection filter' }))
    await waitFor(() => expect(lastGamesQuery().get('collection')).toBeNull())
    expect(lastGamesQuery().get('whose')).toBe('all')
  })

  it('takes a selection out of the collection the filter is set to', async () => {
    stubCollections()
    const user = userEvent.setup()
    draw('/games?collection=7&whose=all')
    await loaded()
    await screen.findByRole('button', { name: /Collection: 45-45 League/ })

    await user.click(screen.getByLabelText('Select game 11'))
    await user.click(screen.getByRole('button', { name: 'Remove from collection' }))

    expect(await screen.findByText('1 game taken out of 45-45 League')).toBeInTheDocument()
    expect(postedTo('/api/collections/7/games/remove')).toEqual([{ game_ids: [11] }])
  })

  it('offers Remove from collection only with a collection set', async () => {
    stubCollections()
    const user = userEvent.setup()
    draw()
    await loaded()

    await user.click(screen.getByLabelText('Select game 11'))
    expect(screen.getByRole('button', { name: 'Add to' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove from collection' })).not.toBeInTheDocument()
  })

  it('narrows the library to a collection from the filter bar', async () => {
    stubCollections()
    const user = userEvent.setup()
    draw()
    await loaded()

    await user.click(screen.getByRole('button', { name: /^Collection/ }))
    await user.click(await screen.findByRole('button', { name: /45-45 League/ }))

    await waitFor(() => expect(lastGamesQuery().get('collection')).toBe('7'))
    expect(screen.getByRole('button', { name: /Collection: 45-45 League/ })).toBeInTheDocument()
    // Picked alone, it writes the collection's own address, so the title names it.
    expect(within(screen.getByTestId('crumbs')).getByText('45-45 League')).toBeInTheDocument()
  })

  it('titles a filtered library "Games (filtered)"', async () => {
    stubCollections()
    draw('/games?color=black')
    await loaded()
    expect(within(screen.getByTestId('crumbs')).getByText('Games (filtered)')).toBeInTheDocument()
  })

  it('filters on rated or casual under Time control', async () => {
    stubCollections()
    const user = userEvent.setup()
    draw()
    await loaded()

    await user.click(screen.getByRole('button', { name: /^Time control/ }))
    await user.click(screen.getByRole('button', { name: 'casual' }))

    await waitFor(() => expect(lastGamesQuery().get('rated')).toBe('false'))
    expect(screen.getByRole('button', { name: /Time control: casual/ })).toBeInTheDocument()
  })

  it('offers to make a collection only from a filter a rule can hold', async () => {
    stubCollections()
    const user = userEvent.setup()
    draw('/games?since=2026-01-01')
    await loaded()
    expect(screen.queryByRole('button', { name: 'Make a collection…' })).not.toBeInTheDocument()

    // The picker, not the column header that sorts by the same word.
    await user.click(screen.getByRole('button', { name: /^Source$/, expanded: false }))
    await user.click(screen.getByRole('button', { name: 'Lichess' }))
    await user.click(await screen.findByRole('button', { name: 'Make a collection…' }))

    expect(await screen.findByRole('dialog', { name: 'New collection' })).toBeInTheDocument()
  })

  it('makes a new collection from the selected rows', async () => {
    stubCollections()
    const user = userEvent.setup()
    draw()
    await loaded()

    await user.click(screen.getByLabelText('Select game 11'))
    await user.click(screen.getByLabelText('Select game 12'))
    await user.click(screen.getByRole('button', { name: 'Add to' }))
    await user.click(await screen.findByRole('button', { name: /New collection from these 2 games/ }))

    expect(await screen.findByRole('dialog', { name: 'New collection' })).toBeInTheDocument()
    expect(screen.getByText('With the 2 games you picked.')).toBeInTheDocument()
  })
})
