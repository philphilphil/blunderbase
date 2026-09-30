import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import { SERVER_CAPABILITIES } from '@/lib/api/types'
import { RuntimeCapabilitiesProvider } from '@/lib/runtime/RuntimeCapabilitiesProvider'
import { MOBILE_QUERY } from '@/lib/ui/media'
import { ThemeProvider } from '@/lib/ui/theme'

import { CommandPaletteProvider } from './CommandPalette'
import { PageChromeProvider, SetPageChrome } from './PageChrome'
import { TopBar } from './TopBar'

function draw({
  crumbs = false,
  demo = false,
  actions,
  back,
}: {
  crumbs?: boolean
  demo?: boolean
  actions?: ReactNode
  back?: { label: string; to: string }
} = {}) {
  const onOpenNav = vi.fn()
  const capabilities = demo
    ? { ...SERVER_CAPABILITIES, password_auth: false, mcp: false, remote_runners: false, read_only: true }
    : SERVER_CAPABILITIES
  // The queue readout asks `/analysis/queue`; unanswered, it reads `Idle 0/0`.
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } })
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ThemeProvider>
          <RuntimeCapabilitiesProvider capabilities={capabilities}>
            <MemoryRouter>
              <PageChromeProvider>
                <CommandPaletteProvider>
                  {crumbs || actions || back ? (
                    <SetPageChrome
                      breadcrumb={
                        crumbs ? [{ label: 'Library', to: '/library' }, { label: 'Import' }] : undefined
                      }
                      manual="guide/library"
                      actions={actions}
                      back={back}
                    />
                  ) : null}
                  <TopBar onOpenNav={onOpenNav} />
                </CommandPaletteProvider>
              </PageChromeProvider>
            </MemoryRouter>
          </RuntimeCapabilitiesProvider>
        </ThemeProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )
  return onOpenNav
}

/** A window narrower than `md`, for the tests about the phone bar. */
function asPhone() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === MOBILE_QUERY,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('the titlebar', () => {
  it('holds the title, the page’s actions, a rule, and the Hide engine switch, in that order', () => {
    draw({ crumbs: true, actions: <button type="button">Sync all</button> })

    const bar = screen.getByRole('banner')
    const title = screen.getByRole('heading', { name: 'Import' })
    const action = screen.getByRole('button', { name: 'Sync all' })
    const toggle = screen.getByRole('switch', { name: 'Hide engine' })
    const rule = action.parentElement!.nextElementSibling!
    expect(rule).toHaveClass('w-px', 'bg-line')
    // Past the rule, the app's own: the analysis queue, then the switch.
    expect(rule.nextElementSibling).toHaveTextContent('Idle0/0')
    expect(rule.nextElementSibling!.nextElementSibling).toBe(toggle)
    const order = [title, action, toggle].map((node) =>
      Array.from(bar.querySelectorAll('*')).indexOf(node),
    )
    expect(order).toEqual([...order].sort((a, b) => a - b))
    // The page's gutter, so the title sits over the column it names.
    expect(bar).toHaveClass('md:pl-6')
  })

  it('leaves the app’s own chrome to the rail', () => {
    draw({ demo: true })

    // Brand, demo tint, theme, ⌘K chip, shortcuts and account all moved out. (The queue
    // came back: the rail's foot had no room for it.)
    expect(screen.queryByText('Blunderbase')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /demo/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Theme' })).not.toBeInTheDocument()
    expect(screen.queryByText('⌘K')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /account/i })).not.toBeInTheDocument()
  })

  it('draws the rule only when there are actions for it to end', () => {
    draw({ crumbs: true })
    const toggle = screen.getByRole('switch', { name: 'Hide engine' })
    const queue = toggle.previousElementSibling!
    expect(queue).toHaveTextContent('Idle0/0')
    expect(queue.previousElementSibling).not.toHaveClass('bg-line')
  })

  it('sets the title as the page’s heading, and every crumb before it as a link', () => {
    draw({ crumbs: true })

    const title = screen.getByRole('heading', { name: 'Import' })
    expect(title).toHaveClass('text-heading', 'font-semibold', 'text-ink', 'truncate')
    expect(title).not.toHaveClass('max-md:hidden')
    const place = screen.getByRole('link', { name: 'Library' })
    expect(place).toHaveAttribute('href', '/library')
    expect(place).toHaveClass('text-soft', 'hover:underline', 'max-md:hidden')
  })

  it('carries the page’s own buttons from md up, and no manual link of its own', () => {
    // The page names a chapter; the link to it is the rail footer's, not the bar's.
    draw({ actions: <button type="button">Sync all</button> })
    expect(screen.getByRole('button', { name: 'Sync all' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /manual/i })).not.toBeInTheDocument()
  })
})

describe('the phone bar', () => {
  it('opens the navigation from a button that only exists below md', async () => {
    const onOpenNav = draw()

    const button = screen.getByRole('button', { name: 'Open the navigation' })
    expect(button).toHaveClass('md:hidden')

    await userEvent.click(button)

    expect(onOpenNav).toHaveBeenCalledTimes(1)
  })

  it('keeps the search as an icon, and the switch without its word', () => {
    asPhone()
    draw()

    expect(screen.getByRole('button', { name: 'Search everything' })).toHaveClass('md:hidden')
    // The word is the accessible name only.
    const toggle = screen.getByRole('switch', { name: 'Hide engine' })
    expect(toggle).not.toHaveTextContent('Hide engine')
  })

  it('does not draw the page’s buttons on a phone', () => {
    asPhone()
    draw({ actions: <button type="button">Sync all</button> })
    expect(screen.queryByRole('button', { name: 'Sync all' })).not.toBeInTheDocument()
  })

  it('leads a detail page with a way back that names its parent, instead of the ☰', () => {
    asPhone()
    draw({ back: { label: 'Games', to: '/games?collection=7&whose=all' } })

    const back = screen.getByRole('link', { name: 'Games' })
    expect(back).toHaveAttribute('href', '/games?collection=7&whose=all')
    expect(back).toHaveClass('md:hidden')
    expect(screen.queryByRole('button', { name: 'Open the navigation' })).not.toBeInTheDocument()
  })
})
