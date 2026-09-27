import { QueryClient, QueryClientProvider, useQuery, type QueryKey } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { queryKeys } from '@/lib/api/keys'
import { onSessionLost, reportSessionRestored } from '@/lib/auth/session'

import { EventsProvider } from './EventsProvider'
import { invalidationsFor } from './invalidation'
import { ownWrite, resetOwnWrites } from './ownWrites'
import type { AnyEvent } from './types'

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
    const done = { event: 'analysis.done', game_id: 4, requested: false, status: 'done' }
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
    const queryFn = vi.fn(async () => 'the runners')
    const socket = renderProbe(queryFn, queryKeys.runners())
    await act(() => vi.advanceTimersByTimeAsync(0))
    socket().open()

    const updated = { event: 'runner.updated', runner_id: 1, name: 'gpu-1', slots: 4 }
    for (const busy of [1, 2, 3]) {
      socket().receive({ ...updated, busy, connected: true })
      await act(() => vi.advanceTimersByTimeAsync(1_000))
    }

    // One per window rather than one per frame, and no window skipped.
    expect(queryFn).toHaveBeenCalledTimes(4)
  })

  it('holds the analysis queue to one refetch per cooldown, and one more after the burst', async () => {
    vi.useFakeTimers()
    const queryFn = vi.fn(async () => 'the queue')
    const socket = renderProbe(queryFn, queryKeys.queue())
    await act(() => vi.advanceTimersByTimeAsync(0))
    socket().open()
    expect(queryFn).toHaveBeenCalledTimes(1)

    // A batch in flight: a `progress` frame every 100ms, well inside the 1s cooldown.
    const progress = { event: 'analysis.progress', run_id: 9, game_id: 4, status: 'running' }
    for (let ply = 0; ply < 5; ply += 1) {
      socket().receive({ ...progress, done: ply, total: 40 })
      await act(() => vi.advanceTimersByTimeAsync(100))
    }
    // The first window went straight out (the leading edge); the rest are held.
    expect(queryFn).toHaveBeenCalledTimes(2)

    // Nothing is dropped: the state after the last frame is fetched on the trailing edge —
    // once, not once per frame that arrived while the cooldown was running.
    await act(() => vi.advanceTimersByTimeAsync(1_000))
    expect(queryFn).toHaveBeenCalledTimes(3)
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(queryFn).toHaveBeenCalledTimes(3)
  })

  it("leaves a game's own analysis runs alone during a queue burst", async () => {
    vi.useFakeTimers()
    const queryFn = vi.fn(async () => 'the runs')
    const socket = renderProbe(queryFn, queryKeys.runs(4))
    await act(() => vi.advanceTimersByTimeAsync(0))
    socket().open()
    expect(queryFn).toHaveBeenCalledTimes(1)

    const progress = { event: 'analysis.progress', run_id: 9, game_id: 4, status: 'running' }
    for (let ply = 0; ply < 5; ply += 1) {
      socket().receive({ ...progress, done: ply, total: 40 })
      await act(() => vi.advanceTimersByTimeAsync(100))
    }
    await act(() => vi.advanceTimersByTimeAsync(5_000))

    // `analysis.progress` only ever touches the queue key — a detail key under the same
    // root is not swept along, cooled or not.
    expect(queryFn).toHaveBeenCalledTimes(1)
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

describe('EventsProvider — a collection write of this tab', () => {
  /**
   * The provider over a client the test holds, with one games query that counts. Each fetch
   * takes `serverMs` to answer.
   */
  function renderGames(serverMs = 1_000) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 30_000 } },
    })
    const fetches = { started: 0, abandoned: 0 }
    const queryFn = ({ signal }: { signal: AbortSignal }) => {
      fetches.started += 1
      signal.addEventListener('abort', () => {
        fetches.abandoned += 1
      })
      return new Promise<string>((resolve) => setTimeout(() => resolve('rows'), serverMs))
    }
    function Games() {
      const query = useQuery({ queryKey: queryKeys.gameCards({}), queryFn })
      return <span>{query.data ?? 'loading'}</span>
    }
    vi.stubGlobal('WebSocket', FakeSocket)
    render(
      <QueryClientProvider client={client}>
        <EventsProvider url="ws://events">
          <Games />
        </EventsProvider>
      </QueryClientProvider>,
    )
    return { client, fetches, socket: () => FakeSocket.instances.at(-1)! }
  }

  const moved = { event: 'collections.changed', collection_id: 3, membership: true }
  const refresh = () => ({
    keys: invalidationsFor(moved as AnyEvent),
    announced: true,
    subject: { id: 3, membership: true },
  })

  afterEach(() => resetOwnWrites())

  it('fetches the games once for its own write, and never gives that fetch up', async () => {
    vi.useFakeTimers()
    const { client, fetches, socket } = renderGames()
    socket().open()
    await act(() => vi.advanceTimersByTimeAsync(1_500))
    expect(fetches.started).toBe(1)

    await act(() => ownWrite(client, 'collections.changed', async () => ({}), refresh))
    // The echo lands while the tab's own refetch is still in flight.
    socket().receive(moved)
    await act(() => vi.advanceTimersByTimeAsync(5_000))

    expect(fetches).toEqual({ started: 2, abandoned: 0 })
  })

  it('does the same when the echo beats the answer to the tab', async () => {
    vi.useFakeTimers()
    const { client, fetches, socket } = renderGames()
    socket().open()
    await act(() => vi.advanceTimersByTimeAsync(1_500))
    let answer!: () => void
    const writing = ownWrite(
      client,
      'collections.changed',
      () => new Promise<void>((resolve) => (answer = resolve)),
      refresh,
    )

    socket().receive(moved)
    await act(() => vi.advanceTimersByTimeAsync(300))
    answer()
    await act(() => writing)
    await act(() => vi.advanceTimersByTimeAsync(5_000))

    expect(fetches).toEqual({ started: 2, abandoned: 0 })
  })

  it('fetches the games once for a rule saved and then applied, whatever order the echoes take', async () => {
    vi.useFakeTimers()
    const { client, fetches, socket } = renderGames()
    socket().open()
    await act(() => vi.advanceTimersByTimeAsync(1_500))
    const saved = { event: 'collections.changed', collection_id: 3, membership: false }
    const saving = () => ({
      keys: invalidationsFor(saved as AnyEvent),
      announced: true,
      subject: { id: 3, membership: false },
    })

    // The save answers before its frame; the apply starts at once and the save's frame
    // lands while it is out. The apply's own frame follows its answer.
    await act(() => ownWrite(client, 'collections.changed', async () => ({}), saving))
    let answer!: () => void
    const applying = ownWrite(
      client,
      'collections.changed',
      () => new Promise<void>((resolve) => (answer = resolve)),
      refresh,
    )
    socket().receive(saved)
    await act(() => vi.advanceTimersByTimeAsync(100))
    answer()
    await act(() => applying)
    socket().receive(moved)
    await act(() => vi.advanceTimersByTimeAsync(10_000))

    expect(fetches).toEqual({ started: 2, abandoned: 0 })
  })

  it('does not let an analysis batch cancel the refetch its own write started', async () => {
    vi.useFakeTimers()
    const { client, fetches, socket } = renderGames()
    socket().open()
    await act(() => vi.advanceTimersByTimeAsync(1_500))
    const done = { event: 'analysis.done', game_id: 4, requested: false, status: 'done' }

    // A batch is running: one `done` refetched the games, the next waits on the cooldown.
    socket().receive({ ...done, run_id: 1 })
    await act(() => vi.advanceTimersByTimeAsync(1_300))
    socket().receive({ ...done, run_id: 2 })
    await act(() => vi.advanceTimersByTimeAsync(1_200))
    expect(fetches.started).toBe(2)

    // The owner adds games to a collection while that trailing flush is still due, and
    // another game finishes while the write's refetch is in flight.
    await act(() => ownWrite(client, 'collections.changed', async () => ({}), refresh))
    socket().receive({ ...done, run_id: 3 })
    await act(() => vi.advanceTimersByTimeAsync(10_000))

    // The write's refetch read what was held back; the later frame waited its turn behind it.
    expect(fetches).toEqual({ started: 4, abandoned: 0 })
  })

  it('waits behind a games fetch already running instead of cancelling it, for two writes', async () => {
    vi.useFakeTimers()
    const { client, fetches, socket } = renderGames()
    socket().open()
    await act(() => vi.advanceTimersByTimeAsync(1_500))
    expect(fetches.started).toBe(1)

    // A sync's import flush has the games out on the wire when the owner ticks two
    // collections in the Add to… checklist, one right after the other.
    socket().receive({
      event: 'analysis.done',
      game_id: 4,
      run_id: 1,
      requested: false,
      status: 'done',
    })
    await act(() => vi.advanceTimersByTimeAsync(300))
    expect(fetches.started).toBe(2)
    await act(() => ownWrite(client, 'collections.changed', async () => ({}), refresh))
    await act(() => ownWrite(client, 'collections.changed', async () => ({}), refresh))
    expect(fetches).toEqual({ started: 2, abandoned: 0 })

    // The running fetch answers untouched, and both writes are read by one fetch after it.
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(fetches).toEqual({ started: 3, abandoned: 0 })
  })

  it('holds the trailing refetch back while a slow games fetch is still running', async () => {
    vi.useFakeTimers()
    const { client, fetches, socket } = renderGames(5_000)
    socket().open()
    await act(() => vi.advanceTimersByTimeAsync(5_500))
    expect(fetches.started).toBe(1)

    // The first tick refetches at once; the second waits behind that fetch, which on this
    // server outlasts the cooldown, so the trailing edge has to wait again rather than give
    // it up.
    await act(() => ownWrite(client, 'collections.changed', async () => ({}), refresh))
    await act(() => vi.advanceTimersByTimeAsync(100))
    await act(() => ownWrite(client, 'collections.changed', async () => ({}), refresh))
    await act(() => vi.advanceTimersByTimeAsync(4_000))
    expect(fetches).toEqual({ started: 2, abandoned: 0 })

    await act(() => vi.advanceTimersByTimeAsync(20_000))
    expect(fetches).toEqual({ started: 3, abandoned: 0 })
  })

  it('still refreshes a tab that wrote nothing from the socket', async () => {
    vi.useFakeTimers()
    const { fetches, socket } = renderGames()
    socket().open()
    await act(() => vi.advanceTimersByTimeAsync(1_500))

    socket().receive(moved)
    await act(() => vi.advanceTimersByTimeAsync(5_000))

    expect(fetches).toEqual({ started: 2, abandoned: 0 })
  })

  it('refreshes only the collections for a change that moved no game', async () => {
    vi.useFakeTimers()
    const { fetches, socket } = renderGames()
    socket().open()
    await act(() => vi.advanceTimersByTimeAsync(1_500))

    socket().receive({ ...moved, membership: false })
    await act(() => vi.advanceTimersByTimeAsync(5_000))

    expect(fetches.started).toBe(1)
  })
})
