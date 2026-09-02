/**
 * Which standing arrows the board draws — the engine's move here, Maia's, and the move the
 * game actually went on to play. Three independent switches rather than one, because the
 * three answer different questions and a reader who wants "what would a 1700 do" does not
 * necessarily want the engine's verdict in the same glance.
 *
 * A per-browser reading preference like `./linePreviewPrefs` and stored the same way — a
 * localStorage blob behind `useSyncExternalStore`, sanitised field by field so a stale or
 * hand-edited entry degrades to the defaults for that field rather than for the whole
 * object. Not `AppSettings`: this is taste and screen, not a fact about any game.
 *
 * Distinct from the `hints` switch on the board's toolbar. `hints` is the self-test gesture
 * — *everything* that answers the position goes away at once, panels included — and these
 * are the standing choice underneath it about which arrows are worth drawing at all.
 */
import { useSyncExternalStore } from 'react'

export interface BoardArrowPrefs {
  /** The engine's own move in the position on the board. */
  engine: boolean
  /** What Maia expects a human of the chosen level to play here. */
  maia: boolean
  /** The move the game actually played from this position. */
  played: boolean
}

export const BOARD_ARROW_DEFAULTS: BoardArrowPrefs = {
  engine: true,
  maia: true,
  played: true,
}

export const BOARD_ARROW_KEY = 'blunderbase.boardArrows'

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    // Storage disabled: prefs hold for this render only.
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function sanitize(raw: unknown): BoardArrowPrefs {
  const record = isRecord(raw) ? raw : {}
  return {
    engine: readBool(record.engine, BOARD_ARROW_DEFAULTS.engine),
    maia: readBool(record.maia, BOARD_ARROW_DEFAULTS.maia),
    played: readBool(record.played, BOARD_ARROW_DEFAULTS.played),
  }
}

function readPrefs(): BoardArrowPrefs {
  const store = storage()
  if (!store) return BOARD_ARROW_DEFAULTS
  try {
    const raw = store.getItem(BOARD_ARROW_KEY)
    if (!raw) return BOARD_ARROW_DEFAULTS
    const parsed: unknown = JSON.parse(raw)
    return sanitize(parsed)
  } catch {
    // Corrupt or unreadable: defaults rather than throwing.
    return BOARD_ARROW_DEFAULTS
  }
}

let cache: BoardArrowPrefs | null = null
const listeners = new Set<() => void>()

function snapshot(): BoardArrowPrefs {
  if (cache === null) cache = readPrefs()
  return cache
}

function write(next: BoardArrowPrefs): void {
  cache = sanitize(next)
  const store = storage()
  try {
    store?.setItem(BOARD_ARROW_KEY, JSON.stringify(cache))
  } catch {
    // Quota or a private window: the change still holds for this session.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== BOARD_ARROW_KEY) return
    cache = readPrefs()
    for (const each of listeners) each()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function setBoardArrowPrefs(patch: Partial<BoardArrowPrefs>): void {
  write({ ...snapshot(), ...patch })
}

/** Test seam: forget what was read, so the next read hits storage again. */
export function resetBoardArrowPrefs(): void {
  cache = null
  for (const listener of listeners) listener()
}

export function useBoardArrowPrefs(): BoardArrowPrefs {
  return useSyncExternalStore(subscribe, snapshot, () => BOARD_ARROW_DEFAULTS)
}
