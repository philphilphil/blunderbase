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
  maia_on_analysis: 0,
  maia_both_sides: 0,
  analysis_nodes: 111_000,
  analysis_multipv: 5,
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

    const nodes = await screen.findByLabelText('Nodes per move')
    expect(screen.getByText('Analysis pass')).toBeInTheDocument()
    expect(screen.getByLabelText('Lines')).toHaveValue(5)
    expect(screen.getByText('Move classification')).toBeInTheDocument()
    expect(screen.queryByText('Human levels')).not.toBeInTheDocument()

    await userEvent.clear(nodes)
    await userEvent.type(nodes, '222000')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(sent).not.toBeNull())
    expect(sent).toMatchObject({
      analysis_nodes: 222000,
      analysis_multipv: 5,
      maia_elos: [1500, 1800],
      maia_on_analysis: 0,
      maia_both_sides: 0,
    })
    // The old per-tier keys are gone from the body, not sent as nulls.
    expect(sent).not.toHaveProperty('quick_nodes')
    expect(sent).not.toHaveProperty('maia_on_deep')
  })

  it('hides the engine on new games from a chosen speed down, and saves the rank', async () => {
    draw(<EnginePassesPage />)

    const hide = await screen.findByLabelText('Hide the engine on')
    // Nothing stored means nothing hidden, which is what every game before it existed did.
    expect(hide).toHaveValue('0')
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled()

    await userEvent.selectOptions(hide, 'Rapid and classical')
    expect(hide).toHaveValue('3')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(sent).not.toBeNull())
    // The rank rides with the whole of the settings, the budgets untouched.
    expect(sent).toMatchObject({ hide_engine_new_games: 3, analysis_nodes: 111000, maia_elos: [1500, 1800] })
  })

  it('keeps Maia controls together and carries engine-pass values through its save', async () => {
    draw(<MaiaSettingsPage />)

    const level = await screen.findByLabelText('Add a level')
    expect(screen.getByText('When Maia runs')).toBeInTheDocument()
    expect(screen.queryByLabelText('Nodes per move')).not.toBeInTheDocument()
    // One switch for the one pass, where there used to be one per tier.
    expect(screen.getByRole('switch', { name: 'Maia on the analysis pass' })).toHaveAttribute(
      'aria-checked',
      'false',
    )

    await userEvent.type(level, '1900')
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }))
    await userEvent.click(screen.getByRole('switch', { name: 'Maia on the analysis pass' }))
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(sent).not.toBeNull())
    expect(sent).toMatchObject({
      maia_elos: [1500, 1800, 1900],
      maia_on_analysis: 1,
      analysis_nodes: 111000,
      analysis_multipv: 5,
      inaccuracy_threshold: 4,
      mistake_threshold: 9,
      blunder_threshold: 14,
    })
  })
})
