/**
 * The record of a whole-library analysis pass, kept where a reload can find it.
 *
 * A backfill runs for hours, and the screen that watches it is the whole app (see
 * `components/shell/BackfillTakeover.tsx`). Nothing in the API remembers that *this*
 * browser started one — `/analysis/queue` only knows there is work — so the three facts
 * the takeover cannot derive live in `localStorage` beside the theme and the saved
 * filters: which tier, how many runs the POST took on, and when it began. Everything else
 * is read back off the queue.
 *
 * Follows `routes/engines/expertMode.ts`'s localStorage + `useSyncExternalStore` idiom, so
 * a second tab watching the same pass follows along and clears with it.
 */
import { useSyncExternalStore } from 'react'

import type { Tier } from '@/lib/api/types'

export const BACKFILL_RUN_KEY = 'blunderbase.analysisBackfill'

export interface BackfillRun {
  tier: Tier
  /** What the POST reported as queued — the denominator the takeover counts towards. */
  total: number
  /** Epoch milliseconds, which is what the ETA measures elapsed time against. */
  startedAt: number
}

let cache: BackfillRun | null | undefined
const listeners = new Set<() => void>()

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    // Storage disabled: the pass still runs, it just cannot survive a reload.
    return null
  }
}

function isRun(value: unknown): value is BackfillRun {
  if (!value || typeof value !== 'object') return false
  const run = value as Partial<BackfillRun>
  return (
    (run.tier === 'quick' || run.tier === 'deep') &&
    typeof run.total === 'number' &&
    run.total > 0 &&
    typeof run.startedAt === 'number' &&
    Number.isFinite(run.startedAt)
  )
}

function read(): BackfillRun | null {
  const store = storage()
  if (!store) return null
  try {
    const raw = store.getItem(BACKFILL_RUN_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    // A record written by an older build, or half-written: no pass is better than a
    // takeover counting towards a number that means nothing.
    return isRun(parsed) ? parsed : null
  } catch {
    return null
  }
}

function snapshot(): BackfillRun | null {
  if (cache === undefined) cache = read()
  return cache
}

function announce(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== BACKFILL_RUN_KEY) return
    cache = read()
    announce()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** Enter the takeover: every mounted reader sees the run on the next render. */
export function startBackfillRun(run: BackfillRun): void {
  cache = run
  try {
    storage()?.setItem(BACKFILL_RUN_KEY, JSON.stringify(run))
  } catch {
    // Quota or a private window: the takeover still holds until the tab is reloaded.
  }
  announce()
}

/** Release the app — the pass drained, or the owner cancelled it. */
export function clearBackfillRun(): void {
  cache = null
  try {
    storage()?.removeItem(BACKFILL_RUN_KEY)
  } catch {
    // Nothing to undo: a store that will not delete never stored anything either.
  }
  announce()
}

/** Test seam: forget what was read, so the next read hits storage again. */
export function resetBackfillRun(): void {
  cache = undefined
  announce()
}

/** The pass this browser is watching, or null when the app is its own again. */
export function useBackfillRun(): BackfillRun | null {
  return useSyncExternalStore(subscribe, snapshot, () => null)
}
