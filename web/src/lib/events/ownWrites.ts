import type { QueryClient, QueryKey } from '@tanstack/react-query'

import type { EventName } from './types'

/**
 * A tab's own writes, and the socket frame each one echoes back to the same tab.
 *
 * The tab that puts games in a collection refreshes what moved the moment its request
 * answers: it cannot wait for the socket, which may be down. The server announces the same
 * write on the socket too, and that frame used to invalidate the same roots a flush later —
 * with TanStack's default `cancelRefetch`, which cancels the refetches the tab had just
 * started and sends them again, while the server went on computing the ones given up on.
 * That abandoned-request pile-up is what took the production box down. Here the tab keeps
 * its own refresh and recognises the frame that only repeats it, so each read goes out once.
 *
 * A frame is matched to a write by what it is about — the collection and whether games
 * moved (`FrameSubject`, `WriteSubject`) — never by which query keys it names. Two writes in
 * a row, a rule saved and then applied, name nested keys; matched by keys, the first one's
 * late echo would pass for the second's, and the second's real echo would then go through
 * and refetch everything again.
 *
 * The frame is emitted before the response is written, so it can arrive on either side of
 * it. One that arrives while a write of this tab is still in flight is held until the write
 * answers. Then it is the write's echo, or the late echo of an earlier write still expected,
 * and dropped; or else it is somebody else's frame, dropped all the same if what the write
 * refreshes covers it — the refresh starts after the write and after whatever change the
 * frame was about, so it reads both — and otherwise let through. Only the echo counts as
 * heard. A write whose echo has not arrived by the time it refreshes leaves an expectation
 * that its echo, within `ECHO_WINDOW_MS`, consumes. Only a write the server announces leaves
 * one or hears one (`announced`), so a write that moved nothing cannot swallow somebody
 * else's news.
 *
 * The refresh itself goes through the events provider when one is listening
 * (`setRefreshSink`), which counts it as that key's flush. A frame about something else
 * for the same roots — an analysis batch's `done`, its cooldown coming due — then waits out
 * the cooldown behind the write's refetch instead of cancelling it and sending it again.
 *
 * Other tabs never write, so nothing here changes what the socket does for them.
 */

/** How long after a write its echo is still expected. The frame is sent before the response. */
export const ECHO_WINDOW_MS = 2_000

/** What a frame is about: its collection (null for several at once) and whether games moved. */
export interface FrameSubject {
  id: number | null
  membership: boolean
}

/**
 * What a write's echo will be about. `membership` is null when the write cannot tell from
 * its answer whether games moved — deleting a collection the tab had no count for — and
 * either frame about that collection is then its echo.
 */
export interface WriteSubject {
  id: number
  membership: boolean | null
}

interface Expected {
  event: EventName
  subject: WriteSubject
  at: number
}

interface Held {
  event: EventName
  keys: QueryKey[]
  subject: FrameSubject
}

let writing = 0
let expected: Expected[] = []
let held: Held[] = []
let sink: ((keys: QueryKey[]) => void) | null = null
let refresher: ((keys: QueryKey[]) => void) | null = null

/**
 * Where a held frame's keys go when it turns out not to be an echo: the events provider's
 * pending invalidations. Returns the unregister.
 */
export function setHeldFrameSink(next: (keys: QueryKey[]) => void): () => void {
  sink = next
  return () => {
    if (sink === next) sink = null
  }
}

/**
 * Who refreshes what a write moved: the events provider, which invalidates the keys at once
 * and counts that as their flush, so its cooldowns hold the next frame for them back — and
 * which holds a key whose fetch is still running behind that fetch rather than cancelling it.
 * Without one — no provider mounted — the write invalidates the keys itself. Returns the
 * unregister.
 */
export function setRefreshSink(next: (keys: QueryKey[]) => void): () => void {
  refresher = next
  return () => {
    if (refresher === next) refresher = null
  }
}

/**
 * What a `collections.changed` frame is about, read off the wire. A frame without
 * `membership` is from a server that did not say, and is taken as moved, as the
 * invalidation table takes it.
 */
export function collectionsFrameSubject(event: object): FrameSubject {
  const { collection_id, membership } = event as { collection_id?: unknown; membership?: unknown }
  return {
    id: typeof collection_id === 'number' ? collection_id : null,
    membership: membership !== false,
  }
}

/**
 * The keys a frame should still invalidate, after taking out an echo of this tab's own
 * write. Called by the events provider for the events a write can echo.
 */
export function screenFrame(event: EventName, keys: QueryKey[], subject: FrameSubject): QueryKey[] {
  if (keys.length === 0) return keys
  if (writing > 0) {
    held.push({ event, keys, subject })
    return []
  }
  return takeExpected(event, subject) ? [] : keys
}

/**
 * Run one write of this tab's, then refresh what it moved — once — and take the socket's
 * echo of it out of the socket's hands.
 *
 * `refreshes` reads the answer: which query roots moved, whether the server announces the
 * write as `event` (a write that changed nothing announces nothing), and what that
 * announcement will be about (`subject`), which is how its echo is told from other frames.
 */
export async function ownWrite<T>(
  client: QueryClient,
  event: EventName,
  write: () => Promise<T>,
  refreshes: (result: T) => { keys: QueryKey[]; announced: boolean; subject: WriteSubject },
): Promise<T> {
  writing += 1
  let result: T
  try {
    result = await write()
  } catch (error) {
    writing -= 1
    // Nothing was refreshed, so everything held goes through as if nobody had waited.
    if (writing === 0) releaseHeld()
    throw error
  }
  writing -= 1
  const { keys, announced, subject } = refreshes(result)
  if (refresher) refresher(keys)
  else for (const queryKey of keys) void client.invalidateQueries({ queryKey })
  let heard = false
  held = held.filter((frame) => {
    if (frame.event !== event) return true
    // This write's own echo, once: a second frame like it is somebody else's.
    if (announced && !heard && isEcho(subject, frame.subject)) {
      heard = true
      return false
    }
    // An earlier write's echo arriving late — that write refreshed for it already.
    if (takeExpected(frame.event, frame.subject)) return false
    // Somebody else's news that this refresh reads anyway.
    return !covers(keys, frame.keys)
  })
  if (writing === 0) releaseHeld()
  if (announced && !heard) expected.push({ event, subject, at: Date.now() })
  return result
}

/** Forget every write, hold and expectation. For tests, which share this module. */
export function resetOwnWrites(): void {
  writing = 0
  expected = []
  held = []
}

/**
 * Let every held frame through; only once no write is left that could be its source. An
 * earlier write's late echo among them is still that write's, and goes no further.
 */
function releaseHeld(): void {
  const out = held
  held = []
  for (const frame of out) {
    if (!takeExpected(frame.event, frame.subject)) sink?.(frame.keys)
  }
}

/** Consume the expectation, still in its window, that this frame is the echo of. */
function takeExpected(event: EventName, subject: FrameSubject): boolean {
  const now = Date.now()
  expected = expected.filter((entry) => now - entry.at <= ECHO_WINDOW_MS)
  const index = expected.findIndex(
    (entry) => entry.event === event && isEcho(entry.subject, subject),
  )
  if (index === -1) return false
  expected.splice(index, 1)
  return true
}

/** The frame is what the write's announcement would say. */
function isEcho(write: WriteSubject, frame: FrameSubject): boolean {
  return (
    frame.id === write.id && (write.membership === null || write.membership === frame.membership)
  )
}

/** Every key in `keys` is one of `refreshed` or sits under one of them. */
function covers(refreshed: QueryKey[], keys: QueryKey[]): boolean {
  return keys.every((key) => refreshed.some((prefix) => isPrefixOrSame(prefix, key)))
}

/** `key` is `prefix` or sits under it — what invalidating `prefix` refetches. */
export function isPrefixOrSame(prefix: QueryKey, key: QueryKey): boolean {
  if (prefix.length > key.length) return false
  return prefix.every((part, index) => JSON.stringify(part) === JSON.stringify(key[index]))
}
