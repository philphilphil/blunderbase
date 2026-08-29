/**
 * The chess this runner has to do itself, on chessops instead of python-chess.
 *
 * Three things a browser tab cannot get away with hand-waving, because the rows it sends
 * back are stored next to rows a Python host wrote and nothing downstream can tell them
 * apart:
 *
 * - **Castling spellings.** python-chess writes `e1g1` in a standard game and `e1h1` in a
 *   Chess960 one; chessops normalises every castling move to king-takes-rook internally,
 *   so writing a UCI back out has to undo that per the game's own variant. A stored
 *   `best_move_uci` in the wrong spelling is a move the game page cannot match.
 * - **Legality.** `StockfishAdapter.analyse` drops a candidate whose first PV move the
 *   position rejects, and truncates the rest at the first move that does not replay
 *   (`line()`); a PV that ran off the end of what we can verify must not be stored as if
 *   it had been checked.
 * - **Which games are Chess960 at all.** `import_service.CHESS960_VARIANTS` names the
 *   three spellings, and `analysis.replay` additionally turns the flag on for any position
 *   whose castling rights are not the standard ones — a Chess960 game imported under a
 *   variant name nobody wrote down is still a Chess960 game.
 */
import { Chess, castlingSide, normalizeMove, type Position } from 'chessops/chess'
import { parseFen } from 'chessops/fen'
import { isNormal, type NormalMove, type Square } from 'chessops/types'
import { kingCastlesTo, makeSquare, makeUci, moveEquals, parseUci } from 'chessops/util'

/** `services/import_service.py: CHESS960_VARIANTS`. */
export const CHESS960_VARIANTS = new Set(['chess960', 'fischerandom', 'fischerrandom'])

/** a1, h1, a8, h8 — where a standard game's castling rooks stand. */
const CORNERS: Square[] = [0, 7, 56, 63]
const WHITE_KING_HOME: Square = 4
const BLACK_KING_HOME: Square = 60

/** A position out of a FEN, or null because nothing could be made of it. */
export function positionFrom(fen: string): Chess | null {
  const setup = parseFen(fen)
  if (setup.isErr) return null
  const position = Chess.fromSetup(setup.value)
  return position.isErr ? null : position.value
}

/**
 * `Board.has_chess960_castling_rights`: castling rights that a standard game could not
 * have. Ported because `analysis.replay` reads it, so a plan whose variant says nothing
 * still ends up analysed under the right spelling.
 */
export function hasChess960CastlingRights(position: Chess): boolean {
  const rooks = [...position.castles.castlingRights]
  if (rooks.some((square) => !CORNERS.includes(square))) return true
  if (rooks.some((square) => square < 8) && position.board.kingOf('white') !== WHITE_KING_HOME) {
    return true
  }
  if (rooks.some((square) => square >= 56) && position.board.kingOf('black') !== BLACK_KING_HOME) {
    return true
  }
  return false
}

/** One UCI move read in this position: parsed, normalised, and refused unless it is legal. */
export function readUci(position: Position, uci: string): NormalMove | null {
  const parsed = parseUci(uci)
  if (!parsed || !isNormal(parsed)) return null
  const move = normalizeMove(position, parsed)
  if (!isNormal(move) || !position.isLegal(move)) return null
  return move
}

/**
 * One move as `Board.uci` would have written it: king-takes-rook under Chess960, and the
 * two-square king move otherwise.
 */
export function writeUci(position: Position, move: NormalMove, chess960: boolean): string {
  const side = castlingSide(position, move)
  if (side && !chess960) {
    return makeSquare(move.from) + makeSquare(kingCastlesTo(position.turn, side))
  }
  return makeUci(move)
}

/**
 * `adapters/stockfish.py: line()` — a principal variation as UCI, cut at `limit` plies and
 * again at the first move the replay will not accept.
 */
export function truncateLine(
  position: Position,
  pv: string[],
  limit: number,
  chess960: boolean,
): string[] {
  const replay = position.clone()
  const moves: string[] = []
  for (const uci of pv.slice(0, limit)) {
    const move = readUci(replay, uci)
    if (!move) break
    moves.push(writeUci(replay, move, chess960))
    replay.play(move)
  }
  return moves
}

/**
 * `analysis._is_best`: whether the move played is the engine's first choice, castling
 * spellings aside. A move neither side can parse falls back to comparing the text, exactly
 * as the Python does.
 */
export function isBest(position: Position, played: string, best: string | null): boolean {
  if (best === null) return false
  const left = readUci(position, played)
  const right = readUci(position, best)
  if (!left || !right) return played === best
  return moveEquals(left, right)
}
