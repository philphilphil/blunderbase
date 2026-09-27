/**
 * How the game on screen numbers its plies, for the components that print a move number.
 *
 * A game from the initial array numbers ply 0 as White's move 1, and every label in the game
 * view used to assume so. A chess960 game does too, but a game set up from a position (Black
 * to move, or at move 30) does not: its `GameLine.offset` (`gameModel.plyOffset`) shifts
 * both the number and the dots. It is a context rather than a prop because the labels are
 * printed deep inside half a dozen panels — the move list, both graphs, the flagged
 * moments, the book, Maia — and threading one number through each of their prop lists is
 * the kind of plumbing that gets missed on the next panel. Outside a game (a test, a panel
 * rendered on its own) the default is 0, the initial array.
 */
import { createContext, useCallback, useContext } from 'react'

import { moveNumberOf, plyLabel, sideOf, type Side } from './gameModel'

export const PlyOffsetContext = createContext(0)

/** The shift of the game on screen — `GameLine.offset`, or 0 outside one. */
export function usePlyOffset(): number {
  return useContext(PlyOffsetContext)
}

/** `plyLabel`, numbered the way the game on screen is. */
export function usePlyLabel(): (ply: number) => string {
  const offset = usePlyOffset()
  return useCallback((ply: number) => plyLabel(ply, offset), [offset])
}

/** The move number and the side of a ply of the game on screen. */
export function usePlyNumbering(): {
  moveNumber: (ply: number) => number
  side: (ply: number) => Side
} {
  const offset = usePlyOffset()
  return {
    moveNumber: (ply: number) => moveNumberOf(ply, offset),
    side: (ply: number) => sideOf(ply, offset),
  }
}
