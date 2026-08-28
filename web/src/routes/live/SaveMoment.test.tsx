import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'

import { SaveMoment } from './SaveMoment'

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

function stubFetch() {
  const fetchMock = vi.fn(async () =>
    new Response(
      JSON.stringify({
        id: 5,
        text: 'remember this',
        tags: [],
        source: 'live',
        created_at: '2026-08-27T10:00:00Z',
        updated_at: '2026-08-27T10:00:00Z',
      }),
      { status: 201, headers: { 'content-type': 'application/json' } },
    ),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function draw(active = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <Providers client={client}>
      <MemoryRouter>
        <SaveMoment active={active} />
      </MemoryRouter>
    </Providers>,
  )
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeSocket)
  stubFetch()
})

afterEach(() => vi.unstubAllGlobals())

describe('SaveMoment', () => {
  it('lets the backend snapshot the board rather than sending a position', async () => {
    const user = userEvent.setup()
    draw()

    await user.click(screen.getByRole('button', { name: /save this moment/i }))
    await user.type(screen.getByLabelText('Note about this position'), 'remember this')
    await user.click(screen.getByRole('button', { name: 'Save note' }))

    await waitFor(() => {
      const posted = vi
        .mocked(fetch)
        .mock.calls.filter(([, init]) => init?.method === 'POST')
        .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>)
      expect(posted).toEqual([{ text: 'remember this', from_live: true }])
    })

    // The confirmation carries a way into the note it just wrote.
    expect(await screen.findByRole('link', { name: 'open it' })).toHaveAttribute(
      'href',
      '/notes?note=5',
    )
  })

  it('is disabled while nothing is on the board', () => {
    draw(false)
    expect(screen.getByRole('button', { name: /save this moment/i })).toBeDisabled()
  })
})
