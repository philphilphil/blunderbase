/**
 * How a flat page of notes becomes the notes screen: which anchor each one has, where it
 * links to, and the grouping the list is drawn in.
 *
 * Pure functions over `NoteResponse` — the payload already carries the position's FEN, the
 * whole variation and a summary of the game (`services/notes.py:note_payload`), so nothing
 * here fetches and everything here is testable.
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
  position: 'position',
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
 * it pinned when it pinned one. A note that knows only a position has nowhere else to be
 * than this screen, so it links to itself — which is what the command palette needs.
 */
export function noteHref(note: NoteResponse): string {
  if (typeof note.game_id !== 'number') return `/notes?note=${note.id}`
  const params = new URLSearchParams()
  if (typeof note.ply === 'number' && note.ply > 0) params.set('ply', String(note.ply))
  if (typeof note.line_id === 'number') params.set('line', String(note.line_id))
  const query = params.toString()
  return `/games/${note.game_id}${query ? `?${query}` : ''}`
}

/** A note as one line — the palette's row and the resurfaced strip both want this. */
export function oneLine(note: NoteResponse, max = 80): string {
  const first = note.text.split('\n', 1)[0]?.trim() ?? ''
  if (!first) return 'note'
  return first.length > max ? `${first.slice(0, max - 1)}…` : first
}

export interface NoteGroup {
  /** `game:12` or `loose` — the React key and the scroll anchor. */
  key: string
  gameId: number | null
  title: string
  /** `1–0 · 2026-08-22`, or null when the group has nothing to add. */
  subtitle: string | null
  /** Where the group's heading links, or null for the loose group. */
  href: string | null
  notes: NoteResponse[]
}

const RESULTS: Record<string, string> = { '1-0': '1–0', '0-1': '0–1', '1/2-1/2': '½–½' }

function subtitleFor(game: NoteGameBrief | null | undefined): string | null {
  if (!game) return null
  const parts = [
    game.result ? (RESULTS[game.result] ?? game.result) : null,
    game.date ?? null,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

/** Newest first, and a note without a timestamp last rather than first. */
function writtenAt(note: NoteResponse): number {
  const value = Date.parse(note.updated_at ?? note.created_at ?? '')
  return Number.isNaN(value) ? 0 : value
}

/**
 * In ply order inside a game, because that is the order the game was played in; a note
 * with no ply comes first (it is about the game as a whole), and ties break on the newest.
 */
function byPly(left: NoteResponse, right: NoteResponse): number {
  const a = typeof left.ply === 'number' ? left.ply : -1
  const b = typeof right.ply === 'number' ? right.ply : -1
  if (a !== b) return a - b
  return writtenAt(right) - writtenAt(left)
}

/**
 * The list as the screen draws it: one group per game in ply order, then everything with
 * no game — a position note or a loose one — in a final group.
 *
 * Games are ordered by their most recently written note, so what has just been added is
 * at the top whatever ply it landed on.
 */
export function groupNotes(notes: readonly NoteResponse[]): NoteGroup[] {
  const games = new Map<number, NoteGroup>()
  const loose: NoteResponse[] = []

  for (const note of notes) {
    const gameId = note.game_id
    if (typeof gameId !== 'number') {
      loose.push(note)
      continue
    }
    let group = games.get(gameId)
    if (!group) {
      group = {
        key: `game:${gameId}`,
        gameId,
        title: gameLabel(note.game, gameId),
        subtitle: subtitleFor(note.game),
        href: `/games/${gameId}`,
        notes: [],
      }
      games.set(gameId, group)
    }
    group.notes.push(note)
  }

  const ordered = [...games.values()].sort((left, right) => {
    const a = Math.max(...left.notes.map(writtenAt))
    const b = Math.max(...right.notes.map(writtenAt))
    return b - a
  })
  for (const group of ordered) group.notes.sort(byPly)

  if (loose.length) {
    ordered.push({
      key: 'loose',
      gameId: null,
      title: 'Positions and loose notes',
      subtitle: null,
      href: null,
      notes: [...loose].sort((left, right) => writtenAt(right) - writtenAt(left)),
    })
  }
  return ordered
}

/** How many notes a set of groups holds — the header's count, without a second pass. */
export function countNotes(groups: readonly NoteGroup[]): number {
  return groups.reduce((total, group) => total + group.notes.length, 0)
}
