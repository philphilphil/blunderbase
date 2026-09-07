/**
 * Whether the engine is allowed to speak at all, in this browser.
 *
 * The gesture this exists for is annotating a game the way it would be annotated on paper:
 * read the moves, decide for yourself where it went wrong, write it down — and only then
 * ask Stockfish whether you were right. Everything the app knows about a game is an engine
 * verdict, and a verdict that is already on the screen cannot be un-read, so the switch has
 * to come before the reading rather than after it.
 *
 * Distinct from the two switches next to it, and the difference is what each one is for:
 *
 * - `lib/board/arrowPrefs` is standing taste — which of the three arrows are worth drawing.
 * - The game view's `hints` is one screen's momentary "don't tell me yet": it empties the
 *   board's arrows and the two engine columns, and it comes back on the next game.
 * - This is the mode. It survives navigation and reloads, it is on every screen the engine
 *   speaks on (the game and the library), and it hides the numbers `hints` deliberately
 *   keeps — the eval bar, the score chip, the curve, the flags in the table.
 *
 * What it does *not* touch is anything the reader asked for by name: queueing a run still
 * works (the point is to check afterwards), and a library filter set to "contains a
 * blunder" is a question they typed rather than an answer they were handed.
 *
 * Stored per browser like the theme, and read through `useSyncExternalStore` like
 * `arrowPrefs` — several screens read it at once and a second tab flipping it should not
 * leave this one disagreeing with storage.
 */
import { useSyncExternalStore } from 'react'

export const ENGINE_HIDDEN_KEY = 'blunderbase.engineHidden'

/** The engine speaks until somebody says otherwise. */
const DEFAULT_HIDDEN = false

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    // Storage disabled: the mode holds for this session only.
    return null
  }
}

function readHidden(): boolean {
  try {
    return storage()?.getItem(ENGINE_HIDDEN_KEY) === 'true'
  } catch {
    return DEFAULT_HIDDEN
  }
}

let cache: boolean | null = null
const listeners = new Set<() => void>()

function snapshot(): boolean {
  if (cache === null) cache = readHidden()
  return cache
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== ENGINE_HIDDEN_KEY) return
    cache = readHidden()
    for (const each of listeners) each()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function setEngineHidden(hidden: boolean): void {
  cache = hidden
  try {
    storage()?.setItem(ENGINE_HIDDEN_KEY, String(hidden))
  } catch {
    // Quota or a private window: the mode still holds for this session.
  }
  for (const listener of listeners) listener()
}

/** Flip it, and report what it became — the shortcut and the button both want that. */
export function toggleEngineHidden(): boolean {
  const next = !snapshot()
  setEngineHidden(next)
  return next
}

/** Test seam: forget what was read, so the next read hits storage again. */
export function resetEngineHidden(): void {
  cache = null
  for (const listener of listeners) listener()
}

/** True while every engine verdict is to be kept off the screen. */
export function useEngineHidden(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULT_HIDDEN)
}
