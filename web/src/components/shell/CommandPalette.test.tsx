import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import { ThemeProvider } from '@/lib/ui/theme'
import { resetSavedFilters } from '@/routes/games/savedFilters'

import { CommandPaletteProvider } from './CommandPalette'
import { PageChromeProvider } from './PageChrome'
import { TopBar } from './TopBar'

const { useSearch, useProfile, useLogout, useChangePassword, useQueueStatus, useCollections } =
  vi.hoisted(() => ({
    useSearch: vi.fn(),
    useProfile: vi.fn(),
    useLogout: vi.fn(),
    useChangePassword: vi.fn(),
    useQueueStatus: vi.fn(),
    useCollections: vi.fn(),
  }))
vi.mock('@/lib/api/queries', () => ({
  useSearch,
  useProfile,
  useLogout,
  useChangePassword,
  useQueueStatus,
  useCollections,
}))

// The account chip is the titlebar's, not the palette's, and it wants the tour provider
// the shell mounts around the whole app. `AccountMenu.test.tsx` is where it is exercised.
vi.mock('./AccountMenu', () => ({
  AccountMenu: () => <div data-testid="account" />,
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
function draw(data: Answer = EMPTY, collections: unknown[] = []) {
  useSearch.mockReturnValue({ data, isFetching: false })
  useCollections.mockReturnValue({ data: { collections }, isPending: false })
  useProfile.mockReturnValue({ data: undefined, isPending: true })
  useQueueStatus.mockReturnValue({ data: undefined, isPending: true })
  useLogout.mockReturnValue({ mutate: vi.fn(), isPending: false })
  useChangePassword.mockReturnValue({ mutate: vi.fn(), isPending: false })
  return render(
    <TooltipProvider>
      <ThemeProvider>
        <MemoryRouter initialEntries={['/games']}>
        <PageChromeProvider>
          <CommandPaletteProvider>
            <Where />
            <TopBar onOpenNav={vi.fn()} />
          </CommandPaletteProvider>
        </PageChromeProvider>
        </MemoryRouter>
      </ThemeProvider>
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

  it('finds a collection by name, and every one of them by the word', async () => {
    const user = userEvent.setup()
    draw(EMPTY, [
      { id: 3, name: '45-45 League', color: 'good', game_count: 8, created_at: '' },
      { id: 7, name: 'Tough losses', color: 'blunder', game_count: 23, created_at: '' },
    ])

    await user.keyboard('{Meta>}k{/Meta}')
    // Nothing typed: collections wait to be asked for, like the saved cuts.
    expect(screen.queryByRole('option', { name: /League/ })).not.toBeInTheDocument()

    await user.keyboard('league')
    expect(screen.getByRole('option', { name: /45-45 League/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Tough losses/ })).not.toBeInTheDocument()

    await user.clear(screen.getByRole('textbox', { name: 'Search everything' }))
    await user.keyboard('collection')
    expect(screen.getByRole('option', { name: /Tough losses/ })).toBeInTheDocument()
    // And the screen that shows them all, first, as the rail lists it.
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveAccessibleName(/^Collections/)

    await user.clear(screen.getByRole('textbox', { name: 'Search everything' }))
    await user.keyboard('tough{Enter}')
    expect(screen.getByTestId('where')).toHaveTextContent('/games?collection=7&whose=all')
  })

  it('navigates to the page the highlight rests on', async () => {
    const user = userEvent.setup()
    draw()

    await user.keyboard('{Meta>}k{/Meta}')
    await user.keyboard('engines')
    await user.keyboard('{Enter}')

    expect(screen.getByTestId('where')).toHaveTextContent('/compute/engines')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
