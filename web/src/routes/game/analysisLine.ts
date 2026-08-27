/**
 * The analysis board: a line the reader has played *off* the game.
 *
 * The game view is otherwise a cursor into a fixed move list. Clicking an engine PV move,
 * a Maia rollout move or dragging a piece branches from the position the cursor is on and
 * keeps its own little move list — `base` says which game position it left from, `moves`
 * says what has been played since. An empty (or absent) line means the board is back on
 * the game, which is what tells the panel to use stored data rather than to query.
 *
 * The line is walkable: `cursor` says how many of its moves are actually on the board, so a
 * clicked engine PV keeps its whole tail while the reader steps through it. Everything the
 * page reads off the line — the position, the legal destinations, the ply — is taken at the
 * cursor, never at the line's end.
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
  /** The whole line, in UCI. An illegal tail is dropped rather than thrown. */
  moves: string[]
  /** The same moves in SAN, for the move list. */
  sans: string[]
  /** How many of `moves` are on the board — always within `[0, moves.length]`. */
  cursor: number
  /** The position after `cursor` moves. */
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
 * Replay `ucis` from the game position after `base` plies, stopping the *board* after
 * `cursor` of them (the whole line by default). Returns null when the game has no such
 * position — a cursor that has run off the end of a half-replayed game.
 *
 * A move the position rejects ends the line there, so `cursor` is clamped to what actually
 * replayed: a click that lands on a move which is no longer legal leaves the board on the
 * last position the line really reached rather than stranding it past the end.
 */
export function buildAnalysisLine(
  line: GameLine,
  base: number,
  ucis: readonly string[],
  cursor?: number,
): AnalysisLine | null {
  const start = line.boards[base]
  if (!start) return null

  const replay = start.clone()
  const moves: string[] = []
  const sans: string[] = []
  for (const uci of ucis) {
    const parsed = parseUci(uci)
    if (!parsed) break
    const move = normalizeMove(replay, parsed)
    if (!replay.isLegal(move)) break
    sans.push(makeSanAndPlay(replay, move))
    moves.push(makeUci(move))
  }

  const at = Math.max(0, Math.min(moves.length, cursor ?? moves.length))
  // The board the page reads is the one at the cursor, so the line is replayed again up to
  // it. `at === moves.length` is the common case and could reuse `replay`, but replaying is
  // a handful of moves and one code path is worth more than the saving.
  const board = start.clone()
  for (const uci of moves.slice(0, at)) {
    board.play(normalizeMove(board, parseUci(uci)!))
  }

  return {
    base,
    moves,
    sans,
    cursor: at,
    position: {
      fen: makeFen(board.toSetup()),
      turn: board.turn,
      check: board.isCheck(),
    },
    ply: base + at,
    lastMove: at > 0 ? moves[at - 1]! : null,
    dests: chessgroundDests(board),
    board,
  }
}

/**
 * The line truncated at the cursor and extended by one board move, or null when that move
 * is not legal here. Dragging a piece in the middle of a walked line is a new continuation
 * from *this* position, so whatever the line said next is dropped rather than left dangling
 * behind a move that no longer leads to it.
 *
 * A pawn reaching the last rank promotes to a queen, as it does on the explorer's board — an
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
  return [...analysis.moves.slice(0, analysis.cursor), makeUci(move)]
}
