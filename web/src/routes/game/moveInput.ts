/**
 * A move typed rather than dragged: `Nf3`, `exd5`, `O-O`, `e8=Q`, `g1f3`.
 *
 * chessground knows nothing about the keyboard — lichess's own typed-move box is a module
 * beside the board, not part of it — so this is the piece that turns what a reader typed
 * into the one legal move they meant, or says why it cannot yet. It is pure: a position, a
 * string and a language in, a resolution out, so the whole of "what does `Nd2` mean here"
 * is testable without a board on the screen.
 *
 * What is accepted is what people actually type, which is looser than SAN:
 *
 * - The captures, checks and promotion signs are optional (`ed5` is `exd5`, `Nf3` matches
 *   `Nf3+`, `e8Q` is `e8=Q`), because they are things the *position* knows and the reader
 *   should not have to spell to be understood.
 * - The piece letters of the app's language are read as well as the English ones — a
 *   German reader whose move list says `Sf3` types `Sf3` — and a lower-case piece letter
 *   that cannot be a file (`n`, `q`, `r`, `k`; `s`, `t`, `l` in German) is a piece. `b`
 *   and `d` stay files: `bxc3` is the b-pawn, and the bishop is `Bxc3`.
 * - Disambiguation may be left out: `Nd2` finds the one knight that can go there, and
 *   reports *ambiguous* rather than guessing when two can, so the reader adds the file.
 * - Castling is `O-O`, `0-0`, `oo` or `OO`, however the keyboard had it.
 * - Plain UCI (`g1f3`, `e7e8q`) works too, since that is how the app's own engine lines
 *   and the MCP payloads spell a move.
 *
 * The resolution says one more thing than "this move or nothing": whether the text is
 * *finished*. `O-O` is a legal move and also the first three characters of `O-O-O`, so a
 * box that plays a move the moment it becomes unambiguous must know to wait there. The
 * component plays a `complete` match as it is typed and everything else on Enter.
 */
import type { Chess } from 'chessops/chess'
import { normalizeMove } from 'chessops/chess'
import { makeSan } from 'chessops/san'
import type { NormalMove, Role } from 'chessops/types'
import { makeUci, parseUci, squareRank } from 'chessops/util'

import { PIECE_LETTERS } from '@/lib/chess/notation'
import type { Locale } from '@/lib/i18n/locale'

/** One legal move, spelled both ways the app spells moves. */
export interface TypedMove {
  move: NormalMove
  uci: string
  /** English SAN, as the store writes it — `formatSan` for the reader's own letters. */
  san: string
}

export type MoveResolution =
  | { kind: 'empty' }
  /** Exactly one legal move; `complete` when nothing else could still be typed onto it. */
  | { kind: 'move'; move: TypedMove; complete: boolean }
  /** Several moves fit what was typed — a piece letter and a square two pieces can reach. */
  | { kind: 'ambiguous'; moves: TypedMove[] }
  /** The start of at least one legal move, and of nothing whole yet. */
  | { kind: 'partial' }
  | { kind: 'none' }

const ENGLISH = 'KQRBN'
/** Lower-case letters that are never a file, so can only have meant a piece. */
const LOWER_PIECES = new Set(['n', 'q', 'r', 'k'])
const UCI = /^([a-h][1-8])([a-h][1-8])([qrbnQRBN]?)$/
const CASTLING = /^[oO0](?:-?[oO0]){1,2}$/
const PROMOTIONS: readonly Role[] = ['queen', 'rook', 'bishop', 'knight']

/**
 * Every legal move here, with its SAN. Promotions are one move per piece — a pawn on the
 * seventh has four legal moves to the eighth, and `e8=N` is a different answer from `e8=Q`.
 */
export function legalMoves(board: Chess): TypedMove[] {
  const moves: TypedMove[] = []
  for (const [from, tos] of board.allDests()) {
    const pawn = board.board.getRole(from) === 'pawn'
    for (const to of tos) {
      const promotes = pawn && (squareRank(to) === 7 || squareRank(to) === 0)
      const roles: readonly (Role | undefined)[] = promotes ? PROMOTIONS : [undefined]
      for (const promotion of roles) {
        const move: NormalMove = promotion ? { from, to, promotion } : { from, to }
        moves.push({ move, uci: makeUci(move), san: makeSan(board, move) })
      }
    }
  }
  return moves
}

/** A SAN with the signs the position already knows taken out: `exd5+` → `ed5`, `e8=Q` → `e8Q`. */
function key(san: string): string {
  return san.replace(/[x=+#:]/g, '')
}

/**
 * The key with the *disambiguation* taken out as well: `Nbd2` → `Nd2`, `exd5` → `d5`. What a
 * reader types when they have not yet noticed two pieces can make the move.
 */
function looseKey(san: string): string {
  const stripped = key(san)
  if (stripped.startsWith('O-O')) return stripped
  const piece = /^[KQRBN]/.test(stripped) ? stripped[0]! : ''
  const rest = stripped.slice(piece.length)
  // The destination square is the last `[a-h][1-8]` in what is left; anything after it is
  // a promotion letter, anything before it is the disambiguation (or a pawn's file).
  const at = rest.search(/[a-h][1-8](?![a-h1-8])/)
  if (at < 0) return stripped
  return piece + rest.slice(at)
}

/**
 * What was typed, spelled the way `key` spells a SAN: castling in `O`s, the language's
 * piece letters turned English, the optional signs dropped, a promotion letter upper-cased.
 */
function normalise(text: string, locale: Locale): string {
  const trimmed = text.trim()
  if (CASTLING.test(trimmed)) {
    return trimmed.replace(/-/g, '').length >= 3 ? 'O-O-O' : 'O-O'
  }
  let out = trimmed.replace(/[x=+#:\s]/g, '')
  if (!out) return out
  const local = PIECE_LETTERS[locale]
  const toEnglish = (letter: string): string => {
    const upper = letter.toUpperCase()
    if (ENGLISH.includes(upper)) return upper
    const at = local.indexOf(upper)
    return at >= 0 ? ENGLISH[at]! : letter
  }
  const first = out[0]!
  const localLower = new Set(
    [...local.toLowerCase()].filter((letter) => !/[a-h]/.test(letter)),
  )
  if (/[A-Z]/.test(first) || LOWER_PIECES.has(first) || localLower.has(first)) {
    out = toEnglish(first) + out.slice(1)
  }
  // A promotion letter: whatever follows the last square.
  const tail = out.match(/^(.*[a-h][1-8])([a-zA-Z])$/)
  if (tail) out = tail[1]! + toEnglish(tail[2]!)
  return out
}

/** A pawn reaching the last rank with no piece named promotes to a queen, as a drag does. */
function queened(board: Chess, move: NormalMove): NormalMove {
  if (move.promotion) return move
  const pawn = board.board.getRole(move.from) === 'pawn'
  const last = squareRank(move.to) === 7 || squareRank(move.to) === 0
  return pawn && last ? { ...move, promotion: 'queen' } : move
}

/**
 * The move `text` means in this position, if it means exactly one.
 *
 * Order matters: UCI first because it is unambiguous by construction, then the SAN spelled
 * in full (`Nbd2`), then the SAN with its disambiguation left off (`Nd2`) — a full spelling
 * is never reported ambiguous by a looser reading of the same letters.
 */
export function resolveTypedMove(board: Chess, text: string, locale: Locale): MoveResolution {
  const typed = normalise(text, locale)
  if (!typed) return { kind: 'empty' }

  const uci = UCI.exec(typed.toLowerCase())
  if (uci) {
    const parsed = parseUci(typed.toLowerCase())
    if (parsed && 'from' in parsed) {
      const move = queened(board, normalizeMove(board, parsed) as NormalMove)
      if (board.isLegal(move)) {
        return {
          kind: 'move',
          move: { move, uci: makeUci(move), san: makeSan(board, move) },
          complete: true,
        }
      }
    }
    return { kind: 'none' }
  }

  const candidates = legalMoves(board)
  const keys = candidates.map((candidate) => ({
    candidate,
    full: key(candidate.san),
    loose: looseKey(candidate.san),
  }))

  // Could more typing still turn this text into a *different* move? `O-O` into `O-O-O`,
  // `e8` into `e8Q` — the box must not play what may only be half of what is meant.
  const complete = (own: TypedMove) =>
    !keys.some(
      (entry) =>
        entry.candidate !== own &&
        ((entry.full.startsWith(typed) && entry.full !== typed) ||
          (entry.loose.startsWith(typed) && entry.loose !== typed)),
    )

  const exact = keys.find((entry) => entry.full === typed)
  if (exact) return { kind: 'move', move: exact.candidate, complete: complete(exact.candidate) }

  const loose = keys.filter((entry) => entry.loose === typed)
  if (loose.length === 1) {
    const only = loose[0]!.candidate
    return { kind: 'move', move: only, complete: complete(only) }
  }
  if (loose.length > 1) return { kind: 'ambiguous', moves: loose.map((entry) => entry.candidate) }

  const prefix = keys.some(
    (entry) => entry.full.startsWith(typed) || entry.loose.startsWith(typed),
  )
  return prefix ? { kind: 'partial' } : { kind: 'none' }
}
