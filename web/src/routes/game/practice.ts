/**
 * A practice game, as pure functions: whose move it is, how it ended, what a take-back
 * removes, and which move Maia plays.
 *
 * The game is not a second board. It is the analysis line the page already walks — the
 * reader's moves and the computer's are appended to the same branch a drag appends to — so
 * every surface that reads a line (the move list, the kept variations, Pin this line, the
 * live engine afterwards) works on a practice game without knowing it is one. What this
 * module adds is the one thing a line does not have: a side that belongs to the reader, and
 * the rules that follow from that.
 *
 * Kept free of React and of the network so the whole of "is it my move, is it over, what
 * does take back undo" is testable with a FEN and a list of moves.
 */
import type { Chess } from 'chessops/chess'
import { makeFen } from 'chessops/fen'
import { parseUci } from 'chessops/util'
import { normalizeMove } from 'chessops/chess'

import type { MaiaPolicyMove, MaiaPolicyResponse, PracticeOpponents } from '@/lib/api/types'

export type PracticeSide = 'white' | 'black'

/** The think times the dialog offers, in milliseconds. A second is what a rated Stockfish is tuned around. */
export const THINK_TIMES = [500, 1000, 2000, 5000] as const

/** The dialog's name for Maia among the engine ids. */
export const MAIA_CHOICE = 'maia'

/**
 * Who the dialog opens on: Maia where it can answer, else the analysis role's engine, else
 * the first engine that can. Maia first because a practice opponent is most use when it
 * plays like a person of a rating, and that is what Maia is.
 */
export function preferredOpponent(
  opponents: PracticeOpponents | undefined,
): number | typeof MAIA_CHOICE | null {
  if (!opponents) return null
  if (opponents.maia.available) return MAIA_CHOICE
  const usable = opponents.engines.filter((row) => row.available)
  const role = usable.find((row) => row.engine_id === opponents.default_engine_id)
  return (role ?? usable[0])?.engine_id ?? null
}

/** Who answers the reader's moves. */
export type PracticeOpponent =
  | {
      kind: 'engine'
      engineId: number
      name: string
      /** The rating the engine is held to; null plays at full strength. */
      elo: number | null
      movetimeMs: number
    }
  | {
      kind: 'maia'
      /** The level asked for; null asks the deployment's first configured one. */
      level: number | null
    }

export interface PracticeGame {
  side: PracticeSide
  opponent: PracticeOpponent
  /** The game plies the line branches from. A line with another base is not this game. */
  base: number
  /** How many moves of the line were on the board when practice began: take-back stops there. */
  from: number
  /** Whether the evaluation, the lines and Maia are shown (`H`). Hidden by default. */
  reveal: boolean
}

/**
 * - `yours` — the reader is to move at the end of the line.
 * - `thinking` — the computer is to move at the end of the line.
 * - `reviewing` — the board has been stepped back into the line; nothing is asked.
 * - `over` — the game has ended at the end of the line.
 */
export type PracticePhase = 'yours' | 'thinking' | 'reviewing' | 'over'

export type PracticeResult =
  | { kind: 'checkmate'; winner: PracticeSide }
  | { kind: 'stalemate' }
  | { kind: 'insufficient' }
  | { kind: 'fifty-moves' }
  | { kind: 'repetition' }

/** The position after `moves` from `start`, or null where a move does not replay. */
function replay(start: Chess, moves: readonly string[]): Chess[] | null {
  const board = start.clone()
  const boards = [board.clone()]
  for (const uci of moves) {
    const parsed = parseUci(uci)
    if (!parsed) return null
    const move = normalizeMove(board, parsed)
    if (!board.isLegal(move)) return null
    board.play(move)
    boards.push(board.clone())
  }
  return boards
}

/** The part of a FEN that makes two positions the same position for a repetition. */
function repetitionKey(board: Chess): string {
  return makeFen(board.toSetup()).split(' ').slice(0, 4).join(' ')
}

/**
 * How the game stands after `moves`, or null while it goes on.
 *
 * Checkmate, stalemate and too little material are the board's own; the fifty-move rule
 * and threefold repetition are claimed for the reader the moment they are there, since
 * there is no opponent across the table to claim them and a practice game that played on
 * past a dead draw would be practising nothing.
 */
export function practiceResult(start: Chess, moves: readonly string[]): PracticeResult | null {
  const boards = replay(start, moves)
  if (boards === null) return null
  const board = boards[boards.length - 1]!
  if (board.isCheckmate()) {
    return { kind: 'checkmate', winner: board.turn === 'white' ? 'black' : 'white' }
  }
  if (board.isStalemate()) return { kind: 'stalemate' }
  if (board.isInsufficientMaterial()) return { kind: 'insufficient' }
  if (board.halfmoves >= 100) return { kind: 'fifty-moves' }
  const key = repetitionKey(board)
  if (boards.filter((seen) => repetitionKey(seen) === key).length >= 3) {
    return { kind: 'repetition' }
  }
  return null
}

/** Where the practice game stands, for a board at `cursor` of a line of `moves`. */
export function practicePhase(
  game: PracticeGame,
  start: Chess,
  moves: readonly string[],
  cursor: number,
): PracticePhase {
  if (cursor < moves.length) return 'reviewing'
  if (practiceResult(start, moves) !== null) return 'over'
  const boards = replay(start, moves)
  const turn = boards?.[boards.length - 1]?.turn
  return turn === game.side ? 'yours' : 'thinking'
}

/**
 * How long the line is after a take-back.
 *
 * With the reader to move, the computer's reply and the reader's move before it both go, so
 * the reader is to move again in the position they chose from. With the computer still
 * thinking, only the reader's own last move goes. Never below where practice began: the
 * moves before that were the game, or the reader's analysis, not this game.
 */
export function takeBackLength(
  game: PracticeGame,
  start: Chess,
  moves: readonly string[],
): number {
  const length = moves.length
  if (length <= game.from) return length
  const boards = replay(start, moves)
  const turn = boards?.[boards.length - 1]?.turn
  const drop = turn === game.side ? 2 : 1
  return Math.max(game.from, length - drop)
}

/** Whether a take-back has anything to take. */
export function canTakeBack(game: PracticeGame, moves: readonly string[]): boolean {
  return moves.length > game.from
}

/** The level's policy out of a live answer, or the top-level one when the level is not keyed. */
export function policyFor(answer: MaiaPolicyResponse, level: number | null): MaiaPolicyMove[] {
  if (level !== null) {
    const keyed = answer.levels?.[String(level)]
    if (keyed) return keyed.policy
  }
  return answer.policy
}

/**
 * The move Maia plays: a draw from its policy, weighted by the share of humans who play each.
 *
 * Its most likely move every time would be a deterministic bot that never blunders the way
 * the rating it was trained on does — the thing a practice opponent at 1500 is for. Where
 * the build publishes no probability the rank stands in (the first twice as likely as the
 * second, and so on), which keeps the order the model gave. `random` is `Math.random` in the
 * page and a fixed sequence in a test.
 */
export function sampleMove(
  policy: readonly MaiaPolicyMove[],
  random: () => number = Math.random,
): string | null {
  const offered = policy.filter((entry) => entry.uci)
  if (offered.length === 0) return null
  const published = offered.some((entry) => typeof entry.p === 'number' && entry.p > 0)
  const weights = offered.map((entry, index) =>
    published
      ? Math.max(0, entry.p ?? 0)
      : 1 / (typeof entry.rank === 'number' && entry.rank > 0 ? entry.rank : index + 1),
  )
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  if (total <= 0) return offered[0]!.uci
  let pick = random() * total
  for (let index = 0; index < offered.length; index += 1) {
    pick -= weights[index]!
    if (pick < 0) return offered[index]!.uci
  }
  return offered[offered.length - 1]!.uci
}
