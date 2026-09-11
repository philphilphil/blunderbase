import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
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
  correspondence_search_engine_ids: [1],
  correspondence_task_nodes: 40_000_000,
  correspondence_task_multipv: 3,
  correspondence_stale_depth: 30,
  correspondence_task_engine_id: null,
}

/**
 * What `/runners/status` answers. The task engine is chosen out of this rather than out of
 * `/correspondence/status`: a task is queue work and may run on a runner, and a runner's
 * engines are only ever listed here.
 */
const RUNNERS = {
  local: {
    name: 'this host',
    busy: 0,
    streams: 0,
    workers: true,
    queued: 0,
    running: 0,
    engines: [{ id: 1, name: 'Stockfish 17', kind: 'uci', enabled: true, streams: true }],
  },
  runners: [
    {
      id: 4,
      name: 'gpu-box',
      slots: 2,
      connected: true,
      busy: 0,
      streams: 0,
      free_slots: 2,
      queued_eligible: 0,
      engines: [{ id: 9, name: 'Stockfish 17 (big)', kind: 'uci', enabled: true, streams: false }],
    },
  ],
  queue: { queued: 0, running: 0 },
}

const STATUS = {
  slots: 2,
  in_use: 0,
  queued: 0,
  paused: 0,
  parked: [],
  hosts: [{ runner_id: null, host: 'this host', slots: 2, in_use: 0, parked: 0 }],
  // What the server really answers with while `correspondence_search_engine_ids` is `[1]`:
  // `engines` is the setting already applied, and only `eligible_engines` still knows that
  // Leela exists. A mock that put both in `engines` would hide the bug this page had.
  engines: [{ engine_id: 1, name: 'Stockfish 17', version: '17', default: true }],
  eligible_engines: [
    { engine_id: 1, name: 'Stockfish 17', version: '17' },
    { engine_id: 2, name: 'Leela 0.31', version: '0.31' },
  ],
}

let sent: AppSettingsUpdate | null
let statusReads: number

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
  statusReads = 0
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path.includes('/correspondence/status')) {
        statusReads += 1
        return json(STATUS)
      }
      if (path.includes('/runners/status')) return json(RUNNERS)
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
      correspondence_search_engine_ids: [1],
      correspondence_task_nodes: 40_000_000,
      correspondence_task_multipv: 3,
      correspondence_stale_depth: 30,
      correspondence_task_engine_id: null,
      maia_elos: [1500, 1800],
      quick_nodes: 111_000,
      deep_nodes: 2_222_000,
      deep_multipv: 5,
      blunder_threshold: 14,
    })
  })

  it('offers an eligible engine the saved list left out, so the choice is not one-way', async () => {
    draw()
    // Stockfish is the whole of `engines`; Leela is offered because it is still eligible.
    const list = await screen.findByTestId('correspondence-engine-order')
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByRole('button', { name: '+ Leela 0.31' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Stockfish 17' })).not.toBeInTheDocument()
  })

  it('adds an engine to the picker’s list and keeps the order it was given', async () => {
    draw()
    await userEvent.click(await screen.findByRole('button', { name: '+ Leela 0.31' }))
    const list = screen.getByTestId('correspondence-engine-order')
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)

    await userEvent.click(screen.getByRole('button', { name: 'Move Leela 0.31 up' }))
    await userEvent.click(screen.getByRole('button', { name: /Save/ }))
    await waitFor(() => expect(sent).not.toBeNull())
    expect(sent?.correspondence_search_engine_ids).toEqual([2, 1])
  })

  it('sends an empty list when the last engine is removed — that is "offer them all"', async () => {
    draw()
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Stockfish 17' }))
    expect(screen.getByText('Every eligible engine is offered.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Save/ }))
    await waitFor(() => expect(sent).not.toBeNull())
    expect(sent?.correspondence_search_engine_ids).toEqual([])
  })

  it('reads the status again after a save, so the picker is not the list just replaced', async () => {
    draw()
    await waitFor(() => expect(statusReads).toBe(1))
    await userEvent.click(await screen.findByRole('button', { name: '+ Leela 0.31' }))
    await userEvent.click(screen.getByRole('button', { name: /Save/ }))

    await waitFor(() => expect(sent).not.toBeNull())
    // `GET /correspondence/status` is read *through* the engine list this form writes: the
    // picker's order and its default both come from it.
    await waitFor(() => expect(statusReads).toBeGreaterThan(1))
  })

  it('offers a runner’s engine for the tasks, which a search could never use', async () => {
    draw()
    const picker = await screen.findByLabelText<HTMLSelectElement>('Task engine')
    // The remote one is offered although it drives no board here: a task is ordinary queue
    // work, and a machine of its own is the setup the mode is happiest in.
    expect(
      within(picker).getByRole('option', { name: 'Stockfish 17 (big) · gpu-box' }),
    ).toBeInTheDocument()
    expect(picker).toHaveValue('')

    await userEvent.selectOptions(picker, '9')
    await userEvent.click(screen.getByRole('button', { name: /Save/ }))
    await waitFor(() => expect(sent).not.toBeNull())
    expect(sent?.correspondence_task_engine_id).toBe(9)
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
