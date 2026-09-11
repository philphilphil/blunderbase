import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import type { AppSettings, AppSettingsUpdate } from '@/lib/api/types'

import { CorrespondenceSettingsPage } from './CorrespondenceSettings'

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

/** Everything a PUT would wipe if the form left it out, plus what this page edits. */
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
  correspondence_enabled: 1,
  correspondence_multipv: 3,
  correspondence_slots: 2,
  correspondence_task_nodes: 40_000_000,
  correspondence_task_multipv: 3,
  correspondence_stale_depth: 30,
}

let sent: AppSettingsUpdate | null

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function draw() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <Providers client={client}>
      <MemoryRouter>
        <CorrespondenceSettingsPage />
      </MemoryRouter>
    </Providers>,
  )
}

beforeEach(() => {
  sent = null
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (!path.endsWith('/api/settings')) return json({})
      if ((init?.method ?? 'GET') === 'PUT') {
        sent = JSON.parse(String(init?.body)) as AppSettingsUpdate
        return json({ ...STORED, ...sent })
      }
      return json(STORED)
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Analysis → Correspondence', () => {
  it('sends every key the deployment holds, not only the one that changed', async () => {
    draw()
    const slots = await screen.findByLabelText('Search slots')
    await userEvent.clear(slots)
    await userEvent.type(slots, '4')
    await userEvent.click(screen.getByRole('button', { name: /Save/ }))

    await waitFor(() => expect(sent).not.toBeNull())
    // The whole record: a PUT is a replace, and an absent key is a cleared one.
    expect(sent).toMatchObject({
      correspondence_enabled: 1,
      correspondence_multipv: 3,
      correspondence_slots: 4,
      correspondence_task_nodes: 40_000_000,
      correspondence_task_multipv: 3,
      correspondence_stale_depth: 30,
      maia_elos: [1500, 1800],
      quick_nodes: 111_000,
      deep_nodes: 2_222_000,
      deep_multipv: 5,
      blunder_threshold: 14,
    })
  })

  it('sends the task numbers as they were typed, and an empty box as the default', async () => {
    draw()
    const nodes = await screen.findByLabelText('Nodes per task')
    await userEvent.clear(nodes)
    await userEvent.type(nodes, '80000000')
    const stale = screen.getByLabelText('Stale below depth')
    await userEvent.clear(stale)
    await userEvent.click(screen.getByRole('button', { name: /Save/ }))

    await waitFor(() => expect(sent).not.toBeNull())
    expect(sent?.correspondence_task_nodes).toBe(80_000_000)
    // Cleared is "nobody has set this", which is null and not zero.
    expect(sent?.correspondence_stale_depth).toBeNull()
    expect(sent?.correspondence_task_multipv).toBe(3)
  })

  it('says that the slot count needs a restart, because the pool is sized at boot', async () => {
    draw()
    expect(
      await screen.findByText(/reads this when it starts, so a change here takes effect/),
    ).toBeInTheDocument()
  })
})
