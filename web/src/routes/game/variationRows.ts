/**
 * One list of variations out of three sources: the lines pinned to the game on the server
 * (`GET /games/{id}/lines`), the lines this session has walked and kept in memory
 * (`./sessionVariations`), and the line the board is standing in right now.
 *
 * The three overlap constantly and the move list must draw each line exactly once, so the
 * folding is done here, as a pure function over the three inputs, rather than inside the
 * component that renders them.
 *
 * The rules, in the order they matter:
 *
 * - A pinned line and a session line off the same position where one is the head of the
 *   other are **one** line the reader walked, so they become one row. The longer of the two
 *   is what is drawn — walking further into a pinned line and stepping out of it leaves the
 *   store holding the longer walk, and hiding that tail behind the saved prefix would make
 *   the table lie about what was read. What is *pinned* is still only the prefix, which
 *   `pinnedThrough` says, and which is what lets the pin affordance offer "extend" rather
 *   than "unpin" on a row that has grown past its saved shape.
 * - The line the board is walking claims the row of whichever entry it is the same walk as,
 *   rather than being drawn again beside it: a row must not jump to the front of the table
 *   the moment it is clicked into.
 * - Everything is replayed against *this* game (`sanVariation`), so a stored line can never
 *   disagree with the position it hangs off; one that no longer replays at all drops out.
 *
 * Pinned lines lead, in the order the server sends them, then the session's own in the order
 * they were walked. A pin is a decision the reader made about a line and it outranks the
 * accident of when they last clicked something.
 */
import type { LineResponse } from '@/lib/api/types'

import { sanVariation, type GameLine } from './gameModel'
import type { WalkedLine } from './notesModel'
import { isPrefix, type KeptVariation } from './sessionVariations'

export interface VariationRow {
  /** The session entry this row stands for, or null for one only the server holds. */
  keptId: number | null
  /** The pinned line this row stands for, or null for a line nobody has pinned. */
  lineId: number | null
  /** The number of game plies the line branches from — its first move is ply `base`. */
  base: number
  /** The line in UCI, as long as it was drawn: what pinning this row would send. */
  moves: string[]
  /** The same line in SAN, replayed against this game. */
  sans: string[]
  /** How many of its moves are on the board, or null where the board is elsewhere. */
  cursor: number | null
  /**
   * How many of `sans` the server is actually holding. `0` is "not pinned"; a number short
   * of `sans.length` is "pinned, and since walked further" — the pin can be extended.
   */
  pinnedThrough: number
  /** Indices into `sans` that carry a note, for the move list's markers. */
  noted: number[]
  /** How many notes hang off the pinned line, whichever move they sit on. */
  noteCount: number
}

export interface VariationRowsInput {
  /** The replayed game, so every line can be turned into SAN against it. */
  line: GameLine
  /** The pinned lines, as `GET /games/{id}/lines` sent them. */
  persisted: readonly LineResponse[]
  /** This session's kept lines, oldest first. */
  kept: readonly KeptVariation[]
  /** The line the board is standing in, or null while it is on the game. */
  walked: WalkedLine | null
  /** Which indices of each pinned line carry a note (`notedLineIndices`). */
  notedByLine?: Map<number, Set<number>>
}

export function variationRows({
  line,
  persisted,
  kept,
  walked,
  notedByLine,
}: VariationRowsInput): VariationRow[] {
  const rows: VariationRow[] = []
  /** Session entries already spoken for by a pinned row. */
  const absorbed = new Set<number>()

  for (const pinned of persisted) {
    // The session's own walk of this line, if it has one: covered by it, or continuing it.
    const overlap = kept.find(
      (entry) =>
        !absorbed.has(entry.id) &&
        entry.base === pinned.base_ply &&
        (isPrefix(entry.moves, pinned.moves) || isPrefix(pinned.moves, entry.moves)),
    )
    if (overlap) absorbed.add(overlap.id)

    const longest =
      overlap && overlap.moves.length > pinned.moves.length ? overlap.moves : pinned.moves
    const sans = sanVariation(line, pinned.base_ply, longest, longest.length)
    if (sans.length === 0) continue
    const noted = [...(notedByLine?.get(pinned.id) ?? [])]
      .filter((index) => index < sans.length)
      .sort((left, right) => left - right)
    rows.push({
      keptId: overlap?.id ?? null,
      lineId: pinned.id,
      base: pinned.base_ply,
      moves: longest.slice(0, sans.length),
      sans,
      cursor: null,
      pinnedThrough: Math.min(pinned.moves.length, sans.length),
      noted,
      noteCount: pinned.notes?.length ?? 0,
    })
  }

  for (const entry of kept) {
    if (absorbed.has(entry.id)) continue
    const sans = sanVariation(line, entry.base, entry.moves, entry.moves.length)
    if (sans.length === 0) continue
    rows.push({
      keptId: entry.id,
      lineId: null,
      base: entry.base,
      moves: entry.moves.slice(0, sans.length),
      sans,
      cursor: null,
      pinnedThrough: 0,
      noted: [],
      noteCount: 0,
    })
  }

  if (!walked || walked.sans.length === 0) return rows

  // The row the walk belongs to: the same base, and one line the head of the other. There
  // is at most one such row — the store's prefix rule and the fold above both hold to it —
  // but were there a second it would keep its own quiet row rather than being lit twice.
  const claimed = rows.find(
    (row) =>
      row.base === walked.base &&
      (isPrefix(row.moves, walked.moves) || isPrefix(walked.moves, row.moves)),
  )
  if (claimed) {
    // The walk is what is on the board, so it is what is drawn — and it is never shorter
    // than the row it claims in practice, the branch carrying the whole line and walking it
    // with a cursor. Where it is longer, the pinned prefix is unchanged and `pinnedThrough`
    // still names it.
    if (walked.sans.length >= claimed.sans.length) {
      claimed.moves = [...walked.moves]
      claimed.sans = [...walked.sans]
    }
    claimed.cursor = walked.cursor
    claimed.pinnedThrough = Math.min(claimed.pinnedThrough, claimed.sans.length)
    claimed.noted = claimed.noted.filter((index) => index < claimed.sans.length)
    return rows
  }

  rows.push({
    keptId: null,
    lineId: null,
    base: walked.base,
    moves: [...walked.moves],
    sans: [...walked.sans],
    cursor: walked.cursor,
    pinnedThrough: 0,
    noted: [],
    noteCount: 0,
  })
  return rows
}
