import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import type { AppSettings, AppSettingsUpdate } from '@/lib/api/types'

import { EnginePassesPage, MaiaSettingsPage } from './AnalysisSettings'

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

const STORED: AppSettings = {
  maia_target_elo: 1500,
  maia_elos: [1500, 1800],
  maia_on_quick: 0,
  maia_on_deep: 1,
  maia_both_sides: 0,
  quick_nodes: 111_000,
  deep_nodes: 2_222_000,
  deep_multipv: 5,
  inaccuracy_threshold: 4,
  mistake_threshold: 9,
  blunder_threshold: 14,
}

let sent: AppSettingsUpdate | null

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

function draw(page: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <Providers client={client}>
      <MemoryRouter>{page}</MemoryRouter>
    </Providers>,
  )
}

beforeEach(() => {
  sent = null
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).endsWith('/api/settings')) return json({})
    if ((init?.method ?? 'GET') === 'PUT') {
      sent = JSON.parse(String(init?.body)) as AppSettingsUpdate
      return json({ ...STORED, ...sent, maia_target_elo: sent.maia_elos?.[0] ?? 2000 })
    }
    return json(STORED)
  }))
})

afterEach(() => vi.unstubAllGlobals())

describe('focused analysis configuration', () => {
  it('keeps engine-pass controls together and carries Maia through its whole-object save', async () => {
    draw(<EnginePassesPage />)

    const quick = await screen.findByLabelText('Quick nodes')
    expect(screen.getByText('Move classification')).toBeInTheDocument()
    expect(screen.queryByText('Human levels')).not.toBeInTheDocument()

    await userEvent.clear(quick)
    await userEvent.type(quick, '222000')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(sent).not.toBeNull())
    expect(sent).toMatchObject({
      quick_nodes: 222000,
      maia_elos: [1500, 1800],
      maia_on_quick: 0,
      maia_on_deep: 1,
      maia_both_sides: 0,
    })
  })

  it('offers to hide the engine on new games, and saves the switch as a flag', async () => {
    draw(<EnginePassesPage />)

    const hide = await screen.findByRole('switch', { name: 'Hide the engine on new games' })
    // Nothing stored means off, which is what every game before the switch existed did.
    expect(hide).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled()

    await userEvent.click(hide)
    expect(hide).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(sent).not.toBeNull())
    // The flag rides with the whole of the settings, the budgets untouched.
    expect(sent).toMatchObject({ hide_engine_new_games: 1, quick_nodes: 111000, maia_elos: [1500, 1800] })
  })

  it('keeps Maia controls together and carries engine-pass values through its save', async () => {
    draw(<MaiaSettingsPage />)

    const level = await screen.findByLabelText('Add a level')
    expect(screen.getByText('When Maia runs')).toBeInTheDocument()
    expect(screen.queryByLabelText('Quick nodes')).not.toBeInTheDocument()

    await userEvent.type(level, '1900')
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }))
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(sent).not.toBeNull())
    expect(sent).toMatchObject({
      maia_elos: [1500, 1800, 1900],
      quick_nodes: 111000,
      deep_nodes: 2222000,
      deep_multipv: 5,
      inaccuracy_threshold: 4,
      mistake_threshold: 9,
      blunder_threshold: 14,
    })
  })
})
