import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { SERVER_CAPABILITIES } from '@/lib/api/types'
import { RuntimeCapabilitiesProvider } from '@/lib/runtime/RuntimeCapabilitiesProvider'
import { MOBILE_QUERY } from '@/lib/ui/media'
import { ThemeProvider } from '@/lib/ui/theme'

import { CommandPaletteProvider } from './CommandPalette'
import { PageChromeProvider, SetPageChrome } from './PageChrome'
import { TopBar } from './TopBar'

// The queue widget and the account chip each want a session and a query client of their
// own; this file is about what the titlebar keeps and drops when the window is a phone.
vi.mock('./QueueIndicator', () => ({
  QueueIndicator: () => <div data-testid="queue" />,
}))
vi.mock('./AccountMenu', () => ({
  AccountMenu: () => <div data-testid="account" />,
}))

function draw({
  crumbs = false,
  demo = false,
  actions,
}: { crumbs?: boolean; demo?: boolean; actions?: ReactNode } = {}) {
  const onOpenNav = vi.fn()
  const capabilities = demo
    ? { ...SERVER_CAPABILITIES, password_auth: false, mcp: false, remote_runners: false, read_only: true }
    : SERVER_CAPABILITIES
  render(
    <ThemeProvider>
      <RuntimeCapabilitiesProvider capabilities={capabilities}>
        <MemoryRouter>
          <PageChromeProvider>
            <CommandPaletteProvider>
              {crumbs || actions ? (
                <SetPageChrome
                  breadcrumb={
                    crumbs ? [{ label: 'Library', to: '/games' }, { label: 'Import' }] : undefined
                  }
                  manual="guide/library"
                  actions={actions}
                />
              ) : null}
              <TopBar onOpenNav={onOpenNav} />
            </CommandPaletteProvider>
          </PageChromeProvider>
        </MemoryRouter>
      </RuntimeCapabilitiesProvider>
    </ThemeProvider>,
  )
  return onOpenNav
}

describe('the titlebar', () => {
  it('opens the navigation from a button that only exists below md', async () => {
    const onOpenNav = draw()

    const button = screen.getByRole('button', { name: 'Open the navigation' })
    expect(button).toHaveClass('md:hidden')

    await userEvent.click(button)

    expect(onOpenNav).toHaveBeenCalledTimes(1)
  })

  it('keeps the queue, the search and the account on a phone', () => {
    draw()

    expect(screen.getByTestId('queue')).toBeInTheDocument()
    expect(screen.getByTestId('account')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Search everything' })).toBeInTheDocument()
  })

  it('drops the wordmark below md but keeps the mark linking home', () => {
    draw()

    expect(screen.getByText('Blunderbase')).toHaveClass('max-md:hidden')
    expect(screen.getByRole('link')).toHaveAttribute('href', '/')
  })

  it('carries the theme control, and hands it to the rail below md', () => {
    draw()

    // Both copies exist in the shell (the rail's is what the phone drawer carries); the
    // titlebar's is the one that shows from `md` up, so it is the one that must say so.
    expect(screen.getByRole('group', { name: 'Theme' })).toHaveClass('max-md:hidden')
  })

  it('names the page with its last crumb at every width, and drops the way there below md', () => {
    draw({ crumbs: true })

    // Pages print no title of their own, so the last crumb is the page's name everywhere.
    const page = screen.getByText('Import')
    expect(page).toHaveClass('text-ink')
    expect(page).not.toHaveClass('max-md:hidden')
    expect(screen.getByRole('link', { name: 'Library' })).toHaveClass('max-md:hidden')
  })

  it('carries the page’s own buttons from md up, and no manual link of its own', () => {
    // The page names a chapter; the link to it is the rail footer's now, not the bar's.
    draw({ actions: <button type="button">Sync all</button> })
    expect(screen.getByRole('button', { name: 'Sync all' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /manual/i })).not.toBeInTheDocument()
  })

  it('does not draw the page’s buttons on a phone', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === MOBILE_QUERY,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )
    draw({ actions: <button type="button">Sync all</button> })
    expect(screen.queryByRole('button', { name: 'Sync all' })).not.toBeInTheDocument()
    vi.unstubAllGlobals()
  })
})

describe('the public demo', () => {
  it('says so in the titlebar, and points home', () => {
    draw({ demo: true })

    const chip = screen.getByRole('link', { name: /demo/i })
    expect(chip).toHaveAttribute('href', 'https://blunderbase.org')
    expect(chip).toHaveTextContent(/read-only/)
  })

  it('carries no such chip on an installation of one\'s own', () => {
    draw()

    expect(screen.queryByRole('link', { name: /demo/i })).not.toBeInTheDocument()
  })
})
