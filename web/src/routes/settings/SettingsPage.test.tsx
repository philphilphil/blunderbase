import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import { useMaiaTargetElo } from '@/lib/api/queries'
import type { AppSettings, GamesDeleted } from '@/lib/api/types'

import { SettingsPage } from './SettingsPage'

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
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const NOTHING_SET: AppSettings = {
  maia_target_elo: null,
  quick_nodes: null,
  deep_nodes: null,
  deep_multipv: null,
  inaccuracy_threshold: null,
  mistake_threshold: null,
  blunder_threshold: null,
  default_owner_rating: null,
}

const PASSWORD = 'correct-horse-battery'

/** What the wipe would answer for the library the stub starts with. */
const WIPED: GamesDeleted = { games: 6, runs: 4, notes: 1, import_jobs: 2 }

/** The deployment's stored settings, as the backend would keep them across the calls. */
let stored: AppSettings
/** How many games the library holds — the danger zone reads it, and the wipe empties it. */
let games: number

function clamp(value: number | null, low: number, high: number) {
  return value === null ? null : Math.min(high, Math.max(low, value))
}

/** The backend's own rules, as far as the page can tell them apart: clamp, then order. */
function stubFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).split('?')[0]!
    const method = init?.method ?? 'GET'
    if (path.endsWith('/api/settings')) {
      if (method === 'PUT') {
        const sent = JSON.parse(String(init?.body)) as AppSettings
        const inaccuracy = clamp(sent.inaccuracy_threshold, 0, 100) ?? 10
        const mistake = clamp(sent.mistake_threshold, 0, 100) ?? 20
        const blunder = clamp(sent.blunder_threshold, 0, 100) ?? 30
        if (!(inaccuracy < mistake && mistake < blunder)) {
          return json(422, {
            error: 'invalid_settings',
            detail: 'the classification thresholds have to rise: inaccuracy < mistake < blunder',
          })
        }
        stored = {
          maia_target_elo: clamp(sent.maia_target_elo, 1100, 2000),
          quick_nodes: clamp(sent.quick_nodes, 1, Number.MAX_SAFE_INTEGER),
          deep_nodes: clamp(sent.deep_nodes, 1, Number.MAX_SAFE_INTEGER),
          deep_multipv: clamp(sent.deep_multipv, 1, 10),
          inaccuracy_threshold: clamp(sent.inaccuracy_threshold, 0, 100),
          mistake_threshold: clamp(sent.mistake_threshold, 0, 100),
          blunder_threshold: clamp(sent.blunder_threshold, 0, 100),
          default_owner_rating: clamp(sent.default_owner_rating, 1, Number.MAX_SAFE_INTEGER),
        }
      }
      return json(200, stored)
    }
    if (path.endsWith('/api/games/delete-all')) {
      const sent = JSON.parse(String(init?.body)) as { password: string }
      if (sent.password !== PASSWORD) {
        return json(401, { error: 'invalid_password', detail: 'that is not the password' })
      }
      games = 0
      return json(200, WIPED)
    }
    if (path.endsWith('/api/games')) {
      return json(200, { games: [], total: games, limit: 1, offset: 0 })
    }
    if (path.endsWith('/api/auth/status')) {
      return json(200, {
        setup_required: false,
        authenticated: true,
        maia_target_elo: stored.maia_target_elo,
      })
    }
    return json(404, { error: 'not_found', detail: path })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** The target elo as every other screen reads it — off the bootstrap payload. */
function Elsewhere() {
  const elo = useMaiaTargetElo()
  return <div data-testid="elsewhere">{elo === null ? 'none' : String(elo)}</div>
}

function draw({ withReader = false }: { withReader?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <Providers client={client}>
      <MemoryRouter>
        <SettingsPage />
        {withReader ? <Elsewhere /> : null}
      </MemoryRouter>
    </Providers>,
  )
  return client
}

function field(label: string) {
  return screen.getByLabelText(label)
}

/** A field once the read has answered — everything before that is a skeleton. */
function loadedField(label: string) {
  return screen.findByLabelText(label)
}

function save() {
  return screen.getByRole('button', { name: /save/i })
}

beforeEach(() => {
  stored = { ...NOTHING_SET }
  games = 6
  vi.stubGlobal('WebSocket', FakeSocket)
  stubFetch()
})

afterEach(() => vi.unstubAllGlobals())

describe('SettingsPage', () => {
  it('renders a card for every group of settings', async () => {
    draw()

    await loadedField('Target elo')

    expect(screen.getByText('Maia')).toBeInTheDocument()
    expect(screen.getByText('Analysis')).toBeInTheDocument()
    expect(screen.getByText('Classification')).toBeInTheDocument()
    expect(screen.getByText('Defaults')).toBeInTheDocument()
    for (const label of [
      'Target elo',
      'Quick nodes',
      'Deep nodes',
      'Deep lines',
      'Inaccuracy',
      'Mistake',
      'Blunder',
      'Owner rating',
    ]) {
      expect(field(label)).toBeInTheDocument()
    }
  })

  it('renders the stored values', async () => {
    stored = { ...NOTHING_SET, maia_target_elo: 1700, quick_nodes: 50000, deep_multipv: 6 }

    draw()

    await waitFor(() => expect(field('Target elo')).toHaveValue(1700))
    expect(field('Quick nodes')).toHaveValue(50000)
    expect(field('Deep lines')).toHaveValue(6)
  })

  it('shows the default under a box nobody has set', async () => {
    draw()

    await loadedField('Quick nodes')
    expect(field('Deep nodes')).toHaveValue(null)
    expect(screen.getByText('Default 250,000')).toBeInTheDocument()
    expect(screen.getByText('Default 2,000,000')).toBeInTheDocument()
    expect(screen.getByText('Default 1500')).toBeInTheDocument()
  })

  it('saves every box in one request', async () => {
    draw()

    await userEvent.type(await loadedField('Target elo'), '1700')
    await userEvent.type(field('Quick nodes'), '50000')
    await userEvent.type(field('Inaccuracy'), '5')
    await userEvent.click(save())

    await waitFor(() => expect(stored.maia_target_elo).toBe(1700))
    expect(stored.quick_nodes).toBe(50000)
    expect(stored.inaccuracy_threshold).toBe(5)
    // A PUT is the whole of the settings: what was left empty stays cleared.
    expect(stored.deep_nodes).toBeNull()
  })

  // The backend clamps rather than refusing, so the page must show what is in force
  // rather than go on displaying the number that was typed.
  it('shows the clamped value rather than what was typed', async () => {
    draw()

    await userEvent.type(await loadedField('Deep lines'), '99')
    await userEvent.click(save())

    await waitFor(() => expect(field('Deep lines')).toHaveValue(10))
    expect(stored.deep_multipv).toBe(10)
  })

  it('clears a setting when its box is emptied', async () => {
    stored = { ...NOTHING_SET, quick_nodes: 50000 }
    draw()
    await waitFor(() => expect(field('Quick nodes')).toHaveValue(50000))

    await userEvent.clear(field('Quick nodes'))
    await userEvent.click(save())

    await waitFor(() => expect(stored.quick_nodes).toBeNull())
    expect(field('Quick nodes')).toHaveValue(null)
    expect(screen.getByText('Default 250,000')).toBeInTheDocument()
  })

  it('shows the refusal when the thresholds do not rise', async () => {
    draw()

    await userEvent.type(await loadedField('Inaccuracy'), '40')
    await userEvent.click(save())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/inaccuracy < mistake < blunder/i)
    // Refused whole: nothing was stored, and the typing is still there to correct.
    expect(stored).toEqual(NOTHING_SET)
    expect(field('Inaccuracy')).toHaveValue(40)
  })

  it('drops unsaved edits when reverted', async () => {
    stored = { ...NOTHING_SET, deep_nodes: 900000 }
    draw()
    await waitFor(() => expect(field('Deep nodes')).toHaveValue(900000))

    await userEvent.clear(field('Deep nodes'))
    await userEvent.type(field('Deep nodes'), '1')
    await userEvent.click(screen.getByRole('button', { name: /revert/i }))

    expect(field('Deep nodes')).toHaveValue(900000)
    expect(screen.queryByRole('button', { name: /revert/i })).not.toBeInTheDocument()
  })

  it('does not offer to save what has not changed', async () => {
    stored = { ...NOTHING_SET, maia_target_elo: 1700 }
    const fetchMock = vi.mocked(fetch)
    draw()
    await waitFor(() => expect(field('Target elo')).toHaveValue(1700))

    expect(save()).toBeDisabled()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
  })

  it('offers the wipe behind a dialog that names the count and asks for the password', async () => {
    draw()
    await screen.findByText('6 games in the database.')

    await userEvent.click(screen.getByRole('button', { name: /delete all games/i }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(/6 games go/i)
    expect(screen.getByLabelText('Your password')).toBeInTheDocument()
    // Nothing has been asked of the backend yet — this is a question, not the deletion.
    expect(
      vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes('delete-all')),
    ).toBe(false)
  })

  it('shows a wrong password against the form rather than losing the dialog', async () => {
    draw()
    await screen.findByText('6 games in the database.')
    await userEvent.click(screen.getByRole('button', { name: /delete all games/i }))

    await userEvent.type(screen.getByLabelText('Your password'), 'not-the-one')
    await userEvent.click(screen.getByRole('button', { name: /delete them/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('that is not the password')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(games).toBe(6)
  })

  it('empties the library on the right password and says what it took', async () => {
    draw()
    await screen.findByText('6 games in the database.')
    await userEvent.click(screen.getByRole('button', { name: /delete all games/i }))

    await userEvent.type(screen.getByLabelText('Your password'), PASSWORD)
    await userEvent.click(screen.getByRole('button', { name: /delete them/i }))

    await waitFor(() => expect(games).toBe(0))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Deleted 6 games, 4 analysis runs and 1 note.',
    )
  })

  it('sends every screen back to the server once the games are gone', async () => {
    const client = draw()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    await screen.findByText('6 games in the database.')
    await userEvent.click(screen.getByRole('button', { name: /delete all games/i }))

    await userEvent.type(screen.getByLabelText('Your password'), PASSWORD)
    await userEvent.click(screen.getByRole('button', { name: /delete them/i }))

    await waitFor(() => expect(invalidate).toHaveBeenCalled())
    const prefixes = invalidate.mock.calls.map(([filters]) => filters?.queryKey?.[0])
    for (const prefix of ['games', 'stats', 'analysis', 'import', 'explorer', 'notes']) {
      expect(prefixes).toContain(prefix)
    }
  })

  it('moves the level every other screen reads, without a reload', async () => {
    stored = { ...NOTHING_SET, maia_target_elo: 1700 }
    draw({ withReader: true })
    await waitFor(() => expect(screen.getByTestId('elsewhere')).toHaveTextContent('1700'))

    await userEvent.clear(await loadedField('Target elo'))
    await userEvent.type(field('Target elo'), '1500')
    await userEvent.click(save())

    await waitFor(() => expect(screen.getByTestId('elsewhere')).toHaveTextContent('1500'))
  })
})
