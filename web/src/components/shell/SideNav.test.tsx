import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { ConnectionStatus } from '@/lib/events/EventsProvider'
import { ThemeProvider } from '@/lib/ui/theme'

import { NavDrawer, SideNav } from './SideNav'

const {
  useEngines,
  useGames,
  useLiveState,
  useAppSettings,
  useCorrespondenceGames,
  useCorrespondenceStatus,
} = vi.hoisted(() => ({
  useEngines: vi.fn(),
  useGames: vi.fn(),
  useLiveState: vi.fn(),
  useAppSettings: vi.fn(),
  useCorrespondenceGames: vi.fn(),
  useCorrespondenceStatus: vi.fn(),
}))
vi.mock('@/lib/api/queries', () => ({
  useEngines,
  useGames,
  useLiveState,
  useAppSettings,
  useCorrespondenceGames,
  useCorrespondenceStatus,
}))

const { useEvents } = vi.hoisted(() => ({ useEvents: vi.fn() }))
vi.mock('@/lib/events/EventsProvider', () => ({ useEvents }))

const pending = { data: undefined, isPending: true }

/** Everything the rail asks the API for, answered with "still loading". */
function stub(status: ConnectionStatus, reconnects: number) {
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
}: {
  status?: ConnectionStatus
  reconnects?: number
  path?: string
} = {}) {
  stub(status, reconnects)
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <SideNav />
      </MemoryRouter>
    </ThemeProvider>,
  )
}

describe('the rail footer', () => {
  it('asks nothing of the games endpoint for a coverage bar it no longer draws', () => {
    useEngines.mockReturnValue(pending)
    useLiveState.mockReturnValue(pending)
    useAppSettings.mockReturnValue(pending)
    useCorrespondenceGames.mockReturnValue(pending)
    useCorrespondenceStatus.mockReturnValue(pending)
    useEvents.mockReturnValue({ status: 'open', reconnects: 0 })
    useGames.mockImplementation((query) => ({
      data: { total: query.analyzed ? 2 : 9_553 },
      isPending: false,
    }))

    render(
      <ThemeProvider>
        <MemoryRouter>
          <SideNav />
        </MemoryRouter>
      </ThemeProvider>,
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
    expect(games).toHaveAttribute('title', 'Games')
    // The group headings and the open entry's second level go with the words.
    expect(screen.queryByText('Workspace')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Expand the navigation' }))

    expect(screen.getByRole('link', { name: 'Games' })).toHaveTextContent('Games')
    expect(screen.getByText('Workspace')).toBeInTheDocument()
  })

  it('prints the version Vite baked in from package.json', () => {
    // Read off disk rather than restated, so a bump that misses `define` fails here.
    const { version } = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
    ) as { version: string }

    draw()

    expect(screen.getByText(`v${version}`)).toBeInTheDocument()
  })

  it('carries the theme control, the source link and the connection dot', () => {
    draw({ status: 'connecting', reconnects: 0 })

    expect(screen.getByRole('group', { name: 'Theme' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /github/i })).toHaveAttribute(
      'href',
      'https://github.com/philphilphil/blunderbase',
    )
    expect(screen.getByRole('link', { name: /github/i })).toHaveAttribute('target', '_blank')
    expect(screen.getByLabelText('connecting to /events')).toBeInTheDocument()
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
      <ThemeProvider>
        <MemoryRouter>
          <SideNav />
        </MemoryRouter>
      </ThemeProvider>,
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
      <ThemeProvider>
        <MemoryRouter>
          <SideNav />
        </MemoryRouter>
      </ThemeProvider>,
    )
  }

  it('counts the warm processes along the foot, and not the cold paused rows', () => {
    // A restart leaves every paused search cold: the rows are still paused and no process
    // exists, so `parked, warm` — a claim about this machine's memory — has to read the
    // parked list rather than the count of paused rows.
    const base = { slots: 2, in_use: 1, queued: 0, paused: 3, hosts: [], engines: [] }
    withStatus({ ...base, parked: [] })
    expect(screen.queryByText('parked, warm')).not.toBeInTheDocument()
    cleanup()

    withStatus({
      ...base,
      parked: [{ search_id: 8, node_id: 4, engine_id: 1, engine_name: 'SF', hash_mb: 4096 }],
    })
    expect(screen.getByText('parked, warm')).toBeInTheDocument()
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

/** The same nav in the shape it takes below `md`, and the `onClose` it is handed. */
function drawDrawer({ open = true, path = '/' }: { open?: boolean; path?: string } = {}) {
  stub('open', 0)
  const onClose = vi.fn()
  render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <NavDrawer open={open} onClose={onClose} />
      </MemoryRouter>
    </ThemeProvider>,
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
