import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { i18n } from '@lingui/core'
import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthGate } from '@/app/AuthGate'
import { Providers } from '@/app/Providers'
import { TourProvider } from '@/lib/tour/TourProvider'

import { PageChromeProvider, SetPageChrome } from './PageChrome'
import { SettingsMenu } from './SettingsMenu'

class FakeSocket {
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((event?: CloseEvent) => void) | null = null
  readonly url: string
  constructor(url: string) {
    this.url = url
  }
  close() {}
}

function json(status: number, body: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

let routes: Record<string, () => Response>

/** The row lives in the rail, which only exists once there is a session — so it is mounted
 * behind the same gate here, and signing out has somewhere real to land. The tour provider
 * is here for the same reason: "Show the tour again" is one of the menu's items, and the
 * shell is what mounts the tour around the whole app. The page chrome is what names the
 * manual's chapter for the page. */
function draw({ manual }: { manual?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <Providers client={client}>
      <AuthGate>
        <MemoryRouter>
          <PageChromeProvider>
            {manual ? <SetPageChrome manual={manual} /> : null}
            <TourProvider>
              <SettingsMenu />
            </TourProvider>
          </PageChromeProvider>
        </MemoryRouter>
      </AuthGate>
    </Providers>,
  )
  return client
}

beforeEach(() => {
  routes = {
    'GET /api/auth/status': () => json(200, { setup_required: false, authenticated: true }),
    // Seen, so the tour does not start itself over a test about the menu.
    'GET /api/settings/tour': () => json(200, { seen: true }),
    'GET /api/stats/profile': () =>
      json(200, {
        accounts: [
          { id: 1, platform: 'lichess', username: 'kn1ghtmare', is_owner: true, games: 1042 },
        ],
      }),
  }
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${String(input).split('?')[0]}`
      return routes[key]?.() ?? json(404, { error: 'not_found', detail: key })
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

async function openMenu() {
  await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
}

describe('SettingsMenu', () => {
  it('is the rail’s Settings row: a gear, the word, and a menu that opens upward', async () => {
    draw()
    const trigger = await screen.findByRole('button', { name: 'Settings' })
    // A gear, not a person: the app has no user of its own to put a name to.
    expect(trigger).toHaveTextContent('Settings')
    expect(trigger.querySelector('.lucide-settings')).not.toBeNull()
    expect(trigger).not.toHaveTextContent('kn1ghtmare')
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger.querySelector('.lucide-chevron-up')).not.toBeNull()

    await openMenu()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    // Placed above the row, from its bottom edge, since the row is the column's last thing.
    expect(screen.getByRole('menu').style.bottom).not.toBe('')
    // No borrowed identity at its head either.
    expect(screen.getByRole('menu')).not.toHaveTextContent('kn1ghtmare')
  })

  // Portalled to the end of the page, the menu is not next in the tab order after its
  // trigger, so the focus has to be taken in and handed back.
  it('takes the focus in when it opens, walks it with the arrows and hands it back on Escape', async () => {
    draw()
    const trigger = await screen.findByRole('button', { name: 'Settings' })
    await openMenu()
    const menu = screen.getByRole('menu')
    expect(menu).toContainElement(document.activeElement as HTMLElement)

    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(
      screen.getByRole('menuitem', { name: /Keyboard shortcuts/ }),
    )

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(trigger)
  })

  it('opens the manual at the chapter the page names', async () => {
    draw({ manual: 'guide/games' })
    await openMenu()
    const manual = screen.getByRole('menuitem', { name: 'Manual for this page' })
    expect(manual).toHaveAttribute('href', '/manual/guide/games/')
    expect(manual).toHaveAttribute('target', '_blank')
    expect(manual).toHaveAttribute('rel', 'noreferrer')
  })

  it('follows the language the app is in', async () => {
    i18n.loadAndActivate({ locale: 'de', messages: {} })
    try {
      draw({ manual: 'guide/explorer#build-a-repertoire' })
      await userEvent.click(await screen.findByRole('button', { name: /Settings|Einstellungen/ }))
      expect(screen.getByRole('menuitem', { name: /Manual|Handbuch/ })).toHaveAttribute(
        'href',
        '/manual/de/guide/explorer/#build-a-repertoire',
      )
    } finally {
      i18n.loadAndActivate({ locale: 'en', messages: {} })
    }
  })

  it('ends with the build’s version, what changed, and the source', async () => {
    // Read off disk rather than restated, so a bump that misses Vite's `define` fails here.
    const { version } = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
    ) as { version: string }
    draw()
    await openMenu()
    const changed = screen.getByRole('menuitem', { name: /What changed/ })
    expect(changed).toHaveTextContent(`Blunderbase v${version} · What changed`)
    expect(changed).toHaveAttribute('href', expect.stringContaining('CHANGELOG.md'))
    expect(screen.getByRole('menuitem', { name: 'Blunderbase on GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/philphilphil/blunderbase',
    )
  })

  it('carries Appearance and Language as one-of choices, and the keyboard shortcuts', async () => {
    const user = userEvent.setup()
    draw()
    await openMenu()

    const appearance = screen.getByRole('radiogroup', { name: 'Appearance' })
    expect(
      Array.from(appearance.querySelectorAll('[role="radio"]')).map((radio) => radio.textContent),
    ).toEqual(['Dark', 'Light', 'System'])
    expect(screen.getByRole('radiogroup', { name: 'Language' })).toHaveTextContent(
      'EnglishDeutsch',
    )

    const light = screen.getByRole('radio', { name: 'Light' })
    await user.click(light)
    expect(light).toHaveAttribute('aria-checked', 'true')

    const keys = screen.getByRole('menuitem', { name: /keyboard shortcuts/i })
    // The row prints the key that opens the list from anywhere.
    expect(keys.querySelector('kbd')).toHaveTextContent('?')
  })

  it('carries the ways into the installation and the two things an owner does to a session', async () => {
    draw()
    await openMenu()

    expect(screen.getByRole('menuitem', { name: /connected accounts/i })).toHaveAttribute(
      'href',
      '/library/import',
    )
    expect(screen.getByRole('menuitem', { name: /^assistant$/i })).toHaveAttribute(
      'href',
      '/assistant',
    )
    const manual = screen.getByRole('menuitem', { name: /^manual$/i })
    expect(manual).toHaveAttribute('href', '/manual/')
    expect(manual).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('menuitem', { name: /show the tour again/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /change password/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeInTheDocument()
  })

  it('shows no server credentials or MCP setup in the desktop runtime', async () => {
    routes['GET /api/auth/status'] = () =>
      json(200, {
        setup_required: false,
        authenticated: true,
        capabilities: { password_auth: false, mcp: false, remote_runners: false, read_only: false },
      })
    draw()
    await openMenu()

    expect(screen.queryByRole('menuitem', { name: /^assistant$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /change password/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /sign out/i })).not.toBeInTheDocument()
  })

  it('signs out to the login screen and forgets what the session cached', async () => {
    routes['POST /api/auth/logout'] = () => new Response(null, { status: 204 })
    const client = draw()
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: /sign out/i }))

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(client.getQueryData(['stats', 'profile'])).toBeUndefined()
  })

  it('keeps this browser signed in after the password is changed', async () => {
    routes['POST /api/auth/password'] = () =>
      json(200, { setup_required: false, authenticated: true })
    draw()
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: /change password/i }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/every other browser is signed out/i)
    await userEvent.type(screen.getByLabelText('Current password'), 'the old one')
    await userEvent.type(screen.getByLabelText('New password'), 'the newer one')
    await userEvent.type(screen.getByLabelText('Repeat the new one'), 'the newer one')
    await userEvent.click(screen.getByRole('button', { name: /change it/i }))

    expect(await screen.findByText(/still signed in here/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument()
  })

  it('does not send a change the two new fields disagree about', async () => {
    draw()
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: /change password/i }))
    await userEvent.type(await screen.findByLabelText('Current password'), 'the old one')
    await userEvent.type(screen.getByLabelText('New password'), 'the newer one')
    await userEvent.type(screen.getByLabelText('Repeat the new one'), 'the newer oue')
    await userEvent.click(screen.getByRole('button', { name: /change it/i }))

    expect(screen.getByRole('alert')).toHaveTextContent('those two do not match')
    expect(vi.mocked(fetch).mock.calls.some((call) => String(call[0]).includes('/auth/password'))).toBe(
      false,
    )
  })
})
