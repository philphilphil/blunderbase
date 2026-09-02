/**
 * How a note payload becomes what the screen shows: which anchor it has, what to call the
 * move it was written on, where its two links go, and which slice of time it belongs to.
 *
 * Pure functions over `NoteResponse` — the payload already carries the position's FEN, the
 * whole variation and a summary of the game (`services/notes.py:note_payload`), so nothing
 * here fetches and everything here is testable.
 *
 * This module used to group the list by game as well. That went (owner's call, 2026-09-02):
 * a game is where a note was *written*, not what it is about, `/games` is already the index
 * of games, and at 1.5 notes per noted game the headings cost a row apiece and left the
 * columns full of holes. What replaces it is `ageBuckets` — time is the only ordering that
 * is always true of a note, and a date rule takes a line rather than a row.
 */
import type { LineResponse, NoteGameBrief, NoteResponse, NoteScope } from '@/lib/api/types'
import { moveNumberLabel } from '@/lib/chess/evaluation'

/** Which anchors a note has, the same four names `GET /notes?scope=` uses. */
export function scopeOf(note: NoteResponse): NoteScope {
  if (typeof note.line_id === 'number') return 'line'
  if (typeof note.game_id === 'number') return 'game'
  if (note.fen || typeof note.position_id === 'number') return 'position'
  return 'free'
}

export const SCOPE_BADGES: Record<NoteScope, string> = {
  game: 'game',
  // Not "position": every note is about a position, so the word said nothing about which
  // kind this is. What this scope actually means is a note written against a position on
  // its own rather than against a game of yours — which is the opening explorer's note.
  position: 'opening line',
  line: 'variation',
  free: 'loose',
}

/** `kn1ghtmare vs Dr_Nykterstein`, or the id when the note carries no game summary. */
export function gameLabel(game: NoteGameBrief | null | undefined, gameId: number): string {
  if (!game) return `Game #${gameId}`
  const white = game.white ?? '?'
  const black = game.black ?? '?'
  if (white === '?' && black === '?') return `Game #${gameId}`
  return `${white} vs ${black}`
}

/**
 * Where in the game the note sits. Named apart from `routes/game/gameModel.plyLabel`, which
 * takes a move *index*: `ply` on a note is a half-move *count*, so the move it is about is
 * the one before it: 0 is the starting position, 25 is the position after White's 13th.
 */
export function notePlyLabel(ply: number | null | undefined): string | null {
  if (typeof ply !== 'number' || !Number.isFinite(ply)) return null
  if (ply <= 0) return 'start'
  return moveNumberLabel(ply - 1)
}

/**
 * A kept variation in SAN with move numbers — `13… Nd7 14. Bg5 h6`.
 *
 * `base_ply` is how many half-moves of the mainline come first, so the variation's first
 * move is half-move `base_ply` and gets a `12…` when it is Black's.
 */
export function lineText(line: Pick<LineResponse, 'base_ply' | 'sans' | 'moves'>): string {
  const moves = line.sans.length ? line.sans : line.moves
  const parts: string[] = []
  moves.forEach((move, index) => {
    const ply = line.base_ply + index
    if (ply % 2 === 0) parts.push(`${Math.floor(ply / 2) + 1}.`)
    else if (index === 0) parts.push(`${Math.floor(ply / 2) + 1}…`)
    parts.push(move)
  })
  return parts.join(' ')
}

/**
 * Where clicking the note goes.
 *
 * A note that knows its game opens that game at the ply it is about, and at the variation
 * it pinned when it pinned one. A note that knows only a position opens the opening
 * explorer rooted there — `?fen=` is that entry point, and it is where such a note was
 * written. Only a note anchored to nothing links to itself, which is what the command
 * palette needs to be able to show it at all.
 */
export function noteHref(note: NoteResponse): string {
  return gameHref(note) ?? explorerHref(note.fen) ?? `/notes?note=${note.id}`
}

/**
 * The game the note was written on, opened at the move it was written on — and at the
 * variation it pinned, when it pinned one. Null for a note that names no game.
 *
 * This is half of what a note has to say for itself once it starts resurfacing away from
 * where it was made: the same position turns up in the explorer, in the repertoire and in
 * somebody else's game, and "where did I write this?" is a link, not a memory.
 */
export function gameHref(note: NoteResponse): string | null {
  if (typeof note.game_id !== 'number') return null
  const params = new URLSearchParams()
  if (typeof note.ply === 'number' && note.ply > 0) params.set('ply', String(note.ply))
  if (typeof note.line_id === 'number') params.set('line', String(note.line_id))
  const query = params.toString()
  return `/games/${note.game_id}${query ? `?${query}` : ''}`
}

/** The opening explorer rooted at a position: every game through it, and how they went. */
export function explorerHref(fen: string | null | undefined): string | null {
  return fen ? `/explorer?fen=${encodeURIComponent(fen)}` : null
}

/**
 * What a note says about where it came from: the move it was written on, and the game.
 *
 * The move comes from the payload rather than from `ply` alone, because only the server
 * knows which SAN that ply is — and on a pinned variation, that the variation's move is not
 * the game's. `notePlyLabel` is the fallback for a note written before the field existed.
 */
export function originLabel(note: NoteResponse): string | null {
  return note.move?.label ?? notePlyLabel(note.ply)
}

/**
 * How many games in the library pass through a note's position, as one phrase.
 *
 * The two counts are kept apart because they answer differently: the owner's own games are
 * what the explorer will show, and model games are kept for study and counted nowhere else.
 * Null when nothing stored reaches the position — a note on a line only ever browsed to.
 */
export function reachLabel(note: NoteResponse): string | null {
  const mine = note.position_games ?? 0
  const model = note.position_reference_games ?? 0
  const parts: string[] = []
  if (mine > 0) parts.push(mine === 1 ? '1 game of yours' : `${mine} of your games`)
  if (model > 0) parts.push(`${model} model game${model === 1 ? '' : 's'}`)
  if (!parts.length) return null
  return `In ${parts.join(' and ')}`
}

/** A note as one line — what the command palette's row shows. */
export function oneLine(note: NoteResponse, max = 80): string {
  const first = note.text.split('\n', 1)[0]?.trim() ?? ''
  if (!first) return 'note'
  return first.length > max ? `${first.slice(0, max - 1)}…` : first
}

/** One slice of the list under one date rule. */
export interface NoteBucket {
  /** `today` / `week` / `2026-07` — the React key, stable across renders. */
  key: string
  /** `Today`, `This week`, `July 2026`. */
  label: string
  notes: NoteResponse[]
}

const DAY = 86_400_000
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/**
 * The list cut into slices of time, in the order it arrived — which is newest first, by
 * `created_at`, the same field and the same direction the API sorts by
 * (`services/notes.search_notes`). Nothing is re-sorted here: a rule that disagreed with
 * the order under it would be worse than no rule.
 *
 * Today, this week and this month are relative, and everything before that falls into its
 * own calendar month. That last part is what makes the rules survive a library with years
 * in it: one bucket called "Earlier" holding four hundred notes says nothing, and
 * `July 2026` is a place a reader can aim at.
 *
 * `created_at`, not `updated_at`: the rule says when a note was *written*, which is what a
 * reader means by "August", and rewriting a sentence in one does not move it through time.
 */
export function ageBuckets(notes: readonly NoteResponse[], now = Date.now()): NoteBucket[] {
  const buckets: NoteBucket[] = []
  const midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)
  const startOfToday = midnight.getTime()
  const startOfMonth = new Date(midnight.getFullYear(), midnight.getMonth(), 1).getTime()

  for (const note of notes) {
    const written = Date.parse(note.created_at ?? '')
    const at = Number.isNaN(written) ? 0 : written
    let key: string
    let label: string
    if (at >= startOfToday) {
      key = 'today'
      label = 'Today'
    } else if (at >= startOfToday - 6 * DAY) {
      key = 'week'
      label = 'This week'
    } else if (at >= startOfMonth) {
      key = 'month'
      label = 'Earlier this month'
    } else {
      const day = new Date(at)
      key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}`
      label = `${MONTHS[day.getMonth()]} ${day.getFullYear()}`
    }
    // Consecutive only: the list is already in order, so a bucket is a run of it. Reopening
    // an earlier one would mean the notes under a rule were not the notes after it.
    const open = buckets.at(-1)
    if (open && open.key === key) open.notes.push(note)
    else buckets.push({ key, label, notes: [note] })
  }
  return buckets
}
