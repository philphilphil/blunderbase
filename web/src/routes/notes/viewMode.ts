/**
 * How the notes page draws its notes — the stream, the sheet, or the list.
 *
 * A per-browser reading preference, not a filter, which is why it is here and not in the
 * URL beside `filters.ts`. A filter says *which* notes; this says how they are laid out,
 * and a link to a cut of the notes should arrive in whichever shape the person who opened
 * it reads in. Stored by `lib/ui/viewPreference`, which the collections' grid / table
 * shares.
 *
 * The stream is the default because it is the one that shows a note whole; the sheet is for
 * browsing by position. Anything else in storage — including the `boxes`/`grid` this key
 * briefly held before the 2026-09-02 rework — reads as the default rather than as an error.
 */
import { viewPreference } from '@/lib/ui/viewPreference'

/**
 * `stream` is one column of whole notes; `sheet` is a packed grid of positions; `list` is
 * one line per note with where it came from beside it.
 */
export type NoteView = 'stream' | 'sheet' | 'list'

export const NOTE_VIEW_KEY = 'blunderbase.noteView'

const pref = viewPreference<NoteView>(NOTE_VIEW_KEY, ['stream', 'sheet', 'list'], 'stream')

export const setNoteView = pref.set
export const resetNoteView = pref.reset
export const useNoteView = pref.use
