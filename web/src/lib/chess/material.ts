/**
 * Material balance from a FEN, for the two player rows that flank the board.
 *
 * The rebuilt game header is one line, and the room for that came from moving what used to
 * be a second header row into the slim player rows — so those rows have to say who is up
 * material without a round trip. The position is already in hand on every ply (the board is
 * driven from a FEN), so this is arithmetic on the client, not a field on the API.
 *
 * It is counted the way a captured pile is shown on a board, not the way an engine counts:
 * a side's missing pieces are what the other side has taken, and equal takings cancel per
 * piece type, so "each has taken three pawns and a bishop" shows nothing at all. That is
 * the only presentation that matches the number beside it, which is the same difference.
 *
 * Promotions are not tracked — a FEN cannot tell a promoted queen from the original one.
 * A side that promotes reads as having lost one more pawn, which is what every board site
 * does and what the pieces on the screen actually look like.
 */

import { parseFen } from 'chessops/fen'
import type { Color } from 'chessops/types'

/** Every role that can be captured. The king cannot, so it is not one. */
export type CapturedRole = 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn'

/** Heaviest first: a captured pile reads queen down to pawn. */
const ROLES: readonly CapturedRole[] = ['queen', 'rook', 'bishop', 'knight', 'pawn']

/** Standard values. Knight and bishop are both 3 here, so a swap of the two is level. */
const VALUE: Record<CapturedRole, number> = {
  queen: 9,
  rook: 5,
  bishop: 3,
  knight: 3,
  pawn: 1,
}

const START_COUNT: Record<CapturedRole, number> = {
  queen: 1,
  rook: 2,
  bishop: 2,
  knight: 2,
  pawn: 8,
}

export interface SideMaterial {
  /**
   * What this side has taken beyond what it has given back, heaviest first and one entry
   * per piece — `['rook', 'pawn', 'pawn']` renders straight into a row of glyphs. The
   * pieces are the *opponent's* colour, since they are the ones that were captured.
   */
  captured: CapturedRole[]
  /** Signed from this side: `+3` is a bishop up, `-3` a bishop down, `0` level. */
  advantage: number
}

export interface MaterialBalance {
  white: SideMaterial
  black: SideMaterial
  /** The single difference, signed from White — `white.advantage`, named for readers. */
  balance: number
}

/** A fresh level result. Built each time, so no caller can mutate a shared `captured`. */
const level = (): MaterialBalance => ({
  white: { captured: [], advantage: 0 },
  black: { captured: [], advantage: 0 },
  balance: 0,
})

/**
 * The captured pieces and the balance for a position.
 *
 * A FEN this cannot parse comes back level rather than throwing: the player rows render on
 * every ply, including ones the board itself is still catching up with, and a blank
 * material strip is a better failure there than a blank screen.
 */
export function materialBalance(fen: string): MaterialBalance {
  const setup = parseFen(fen)
  if (setup.isErr) return level()
  const board = setup.value.board

  /** How many of `color`'s pieces are gone — i.e. what the other side has taken. */
  const missing = (color: Color, role: CapturedRole) =>
    Math.max(0, START_COUNT[role] - board.pieces(color, role).size())

  const white: CapturedRole[] = []
  const black: CapturedRole[] = []
  let balance = 0

  for (const role of ROLES) {
    // Cancel per type, so only the surplus is drawn and it agrees with the number.
    const net = missing('black', role) - missing('white', role)
    const pile = net > 0 ? white : black
    for (let i = 0; i < Math.abs(net); i++) pile.push(role)
    balance += net * VALUE[role]
  }

  return {
    white: { captured: white, advantage: balance },
    // `|| 0` only to fold `-0` back to `0`; a level game must compare equal to a level game.
    black: { captured: black, advantage: -balance || 0 },
    balance,
  }
}
