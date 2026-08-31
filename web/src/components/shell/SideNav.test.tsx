import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { ConnectionStatus } from '@/lib/events/EventsProvider'
import { ThemeProvider } from '@/lib/ui/theme'

import { NavDrawer, SideNav } from './SideNav'

const { useEngines, useGames, useLiveState } = vi.hoisted(() => ({
  useEngines: vi.fn(),
  useGames: vi.fn(),
  useLiveState: vi.fn(),
}))
vi.mock('@/lib/api/queries', () => ({ useEngines, useGames, useLiveState }))

const { useEvents } = vi.hoisted(() => ({ useEvents: vi.fn() }))
vi.mock('@/lib/events/EventsProvider', () => ({ useEvents }))

const pending = { data: undefined, isPending: true }

/** Everything the rail asks the API for, answered with "still loading". */
function stub(status: ConnectionStatus, reconnects: number) {
  useEngines.mockReturnValue(pending)
  useGames.mockReturnValue(pending)
  useLiveState.mockReturnValue(pending)
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
  it('counts games with any engine analysis, whether quick or deep', () => {
    useEngines.mockReturnValue(pending)
    useLiveState.mockReturnValue(pending)
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

    expect(useGames).toHaveBeenCalledWith({ analyzed: true, limit: 1 })
    expect(screen.getByText('2 of 9,553 engine analyzed')).toBeInTheDocument()
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
    expect(screen.getByRole('link', { name: 'Engines' })).toHaveAttribute('href', '/engines')
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
