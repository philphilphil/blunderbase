/**
 * The engine line preview's per-browser settings — row-hover mode, scrub, depth, colours,
 * playthrough tempo. A reading preference, not a fact about any game, so it uses a
 * localStorage + `useSyncExternalStore` adapter rather than component-local state.
 *
 * This is one JSON object with two nested groups
 * (`play`, `overlay`). Reads are validated field by field: a value that fails its own
 * check falls back to that field's default rather than discarding the whole blob, so a
 * stale or hand-edited entry degrades gracefully instead of resetting everything.
 */
import { useSyncExternalStore } from 'react'

import { LINE_PREVIEW_DEFAULTS, type LinePreviewPrefs } from './linePreview'

export const LINE_PREVIEW_KEY = 'blunderbase.linePreview'

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

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function readRow(value: unknown): LinePreviewPrefs['row'] {
  const rows: LinePreviewPrefs['row'][] = ['arrows', 'overlay', 'play', 'peek', 'off']
  return rows.includes(value as LinePreviewPrefs['row'])
    ? (value as LinePreviewPrefs['row'])
    : LINE_PREVIEW_DEFAULTS.row
}

function readLabels(value: unknown): LinePreviewPrefs['labels'] {
  return value === 'move' || value === 'ply' ? value : LINE_PREVIEW_DEFAULTS.labels
}

function readBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function readPlay(value: unknown): LinePreviewPrefs['play'] {
  const defaults = LINE_PREVIEW_DEFAULTS.play
  const raw = isRecord(value) ? value : {}
  return {
    tempo: clampNumber(raw.tempo, 100, 2000, defaults.tempo),
    delay: clampNumber(raw.delay, 0, 2000, defaults.delay),
    loop: readBool(raw.loop, defaults.loop),
    ahead: readBool(raw.ahead, defaults.ahead),
  }
}

function readOverlay(value: unknown): LinePreviewPrefs['overlay'] {
  const defaults = LINE_PREVIEW_DEFAULTS.overlay
  const raw = isRecord(value) ? value : {}
  return { dim: readBool(raw.dim, defaults.dim) }
}

/** Validates field by field so one bad entry does not take the rest of the blob with it. */
function sanitize(raw: unknown): LinePreviewPrefs {
  const record = isRecord(raw) ? raw : {}
  return {
    row: readRow(record.row),
    scrub: readBool(record.scrub, LINE_PREVIEW_DEFAULTS.scrub),
    lookahead: clampInt(record.lookahead, 0, 4, LINE_PREVIEW_DEFAULTS.lookahead) as LinePreviewPrefs['lookahead'],
    depth: clampInt(record.depth, 1, 18, LINE_PREVIEW_DEFAULTS.depth),
    badges: readBool(record.badges, LINE_PREVIEW_DEFAULTS.badges),
    labels: readLabels(record.labels),
    bySide: readBool(record.bySide, LINE_PREVIEW_DEFAULTS.bySide),
    fade: readBool(record.fade, LINE_PREVIEW_DEFAULTS.fade),
    play: readPlay(record.play),
    overlay: readOverlay(record.overlay),
  }
}

function readPrefs(): LinePreviewPrefs {
  const store = storage()
  if (!store) return LINE_PREVIEW_DEFAULTS
  try {
    const raw = store.getItem(LINE_PREVIEW_KEY)
    if (!raw) return LINE_PREVIEW_DEFAULTS
    const parsed: unknown = JSON.parse(raw)
    return sanitize(parsed)
  } catch {
    // Corrupt or unreadable: defaults rather than throwing.
    return LINE_PREVIEW_DEFAULTS
  }
}

let cache: LinePreviewPrefs | null = null
const listeners = new Set<() => void>()

function snapshot(): LinePreviewPrefs {
  if (cache === null) cache = readPrefs()
  return cache
}

function write(raw: LinePreviewPrefs): void {
  // Sanitised on the way in as well as on the way out: the cache is what every reader sees
  // until the page is reloaded, so an out-of-range value written here would otherwise hold
  // for the session and only be clamped by the next tab to read the key.
  const next = sanitize(raw)
  cache = next
  const store = storage()
  try {
    store?.setItem(LINE_PREVIEW_KEY, JSON.stringify(next))
  } catch {
    // Quota or a private window: the change still holds for this session.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== LINE_PREVIEW_KEY) return
    cache = readPrefs()
    for (const each of listeners) each()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/**
 * Merges a patch over the current prefs. `play` and `overlay` merge one level deeper so a
 * patch to one field of either (`{ play: { tempo: 300 } }`) does not clobber its siblings.
 */
export function setLinePreviewPrefs(
  patch: Partial<Omit<LinePreviewPrefs, 'play' | 'overlay'>> & {
    play?: Partial<LinePreviewPrefs['play']>
    overlay?: Partial<LinePreviewPrefs['overlay']>
  },
): void {
  const current = snapshot()
  write({
    ...current,
    ...patch,
    play: { ...current.play, ...patch.play },
    overlay: { ...current.overlay, ...patch.overlay },
  })
}

/** Test seam: forget what was read, so the next read hits storage again. */
export function resetLinePreviewPrefs(): void {
  cache = null
  for (const listener of listeners) listener()
}

export function useLinePreviewPrefs(): LinePreviewPrefs {
  return useSyncExternalStore(subscribe, snapshot, () => LINE_PREVIEW_DEFAULTS)
}
