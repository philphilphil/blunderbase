import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'

import { AutoSyncControl, DEFAULT_MINUTES } from './AutoSyncControl'

let stored: number | null

/** The two calls the control makes, answered the way the backend does: what is in force. */
function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).split('?')[0]
      if (path !== '/api/import/schedule') {
        return new Response(JSON.stringify({ error: 'not_found', detail: path }), { status: 404 })
      }
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { minutes: number | null }
        stored = body.minutes === null ? null : Math.max(1, body.minutes)
      }
      return new Response(JSON.stringify({ minutes: stored }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
}

function puts(): (number | null)[] {
  return vi
    .mocked(fetch)
    .mock.calls.filter(([, init]) => init?.method === 'PUT')
    .map(([, init]) => (JSON.parse(String(init?.body)) as { minutes: number | null }).minutes)
}

function draw() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <Providers client={client}>
      <AutoSyncControl />
    </Providers>,
  )
}

beforeEach(() => {
  stored = null
  stubFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('syncing on a schedule', () => {
  it('switches on at the default and shows what the backend kept', async () => {
    draw()
    const box = await screen.findByRole('checkbox', { name: 'Sync automatically' })
    await waitFor(() => expect(box).toBeEnabled())
    expect(box).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('textbox', { name: 'Minutes between syncs' })).toBeDisabled()

    await userEvent.click(box)

    await waitFor(() => expect(box).toHaveAttribute('aria-checked', 'true'))
    expect(puts()).toEqual([DEFAULT_MINUTES])
    expect(screen.getByRole('textbox', { name: 'Minutes between syncs' })).toHaveValue(
      String(DEFAULT_MINUTES),
    )
  })

  it('saves a new number on Enter, and puts back the old one for nonsense', async () => {
    stored = 30
    draw()
    const field = await screen.findByRole('textbox', { name: 'Minutes between syncs' })
    await waitFor(() => expect(field).toHaveValue('30'))

    await userEvent.clear(field)
    await userEvent.type(field, '15{Enter}')

    await waitFor(() => expect(puts()).toEqual([15]))
    await waitFor(() => expect(field).toHaveValue('15'))

    await userEvent.clear(field)
    await userEvent.type(field, '0{Enter}')

    expect(puts()).toEqual([15])
    expect(field).toHaveValue('15')
  })

  it('switches off with a null and keeps the number in the greyed box', async () => {
    stored = 45
    draw()
    const box = await screen.findByRole('checkbox', { name: 'Sync automatically' })
    await waitFor(() => expect(box).toHaveAttribute('aria-checked', 'true'))

    await userEvent.click(box)

    await waitFor(() => expect(box).toHaveAttribute('aria-checked', 'false'))
    expect(puts()).toEqual([null])
    const field = screen.getByRole('textbox', { name: 'Minutes between syncs' })
    expect(field).toBeDisabled()
    expect(field).toHaveValue('45')
  })
})
