/**
 * The analysis board: a line the reader has played *off* the game.
 *
 * The game view is otherwise a cursor into a fixed move list. Clicking an engine PV move,
 * a Maia rollout move or dragging a piece branches from the position the cursor is on and
 * keeps its own little move list — `base` says which game position it left from, `moves`
 * says what has been played since. An empty (or absent) line means the board is back on
 * the game, which is what tells the panel to use stored data rather than to query.
 *
 * Nothing here mutates the replayed game: `GameLine.boards` are cloned before a move is
 * pushed, the same way `sanVariation` reads them.
 */
import { Chess, normalizeMove } from 'chessops/chess'
import { chessgroundDests } from 'chessops/compat'
import { makeFen } from 'chessops/fen'
import { makeSanAndPlay } from 'chessops/san'
import type { NormalMove, SquareName } from 'chessops/types'
import { makeUci, parseUci } from 'chessops/util'

import type { GameLine, PlyPosition } from './gameModel'

export interface AnalysisLine {
  /** The number of game plies the line branches from — an index into `GameLine.positions`. */
  base: number
  /** The moves played since, in UCI. An illegal tail is dropped rather than thrown. */
  moves: string[]
  /** The same moves in SAN, for the breadcrumb. */
  sans: string[]
  position: PlyPosition
  /** The ply the *next* move would be, counted from the start of the game. */
  ply: number
  lastMove: string | null
  /** Legal destinations per origin square, so the board can accept a drag. */
  dests: Map<SquareName, SquareName[]>
  /** The position itself, for extending the line. */
  board: Chess
}

/**
 * Replay `ucis` from the game position after `base` plies. Returns null when the game has
 * no such position — a cursor that has run off the end of a half-replayed game.
 */
export function buildAnalysisLine(
  line: GameLine,
  base: number,
  ucis: readonly string[],
): AnalysisLine | null {
  const start = line.boards[base]
  if (!start) return null

  const board = start.clone()
  const moves: string[] = []
  const sans: string[] = []
  for (const uci of ucis) {
    const parsed = parseUci(uci)
    if (!parsed) break
    const move = normalizeMove(board, parsed)
    if (!board.isLegal(move)) break
    sans.push(makeSanAndPlay(board, move))
    moves.push(makeUci(move))
  }

  return {
    base,
    moves,
    sans,
    position: {
      fen: makeFen(board.toSetup()),
      turn: board.turn,
      check: board.isCheck(),
    },
    ply: base + moves.length,
    lastMove: moves.at(-1) ?? null,
    dests: chessgroundDests(board),
    board,
  }
}

/**
 * The line extended by one board move, or null when that move is not legal here. A pawn
 * reaching the last rank promotes to a queen, as it does on the explorer's board — an
 * underpromotion is not what a Maia rollout is ever about.
 */
export function withBoardMove(
  analysis: AnalysisLine,
  orig: string,
  dest: string,
): string[] | null {
  const plain = parseUci(`${orig}${dest}`)
  if (!plain || !('from' in plain)) return null
  const promotes =
    analysis.board.board.getRole(plain.from) === 'pawn' &&
    (dest.endsWith('8') || dest.endsWith('1'))
  const move: NormalMove = promotes ? { ...plain, promotion: 'queen' } : plain
  if (!analysis.board.isLegal(move)) return null
  return [...analysis.moves, makeUci(move)]
}
