/**
 * Which book the game screen's Book tab reads, and how the Lichess one is filtered.
 *
 * The same three sources as `/explorer` — the owner's own games, Lichess's masters database,
 * its rated games — and the same Lichess filters, read through the explorer's own parsers so
 * a stored list can never be empty or carry a band Lichess does not know. Unlike the
 * explorer's, these are not in the URL: the explorer's address is a position someone can
 * link to, while this is how one reader likes their game screen, so it is a per-browser
 * preference like the board's (`lib/board/arrowPrefs`).
 *
 * Masters has no filters to store. It is one book of over-the-board games, with no speed
 * and no rating band to choose.
 */
import { useSyncExternalStore } from 'react'

import { viewPreference } from '@/lib/ui/viewPreference'
import {
  DEFAULT_RATINGS,
  DEFAULT_SPEEDS,
  SOURCES,
  parseRatings,
  parseSpeeds,
  type ExplorerSource,
  type Speed,
} from '@/routes/explorer/reference'

export const BOOK_SOURCE_KEY = 'blunderbase.bookSource'
export const BOOK_SPEEDS_KEY = 'blunderbase.bookSpeeds'
export const BOOK_RATINGS_KEY = 'blunderbase.bookRatings'

/** The owner's own games until they pick another book; no request leaves the machine before that. */
export const bookSource = viewPreference<ExplorerSource>(BOOK_SOURCE_KEY, SOURCES, 'mine')

export interface BookFilters {
  speeds: Speed[]
  ratings: number[]
}

const DEFAULT_FILTERS: BookFilters = { speeds: [...DEFAULT_SPEEDS], ratings: [...DEFAULT_RATINGS] }

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    // Storage disabled: the filters hold for this session and are not written down.
    return null
  }
}

function read(): BookFilters {
  try {
    const store = storage()
    return {
      speeds: parseSpeeds(store?.getItem(BOOK_SPEEDS_KEY) ?? null),
      ratings: parseRatings(store?.getItem(BOOK_RATINGS_KEY) ?? null),
    }
  } catch {
    return DEFAULT_FILTERS
  }
}

let cache: BookFilters | null = null
const listeners = new Set<() => void>()

function snapshot(): BookFilters {
  if (cache === null) cache = read()
  return cache
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== BOOK_SPEEDS_KEY && event.key !== BOOK_RATINGS_KEY) return
    cache = read()
    for (const each of listeners) each()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** Change one list or both; each is checked by the explorer's parsers on the way in. */
export function setBookFilters(patch: Partial<BookFilters>): void {
  const next = { ...snapshot(), ...patch }
  cache = { speeds: parseSpeeds(next.speeds.join(',')), ratings: parseRatings(next.ratings.join(',')) }
  try {
    storage()?.setItem(BOOK_SPEEDS_KEY, cache.speeds.join(','))
    storage()?.setItem(BOOK_RATINGS_KEY, cache.ratings.join(','))
  } catch {
    // Quota or a private window: the change still holds for this session.
  }
  for (const listener of listeners) listener()
}

/** Back to the explorer's defaults. */
export function resetBookFilters(): void {
  setBookFilters(DEFAULT_FILTERS)
}

/** Test seam: forget what was read, so the next read hits storage again. */
export function forgetBookFilters(): void {
  cache = null
  for (const listener of listeners) listener()
}

export function useBookFilters(): BookFilters {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULT_FILTERS)
}
