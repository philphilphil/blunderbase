/**
 * How the reader wants the human column read: which Maia level it speaks for, and whether
 * it is one level or all of them side by side.
 *
 * Both are the reader's, not the deployment's — the configured levels are a fact about what
 * has been computed (`useMaiaElos`), while these two are a way of looking at it, and a way
 * of looking at it should survive stepping to the next game. So they live in `localStorage`
 * beside the theme and the moves-column width, on `lib/board/linePreviewPrefs.ts`'s
 * `useSyncExternalStore` idiom: two components read the same value and both re-render when
 * either writes it.
 *
 * The level is remembered as the number the owner picked rather than as a level some run
 * happened to have. A pick of 1700 against a game analysed at 1500 is still a pick of 1700
 * — `maiaLevelFor` resolves it against whatever that position actually carries.
 */
import { useSyncExternalStore } from 'react'

export const MAIA_ELO_KEY = 'bb.maia.elo'
export const MAIA_COMPARE_KEY = 'bb.maia.compare'

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    // Storage disabled: the pick holds for this render only.
    return null
  }
}

function read(key: string): string | null {
  const store = storage()
  if (!store) return null
  try {
    return store.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null): void {
  const store = storage()
  try {
    if (value === null) store?.removeItem(key)
    else store?.setItem(key, value)
  } catch {
    // Quota or a private window: the pick still holds for this session.
  }
}

const listeners = new Set<() => void>()

function announce(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== MAIA_ELO_KEY && event.key !== MAIA_COMPARE_KEY) return
    elo = undefined
    compare = undefined
    announce()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

// `undefined` is "not read yet"; `null` is "read, and nobody has picked one".
let elo: number | null | undefined
let compare: boolean | undefined

function eloSnapshot(): number | null {
  if (elo === undefined) {
    const raw = read(MAIA_ELO_KEY)
    const parsed = raw === null ? Number.NaN : Number(raw)
    // Anything that is not a level is no level, and the deployment's own preference stands.
    elo = Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }
  return elo
}

function compareSnapshot(): boolean {
  if (compare === undefined) compare = read(MAIA_COMPARE_KEY) === 'true'
  return compare
}

/** The level the reader picked, or null for "whatever the deployment prefers". */
export function useMaiaEloPick(): number | null {
  return useSyncExternalStore(subscribe, eloSnapshot, () => null)
}

export function setMaiaEloPick(next: number | null): void {
  elo = next
  write(MAIA_ELO_KEY, next === null ? null : String(next))
  announce()
}

/** Whether the human column is one level or every level side by side. */
export function useMaiaCompare(): boolean {
  return useSyncExternalStore(subscribe, compareSnapshot, () => false)
}

export function setMaiaCompare(next: boolean): void {
  compare = next
  write(MAIA_COMPARE_KEY, String(next))
  announce()
}

/** Test seam: forget what was read, so the next read hits storage again. */
export function resetMaiaPreferences(): void {
  elo = undefined
  compare = undefined
  announce()
}
