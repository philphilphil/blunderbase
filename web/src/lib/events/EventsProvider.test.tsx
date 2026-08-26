import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EventsProvider } from './EventsProvider'

/** A socket that never connects on its own, so the test decides when `open` happens. */
class FakeSocket {
  static instances: FakeSocket[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  url: string
  constructor(url: string) {
    this.url = url
    FakeSocket.instances.push(this)
  }
  close() {}
  open() {
    act(() => this.onopen?.())
  }
}

function Probe({ queryFn }: { queryFn: () => Promise<string> }) {
  const query = useQuery({ queryKey: ['probe'], queryFn, retry: false })
  return <span>{query.isError ? 'could not load' : (query.data ?? 'loading')}</span>
}

function renderProbe(queryFn: () => Promise<string>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 30_000 } },
  })
  vi.stubGlobal('WebSocket', FakeSocket)
  render(
    <QueryClientProvider client={client}>
      <EventsProvider url="ws://events">
        <Probe queryFn={queryFn} />
      </EventsProvider>
    </QueryClientProvider>,
  )
  return () => FakeSocket.instances.at(-1)!
}

afterEach(() => {
  FakeSocket.instances = []
  vi.unstubAllGlobals()
})

describe('EventsProvider', () => {
  it('sends the queries that failed while the backend was down back out on the first connect', async () => {
    // The app opened before the API was up: the first request failed and, with retries
    // exhausted and no refetch on focus, nothing would ever ask again.
    let up = false
    const queryFn = vi.fn(async () => {
      if (!up) throw new Error('connection refused')
      return 'the library'
    })
    const socket = renderProbe(queryFn)
    expect(await screen.findByText('could not load')).toBeInTheDocument()

    up = true
    socket().open()
    expect(await screen.findByText('the library')).toBeInTheDocument()
    expect(queryFn).toHaveBeenCalledTimes(2)
  })

  it('leaves a query that succeeded alone when the socket first connects', async () => {
    const queryFn = vi.fn(async () => 'the library')
    const socket = renderProbe(queryFn)
    expect(await screen.findByText('the library')).toBeInTheDocument()

    socket().open()
    await act(async () => {})
    expect(queryFn).toHaveBeenCalledTimes(1)
  })
})
