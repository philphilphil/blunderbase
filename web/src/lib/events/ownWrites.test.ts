import { QueryClient, QueryObserver, type QueryKey } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { queryKeys } from '@/lib/api/keys'

import { invalidationsFor } from './invalidation'
import {
  collectionsFrameSubject,
  ECHO_WINDOW_MS,
  ownWrite,
  resetOwnWrites,
  screenFrame,
  setHeldFrameSink,
} from './ownWrites'

const MOVED = invalidationsFor({ event: 'collections.changed', collection_id: 1, membership: true })
const RENAMED = invalidationsFor({
  event: 'collections.changed',
  collection_id: 1,
  membership: false,
})
/** What those two frames are about, as the provider reads it off the wire. */
const MOVED_ABOUT = { id: 1, membership: true }
const RENAMED_ABOUT = { id: 1, membership: false }
/** A write's answer read: games put in collection 1, or collection 1 renamed. */
const MOVES = { keys: MOVED, announced: true, subject: MOVED_ABOUT }
const RENAMES = { keys: RENAMED, announced: true, subject: RENAMED_ABOUT }

/** A write whose answer the test hands over when it chooses, like a request in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

/**
 * A client with one mounted games query whose every fetch is counted, and whose fetches
 * that were given up on — the signal aborted — are counted too.
 */
function mountedGames() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const fetches = { started: 0, abandoned: 0 }
  const observer = new QueryObserver(client, {
    queryKey: ['games', 'cards', {}],
    queryFn: ({ signal }) => {
      fetches.started += 1
      signal.addEventListener('abort', () => {
        fetches.abandoned += 1
      })
      return new Promise<string>((resolve) => setTimeout(() => resolve('rows'), 500))
    },
  })
  const stop = observer.subscribe(() => {})
  return { client, fetches, stop }
}

let sunk: QueryKey[][] = []
let stopSink: () => void = () => {}

beforeEach(() => {
  vi.useFakeTimers()
  resetOwnWrites()
  sunk = []
  stopSink = setHeldFrameSink((keys) => sunk.push(keys))
})

afterEach(() => {
  stopSink()
  resetOwnWrites()
  vi.useRealTimers()
})

describe('ownWrite', () => {
  it('refreshes what the write moved once, and drops the echo that arrives after it', async () => {
    const { client, fetches, stop } = mountedGames()
    await vi.advanceTimersByTimeAsync(600)
    expect(fetches.started).toBe(1)

    await ownWrite(client, 'collections.changed', async () => ({ added: 2 }), () => MOVES)
    expect(fetches.started).toBe(2)

    // The socket's frame for the same write, a flush later: nothing left for it to do.
    expect(screenFrame('collections.changed', MOVED, MOVED_ABOUT)).toEqual([])
    await vi.advanceTimersByTimeAsync(600)
    expect(fetches).toEqual({ started: 2, abandoned: 0 })
    stop()
  })

  it('is what stands between the refresh and the echo cancelling it', async () => {
    // The harness sees the pile-up: the echo invalidated as it used to be, unscreened.
    const { client, fetches, stop } = mountedGames()
    await vi.advanceTimersByTimeAsync(600)
    await ownWrite(client, 'collections.changed', async () => ({}), () => MOVES)

    void client.invalidateQueries({ queryKey: queryKeys.games() })
    await vi.advanceTimersByTimeAsync(600)

    expect(fetches).toEqual({ started: 3, abandoned: 1 })
    stop()
  })

  it('holds a frame that arrives before the answer, and drops it once the write refreshes', async () => {
    const { client, fetches, stop } = mountedGames()
    await vi.advanceTimersByTimeAsync(600)
    const answer = deferred<{ added: number }>()

    const writing = ownWrite(client, 'collections.changed', () => answer.promise, () => MOVES)
    // The server emits before it writes the response, so the frame can come first.
    expect(screenFrame('collections.changed', MOVED, MOVED_ABOUT)).toEqual([])
    answer.resolve({ added: 1 })
    await writing
    await vi.advanceTimersByTimeAsync(600)

    expect(sunk).toEqual([])
    expect(fetches).toEqual({ started: 2, abandoned: 0 })
    // The echo was heard, so the next frame is somebody else's news and goes through.
    expect(screenFrame('collections.changed', MOVED, MOVED_ABOUT)).toEqual(MOVED)
    stop()
  })

  it('lets a held frame through when the write fails, since nothing was refreshed', async () => {
    const client = new QueryClient()
    const answer = deferred<never>()
    const writing = ownWrite(client, 'collections.changed', () => answer.promise, () => MOVES)
    expect(screenFrame('collections.changed', MOVED, MOVED_ABOUT)).toEqual([])

    answer.reject(new Error('409'))
    await expect(writing).rejects.toThrow('409')

    expect(sunk).toEqual([MOVED])
  })

  it('lets a held frame through that says more than the write refreshed', async () => {
    const client = new QueryClient()
    const answer = deferred<object>()
    // A rename in flight while an import's rule filled a collection: that frame is news.
    const writing = ownWrite(client, 'collections.changed', () => answer.promise, () => RENAMES)
    expect(screenFrame('collections.changed', MOVED, MOVED_ABOUT)).toEqual([])
    answer.resolve({})
    await writing

    expect(sunk).toEqual([MOVED])
  })

  it('leaves nothing to swallow for a write the server did not announce', async () => {
    const client = new QueryClient()
    await ownWrite(client, 'collections.changed', async () => ({ added: 0 }), () => ({
      ...RENAMES,
      announced: false,
    }))

    expect(screenFrame('collections.changed', RENAMED, RENAMED_ABOUT)).toEqual(RENAMED)
  })

  it("takes an earlier write's late echo for that write's, not for the one in flight", async () => {
    // A rule saved, then applied at once: the save's echo lands while the apply is out.
    const { client, fetches, stop } = mountedGames()
    await vi.advanceTimersByTimeAsync(600)
    await ownWrite(client, 'collections.changed', async () => ({}), () => RENAMES)
    const answer = deferred<{ added: number }>()
    const applying = ownWrite(client, 'collections.changed', () => answer.promise, () => MOVES)
    expect(screenFrame('collections.changed', RENAMED, RENAMED_ABOUT)).toEqual([])
    answer.resolve({ added: 3 })
    await applying
    await vi.advanceTimersByTimeAsync(600)
    expect(fetches).toEqual({ started: 2, abandoned: 0 })

    // The apply's own echo, after its answer, is still recognised: nothing refetches again.
    expect(screenFrame('collections.changed', MOVED, MOVED_ABOUT)).toEqual([])
    expect(sunk).toEqual([])
    // And the save's expectation was spent on its echo, so another tab's rename is news.
    expect(screenFrame('collections.changed', RENAMED, RENAMED_ABOUT)).toEqual(RENAMED)
    stop()
  })

  it('drops a covered frame about another collection without counting it as the echo', async () => {
    const client = new QueryClient()
    const answer = deferred<object>()
    const writing = ownWrite(client, 'collections.changed', () => answer.promise, () => MOVES)
    // Another tab filled collection 2 while this tab's add to collection 1 was out.
    const elsewhere = { id: 2, membership: true }
    expect(screenFrame('collections.changed', MOVED, elsewhere)).toEqual([])
    answer.resolve({})
    await writing

    // This refresh read that change too, so it goes no further…
    expect(sunk).toEqual([])
    // …but this write's own echo is still to come, and is still taken out.
    expect(screenFrame('collections.changed', MOVED, MOVED_ABOUT)).toEqual([])
  })

  it('lets a frame about the same collection through when this write announced nothing', async () => {
    const client = new QueryClient()
    const answer = deferred<object>()
    const writing = ownWrite(client, 'collections.changed', () => answer.promise, () => ({
      ...RENAMES,
      announced: false,
    }))
    expect(screenFrame('collections.changed', RENAMED, RENAMED_ABOUT)).toEqual([])
    answer.resolve({})
    await writing

    // Covered by the refresh, so dropped; but nothing was heard, and nothing is expected.
    expect(sunk).toEqual([])
    expect(screenFrame('collections.changed', RENAMED, RENAMED_ABOUT)).toEqual(RENAMED)
  })

  it('takes either frame for the echo of a write that could not tell whether games moved', async () => {
    const client = new QueryClient()
    await ownWrite(client, 'collections.changed', async () => undefined, () => ({
      keys: MOVED,
      announced: true,
      subject: { id: 1, membership: null },
    }))

    expect(screenFrame('collections.changed', RENAMED, RENAMED_ABOUT)).toEqual([])
    expect(screenFrame('collections.changed', RENAMED, RENAMED_ABOUT)).toEqual(RENAMED)
  })

  it('stops expecting an echo that never came', async () => {
    const client = new QueryClient()
    await ownWrite(client, 'collections.changed', async () => ({}), () => MOVES)

    vi.advanceTimersByTime(ECHO_WINDOW_MS + 1)

    expect(screenFrame('collections.changed', MOVED, MOVED_ABOUT)).toEqual(MOVED)
  })

  it('passes every frame through in a tab that wrote nothing', () => {
    expect(screenFrame('collections.changed', MOVED, MOVED_ABOUT)).toEqual(MOVED)
    expect(screenFrame('collections.changed', RENAMED, RENAMED_ABOUT)).toEqual(RENAMED)
  })

  it('reads what a frame is about off the wire, a missing flag as moved', () => {
    expect(collectionsFrameSubject({ collection_id: 4, membership: false })).toEqual({
      id: 4,
      membership: false,
    })
    expect(collectionsFrameSubject({ collection_id: 4 })).toEqual({ id: 4, membership: true })
    expect(collectionsFrameSubject({ collection_id: null, membership: true })).toEqual({
      id: null,
      membership: true,
    })
  })

  it('refreshes even with no socket to hear the echo from', async () => {
    const { client, fetches, stop } = mountedGames()
    await vi.advanceTimersByTimeAsync(600)
    stopSink()

    await ownWrite(client, 'collections.changed', async () => ({}), () => ({
      ...MOVES,
      keys: [queryKeys.games()],
    }))
    await vi.advanceTimersByTimeAsync(600)

    expect(fetches).toEqual({ started: 2, abandoned: 0 })
    stop()
  })
})
