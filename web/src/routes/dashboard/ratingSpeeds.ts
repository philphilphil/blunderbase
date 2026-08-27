/**
 * The rating card's per-speed chart visibility — a view preference, not data. The stored
 * set is what's HIDDEN rather than what's shown, so a speed that starts appearing later
 * (a first bullet game, say) defaults to visible without this module ever having heard of
 * it. Lives beside `stats/kit` window prefs in spirit but is its own tiny store, following
 * `games/savedFilters.ts`'s localStorage + `useSyncExternalStore` idiom.
 */
import { useSyncExternalStore } from 'react'

export const HIDDEN_RATING_SPEEDS_KEY = 'blunderbase.hiddenRatingSpeeds'

let cache: Set<string> | null = null
const listeners = new Set<() => void>()

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    // Storage disabled: nothing hides, nothing persists.
    return null
  }
}

function readHiddenSpeeds(): Set<string> {
  const store = storage()
  if (!store) return new Set()
  try {
    const raw = store.getItem(HIDDEN_RATING_SPEEDS_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((entry): entry is string => typeof entry === 'string'))
  } catch {
    // Corrupt or unreadable: everything stays visible rather than throwing.
    return new Set()
  }
}

function snapshot(): Set<string> {
  if (cache === null) cache = readHiddenSpeeds()
  return cache
}

function write(next: Set<string>): void {
  cache = next
  const store = storage()
  try {
    store?.setItem(HIDDEN_RATING_SPEEDS_KEY, JSON.stringify([...next]))
  } catch {
    // Quota or a private window: the toggle still holds for this session.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== HIDDEN_RATING_SPEEDS_KEY) return
    cache = readHiddenSpeeds()
    for (const each of listeners) each()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** Flips one speed's membership in the hidden set. */
export function toggleHiddenSpeed(speed: string): void {
  const current = snapshot()
  const next = new Set(current)
  if (next.has(speed)) next.delete(speed)
  else next.add(speed)
  write(next)
}

/** Test seam: forget what was read, so the next read hits storage again. */
export function resetHiddenSpeeds(): void {
  cache = null
  for (const listener of listeners) listener()
}

const EMPTY: Set<string> = new Set()

export function useHiddenSpeeds(): Set<string> {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY)
}
