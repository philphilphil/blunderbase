/**
 * How the notes page draws its notes — the stream, or the sheet.
 *
 * A per-browser reading preference, not a filter, which is why it is here and not in the
 * URL beside `filters.ts`. A filter says *which* notes; this says how they are laid out,
 * and a link to a cut of the notes should arrive in whichever shape the person who opened
 * it reads in. Stored the same way as `lib/board/arrowPrefs` and `dashboard/ratingSpeeds`:
 * localStorage behind `useSyncExternalStore`, and anything unreadable degrades to the
 * default rather than throwing.
 *
 * The stream is the default because it is the one that shows a note whole; the sheet is for
 * browsing by position. Anything else in storage — including the `boxes`/`grid` this key
 * briefly held before the 2026-09-02 rework — reads as the default rather than as an error.
 */
import { useSyncExternalStore } from 'react'

/** `stream` is one column of whole notes; `sheet` is a packed grid of positions. */
export type NoteView = 'stream' | 'sheet'

export const NOTE_VIEW_KEY = 'blunderbase.noteView'

const DEFAULT: NoteView = 'stream'

let cache: NoteView | null = null
const listeners = new Set<() => void>()

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    // Storage disabled: the choice holds for this session and is not written down.
    return null
  }
}

function read(): NoteView {
  try {
    return storage()?.getItem(NOTE_VIEW_KEY) === 'sheet' ? 'sheet' : DEFAULT
  } catch {
    return DEFAULT
  }
}

function snapshot(): NoteView {
  if (cache === null) cache = read()
  return cache
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== NOTE_VIEW_KEY) return
    cache = read()
    for (const each of listeners) each()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function setNoteView(view: NoteView): void {
  cache = view
  try {
    storage()?.setItem(NOTE_VIEW_KEY, view)
  } catch {
    // Quota or a private window: the toggle still holds for this session.
  }
  for (const listener of listeners) listener()
}

/** Test seam: forget what was read, so the next read hits storage again. */
export function resetNoteView(): void {
  cache = null
  for (const listener of listeners) listener()
}

export function useNoteView(): NoteView {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULT)
}
