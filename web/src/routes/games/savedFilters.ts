/**
 * Design 2b's "Saved filters": the cuts of the library worth one click, and the filter
 * row's "Save filter" affordance that puts one there.
 *
 * Nothing in the API stores UI state, so a saved cut lives in `localStorage` beside the
 * theme preference. A saved filter is only ever a query string over the vocabulary in
 * `./filters` — it is replayed as a link, so it survives a reload, works in a new tab and
 * needs no server round trip.
 *
 * Three built-ins ship so a fresh install has the rail the mock draws. They are not quite
 * the mock's names: the design lists "Losses as black / Time trouble / Unanalysed", and
 * `backend/api/deps.py:game_filters` has no clock filter and no plain `analyzed` flag — so
 * the two it cannot express are the nearest cuts it can, `has_blunders` and `deep_analyzed`.
 */
import { useSyncExternalStore } from 'react'

import {
  FILTER_GROUPS,
  groupSummary,
  paramsFromFilters,
  prune,
  type LibraryFilters,
} from './filters'

export const SAVED_FILTERS_KEY = 'blunderbase.savedFilters'

export interface SavedFilter {
  /** Stable across renders and reloads; the built-ins use their own name. */
  id: string
  label: string
  filters: LibraryFilters
  /** The rail's leading dot. Saved cuts get the neutral one. */
  dotClass: string
  /** Built-ins cannot be removed. */
  builtin?: boolean
}

export const BUILT_IN_FILTERS: readonly SavedFilter[] = [
  {
    id: 'losses-as-black',
    label: 'Losses as black',
    filters: { color: 'black', outcome: 'loss' },
    dotClass: 'bg-blunder',
    builtin: true,
  },
  {
    id: 'with-blunders',
    label: 'Games with blunders',
    filters: { has_blunders: true },
    dotClass: 'bg-mistake',
    builtin: true,
  },
  {
    id: 'no-deep-pass',
    label: 'No deep pass',
    filters: { deep_analyzed: false },
    dotClass: 'bg-faint',
    builtin: true,
  },
]

const SAVED_DOT = 'bg-accent-teal'
/** Enough to fill the rail without pushing the pinned footer off the bottom. */
export const MAX_SAVED_FILTERS = 12
export const MAX_LABEL_LENGTH = 40

// --- the store ------------------------------------------------------------

let cache: SavedFilter[] | null = null
const listeners = new Set<() => void>()

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    // Storage disabled: the built-ins still work, saving quietly does not.
    return null
  }
}

/** One stored entry, or null for anything that is not one. */
function parseEntry(value: unknown): SavedFilter | null {
  if (!value || typeof value !== 'object') return null
  const row = value as { id?: unknown; label?: unknown; filters?: unknown }
  if (typeof row.id !== 'string' || typeof row.label !== 'string') return null
  if (!row.filters || typeof row.filters !== 'object') return null
  const filters = prune(row.filters as LibraryFilters)
  if (Object.keys(filters).length === 0) return null
  return { id: row.id, label: row.label, filters, dotClass: SAVED_DOT }
}

export function readSavedFilters(): SavedFilter[] {
  const store = storage()
  if (!store) return []
  try {
    const raw = store.getItem(SAVED_FILTERS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(parseEntry)
      .filter((entry): entry is SavedFilter => entry !== null)
      .slice(0, MAX_SAVED_FILTERS)
  } catch {
    // Corrupt or unreadable: the rail falls back to the built-ins rather than throwing.
    return []
  }
}

function snapshot(): SavedFilter[] {
  if (cache === null) cache = readSavedFilters()
  return cache
}

function write(next: SavedFilter[]): void {
  cache = next
  const store = storage()
  try {
    store?.setItem(
      SAVED_FILTERS_KEY,
      JSON.stringify(next.map(({ id, label, filters }) => ({ id, label, filters }))),
    )
  } catch {
    // Quota or a private window: the list still holds for this session.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== SAVED_FILTERS_KEY) return
    cache = readSavedFilters()
    for (const each of listeners) each()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** Two filter sets naming the same cut, whatever order the keys went in. */
function fingerprint(filters: LibraryFilters): string {
  const params = paramsFromFilters(filters)
  params.sort()
  return params.toString()
}

/** `Colour: black · loss` -> `colour-black-loss`, unique against what is already there. */
function idFor(label: string, taken: ReadonlySet<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'filter'
  let id = base
  let n = 2
  while (taken.has(id)) {
    id = `${base}-${n}`
    n += 1
  }
  return id
}

/**
 * Save the current cut. A set with nothing in it is not saved — an empty filter is the
 * library itself — and a cut that is already on the list keeps its place under its old
 * name rather than appearing twice.
 */
export function saveFilter(label: string, filters: LibraryFilters): SavedFilter | null {
  const cleaned = prune(filters)
  const name = label.trim().slice(0, MAX_LABEL_LENGTH)
  if (!name || Object.keys(cleaned).length === 0) return null

  const current = snapshot()
  const query = fingerprint(cleaned)
  const existing = current.find((entry) => fingerprint(entry.filters) === query)
  if (existing) return existing

  const entry: SavedFilter = {
    id: idFor(name, new Set([...current.map((row) => row.id), ...BUILT_IN_FILTERS.map((row) => row.id)])),
    label: name,
    filters: cleaned,
    dotClass: SAVED_DOT,
  }
  write([...current, entry].slice(-MAX_SAVED_FILTERS))
  return entry
}

export function removeSavedFilter(id: string): void {
  const current = snapshot()
  const next = current.filter((entry) => entry.id !== id)
  if (next.length !== current.length) write(next)
}

/** Test seam: forget what was read, so the next read hits storage again. */
export function resetSavedFilters(): void {
  cache = null
  for (const listener of listeners) listener()
}

const EMPTY: SavedFilter[] = []

/** The built-ins first, then what the owner saved. */
export function useSavedFilters(): SavedFilter[] {
  const saved = useSyncExternalStore(subscribe, snapshot, () => EMPTY)
  return [...BUILT_IN_FILTERS, ...saved]
}

/**
 * The name the save box starts with: what the chips over the table already say, so the
 * common case is one click. `Colour: black` and `Result: loss` become `black · loss`.
 */
export function suggestLabel(filters: LibraryFilters): string {
  const parts = FILTER_GROUPS.map((group) => groupSummary(group, filters)).filter(
    (part): part is string => part !== null,
  )
  const suggestion = parts.join(' · ')
  return suggestion.length > MAX_LABEL_LENGTH
    ? `${suggestion.slice(0, MAX_LABEL_LENGTH - 1).trimEnd()}…`
    : suggestion
}
