/**
 * Where a note hangs in the game being read, and where a new one would hang.
 *
 * One convention decides everything here, and the API layer fixes it:
 * `NoteResponse.ply` is a half-move **count**, not a move index — `0` is the starting
 * position and `n` the position after `n` half-moves. `MoveRow.ply`, by contrast, is a
 * move's own index: the move at index `i` produces the position with count `i + 1`.
 * So the move a note is written *about* is `moves[note.ply - 1]`, and a note with count `0`
 * is about the starting position and has no move at all. On a line note the count is
 * `line.base_ply + k`: the position after `k` moves of the variation.
 *
 * Nothing in this module renders or fetches; it is what the Notes tab, the move-list
 * markers and the composer all read so that the three cannot disagree about where a note
 * belongs.
 */
import { t } from '@lingui/core/macro'

import type { LineResponse, MoveRow, NoteSource } from '@/lib/api/types'
import { notateEnglish, type Notate } from '@/lib/chess/notation'
import { gameLabel } from '@/routes/notes/presentation'

import { plyLabel, type GameNote } from './gameModel'

/** A note's anchor in this game, resolved to something the page can jump to. */
export type NoteAnchor =
  /** The position after `count` half-moves of the game; `0` is the start. */
  | { kind: 'mainline'; count: number }
  /** The position after `index` moves of a kept variation off game ply `base`. */
  | { kind: 'line'; lineId: number; base: number; index: number }
  /** A note on this game that names no position — nothing to jump to. */
  | { kind: 'loose' }

/** One row of the Notes tab: the note, where it hangs, and how to say so in one line. */
export interface NoteRow {
  note: GameNote
  anchor: NoteAnchor
  /** `2…d5`, `start`, or `1…c6` for the noted move of a variation. Null for a loose note. */
  context: string | null
  /** Whether the row hangs off a variation rather than the game's own line. */
  onLine: boolean
  /**
   * Whether the note was written somewhere else and only *applies* here, because this game
   * reached the position it is about. The panel has to say so — advice from another game,
   * or from the explorer, is not advice about this one — and the composer will not rewrite
   * it, because it belongs to whoever wrote it where they wrote it (`ownNote`).
   */
  elsewhere: boolean
  /** Where it came from, when that is another game of the library's: `phib vs maia`. */
  from: string | null
  /** The move it was written on *there*, which is not this game's move at that ply. */
  originMove: string | null
  source: NoteSource | null
}

/** The half-move count a note names, or null where it names none. */
export function noteCount(note: GameNote): number | null {
  return typeof note.ply === 'number' && note.ply >= 0 ? note.ply : null
}

/**
 * Which anchor a note has, given the variations this game keeps.
 *
 * A note whose `line_id` names a line nobody kept any more — unpinned in another tab, or
 * deleted between the two payloads — falls back to its mainline count rather than
 * disappearing: the count is still a position in this game, which is what the note was
 * written about.
 */
export function noteAnchor(note: GameNote, lines: readonly LineResponse[]): NoteAnchor {
  const count = noteCount(note)
  const lineId = typeof note.line_id === 'number' ? note.line_id : null
  if (lineId !== null) {
    const line = lines.find((entry) => entry.id === lineId)
    if (line) {
      const index = Math.max(0, (count ?? line.base_ply) - line.base_ply)
      return { kind: 'line', lineId, base: line.base_ply, index }
    }
  }
  return count === null ? { kind: 'loose' } : { kind: 'mainline', count }
}

/**
 * `2…d5` — the move that produced the position a note is about. `notate` is the reader's
 * notation (`useNotation`): the label is read, never stored, so it follows the reader.
 */
function moveContext(moves: readonly MoveRow[], count: number, notate: Notate): string | null {
  if (count <= 0) return t`start`
  const move = moves[count - 1]
  if (!move?.san) return null
  return `${plyLabel(count - 1)}${notate(move.san)}`
}

/** The same, inside a variation: SAN comes off the line rather than off the game. */
function lineContext(
  line: LineResponse | undefined,
  base: number,
  index: number,
  notate: Notate,
): string | null {
  if (index <= 0) return t`branch`
  const san = line?.sans[index - 1]
  if (!san) return null
  return `${plyLabel(base + index - 1)}${notate(san)}`
}

/**
 * The Notes tab's rows: every note this game carries, in the order a reader walks the game.
 *
 * The position decides the order, and nothing else does — a note on a variation sits among
 * the game's own notes, at the ply the variation branches from. This list used to keep the
 * game's notes together and hang the variations' underneath them all, on the reasoning that
 * a variation is a detour; but the reader is walking one game, and a thought written on an
 * engine line off move 12 belongs beside the thought written on move 11, not past the note
 * on move 29. Grouped by kind, the tab put the detour first in reading order exactly when
 * the reader had most reason to expect it in place.
 *
 * A variation's own notes stay in the variation's order (`base`, then how far into the
 * line), so they read as the line reads. Two notes on the same position are newest first,
 * which is the order they were written back to front.
 *
 * A note with no position at all — one written about the game entire, with the composer's
 * **Game** switch or from the correspondence journal — sorts first. It is the paragraph
 * about the whole game, and a reader opening the notes reads that before the move-by-move;
 * it used to sort last, on the reasoning that there was nowhere along the reading to put
 * it, and was found under the note on move 40 exactly when it said what the game was about.
 */
export function noteRows(
  notes: readonly GameNote[],
  lines: readonly LineResponse[],
  moves: readonly MoveRow[],
  notate: Notate = notateEnglish,
): NoteRow[] {
  const rows: NoteRow[] = notes.map((note) => {
    const anchor = noteAnchor(note, lines)
    const context =
      anchor.kind === 'mainline'
        ? moveContext(moves, anchor.count, notate)
        : anchor.kind === 'line'
          ? lineContext(
              lines.find((entry) => entry.id === anchor.lineId),
              anchor.base,
              anchor.index,
              notate,
            )
          : null
    // `scope: 'position'` is the backend saying this note was written somewhere else and
    // reached us through the position (`services/games.game_notes`). Those rows carry the
    // game they came from; a note written in the explorer on a bare position carries none,
    // and there is nothing to name.
    const elsewhere = note.scope === 'position'
    return {
      note,
      anchor,
      context,
      onLine: anchor.kind === 'line',
      elsewhere,
      from:
        elsewhere && typeof note.game_id === 'number'
          ? gameLabel(note.game, note.game_id)
          : null,
      originMove: elsewhere ? (note.move?.label ?? null) : null,
      source: note.source ?? null,
    }
  })

  return rows.sort((left, right) => {
    const at = comparePositions(left.anchor, right.anchor)
    if (at !== 0) return at
    return Date.parse(right.note.created_at) - Date.parse(left.note.created_at)
  })
}

/** Where an anchor sits along the reading: a loose note has no position, so it sorts first. */
function comparePositions(left: NoteAnchor, right: NoteAnchor): number {
  const [leftBase, leftIn] = anchorAt(left)
  const [rightBase, rightIn] = anchorAt(right)
  return leftBase === rightBase ? leftIn - rightIn : leftBase - rightBase
}

/**
 * An anchor as `[game ply, moves into a line]`, which orders lexicographically.
 *
 * A line's notes are counted from `base + 1` rather than from `base`, because a variation
 * is an alternative to the game's move out of that position, not to the position itself:
 * at `base` they would sort ahead of the game's own note on the move they replace, and the
 * detour would be read before the thing it is a detour from. One past it puts them exactly
 * where the move list keeps the line — after that move, before the next one.
 */
function anchorAt(anchor: NoteAnchor): [number, number] {
  if (anchor.kind === 'mainline') return [anchor.count, 0]
  if (anchor.kind === 'line') return [anchor.base + 1, anchor.index]
  return [Number.NEGATIVE_INFINITY, 0]
}

/**
 * The mainline move indices that carry a note — what the move list marks.
 *
 * Only the game's own notes: a note on a variation is marked on the variation's move, not
 * on the mainline move the variation happens to branch from. A note on the starting
 * position marks nothing, there being no move that produced it.
 */
export function notedMoveIndices(
  notes: readonly GameNote[],
  lines: readonly LineResponse[],
): Set<number> {
  const marks = new Set<number>()
  for (const note of notes) {
    const anchor = noteAnchor(note, lines)
    if (anchor.kind !== 'mainline' || anchor.count <= 0) continue
    marks.add(anchor.count - 1)
  }
  return marks
}

/** The indices into one line's moves that carry a note, keyed by line id. */
export function notedLineIndices(
  lines: readonly LineResponse[],
): Map<number, Set<number>> {
  const byLine = new Map<number, Set<number>>()
  for (const line of lines) {
    const marks = new Set<number>()
    for (const note of line.notes ?? []) {
      const count = typeof note.ply === 'number' ? note.ply : null
      if (count === null) continue
      const index = count - line.base_ply
      if (index >= 1) marks.add(index - 1)
    }
    if (marks.size > 0) byLine.set(line.id, marks)
  }
  return byLine
}

// --- writing one ----------------------------------------------------------

/** The line the board is walking, as `analysisLine` replayed it. */
export interface WalkedLine {
  base: number
  moves: string[]
  sans: string[]
  /** How many of `moves` are on the board. */
  cursor: number
}

/**
 * What a new note would attach to — the whole of `POST /notes`' anchor half, decided in one
 * place so the composer only has to render it.
 *
 * On the game's own line that is the position on the board: the game, the half-move count
 * and the FEN. Off it — the reader has walked a variation — a note *always* pins the line
 * first, so the anchor carries the whole walk as a `line` to keep rather than a `line_id`:
 * the backend's own prefix rule turns "pin this again" into the row that already holds it,
 * and turns a longer walk into that row extended, which is exactly what is wanted and is
 * not something this side can work out on its own.
 *
 * The line handed over is the whole walk, not the part walked so far, for the same reason
 * `keepBranch` keeps the whole thing: the tail the reader has not stepped through yet is
 * still the line they are reading. The count, though, is where the board actually stands —
 * `base + cursor` — because that is the position the note is about.
 */
export interface NoteTarget {
  /**
   * `game` is the note about the game entire — no ply, no position, no line — which is
   * what the composer writes with its **Game** switch on. It is the same note the
   * correspondence screen's journal keeps, and the notes page filters as having no position.
   */
  kind: 'mainline' | 'line' | 'game'
  gameId: number
  /** The half-move count to send as `ply`; null for a note on the game entire. */
  ply: number | null
  /** The position to send as `fen`; null for a note on the game entire. */
  fen: string | null
  /** The variation to keep and pin the note to, or null on the game's own line. */
  line: { game_id: number; base_ply: number; moves: string[] } | null
  /** What the composer says it is about: `2…d5`, `the starting position`, `1…c6`. */
  label: string
}

export function noteTarget(input: {
  gameId: number
  moves: readonly MoveRow[]
  /** Half-moves of the game on the board — the page's `cursor + 1`. */
  boardIndex: number
  /** The FEN of the position actually on the board, mainline or not. */
  fen: string
  /** The variation being walked, or null while the board is on the game. */
  branch: WalkedLine | null
  /** The reader's notation for the label; English SAN when absent. */
  notate?: Notate
  /**
   * The note is about the game and not about the board: the composer's **Game** switch.
   * Wherever the board stands, the note then names no position, so it comes back under
   * this game only and never under another that reaches the same square.
   */
  wholeGame?: boolean
}): NoteTarget {
  const { gameId, moves, boardIndex, fen, branch, notate = notateEnglish, wholeGame } = input
  if (wholeGame) {
    return { kind: 'game', gameId, ply: null, fen: null, line: null, label: t`the game` }
  }
  if (branch && branch.cursor > 0) {
    const index = Math.min(branch.cursor, branch.sans.length)
    const san = branch.sans[index - 1]
    const ply = branch.base + index
    const move = san ? `${plyLabel(ply - 1)}${notate(san)}` : null
    return {
      kind: 'line',
      gameId,
      ply,
      fen,
      line: { game_id: gameId, base_ply: branch.base, moves: [...branch.moves] },
      label: move ? t`${move} (variation)` : t`a variation`,
    }
  }
  const count = Math.max(0, boardIndex)
  return {
    kind: 'mainline',
    gameId,
    ply: count,
    fen,
    line: null,
    label:
      count === 0
        ? t`the starting position`
        : (moveContext(moves, count, notate) ?? t`ply ${count}`),
  }
}

// --- editing one ----------------------------------------------------------

/**
 * A target as one string, for comparing two of them.
 *
 * The composer holds a box of text against a position, and needs to know when the position
 * under it has moved. Nothing is read back out of this — it is an identity, not a format —
 * so it names every part of the anchor a note would be written with, the walked line
 * included: a reader stepping deeper into the same variation is standing somewhere else.
 */
export function targetKey(target: NoteTarget): string {
  const line = target.line ? `${target.line.base_ply}/${target.line.moves.join(',')}` : ''
  return `${target.kind}:${target.gameId}:${target.ply}:${line}`
}

/**
 * Whether a note is this game's own to rewrite.
 *
 * `game_notes` hands the page two kinds of note: the ones written about this game, and the
 * ones written about a *position* this game happens to have reached — someone else's move
 * order, in another game, that arrived at the same board. The second kind is scoped
 * `position`, and its `ply` is where *this* game reached the position rather than anything
 * the note itself said. Rewriting one from here would edit a note about a different game,
 * so the composer never offers to.
 *
 * The scope is what decides it, and not the game id, because the game payload does not send
 * one: a note that arrived under `/games/{id}` is already about that game or is scoped
 * `position` precisely because it is not. Where an id *is* there — the lines payload sends
 * whole notes — it still has to agree.
 */
function ownNote(note: GameNote, target: NoteTarget): boolean {
  if (note.scope === 'position') return false
  const gameId = note.game_id ?? null
  return gameId === null || gameId === target.gameId
}

/** Whether a note hangs on exactly the position the composer is pointed at. */
function anchoredAt(
  note: GameNote,
  lines: readonly LineResponse[],
  target: NoteTarget,
  lineId: number | null,
): boolean {
  const anchor = noteAnchor(note, lines)
  // A note on the game entire is the one with no position; there is at most a handful of
  // those and the newest is the one the box rewrites (`noteAtTarget`).
  if (target.kind === 'game') return anchor.kind === 'loose'
  if (target.kind === 'line') {
    // Off the game's own line only a note on *that* kept line counts: the same half-move
    // count in another variation is a different position entirely.
    if (anchor.kind !== 'line' || lineId === null) return false
    return anchor.lineId === lineId && anchor.base + anchor.index === target.ply
  }
  return anchor.kind === 'mainline' && anchor.count === target.ply
}

/**
 * The note the composer would be rewriting where it stands, or null where a save there
 * would write a new one.
 *
 * This is the whole of "clicking a noted move opens the note": the composer has no memory
 * of what the reader clicked, only a target, and a target that already carries a note of
 * this game's own is an edit rather than a second note on the same board.
 *
 * Two notes on one position is allowed and does happen, so one of them has to be picked:
 * the newest, which is the one the Notes tab lists first and the one a reader coming back
 * to a position means. `preferId` overrides that for the one case where the reader named a
 * note rather than a position — picking it out of the Notes tab — and is ignored the moment
 * that note is not on this target any more, so a stale id is harmless.
 */
export function noteAtTarget(input: {
  target: NoteTarget
  notes: readonly GameNote[]
  lines: readonly LineResponse[]
  /** The kept line the board is standing in, where it is standing in one. */
  lineId?: number | null
  /** A note the reader asked for by name, preferred among the ones on this position. */
  preferId?: number | null
}): GameNote | null {
  const { target, notes, lines, lineId = null, preferId = null } = input
  const here = notes.filter(
    (note) => ownNote(note, target) && anchoredAt(note, lines, target, lineId),
  )
  if (here.length === 0) return null
  const asked = preferId === null ? null : (here.find((note) => note.id === preferId) ?? null)
  if (asked) return asked
  return (
    [...here].sort(
      (left, right) =>
        Date.parse(right.created_at) - Date.parse(left.created_at) || right.id - left.id,
    )[0] ?? null
  )
}
