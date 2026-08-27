import { QueryClient, QueryClientProvider, useQuery, type QueryKey } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { queryKeys } from '@/lib/api/keys'
import { onSessionLost, reportSessionRestored } from '@/lib/auth/session'

import { EventsProvider } from './EventsProvider'

/** A socket that never connects on its own, so the test decides when `open` happens. */
class FakeSocket {
  static instances: FakeSocket[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((event?: CloseEvent) => void) | null = null
  url: string
  constructor(url: string) {
    this.url = url
    FakeSocket.instances.push(this)
  }
  close() {}
  open() {
    act(() => this.onopen?.())
  }
  /** The server hanging up, with the code and reason a real `CloseEvent` carries. */
  closedBy(code: number, reason = '') {
    act(() => this.onclose?.({ code, reason } as CloseEvent))
  }
  /** One frame off the wire, exactly as the backend would send it. */
  receive(frame: unknown) {
    act(() => this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent<string>))
  }
}

function Probe({
  queryFn,
  queryKey = ['probe'],
}: {
  queryFn: () => Promise<string>
  queryKey?: QueryKey
}) {
  const query = useQuery({ queryKey, queryFn, retry: false })
  return <span>{query.isError ? 'could not load' : (query.data ?? 'loading')}</span>
}

function renderProbe(queryFn: () => Promise<string>, queryKey?: QueryKey) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 30_000 } },
  })
  vi.stubGlobal('WebSocket', FakeSocket)
  render(
    <QueryClientProvider client={client}>
      <EventsProvider url="ws://events">
        <Probe queryFn={queryFn} queryKey={queryKey} />
      </EventsProvider>
    </QueryClientProvider>,
  )
  return () => FakeSocket.instances.at(-1)!
}

afterEach(() => {
  FakeSocket.instances = []
  vi.unstubAllGlobals()
  vi.useRealTimers()
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

  it('reports a 4401 close as being signed out, and stops instead of reconnecting', async () => {
    vi.useFakeTimers()
    const lost = vi.fn()
    const stop = onSessionLost(lost)
    const socket = renderProbe(async () => 'the library')
    socket().open()

    socket().closedBy(4401, 'unauthorized')

    expect(lost).toHaveBeenCalledWith('unauthorized')
    // The backoff would have opened another socket by now for any other close code.
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(FakeSocket.instances).toHaveLength(1)

    // Signing in again is what makes it worth trying, and then it comes straight back.
    act(() => reportSessionRestored())
    expect(FakeSocket.instances).toHaveLength(2)
    stop()
  })

  it('tells a fresh deployment apart from an expired session on the same close code', async () => {
    const lost = vi.fn()
    const stop = onSessionLost(lost)
    const socket = renderProbe(async () => 'the library')
    socket().closedBy(4401, 'setup_required')

    expect(lost).toHaveBeenCalledWith('setup_required')
    stop()
  })

  it('holds the games table to one refetch per cooldown, and one more after the burst', async () => {
    vi.useFakeTimers()
    const queryFn = vi.fn(async () => 'the library')
    const socket = renderProbe(queryFn, queryKeys.gameCards())
    await act(() => vi.advanceTimersByTimeAsync(0))
    socket().open()
    expect(queryFn).toHaveBeenCalledTimes(1)

    // A batch of sixty analyses: a `done` frame every 100ms for two seconds. Left alone,
    // that is a refetch per 200ms window — ten of them, over the most expensive read there is.
    const done = { event: 'analysis.done', game_id: 4, tier: 'quick', status: 'done' }
    for (let run = 0; run < 20; run += 1) {
      socket().receive({ ...done, run_id: run })
      await act(() => vi.advanceTimersByTimeAsync(100))
    }
    // The first window went straight out; everything after it is waiting on the cooldown.
    expect(queryFn).toHaveBeenCalledTimes(2)

    // Nothing is dropped, though: the state after the last frame is fetched on the trailing
    // edge — once, not once per frame that arrived while the cooldown was running.
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    expect(queryFn).toHaveBeenCalledTimes(3)
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(queryFn).toHaveBeenCalledTimes(3)
  })

  it('leaves a cheap key on the 200ms batch — no cooldown between bursts', async () => {
    vi.useFakeTimers()
    const queryFn = vi.fn(async () => 'the queue')
    const socket = renderProbe(queryFn, queryKeys.queue())
    await act(() => vi.advanceTimersByTimeAsync(0))
    socket().open()

    const progress = { event: 'analysis.progress', run_id: 9, game_id: 4, status: 'running' }
    for (const ply of [1, 2, 3]) {
      socket().receive({ ...progress, done: ply, total: 40 })
      await act(() => vi.advanceTimersByTimeAsync(1_000))
    }

    // One per window rather than one per frame, and no window skipped.
    expect(queryFn).toHaveBeenCalledTimes(4)
  })

  it('reconnects on any other close, which is the backend going away', async () => {
    vi.useFakeTimers()
    const socket = renderProbe(async () => 'the library')
    socket().open()

    socket().closedBy(1006)
    await act(() => vi.advanceTimersByTimeAsync(1_000))

    expect(FakeSocket.instances.length).toBeGreaterThan(1)
  })
})
