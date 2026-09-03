/**
 * How the evaluation pane draws the balance: one column per ply, or the filled curve — and
 * what it marks a flagged move with.
 *
 * Bars are the default because they answer "who is this half of the plot" without a
 * convention to recall — every column starts on the 50 % axis and reaches toward the side
 * it favours, so the direction is the reading. The filled curve says the same thing as two
 * thin shapes against a third grey, which is exactly the ambiguity the bars remove; it
 * stays available because it is the better picture of the *shape* of a game, and which of
 * the two a reader wants is taste.
 *
 * A per-browser reading preference like `lib/board/arrowPrefs` and stored the same way — a
 * localStorage blob behind `useSyncExternalStore`, sanitised field by field so a stale or
 * hand-edited entry degrades to the default rather than throwing. Not `AppSettings`: this
 * is taste and screen, not a fact about any game.
 */
import { useSyncExternalStore } from 'react'

export type EvalGraphStyle = 'bars' | 'area'

/** What a flagged ply is marked with on the plot, loudest last. */
export type EvalGraphMarks = 'none' | 'dots' | 'glyphs'

export interface EvalGraphPrefs {
  style: EvalGraphStyle
  /**
   * How a blunder or a mistake is marked. `glyphs` by default — the move table's own `??`
   * and `?`, which name the severity where a disc only codes it in a colour the reader has
   * to have learnt. `dots` is that disc, for whoever finds the tabs loud; `none` is the bare
   * plot, where a blunder is still visible as the jump that produced it.
   */
  marks: EvalGraphMarks
}

export const EVAL_GRAPH_DEFAULTS: EvalGraphPrefs = { style: 'bars', marks: 'glyphs' }

export const EVAL_GRAPH_KEY = 'blunderbase.evalGraph'

const STYLES: readonly EvalGraphStyle[] = ['bars', 'area']
const MARKS: readonly EvalGraphMarks[] = ['none', 'dots', 'glyphs']

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

function sanitize(raw: unknown): EvalGraphPrefs {
  const record = isRecord(raw) ? raw : {}
  const { style, marks } = record
  return {
    style: STYLES.includes(style as EvalGraphStyle)
      ? (style as EvalGraphStyle)
      : EVAL_GRAPH_DEFAULTS.style,
    marks: MARKS.includes(marks as EvalGraphMarks)
      ? (marks as EvalGraphMarks)
      : EVAL_GRAPH_DEFAULTS.marks,
  }
}

function readPrefs(): EvalGraphPrefs {
  const store = storage()
  if (!store) return EVAL_GRAPH_DEFAULTS
  try {
    const raw = store.getItem(EVAL_GRAPH_KEY)
    if (!raw) return EVAL_GRAPH_DEFAULTS
    const parsed: unknown = JSON.parse(raw)
    return sanitize(parsed)
  } catch {
    // Corrupt or unreadable: the default rather than throwing.
    return EVAL_GRAPH_DEFAULTS
  }
}

let cache: EvalGraphPrefs | null = null
const listeners = new Set<() => void>()

function snapshot(): EvalGraphPrefs {
  if (cache === null) cache = readPrefs()
  return cache
}

function write(next: EvalGraphPrefs): void {
  cache = sanitize(next)
  const store = storage()
  try {
    store?.setItem(EVAL_GRAPH_KEY, JSON.stringify(cache))
  } catch {
    // Quota or a private window: the change still holds for this session.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== EVAL_GRAPH_KEY) return
    cache = readPrefs()
    for (const each of listeners) each()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function setEvalGraphPrefs(patch: Partial<EvalGraphPrefs>): void {
  write({ ...snapshot(), ...patch })
}

/** Test seam: forget what was read, so the next read hits storage again. */
export function resetEvalGraphPrefs(): void {
  cache = null
  for (const listener of listeners) listener()
}

export function useEvalGraphPrefs(): EvalGraphPrefs {
  return useSyncExternalStore(subscribe, snapshot, () => EVAL_GRAPH_DEFAULTS)
}
