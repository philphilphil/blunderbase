import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import { ChromeActions, ChromeCrumbs } from '@/test/chrome'

import { CollectionsPage } from './CollectionsPage'
import { COLLECTION_VIEW_KEY, resetCollectionView } from './viewMode'

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

const LEAGUE = {
  id: 7,
  name: '45-45 League',
  color: 'good',
  description: 'Lichess 45+45 League, this season',
  rule: { source: 'lichess', time_control: '2700+45', rated: true },
  game_count: 9,
  created_at: '2026-08-01T00:00:00Z',
  summary: {
    games: 8,
    wins: 4,
    draws: 3,
    losses: 1,
    points: 5.5,
    avg_opponent_rating: 1724,
    blunders_per_game: 0.625,
    first_played_at: '2026-08-06T19:00:00Z',
    last_played_at: '2026-09-24T19:00:00Z',
  },
}

/** Put in by hand, nothing analysed, no rated opponents: the numbers that are not there. */
const LOSSES = {
  id: 9,
  name: 'Tough losses',
  color: 'blunder',
  description: null,
  rule: null,
  game_count: 2,
  created_at: '2026-09-01T00:00:00Z',
  summary: {
    games: 2,
    wins: 0,
    draws: 0,
    losses: 2,
    points: 0,
    avg_opponent_rating: null,
    blunders_per_game: null,
    first_played_at: null,
    last_played_at: null,
  },
}

let listed: unknown[]

function stubFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const method = init?.method ?? 'GET'
    if (url.pathname === '/api/collections' && method === 'GET') {
      return json(200, { collections: listed })
    }
    if (url.pathname === '/api/collections/7' && method === 'DELETE') {
      listed = listed.filter((row) => (row as { id: number }).id !== 7)
      return new Response(null, { status: 204 })
    }
    if (url.pathname === '/api/games') {
      return json(200, { games: [], total: 0, limit: 1, offset: 0 })
    }
    return json(404, { error: 'not_found', detail: url.pathname })
  })
  vi.stubGlobal('fetch', fetchMock)
}

/** Where the router is, so a test can tell that a delete left the reader on this screen. */
function Where() {
  const location = useLocation()
  return <div data-testid="where">{location.pathname + location.search}</div>
}

function draw() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <Providers client={client}>
      <MemoryRouter initialEntries={['/collections']}>
        <CollectionsPage />
        <ChromeCrumbs />
        <ChromeActions />
        <Where />
      </MemoryRouter>
    </Providers>,
  )
}

beforeEach(() => {
  // The view is remembered per browser; every test starts on the grid.
  localStorage.clear()
  resetCollectionView()
  listed = [LEAGUE, LOSSES]
  vi.stubGlobal('WebSocket', FakeSocket)
  stubFetch()
})

afterEach(() => vi.unstubAllGlobals())

/** The card that carries a collection's name. */
async function card(name: string): Promise<HTMLElement> {
  const link = await screen.findByRole('link', { name })
  return link.closest('li')!
}

describe('CollectionsPage', () => {
  it('names itself in the titlebar and asks for every collection with its score', async () => {
    draw()
    await card('45-45 League')

    expect(within(screen.getByTestId('crumbs')).getByText('Collections')).toBeInTheDocument()
    expect(
      within(screen.getByTestId('titlebar')).getByRole('button', { name: 'New collection' }),
    ).toBeInTheDocument()
    const asked = vi
      .mocked(fetch)
      .mock.calls.map(([input]) => new URL(String(input), 'http://localhost'))
      .filter((url) => url.pathname === '/api/collections')
    expect(asked.at(-1)?.searchParams.get('with_summary')).toBe('true')
  })

  it('draws one card per collection: its count, description, score and rule', async () => {
    draw()
    const league = within(await card('45-45 League'))

    expect(league.getByText('9 games')).toBeInTheDocument()
    expect(league.getByText('Lichess 45+45 League, this season')).toBeInTheDocument()
    expect(league.getByText('5½ / 8')).toBeInTheDocument()
    expect(league.getByText('1724')).toBeInTheDocument()
    expect(league.getByText('0.63')).toBeInTheDocument()
    expect(league.getByText('45+45')).toBeInTheDocument()
    expect(league.getByText('rated')).toBeInTheDocument()
    expect(league.getByText(/adds new imports/)).toBeInTheDocument()
    expect(league.getByText(/Last played/)).toBeInTheDocument()
    // One game is in the count and not in the score, and the score says why on hover.
    const score = league.getByText('5½ / 8')
    expect(score).toHaveAttribute('title', expect.stringContaining('1 game in it is not scored'))
    // Above the name link's card-wide overlay, or the link's title is what shows on hover.
    expect(score).toHaveClass('relative', 'z-10')
    expect(league.getByTitle('4 won, 3 drawn, 1 lost')).toHaveClass('relative', 'z-10')
  })

  it('leaves a score with nothing to explain under the card link, so a click there opens it', async () => {
    draw()
    const losses = within(await card('Tough losses'))

    const score = losses.getByText('0 / 2')
    expect(score).not.toHaveAttribute('title')
    expect(score).not.toHaveClass('z-10')
  })

  it('gives every card the same slots, dashing a number that is not there', async () => {
    draw()
    const league = within(await card('45-45 League'))
    const losses = within(await card('Tough losses'))

    // The same four figures under the same names, so cards side by side line up.
    for (const each of [league, losses]) {
      for (const name of ['Your score', 'Results', 'Avg opponent', 'Blunders / game']) {
        expect(each.getByText(name)).toBeInTheDocument()
      }
    }
    // Nothing rated, nothing analysed: dashes in their places rather than gaps.
    expect(losses.getAllByText('—')).toHaveLength(2)
    // No rule is said, not left out; nothing played says so too.
    expect(losses.getByText('No rule · added by hand')).toBeInTheDocument()
    expect(losses.getByText('Nothing played yet')).toBeInTheDocument()
    expect(losses.queryByText(/adds new imports/)).not.toBeInTheDocument()
  })

  it('switches to a table and remembers it, the same figures in columns', async () => {
    const user = userEvent.setup()
    draw()
    await card('45-45 League')

    const views = screen.getByRole('radiogroup', { name: 'How to show the collections' })
    expect(within(views).getByRole('radio', { name: 'Grid' })).toBeChecked()
    await user.click(within(views).getByRole('radio', { name: 'Table' }))

    expect(within(views).getByRole('radio', { name: 'Table' })).toBeChecked()
    expect(localStorage.getItem(COLLECTION_VIEW_KEY)).toBe('table')
    const row = within(await card('45-45 League'))
    expect(row.getByText('5½ / 8')).toBeInTheDocument()
    expect(row.getByText('1724')).toBeInTheDocument()
    expect(row.getByText('Lichess 45+45 League, this season')).toBeInTheDocument()
    // The row is the link as the card is, and its actions are icons with names.
    expect(screen.getByRole('link', { name: '45-45 League' })).toHaveAttribute(
      'href',
      '/games?collection=7&whose=all',
    )
    expect(row.getByRole('button', { name: 'Edit 45-45 League' })).toBeInTheDocument()
    expect(row.getByRole('link', { name: 'Stats for 45-45 League' })).toHaveAttribute(
      'href',
      '/stats?collection=7',
    )
  })

  it('opens the library with the collection set, every game in it', async () => {
    draw()
    await card('45-45 League')

    expect(screen.getByRole('link', { name: '45-45 League' })).toHaveAttribute(
      'href',
      '/games?collection=7&whose=all',
    )
    expect(screen.getByRole('link', { name: 'Stats for 45-45 League' })).toHaveAttribute(
      'href',
      '/stats?collection=7',
    )
  })

  it('edits a collection in the dialog, and a delete from there stays on this screen', async () => {
    const user = userEvent.setup()
    draw()
    await card('45-45 League')

    await user.click(screen.getByRole('button', { name: 'Edit 45-45 League' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit 45-45 League' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete…' }))
    await user.click(within(dialog).getByRole('button', { name: 'Delete collection' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: '45-45 League' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('link', { name: 'Tough losses' })).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/collections')
  })

  it('opens a new collection from the titlebar', async () => {
    const user = userEvent.setup()
    draw()
    await card('45-45 League')

    await user.click(
      within(screen.getByTestId('titlebar')).getByRole('button', { name: 'New collection' }),
    )
    expect(await screen.findByRole('dialog', { name: 'New collection' })).toBeInTheDocument()
  })

  it('says what a collection is, and how to make one, when there are none', async () => {
    listed = []
    const user = userEvent.setup()
    draw()

    const empty = await screen.findByTestId('empty')
    expect(within(empty).getByText('No collections yet')).toBeInTheDocument()
    expect(within(empty).getByText(/A game can be in several/)).toBeInTheDocument()
    expect(within(empty).getByText(/Make a collection/)).toBeInTheDocument()
    expect(within(empty).getByText(/Add to…/)).toBeInTheDocument()

    await user.click(within(empty).getByRole('button', { name: 'New collection' }))
    expect(await screen.findByRole('dialog', { name: 'New collection' })).toBeInTheDocument()
  })

  it('says so when the list cannot be loaded, and offers to try again', async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      json(500, { error: 'internal', detail: 'the database is locked' }),
    )
    draw()

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
