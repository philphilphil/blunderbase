/**
 * Which way the reader wants moves written — see `./notation` for the three ways and why.
 *
 * A per-browser reading preference like `lib/board/arrowPrefs` and stored the same way — a
 * localStorage blob behind `useSyncExternalStore`, sanitised so a stale or hand-edited
 * entry degrades to the default rather than throwing. Not `AppSettings`: the store holds
 * English SAN whatever this says, and an MCP client never sees it. It sits in the board
 * dialog with the other per-browser choices, though it reaches every screen that prints a
 * move: the dialog is where the move list is, which is where the choice is judged.
 *
 * `local` by default: letters in the UI's language, which for English is English and for
 * German is `Sc3`. A German reader who wants `Nc3` — the lichess and chess.com convention
 * whatever the language — picks `english`; the option only appears where it differs.
 *
 * `useNotation` is what a component that prints a move uses. It is one function for the
 * whole render so a list of two hundred moves subscribes once, and it changes identity only
 * when the style or the language does, so it can sit in a dependency list.
 */
import { useCallback, useSyncExternalStore } from 'react'

import { currentLocale, isLocale, type Locale } from '@/lib/i18n/locale'
import { useLingui } from '@/lib/i18n/runtime'

import { formatSan, NOTATION_STYLES, type Notate, type NotationStyle } from './notation'

export interface NotationPrefs {
  style: NotationStyle
}

export const NOTATION_DEFAULTS: NotationPrefs = { style: 'local' }

export const NOTATION_KEY = 'blunderbase.notation'

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

function sanitize(raw: unknown): NotationPrefs {
  const record = isRecord(raw) ? raw : {}
  const { style } = record
  return {
    style: NOTATION_STYLES.includes(style as NotationStyle)
      ? (style as NotationStyle)
      : NOTATION_DEFAULTS.style,
  }
}

function readPrefs(): NotationPrefs {
  const store = storage()
  if (!store) return NOTATION_DEFAULTS
  try {
    const raw = store.getItem(NOTATION_KEY)
    if (!raw) return NOTATION_DEFAULTS
    const parsed: unknown = JSON.parse(raw)
    return sanitize(parsed)
  } catch {
    // Corrupt or unreadable: the default rather than throwing.
    return NOTATION_DEFAULTS
  }
}

let cache: NotationPrefs | null = null
const listeners = new Set<() => void>()

function snapshot(): NotationPrefs {
  if (cache === null) cache = readPrefs()
  return cache
}

function write(next: NotationPrefs): void {
  cache = sanitize(next)
  const store = storage()
  try {
    store?.setItem(NOTATION_KEY, JSON.stringify(cache))
  } catch {
    // Quota or a private window: the change still holds for this session.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== NOTATION_KEY) return
    cache = readPrefs()
    for (const each of listeners) each()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function setNotationPrefs(patch: Partial<NotationPrefs>): void {
  write({ ...snapshot(), ...patch })
}

/** The current prefs without subscribing to them, for code that runs outside a render. */
export function getNotationPrefs(): NotationPrefs {
  return snapshot()
}

/** Test seam: forget what was read, so the next read hits storage again. */
export function resetNotationPrefs(): void {
  cache = null
  for (const listener of listeners) listener()
}

export function useNotationPrefs(): NotationPrefs {
  return useSyncExternalStore(subscribe, snapshot, () => NOTATION_DEFAULTS)
}

/**
 * The formatter for the current style and language. Re-renders the caller when either
 * changes; stable otherwise, so it is a legitimate `useMemo` dependency for a helper that
 * builds labels out of moves.
 */
export function useNotation(): Notate {
  const { style } = useNotationPrefs()
  const { i18n } = useLingui()
  const locale: Locale = isLocale(i18n.locale) ? i18n.locale : currentLocale()
  return useCallback((text: string) => formatSan(text, style, locale), [style, locale])
}
