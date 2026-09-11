/**
 * Reading a move against a position: what the board may do, and what the owner typed.
 *
 * chessops is the referee on this side too, for the same reason the repertoire uses it —
 * the board has to know the legal destinations before a drag can be accepted, and the
 * "opponent played…" box has to turn `Nf5` or `g1f3` into the UCI the API takes. The
 * backend validates again and is the authority; this is what keeps an obvious mistake from
 * becoming a round trip.
 *
 * Every function is total: an unparseable FEN, an illegal move or a typo answers with
 * `null` rather than throwing, because none of them is a reason for a screen to go blank.
 */
import { Chess } from 'chessops/chess'
import { chessgroundDests } from 'chessops/compat'
import { parseFen } from 'chessops/fen'
import { parseSan } from 'chessops/san'
import { isNormal, type NormalMove, type SquareName } from 'chessops/types'
import { makeUci, parseUci } from 'chessops/util'

/** The position a FEN names, or null when it names none. */
export function positionOf(fen: string | null | undefined): Chess | null {
  if (!fen) return null
  const setup = parseFen(fen)
  if (setup.isErr) return null
  const position = Chess.fromSetup(setup.value)
  return position.isErr ? null : position.value
}

/** Legal destinations per origin square — what chessground needs to accept a drag at all. */
export function destsFor(fen: string | null | undefined): Map<SquareName, SquareName[]> {
  const position = positionOf(fen)
  return position ? chessgroundDests(position) : new Map()
}

/**
 * A board drag as UCI, or null when it is not legal here. A pawn reaching the last rank
 * promotes to a queen: the tree is for choosing between candidate moves, and an
 * underpromotion that matters can be typed into "opponent played…" instead.
 */
export function uciFor(fen: string, orig: string, dest: string): string | null {
  const position = positionOf(fen)
  if (!position) return null
  const plain = parseUci(`${orig}${dest}`)
  if (!plain || !isNormal(plain)) return null
  const promotes =
    position.board.getRole(plain.from) === 'pawn' && (dest.endsWith('8') || dest.endsWith('1'))
  const move: NormalMove = promotes ? { ...plain, promotion: 'queen' } : plain
  return position.isLegal(move) ? makeUci(move) : null
}

/**
 * What the owner typed, as UCI: SAN (`Nf5`, `O-O`, `exd6+`) or UCI (`g1f3`, `e7e8q`) alike.
 *
 * Both spellings are accepted because both are what a correspondence server hands out —
 * the move mail says `17.Nf5` and the API says `g1f5`, and asking which one this box wants
 * would be asking the reader to do the conversion the program is already able to do.
 */
export function parseMoveText(fen: string, text: string): string | null {
  const position = positionOf(fen)
  const typed = text.trim()
  if (!position || typed === '') return null
  const uci = parseUci(typed)
  if (uci && position.isLegal(uci)) return makeUci(uci)
  const san = parseSan(position, typed.replace(/^\d+\.+\s*/, ''))
  return san && position.isLegal(san) ? makeUci(san) : null
}
