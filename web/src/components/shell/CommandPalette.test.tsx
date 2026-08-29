import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import { resetSavedFilters } from '@/routes/games/savedFilters'

import { CommandPaletteProvider } from './CommandPalette'
import { PageChromeProvider } from './PageChrome'
import { TopBar } from './TopBar'

const { useSearch, useProfile, useLogout, useChangePassword, useQueueStatus } = vi.hoisted(() => ({
  useSearch: vi.fn(),
  useProfile: vi.fn(),
  useLogout: vi.fn(),
  useChangePassword: vi.fn(),
  useQueueStatus: vi.fn(),
}))
vi.mock('@/lib/api/queries', () => ({
  useSearch,
  useProfile,
  useLogout,
  useChangePassword,
  useQueueStatus,
}))

/** Prints where the router is, so "Enter navigates" is an assertion and not a guess. */
function Where() {
  const location = useLocation()
  return <span data-testid="where">{`${location.pathname}${location.search}`}</span>
}

interface Answer {
  games: unknown[]
  opponents: unknown[]
  openings: unknown[]
  notes: unknown[]
}

const EMPTY: Answer = { games: [], opponents: [], openings: [], notes: [] }

/** The palette as it is really mounted: around the titlebar that raises it. */
function draw(data: Answer = EMPTY) {
  useSearch.mockReturnValue({ data, isFetching: false })
  useProfile.mockReturnValue({ data: undefined, isPending: true })
  useQueueStatus.mockReturnValue({ data: undefined, isPending: true })
  useLogout.mockReturnValue({ mutate: vi.fn(), isPending: false })
  useChangePassword.mockReturnValue({ mutate: vi.fn(), isPending: false })
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={['/games']}>
        <PageChromeProvider>
          <CommandPaletteProvider>
            <Where />
            <TopBar onOpenNav={vi.fn()} />
          </CommandPaletteProvider>
        </PageChromeProvider>
      </MemoryRouter>
    </TooltipProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  // The saved-filter store caches its first read; this jsdom has no storage behind it, so
  // what the palette sees is the three built-ins and nothing else.
  resetSavedFilters()
})

describe('the ⌘K palette', () => {
  it('opens on the shortcut and rests on the workspace routes', async () => {
    const user = userEvent.setup()
    draw()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.keyboard('{Meta>}k{/Meta}')

    expect(screen.getByRole('dialog', { name: 'Search everything' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Dashboard/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Games/ })).toBeInTheDocument()
    // Nothing typed: the pages are the whole list, and no saved cut or report is on it.
    expect(screen.queryByRole('option', { name: /Blunders/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Blunder taxonomy/ })).not.toBeInTheDocument()
  })

  it('opens from the titlebar chip too, and closes on escape', async () => {
    const user = userEvent.setup()
    draw()

    await user.click(screen.getByRole('button', { name: 'Search everything' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('narrows the pages to what was typed, saved filters included', async () => {
    const user = userEvent.setup()
    draw()

    await user.keyboard('{Meta>}k{/Meta}')
    await user.keyboard('blunder')

    // The built-in saved cut and the stats report both answer to the same word. There is
    // no separate page entry for the cut: the saved filter *is* how the palette offers it.
    expect(screen.getByRole('option', { name: /Blunders/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Blunder taxonomy/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Dashboard/ })).not.toBeInTheDocument()
  })

  it('moves the highlight over every group and opens the row on enter', async () => {
    const user = userEvent.setup()
    draw({
      ...EMPTY,
      games: [
        {
          id: 42,
          source: 'lichess' as const,
          white: 'kn1ghtmare',
          black: 'Dr_Nykterstein',
          result: '0-1',
          outcome: 'loss',
          played_at: '2026-02-03T10:00:00',
          opening: 'Sicilian Defence',
          eco: 'B90',
        },
      ],
    })

    await user.keyboard('{Meta>}k{/Meta}')
    await user.keyboard('nykter')

    // No page answers to the opponent's name, so the game is the whole list — and the
    // highlight starts on it rather than on a group header it cannot open.
    expect(screen.getByRole('option', { name: /Dr_Nykterstein/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    await user.keyboard('{Enter}')

    expect(screen.getByTestId('where')).toHaveTextContent('/games/42')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('navigates to the page the highlight rests on', async () => {
    const user = userEvent.setup()
    draw()

    await user.keyboard('{Meta>}k{/Meta}')
    await user.keyboard('engines')
    await user.keyboard('{Enter}')

    expect(screen.getByTestId('where')).toHaveTextContent('/engines')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
