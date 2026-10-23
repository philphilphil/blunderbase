/**
 * The live search the titlebar reports, handed across from the page that runs it.
 *
 * A session belongs to the page that opened it (`useStreamSession` closes it on unmount),
 * and its own readout is where that page put it: behind the engine pane's Live tab on the
 * game, in the workspace's foot on the live board. Neither is where a glance goes while a
 * search is left to run for minutes. The shell cannot reach the page's hook, so the hook
 * posts what is worth the glance here and `LiveSearchReadout` reads it back.
 *
 * One slot rather than a list, because one page is mounted at a time and so is one board.
 * Read through `useSyncExternalStore`, like `engineVisibility`.
 */
import { useSyncExternalStore } from 'react'

export interface LiveSearchReading {
  engine: string
  depth: number | null
  nodes: number | null
  /** How long the engine has searched the position on the board — `info time`. */
  timeMs: number | null
}

/**
 * A reading as the slot holds it, stamped with when its `timeMs` arrived. The engine only
 * reports its time on an `info` line, and deep in a search those come tens of seconds
 * apart; the readout runs its clock on from this stamp between them.
 */
export interface StampedLiveSearch extends LiveSearchReading {
  at: number
}

let current: StampedLiveSearch | null = null
const listeners = new Set<() => void>()

function same(a: LiveSearchReading | null, b: LiveSearchReading | null): boolean {
  if (a === null || b === null) return a === b
  return a.engine === b.engine && a.depth === b.depth && a.nodes === b.nodes && a.timeMs === b.timeMs
}

/** Post the running search, or null when nothing on the page is searching. */
export function publishLiveSearch(next: LiveSearchReading | null): void {
  if (same(current, next)) return
  // New nodes or depth on the same `info time` keep the stamp: the time has not moved.
  const at = current && next && current.timeMs === next.timeMs ? current.at : Date.now()
  current = next ? { ...next, at } : null
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The search a page is running right now, if one is. */
export function useLiveSearchReading(): StampedLiveSearch | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  )
}
