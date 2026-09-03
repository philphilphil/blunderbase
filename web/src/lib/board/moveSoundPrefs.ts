/**
 * Whether the board makes a sound as each move lands, and how loud.
 *
 * Stepping through a game is the thing this app is opened to do, and a review done with
 * the arrow keys is a stream of positions with nothing marking where one ends and the next
 * begins. A click per move is the cheapest possible confirmation that the key registered —
 * the same reason a physical set is nicer to play through than a diagram.
 *
 * On by default, which would be rude for almost any other sound: a browser will not let a
 * page make noise before it has been clicked or typed into, and the only thing that plays a
 * move sound here *is* a click or a key, so the first sound can never arrive unasked. The
 * checkbox is in the board's own settings dialog, next to the arrows.
 *
 * The level is a percentage, in steps of five: a slider is the control every other volume
 * in the world is, and the dialog plays the click as it is dragged, which is how a level is
 * chosen. `./moveSound` owns what a percentage means in gain; this file only keeps the
 * number the slider shows. A per-browser preference like `./arrowPrefs` and stored the same
 * way — a localStorage blob behind `useSyncExternalStore`, sanitised field by field so a
 * stale or hand-edited entry degrades to the default for that field rather than for the
 * whole object.
 */
import { useSyncExternalStore } from 'react'

export interface MoveSoundPrefs {
  enabled: boolean
  /** 0-100. Zero is silence, and is left reachable rather than folded into `enabled`. */
  volume: number
}

export const MOVE_SOUND_DEFAULTS: MoveSoundPrefs = { enabled: true, volume: 60 }

export const MOVE_SOUND_KEY = 'blunderbase.moveSound'

/** The slider's granularity. A hundred stops for a click is ninety-five more than anyone
 *  can hear the difference between, and five keeps the readout to round numbers. */
export const MOVE_SOUND_STEP = 5

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

function sanitize(raw: unknown): MoveSoundPrefs {
  const record = isRecord(raw) ? raw : {}
  const { enabled, volume } = record
  return {
    enabled: typeof enabled === 'boolean' ? enabled : MOVE_SOUND_DEFAULTS.enabled,
    volume:
      typeof volume === 'number' && Number.isFinite(volume)
        ? Math.min(100, Math.max(0, Math.round(volume)))
        : MOVE_SOUND_DEFAULTS.volume,
  }
}

function readPrefs(): MoveSoundPrefs {
  const store = storage()
  if (!store) return MOVE_SOUND_DEFAULTS
  try {
    const raw = store.getItem(MOVE_SOUND_KEY)
    if (!raw) return MOVE_SOUND_DEFAULTS
    const parsed: unknown = JSON.parse(raw)
    return sanitize(parsed)
  } catch {
    // Corrupt or unreadable: the default rather than throwing.
    return MOVE_SOUND_DEFAULTS
  }
}

let cache: MoveSoundPrefs | null = null
const listeners = new Set<() => void>()

function snapshot(): MoveSoundPrefs {
  if (cache === null) cache = readPrefs()
  return cache
}

function write(next: MoveSoundPrefs): void {
  cache = sanitize(next)
  const store = storage()
  try {
    store?.setItem(MOVE_SOUND_KEY, JSON.stringify(cache))
  } catch {
    // Quota or a private window: the change still holds for this session.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== MOVE_SOUND_KEY) return
    cache = readPrefs()
    for (const each of listeners) each()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function setMoveSoundPrefs(patch: Partial<MoveSoundPrefs>): void {
  write({ ...snapshot(), ...patch })
}

/**
 * The current prefs without subscribing to them. `./moveSound` reads them inside the effect
 * that plays the click, where a subscription would re-render the whole game view every time
 * the checkbox moves and buy nothing: the value is wanted at the moment of the sound, not
 * at the moment of the render.
 */
export function getMoveSoundPrefs(): MoveSoundPrefs {
  return snapshot()
}

/** Test seam: forget what was read, so the next read hits storage again. */
export function resetMoveSoundPrefs(): void {
  cache = null
  for (const listener of listeners) listener()
}

export function useMoveSoundPrefs(): MoveSoundPrefs {
  return useSyncExternalStore(subscribe, snapshot, () => MOVE_SOUND_DEFAULTS)
}
