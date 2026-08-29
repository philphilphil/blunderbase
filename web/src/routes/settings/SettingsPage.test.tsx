import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import { useMaiaElos } from '@/lib/api/queries'
import type { AppSettings, AppSettingsUpdate, GamesDeleted } from '@/lib/api/types'

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

/**
 * What an install that never opened the page answers with: null everywhere but the Maia
 * levels, which are always a level — the default one until somebody chooses another.
 */
const NOTHING_SET: AppSettings = {
  maia_target_elo: 2000,
  maia_elos: [2000],
  maia_on_quick: null,
  maia_on_deep: null,
  maia_both_sides: null,
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
        const sent = JSON.parse(String(init?.body)) as AppSettingsUpdate
        const inaccuracy = clamp(sent.inaccuracy_threshold, 0, 100) ?? 10
        const mistake = clamp(sent.mistake_threshold, 0, 100) ?? 20
        const blunder = clamp(sent.blunder_threshold, 0, 100) ?? 30
        if (!(inaccuracy < mistake && mistake < blunder)) {
          return json(422, {
            error: 'invalid_settings',
            detail: 'the classification thresholds have to rise: inaccuracy < mistake < blunder',
          })
        }
        // The levels are a list, and the list wins: the older single field is what a
        // client that has only ever known one level sends.
        const elos = (
          sent.maia_elos && sent.maia_elos.length > 0
            ? sent.maia_elos
            : sent.maia_target_elo === null || sent.maia_target_elo === undefined
              ? [2000]
              : [sent.maia_target_elo]
        )
          .map((elo) => clamp(elo, 1100, 2000) ?? 2000)
          .sort((left, right) => left - right)
        stored = {
          // Cleared is not a state the levels have: null is the default level.
          maia_target_elo: elos[0]!,
          maia_elos: elos,
          // The three flags are 0/1 rows of the same table: clamped like any other number,
          // and cleared to null by a PUT that leaves them out — which is the bug the page
          // had, since a null read back is the default rather than what was in force.
          maia_on_quick: clamp(sent.maia_on_quick ?? null, 0, 1),
          maia_on_deep: clamp(sent.maia_on_deep ?? null, 0, 1),
          maia_both_sides: clamp(sent.maia_both_sides ?? null, 0, 1),
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
        maia_elos: stored.maia_elos,
      })
    }
    return json(404, { error: 'not_found', detail: path })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** The Maia levels as every other screen reads them — off the bootstrap payload. */
function Elsewhere() {
  const elos = useMaiaElos()
  return <div data-testid="elsewhere">{elos === null ? 'none' : elos.join(' ')}</div>
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

/** One of the Maia switches, by the label it announces itself with. */
function toggle(label: string) {
  return screen.getByRole('switch', { name: label })
}

/** The level chips, in the order the card shows them. */
function chips() {
  return [...screen.getByTestId('maia-elos').querySelectorAll('span')]
    .map((chip) => chip.textContent?.trim() ?? '')
    .filter((text) => /^\d+$/.test(text))
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

    await loadedField('Add a level')

    expect(screen.getByText('Maia')).toBeInTheDocument()
    expect(screen.getByText('Analysis')).toBeInTheDocument()
    expect(screen.getByText('Classification')).toBeInTheDocument()
    expect(screen.getByText('Defaults')).toBeInTheDocument()
    for (const label of [
      'Add a level',
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
    stored = {
      ...NOTHING_SET,
      maia_target_elo: 1500,
      maia_elos: [1500, 1700],
      quick_nodes: 50000,
      deep_multipv: 6,
    }

    draw()

    await waitFor(() => expect(field('Quick nodes')).toHaveValue(50000))
    expect(chips()).toEqual(['1500', '1700'])
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

  it('shows the pinned level on a deployment nobody configured', async () => {
    draw()

    // Not an empty list: there is no such thing as asking Maia at no rating.
    await waitFor(() => expect(chips()).toEqual(['2000']))
    expect(screen.getByText(/never none/)).toBeInTheDocument()
  })

  it('adds a level, and saves the whole list', async () => {
    stored = { ...NOTHING_SET, maia_target_elo: 1700, maia_elos: [1700] }
    draw()
    await waitFor(() => expect(chips()).toEqual(['1700']))

    await userEvent.type(field('Add a level'), '1200')
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }))
    // Sorted, because order carries nothing — the set is the setting.
    expect(chips()).toEqual(['1200', '1700'])

    await userEvent.click(save())
    await waitFor(() => expect(stored.maia_elos).toEqual([1200, 1700]))
    // The list is what was sent, and the single-level field follows it.
    expect(stored.maia_target_elo).toBe(1200)
  })

  it('adds the level on Enter rather than saving the form around it', async () => {
    stored = { ...NOTHING_SET, maia_target_elo: 1700, maia_elos: [1700] }
    const fetchMock = vi.mocked(fetch)
    draw()
    await waitFor(() => expect(chips()).toEqual(['1700']))

    await userEvent.type(field('Add a level'), '1200{Enter}')

    expect(chips()).toEqual(['1200', '1700'])
    // Not saved: the list is still a draft, and Save is what commits it.
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
  })

  it('rounds a typed level onto the grid Maia’s weights are named on', async () => {
    stored = { ...NOTHING_SET, maia_target_elo: 1700, maia_elos: [1700] }
    draw()
    await waitFor(() => expect(chips()).toEqual(['1700']))

    await userEvent.type(await loadedField('Add a level'), '1234')
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }))
    expect(chips()).toEqual(['1250', '1700'])
  })

  it('adds the owner’s own rating in one click', async () => {
    stored = { ...NOTHING_SET, maia_target_elo: 2000, maia_elos: [2000], default_owner_rating: 1680 }
    draw()
    await waitFor(() => expect(chips()).toEqual(['2000']))

    // Rounded to the grid, and named on the button so it is a level rather than a promise.
    await userEvent.click(screen.getByRole('button', { name: 'Your rating (1700)' }))
    expect(chips()).toEqual(['1700', '2000'])
    // Offered once: there is nothing to add a second time.
    expect(screen.queryByRole('button', { name: /your rating/i })).not.toBeInTheDocument()
  })

  it('removes a level, but never the last one', async () => {
    stored = { ...NOTHING_SET, maia_target_elo: 1500, maia_elos: [1500, 1700] }
    draw()
    await waitFor(() => expect(chips()).toEqual(['1500', '1700']))

    await userEvent.click(screen.getByRole('button', { name: 'Remove 1500' }))
    expect(chips()).toEqual(['1700'])
    expect(screen.getByRole('button', { name: 'Remove 1700' })).toBeDisabled()

    await userEvent.click(save())
    await waitFor(() => expect(stored.maia_elos).toEqual([1700]))
  })

  it('stops at five levels', async () => {
    stored = { ...NOTHING_SET, maia_elos: [1100, 1300, 1500, 1700, 1900] }
    draw()
    await waitFor(() => expect(chips()).toHaveLength(5))

    expect(field('Add a level')).toBeDisabled()
    expect(screen.getByRole('button', { name: /^add$/i })).toBeDisabled()
    expect(screen.getByText(/5 levels is the most/)).toBeInTheDocument()
  })

  it('points at the Analysis page for the fill rather than doing it here', async () => {
    draw()

    await loadedField('Add a level')
    // The fill is a library operation — thousands of runs — not a setting.
    expect(
      screen.queryByRole('button', { name: /fill in missing maia levels/i }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /fill on the analysis page/i })).toHaveAttribute(
      'href',
      '/analysis',
    )
  })

  it('shows the three Maia switches in the positions the backend defaults to', async () => {
    draw()

    await loadedField('Add a level')
    expect(toggle('Run Maia on quick passes')).toHaveAttribute('aria-checked', 'true')
    // Off, because a deep pass would recompute the policy the quick pass already stored.
    expect(toggle('Run Maia on deep passes')).toHaveAttribute('aria-checked', 'false')
    expect(toggle('Ask about both sides')).toHaveAttribute('aria-checked', 'true')
  })

  it('renders the stored flags rather than their defaults', async () => {
    stored = { ...NOTHING_SET, maia_on_quick: 0, maia_on_deep: 1, maia_both_sides: 0 }
    draw()

    await waitFor(() =>
      expect(toggle('Run Maia on quick passes')).toHaveAttribute('aria-checked', 'false'),
    )
    expect(toggle('Run Maia on deep passes')).toHaveAttribute('aria-checked', 'true')
    expect(toggle('Ask about both sides')).toHaveAttribute('aria-checked', 'false')
  })

  it('round-trips a flipped switch through the PUT', async () => {
    draw()
    await loadedField('Add a level')

    await userEvent.click(toggle('Run Maia on deep passes'))
    await userEvent.click(toggle('Ask about both sides'))
    await userEvent.click(save())

    // Stored as the 0/1 numbers the settings table keeps, not as booleans.
    await waitFor(() => expect(stored.maia_on_deep).toBe(1))
    expect(stored.maia_both_sides).toBe(0)
    expect(toggle('Run Maia on deep passes')).toHaveAttribute('aria-checked', 'true')
    expect(toggle('Ask about both sides')).toHaveAttribute('aria-checked', 'false')
  })

  /**
   * The defect this card exists to close: the PUT is the whole of the settings, so a save
   * that did not name these three put all of them back to their defaults — an owner who
   * had turned Maia off for quick passes got it back on by editing a node budget.
   */
  it('carries the flags through a save that changed something else entirely', async () => {
    stored = { ...NOTHING_SET, maia_on_quick: 0, maia_on_deep: 1, maia_both_sides: 0 }
    draw()
    await waitFor(() =>
      expect(toggle('Run Maia on quick passes')).toHaveAttribute('aria-checked', 'false'),
    )

    await userEvent.type(field('Quick nodes'), '50000')
    await userEvent.click(save())

    await waitFor(() => expect(stored.quick_nodes).toBe(50000))
    expect(stored.maia_on_quick).toBe(0)
    expect(stored.maia_on_deep).toBe(1)
    expect(stored.maia_both_sides).toBe(0)
  })

  it('saves every box in one request', async () => {
    draw()

    await userEvent.type(await loadedField('Quick nodes'), '50000')
    await userEvent.type(field('Inaccuracy'), '5')
    await userEvent.click(save())

    await waitFor(() => expect(stored.quick_nodes).toBe(50000))
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
    stored = { ...NOTHING_SET, maia_target_elo: 1700, maia_elos: [1700] }
    const fetchMock = vi.mocked(fetch)
    draw()
    await waitFor(() => expect(chips()).toEqual(['1700']))

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

  it('moves the levels every other screen reads, without a reload', async () => {
    stored = { ...NOTHING_SET, maia_target_elo: 1700, maia_elos: [1700] }
    draw({ withReader: true })
    await waitFor(() => expect(screen.getByTestId('elsewhere')).toHaveTextContent('1700'))

    await userEvent.type(await loadedField('Add a level'), '1500')
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }))
    await userEvent.click(save())

    // The analysis board asks its live questions at these levels, so the bootstrap payload
    // has to carry the new list rather than the one this browser started with.
    await waitFor(() => expect(screen.getByTestId('elsewhere')).toHaveTextContent('1500 1700'))
  })
})
