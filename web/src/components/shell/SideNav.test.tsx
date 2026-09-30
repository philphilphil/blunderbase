
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SERVER_CAPABILITIES } from '@/lib/api/types'
import type { ConnectionStatus } from '@/lib/events/EventsProvider'
import { pinnedCollectionHref } from '@/lib/libraryPlace'
import { RuntimeCapabilitiesProvider } from '@/lib/runtime/RuntimeCapabilitiesProvider'
import { ThemeProvider } from '@/lib/ui/theme'
import { paramsFromFilters } from '@/routes/games/filters'
import { resetSavedFilters, saveFilter } from '@/routes/games/savedFilters'

import { PageChromeProvider, SetPageChrome } from './PageChrome'
import { NavDrawer, SideNav } from './SideNav'

const {
  useCollections,
  useEngines,
  useGames,
  useLiveState,
  useAppSettings,
  useCorrespondenceGames,
  useCorrespondenceStatus,
} = vi.hoisted(() => ({
  useCollections: vi.fn(),
  useEngines: vi.fn(),
  useGames: vi.fn(),
  useLiveState: vi.fn(),
  useAppSettings: vi.fn(),
  useCorrespondenceGames: vi.fn(),
  useCorrespondenceStatus: vi.fn(),
}))
vi.mock('@/lib/api/queries', () => ({
  useCollections,
  useEngines,
  useGames,
  useLiveState,
  useAppSettings,
  useCorrespondenceGames,
  useCorrespondenceStatus,
}))

const { useEvents } = vi.hoisted(() => ({ useEvents: vi.fn() }))
vi.mock('@/lib/events/EventsProvider', () => ({ useEvents }))

// The Settings menu wants a session and a query client of its own and has tests of its own;
// here it is only one of the things the foot is made of.
vi.mock('./SettingsMenu', () => ({
  SettingsMenu: ({ variant = 'row' }: { variant?: string }) => (
    <button type="button" data-testid="settings" data-variant={variant}>
      Settings
    </button>
  ),
}))

const pending = { data: undefined, isPending: true }

/** What the rail stands in: a theme, and the page chrome the footer's manual link reads. */
function Shell({
  children,
  manual,
  demo = false,
}: {
  children: ReactNode
  manual?: string
  demo?: boolean
}) {
  const capabilities = demo ? { ...SERVER_CAPABILITIES, read_only: true } : SERVER_CAPABILITIES
  return (
    <ThemeProvider>
      <RuntimeCapabilitiesProvider capabilities={capabilities}>
        <PageChromeProvider>
          {manual ? <SetPageChrome manual={manual} /> : null}
          {children}
        </PageChromeProvider>
      </RuntimeCapabilitiesProvider>
    </ThemeProvider>
  )
}

const COLLECTIONS = [
  { id: 7, name: 'League 2026', color: 'good', game_count: 14, pinned: true },
  { id: 9, name: 'Club OTB', color: 'otb', game_count: 32, pinned: true },
  { id: 11, name: 'Blitz arena', color: 'info', game_count: 3, pinned: false },
]

/** Everything the rail asks the API for, answered with "still loading". */
function stub(status: ConnectionStatus, reconnects: number) {
  useCollections.mockReturnValue(pending)
  useEngines.mockReturnValue(pending)
  useGames.mockReturnValue(pending)
  useLiveState.mockReturnValue(pending)
  // Correspondence mode off, which is the default and what every test but its own wants.
  useAppSettings.mockReturnValue(pending)
  useCorrespondenceGames.mockReturnValue(pending)
  useCorrespondenceStatus.mockReturnValue(pending)
  useEvents.mockReturnValue({ status, reconnects })
}

function draw({
  status = 'open' as ConnectionStatus,
  reconnects = 0,
  path = '/',
  manual,
  demo,
  collections,
}: {
  status?: ConnectionStatus
  reconnects?: number
  path?: string
  manual?: string
  demo?: boolean
  collections?: typeof COLLECTIONS
} = {}) {
  stub(status, reconnects)
  if (collections) {
    useCollections.mockReturnValue({ data: { collections }, isPending: false })
  }
  return render(
    <Shell manual={manual} demo={demo}>
      <MemoryRouter initialEntries={[path]}>
        <SideNav />
      </MemoryRouter>
    </Shell>,
  )
}

/** The rail's current row: the one `aria-current="page"` link, which is the only lit one. */
function lit() {
  return screen
    .getByRole('navigation', { name: 'Sections' })
    .querySelectorAll('[aria-current="page"]')
}

afterEach(() => {
  // The fold is remembered; a test that ends folded must not fold the next one's rail.
  try {
    window.localStorage.removeItem('blunderbase.navCollapsed')
  } catch {
    // No storage in this jsdom: nothing was remembered either.
  }
})

describe('the rail’s frame', () => {
  it('starts with the brand, then search, and has no Workspace or Engines heading', () => {
    draw()
    const nav = screen.getByRole('navigation', { name: 'Sections' })
    expect(within(nav).getByRole('link', { name: 'Blunderbase' })).toHaveAttribute('href', '/')
    expect(within(nav).getByRole('button', { name: 'Search everything' })).toHaveTextContent(
      /Search everything⌘K/,
    )
    expect(screen.queryByText('Workspace')).not.toBeInTheDocument()
    expect(screen.queryByText('Engines')).not.toBeInTheDocument()
    // One heading, over the second group, in sentence case.
    expect(screen.getByText('Data & compute')).toHaveClass('text-label', 'font-semibold')
  })

  it('names each numbered page’s shortcut in its row', () => {
    draw()
    expect(screen.getByRole('link', { name: 'Games' })).toHaveAttribute('title', 'Games ⌘2')
    expect(screen.getByRole('link', { name: 'Collections' })).toHaveAttribute(
      'title',
      'Collections ⌘6',
    )
    expect(screen.getByRole('link', { name: 'Live' })).not.toHaveAttribute('title')
  })

  it('says it is the demo, flat, pointing home, with read-only in its title', () => {
    draw({ demo: true })
    const tint = screen.getByRole('link', { name: /demo/i })
    expect(tint).toHaveAttribute('href', 'https://blunderbase.org')
    expect(tint).toHaveAttribute('title', expect.stringMatching(/read-only/))
    expect(tint).not.toHaveClass('border')
  })

  it('carries no demo tint on an installation of one’s own', () => {
    draw()
    expect(screen.queryByRole('link', { name: /demo/i })).not.toBeInTheDocument()
  })
})

describe('the rail footer', () => {
  it('asks nothing of the games endpoint for a coverage bar it no longer draws', () => {
    stub('open', 0)
    useGames.mockImplementation((query) => ({
      data: { total: query.analyzed ? 2 : 9_553 },
      isPending: false,
    }))

    render(
      <Shell>
        <MemoryRouter>
          <SideNav />
        </MemoryRouter>
      </Shell>,
    )

    // The footer's "engine coverage" bar is gone: `/analysis/coverage` answers the same
    // question properly, and the bar cost a second `useGames` on every screen in the app to
    // say it badly. The Games row's own count is the one query that remains.
    expect(useGames).not.toHaveBeenCalledWith({ analyzed: true, limit: 1 })
    expect(screen.queryByText(/engine analyzed/)).not.toBeInTheDocument()
    expect(screen.queryByText('Engine coverage')).not.toBeInTheDocument()
  })

  it('folds the rail to icons and back, and remembers which', async () => {
    const user = userEvent.setup()
    draw()

    expect(screen.getByRole('link', { name: 'Games' })).toHaveTextContent('Games')

    await user.click(screen.getByRole('button', { name: 'Collapse the navigation' }))

    // Folded, a destination is its icon and its accessible name — never nothing.
    const games = screen.getByRole('link', { name: 'Games' })
    expect(games).toHaveTextContent('')
    expect(games).toHaveAttribute('title', 'Games ⌘2')
    // The heading and the words go; the engine line and Settings stay, as icons.
    expect(screen.queryByText('Data & compute')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Compute › Engines/ })).toHaveTextContent('')
    expect(screen.getByTestId('settings')).toHaveAttribute('data-variant', 'icon')

    // The way back out is the brand row's, where the fold control was.
    const expand = screen.getByRole('button', { name: 'Expand the navigation' })
    expect(expand.closest('.border-edge-strong')).not.toBeNull()
    await user.click(expand)

    expect(screen.getByRole('link', { name: 'Games' })).toHaveTextContent('Games')
    expect(screen.getByText('Data & compute')).toBeInTheDocument()
  })

  it('keeps the fold control at the end of the brand row, not in the foot', () => {
    draw()
    const fold = screen.getByRole('button', { name: 'Collapse the navigation' })
    const brand = screen.getByRole('link', { name: 'Blunderbase' })
    expect(fold.parentElement).toBe(brand.parentElement)
  })

  it('is two rows: the engine line, and Settings with the connection dot', () => {
    draw({ status: 'connecting', reconnects: 0 })

    // The theme went to the Settings menu; the rail carries no theme control of its own.
    expect(screen.queryByRole('group', { name: 'Theme' })).not.toBeInTheDocument()
    // The queue is the titlebar's again: the foot had no room for it.
    expect(screen.queryByText(/^Idle/)).not.toBeInTheDocument()
    const settings = screen.getByTestId('settings')
    expect(settings).toHaveAttribute('data-variant', 'row')
    // The live signal is always there, beside Settings.
    const dot = screen.getByLabelText('connecting to /events')
    expect(dot).toHaveClass('bg-mistake')
    expect(dot.parentElement).toBe(settings.parentElement)
    // The manual, the source and the version went into Settings.
    expect(screen.queryByRole('link', { name: /github/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /manual/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/^v\d/)).not.toBeInTheDocument()
  })

  it('draws a live connection green, never in the accent', () => {
    draw({ status: 'open' })
    expect(screen.getByLabelText('live')).toHaveClass('bg-good')
  })
})

describe('the engines line', () => {
  it('names the engines and leads to Compute › Engines, never lit', () => {
    stub('open', 0)
    useEngines.mockReturnValue({
      data: [
        { id: 1, name: 'Stockfish 17', enabled: true },
        { id: 2, name: 'Maia', enabled: true },
        { id: 3, name: 'Old', enabled: false },
      ],
      isPending: false,
    })
    render(
      <Shell>
        <MemoryRouter initialEntries={['/compute/engines']}>
          <SideNav />
        </MemoryRouter>
      </Shell>,
    )

    // One line per engine, a disabled one included and marked so, each the way in.
    const lines = ['Stockfish 17', 'Maia', 'Old'].map((name) =>
      screen.getByRole('link', { name }),
    )
    for (const line of lines) {
      expect(line).toHaveAttribute('href', '/compute/engines')
      expect(line).not.toHaveAttribute('aria-current')
    }
    expect(lines[0]).toHaveTextContent(/^Stockfish 17$/)
    expect(lines[2]).toHaveAttribute('title', 'Old, disabled — Compute › Engines')
    expect(lines[0]!.compareDocumentPosition(lines[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // On the Engines page it is the Engines row under Compute that is lit, not the line.
    expect(lit()).toHaveLength(1)
    expect(lit()[0]).toHaveTextContent('Engines')
  })

  it('says so when there are none, and where to set one up', () => {
    stub('open', 0)
    useEngines.mockReturnValue({ data: [], isPending: false })
    render(
      <Shell>
        <MemoryRouter>
          <SideNav />
        </MemoryRouter>
      </Shell>,
    )
    expect(screen.getByRole('link', { name: /No engines/ })).toHaveAttribute(
      'title',
      'Compute › Engines: set one up',
    )
  })
})

describe('one lit row', () => {
  it('lights the leaf and leaves its parent plain', () => {
    draw({ path: '/library/import' })
    expect(lit()).toHaveLength(1)
    expect(lit()[0]).toHaveTextContent('Import')
    expect(lit()[0]).toHaveClass('bg-nav-current', 'text-accent-teal')
    const library = screen.getByRole('link', { name: 'Library' })
    expect(library).toHaveClass('text-ink')
    expect(library).not.toHaveClass('bg-nav-current')
  })

  it('lights a top-level page itself, and never with the selection blue', () => {
    draw({ path: '/notes' })
    expect(lit()).toHaveLength(1)
    expect(lit()[0]).toHaveTextContent('Notes')
    const rail = screen.getByRole('navigation', { name: 'Sections' })
    // (A bare class: a button's `aria-pressed:bg-selected` variant is its own pressed state.)
    expect(rail.innerHTML).not.toMatch(/[\s"]bg-selected[\s"]/)
    // Hover changes the text alone: a hover fill was a second lit row.
    expect(screen.getByRole('link', { name: 'Stats' }).className).not.toMatch(/hover:bg-/)
  })

  it('lights the report under Stats, and Stats itself once folded to icons', async () => {
    const user = userEvent.setup()
    draw({ path: '/stats?report=clock' })
    expect(lit()).toHaveLength(1)
    expect(lit()[0]).toHaveTextContent('Clock behaviour')

    await user.click(screen.getByRole('button', { name: 'Collapse the navigation' }))
    expect(lit()).toHaveLength(1)
    expect(lit()[0]).toHaveAccessibleName('Stats')
  })
})

describe('the analysis navigation', () => {
  it('folds its pages away everywhere else', () => {
    draw({ path: '/games' })

    expect(screen.queryByRole('link', { name: 'Engine passes' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Maia' })).not.toBeInTheDocument()
  })

  it('unfolds them on the analysis overview', () => {
    draw({ path: '/analysis' })

    expect(screen.getByRole('link', { name: 'Engine passes' })).toHaveAttribute(
      'href',
      '/analysis/engine',
    )
    expect(screen.getByRole('link', { name: 'Maia' })).toHaveAttribute('href', '/analysis/maia')
  })

  it('keeps them open on one of its own pages', () => {
    draw({ path: '/analysis/maia' })

    expect(screen.getByRole('link', { name: 'Engine passes' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Maia' })).toBeInTheDocument()
  })
})

describe('the correspondence entry', () => {
  /** The mode as the settings report it, with the games the list would answer with. */
  function withMode(enabled: number | null, yourMove = 0) {
    stub('open', 0)
    useAppSettings.mockReturnValue({
      data: { correspondence_enabled: enabled },
      isPending: false,
    })
    useCorrespondenceGames.mockReturnValue({
      data: { games: [], counts: { ongoing: 3, finished: 1, your_move: yourMove } },
      isPending: false,
    })
    render(
      <Shell>
        <MemoryRouter>
          <SideNav />
        </MemoryRouter>
      </Shell>,
    )
  }

  it('is not in the rail at all while the mode is off', () => {
    withMode(0)
    expect(screen.queryByRole('link', { name: /Correspondence/ })).not.toBeInTheDocument()
  })

  it('is not there for a deployment that has never set the switch', () => {
    // Null is "nobody has set this", and the default is off — the rail must read that as
    // off rather than as "unknown, show it anyway".
    withMode(null)
    expect(screen.queryByRole('link', { name: /Correspondence/ })).not.toBeInTheDocument()
  })

  it('appears after Live once the mode is on', () => {
    withMode(1)
    const entry = screen.getByRole('link', { name: /Correspondence/ })
    expect(entry).toHaveAttribute('href', '/correspondence')
    const rail = screen.getByRole('navigation', { name: 'Sections' })
    const rows = within(rail).getAllByRole('link')
    expect(rows.indexOf(entry)).toBe(rows.findIndex((row) => row.textContent === 'Live') + 1)
  })

  it('carries the count of games waiting on you, and nothing when none are', () => {
    withMode(1, 2)
    expect(screen.getByRole('link', { name: /Correspondence/ })).toHaveTextContent('2')
    cleanup()
    withMode(1, 0)
    expect(screen.getByRole('link', { name: /Correspondence/ })).toHaveTextContent(
      /^Correspondence$/,
    )
  })

  it('asks for no correspondence games while the mode is off', () => {
    withMode(0)
    expect(useCorrespondenceGames).toHaveBeenCalledWith(undefined, { enabled: false })
  })

  /** The mode on, with what `GET /correspondence/status` is answering right now. */
  function withStatus(data: Record<string, unknown>) {
    stub('open', 0)
    useAppSettings.mockReturnValue({ data: { correspondence_enabled: 1 }, isPending: false })
    useCorrespondenceGames.mockReturnValue({
      data: { games: [], counts: { ongoing: 1, finished: 0, your_move: 0 } },
      isPending: false,
    })
    useCorrespondenceStatus.mockReturnValue({ data, isPending: false })
    render(
      <Shell>
        <MemoryRouter>
          <SideNav />
        </MemoryRouter>
      </Shell>,
    )
  }

  it('adds one line for the searches in use under the engines, the rest in its tooltip', () => {
    const base = { slots: 2, in_use: 1, queued: 0, paused: 3, hosts: [], engines: [] }
    withStatus({
      ...base,
      parked: [],
      hosts: [{ host: 'Firefox on macOS', runner_id: 4, in_use: 0, slots: 1 }],
    })
    const line = screen.getByText('1/2').parentElement!
    expect(line).toHaveTextContent('Correspondence1/2')
    // One line, not a strip naming the hosts again: they are in its tooltip.
    expect(screen.queryByText('Firefox on macOS')).not.toBeInTheDocument()
    expect(line).toHaveAttribute('title', expect.stringContaining('Firefox on macOS: 0 / 1'))
  })

  it('counts the warm processes, and not the cold paused rows', () => {
    // A restart leaves every paused search cold: the rows are still paused and no process
    // exists, so `parked, warm` — a claim about this machine's memory — has to read the
    // parked list rather than the count of paused rows.
    const base = { slots: 2, in_use: 1, queued: 0, paused: 3, hosts: [], engines: [] }
    withStatus({ ...base, parked: [] })
    expect(screen.getByText('1/2').parentElement).not.toHaveAttribute('title', expect.stringContaining('parked'))
    cleanup()

    withStatus({
      ...base,
      parked: [{ search_id: 8, node_id: 4, engine_id: 1, engine_name: 'SF', hash_mb: 4096 }],
    })
    expect(screen.getByText('1/2').parentElement).toHaveAttribute(
      'title',
      expect.stringContaining('parked, warm: 1'),
    )
  })
})

describe('the library navigation', () => {
  it('keeps import and management folded away outside the Library', () => {
    draw({ path: '/games' })

    expect(screen.queryByRole('link', { name: 'Import' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Manage' })).not.toBeInTheDocument()
  })

  it('opens import and management as Library subpages', () => {
    draw({ path: '/library/import' })

    expect(screen.getByRole('link', { name: 'Library' })).toHaveAttribute('href', '/library')
    expect(screen.getByRole('link', { name: 'Import' })).toHaveAttribute(
      'href',
      '/library/import',
    )
    expect(screen.getByRole('link', { name: 'Manage' })).toHaveAttribute(
      'href',
      '/library/manage',
    )
  })
})

describe('collections', () => {
  it('is a rail entry of its own, directly after Games', () => {
    // Off the library, so the saved filters are folded away and the entries are adjacent.
    draw({ path: '/' })

    const nav = screen.getByRole('navigation', { name: 'Sections' })
    const names = within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent?.trim())
    expect(names.indexOf('Collections')).toBe(names.findIndex((name) => name?.startsWith('Games')) + 1)
    expect(within(nav).getByRole('link', { name: 'Collections' })).toHaveAttribute(
      'href',
      '/collections',
    )
  })

  it('folds nothing under Games but the saved filters', () => {
    draw({ path: '/games?collection=7' })

    expect(screen.getByText('Filters')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New collection' })).not.toBeInTheDocument()
  })

  it('keeps a saved filter lit however the library is sorted or paged', () => {
    const cut = paramsFromFilters({ has_blunders: true }).toString()
    draw({ path: `/games?${cut}&order=black&direction=desc&page=3` })

    // Sort and page are how the cut is being read, not which games it is.
    const link = screen.getByRole('link', { name: /Blunders/ })
    expect(link).toHaveAttribute('aria-current', 'page')
    expect(link).toHaveClass('bg-nav-current')
    // The cut is the leaf; Games is its plain parent.
    expect(lit()).toHaveLength(1)
    expect(screen.getByRole('link', { name: /^Games/ })).toHaveClass('text-ink')
    // And following another cut keeps that order rather than falling back to newest first;
    // the page does not come along, as a new cut starts at its first.
    const other = screen.getByRole('link', { name: /Losses/ })
    const href = new URL(other.getAttribute('href')!, 'http://localhost')
    expect(href.searchParams.get('order')).toBe('black')
    expect(href.searchParams.get('direction')).toBe('desc')
    expect(href.searchParams.has('page')).toBe(false)
    expect(other).not.toHaveAttribute('aria-current')
  })

  it('keeps a fold to four rows, More (n) to Games among them, never hiding the lit one', () => {
    resetSavedFilters()
    saveFilter('Wins', { outcome: 'win' })
    saveFilter('Draws', { outcome: 'draw' })
    saveFilter('As white', { color: 'white' })
    try {
      draw({ path: '/games' })
      const fold = screen.getByText('Filters').parentElement!
      const rows = within(fold).getAllByRole('link')
      expect(rows).toHaveLength(4)
      expect(rows[3]).toHaveTextContent('More (2)')
      expect(rows[3]).toHaveAttribute('href', '/games')
      expect(within(fold).queryByRole('link', { name: /As white/ })).not.toBeInTheDocument()
      cleanup()

      // The fifth lit: it takes the last place before More, and the fold does not grow.
      draw({ path: `/games?${paramsFromFilters({ color: 'white' }).toString()}` })
      const lit = screen.getByText('Filters').parentElement!
      expect(within(lit).getAllByRole('link')).toHaveLength(4)
      expect(screen.getByRole('link', { name: /As white/ })).toHaveAttribute('aria-current', 'page')
      expect(screen.getByRole('link', { name: /More \(2\)/ })).toBeInTheDocument()
    } finally {
      resetSavedFilters()
    }
  })
})

describe('pinned collections', () => {
  it('pins the ones marked for the rail under Collections, as swatches with their counts', () => {
    draw({ collections: COLLECTIONS })
    const pinned = screen.getByRole('group', { name: 'Pinned collections' })
    const rows = within(pinned).getAllByRole('link')
    expect(rows.map((row) => row.textContent)).toEqual(['League 202614', 'Club OTB32'])
    expect(rows[0]).toHaveAttribute('href', pinnedCollectionHref(7))
    expect(rows[0]!.querySelector('.rounded-\\[0\\.125rem\\]')).toHaveClass('bg-good')
    // Always there, so no fold rule down its side.
    expect(pinned).toHaveClass('border-transparent')
  })

  it('pins nothing without collections, or with none marked', () => {
    draw({ collections: [] })
    expect(screen.queryByRole('group', { name: 'Pinned collections' })).not.toBeInTheDocument()
    cleanup()

    draw({ collections: COLLECTIONS.map((collection) => ({ ...collection, pinned: false })) })
    expect(screen.queryByRole('group', { name: 'Pinned collections' })).not.toBeInTheDocument()
  })

  it('pins as many as are marked, whatever their place in the list', () => {
    draw({ collections: COLLECTIONS.map((collection) => ({ ...collection, pinned: true })) })
    const rows = within(screen.getByRole('group', { name: 'Pinned collections' })).getAllByRole(
      'link',
    )
    expect(rows).toHaveLength(3)
    cleanup()

    draw({
      collections: COLLECTIONS.map((collection) => ({ ...collection, pinned: collection.id === 11 })),
    })
    expect(
      within(screen.getByRole('group', { name: 'Pinned collections' }))
        .getAllByRole('link')
        .map((row) => row.textContent),
    ).toEqual(['Blitz arena3'])
  })

  it('lights the pinned row while Games shows that collection, not Games', () => {
    draw({ path: '/games?collection=9&whose=all&order=white', collections: COLLECTIONS })
    expect(lit()).toHaveLength(1)
    expect(lit()[0]).toHaveTextContent('Club OTB')
    expect(screen.getByRole('link', { name: /^Collections/ })).toHaveClass('text-ink')
    const games = screen.getByRole('link', { name: /^Games/ })
    expect(games).toHaveClass('text-soft')
    // Games' Filters fold stays shut: the collection is where you are.
    expect(screen.queryByText('Filters')).not.toBeInTheDocument()
  })

  it('lights Collections itself for a collection that is not pinned', () => {
    draw({ path: '/games?collection=11&whose=all', collections: COLLECTIONS })
    expect(lit()).toHaveLength(1)
    expect(lit()[0]).toHaveAccessibleName('Collections')
  })

  it('leaves Games lit for a collection narrowed any further', () => {
    draw({ path: '/games?collection=9&whose=all&outcome=loss', collections: COLLECTIONS })
    expect(lit()).toHaveLength(1)
    expect(lit()[0]).toHaveTextContent(/^Games/)
    expect(screen.getByText('Filters')).toBeInTheDocument()
  })
})

describe('the fit at 1440×900', () => {
  /**
   * The rail's parts at their rendered heights at the 120 % root (design px × 1.2, from the
   * prototype's measurements): a row 42, a fold row 33, a fold label 22, the heading 34,
   * search 44, brand 50, the foot 105. jsdom lays nothing out, so the sum is taken over the
   * rows the rail actually renders for the worst case the spec names: the Explorer fold
   * open (four lines), five saved filters and two pinned collections.
   */
  function railHeight(nav: HTMLElement): number {
    const middle = within(nav).getByTestId('rail-middle')
    let height = 50 + 44 + 105
    for (const link of within(middle).getAllByRole('link')) {
      height += link.closest('.ml-3') ? 33 : 42
    }
    height += middle.querySelectorAll('.text-meta.text-dim-2').length * 22
    height += 34
    return height
  }

  it('fits the worst case without scrolling while correspondence is off', () => {
    resetSavedFilters()
    for (const [label, outcome] of [
      ['Wins', 'win'],
      ['Draws', 'draw'],
      ['Losses', 'loss'],
    ] as const) {
      saveFilter(label, { outcome })
    }
    try {
      stub('open', 0)
      useCollections.mockReturnValue({ data: { collections: COLLECTIONS }, isPending: false })
      useGames.mockReturnValue({
        data: {
          total: 3000,
          games: ['B01', 'D00', 'C21', 'B00', 'A00'].flatMap((eco) =>
            Array.from({ length: 3 }, () => ({ eco, opening: eco, outcome: 'win' })),
          ),
        },
        isPending: false,
      })
      render(
        <Shell>
          <MemoryRouter initialEntries={['/explorer']}>
            <SideNav />
          </MemoryRouter>
        </Shell>,
      )
      const nav = screen.getByRole('navigation', { name: 'Sections' })
      const lines = screen.getByText(/^Your lines/).parentElement!
      expect(within(lines).getAllByRole('link')).toHaveLength(4)
      expect(within(nav).getAllByRole('link', { name: /League|Club/ })).toHaveLength(2)
      expect(railHeight(nav)).toBeLessThanOrEqual(900)
    } finally {
      resetSavedFilters()
    }
  })

  it('lets only the middle scroll, between a fixed brand row and foot', () => {
    draw()
    const middle = screen.getByTestId('rail-middle')
    expect(middle).toHaveClass('overflow-y-auto', 'flex-1', 'min-h-0')
    expect(middle.previousElementSibling).toHaveClass('flex-none')
    expect(middle.nextElementSibling).toHaveClass('flex-none')
  })

  it("keeps a Stats page's collection when the rail switches report", () => {
    draw({ path: '/stats?collection=7&report=clock' })

    expect(screen.getByRole('link', { name: 'Blunder taxonomy' })).toHaveAttribute(
      'href',
      '/stats?report=blunders&collection=7',
    )
  })
})

/** The same nav in the shape it takes below `md`, and the `onClose` it is handed. */
function drawDrawer({ open = true, path = '/' }: { open?: boolean; path?: string } = {}) {
  stub('open', 0)
  const onClose = vi.fn()
  render(
    <Shell>
      <MemoryRouter initialEntries={[path]}>
        <NavDrawer open={open} onClose={onClose} />
      </MemoryRouter>
    </Shell>,
  )
  return onClose
}

describe('the phone drawer', () => {
  it('is not in the tree at all while it is closed', () => {
    drawDrawer({ open: false })

    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument()
  })

  it('carries the same list as the rail once it is open', () => {
    drawDrawer()

    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'Games' })).toHaveAttribute('href', '/games')
    expect(screen.getByRole('link', { name: 'Compute' })).toHaveAttribute('href', '/compute')
    expect(screen.getByRole('link', { name: 'Library' })).toHaveAttribute('href', '/library')
  })

  it('keeps the rail’s order, Settings in its foot, and no fold or theme control', () => {
    drawDrawer()

    const nav = screen.getByRole('navigation', { name: 'Sections' })
    const brand = within(nav).getByRole('link', { name: 'Blunderbase' })
    const search = within(nav).getByRole('button', { name: 'Search everything' })
    const settings = within(nav).getByTestId('settings')
    expect(brand.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(search.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(settings).toHaveAttribute('data-variant', 'row')
    // A control that does nothing is never drawn: the drawer does not fold.
    expect(screen.queryByRole('button', { name: /Collapse the navigation/ })).not.toBeInTheDocument()
    // Appearance is the Settings menu's, here as on a desktop.
    expect(screen.queryByRole('group', { name: 'Theme' })).not.toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: 'Appearance' })).not.toBeInTheDocument()
  })

  it('unfolds the section it is opened in, the way the rail does', () => {
    drawDrawer({ path: '/analysis' })

    expect(screen.getByRole('link', { name: 'Engine passes' })).toBeInTheDocument()
  })

  it('closes on the backdrop', async () => {
    const onClose = drawDrawer()

    await userEvent.click(screen.getByTestId('nav-backdrop'))

    expect(onClose).toHaveBeenCalled()
  })

  it('closes on its own button', async () => {
    const onClose = drawDrawer()

    await userEvent.click(screen.getByRole('button', { name: 'Close the navigation' }))

    expect(onClose).toHaveBeenCalled()
  })

  it('closes on Escape', async () => {
    const onClose = drawDrawer()

    await userEvent.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalled()
  })

  it('closes when a link in it is followed', async () => {
    const onClose = drawDrawer()

    await userEvent.click(screen.getByRole('link', { name: 'Games' }))

    expect(onClose).toHaveBeenCalled()
  })
})
