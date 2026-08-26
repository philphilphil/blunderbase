/**
 * The line the explorer is standing on, replayed from the initial array.
 *
 * `/explorer` is keyed by position, not by path: it takes a FEN and answers with the
 * continuations the owner has played from there. Walking the tree is therefore a client-side
 * job — chessops replays the moves, hands back the FEN to ask about, and supplies the legal
 * destinations the board needs to accept the next click.
 *
 * The backend normalises whatever FEN it is given down to an EPD (`services.explorer.
 * normalize_fen`), so the full FEN produced here is exactly as good as an EPD would be.
 */
import { Chess } from 'chessops/chess'
import { chessgroundDests } from 'chessops/compat'
import { makeFen } from 'chessops/fen'
import { makeSanAndPlay } from 'chessops/san'
import type { Move, NormalMove, SquareName } from 'chessops/types'
import { makeUci, parseUci } from 'chessops/util'

export interface LineStep {
  /** 0-based, counted from the initial position — ply 0 is White's first move. */
  ply: number
  uci: string
  san: string
}

export interface LinePosition {
  /** The moves that were actually legal; an unplayable tail is dropped rather than thrown. */
  steps: LineStep[]
  /** The full FEN of the position the line arrives at. */
  fen: string
  turn: 'white' | 'black'
  /** The ply the *next* move would have, which is `steps.length`. */
  ply: number
  lastMove: string | null
  /** Legal destinations per origin square, for the board. */
  dests: Map<SquareName, SquareName[]>
  /** True when the requested line could not be played to the end. */
  truncated: boolean
}

function isNormal(move: Move): move is NormalMove {
  return 'from' in move
}

/** Replay a list of UCI moves from the start. Anything illegal ends the line there. */
export function buildLine(ucis: readonly string[]): LinePosition {
  const position = Chess.default()
  const steps: LineStep[] = []
  let truncated = false

  for (const uci of ucis) {
    const move = parseUci(uci)
    if (!move || !position.isLegal(move)) {
      truncated = true
      break
    }
    // `makeSanAndPlay` needs the position *before* the move to disambiguate, and plays it.
    const san = makeSanAndPlay(position, move)
    steps.push({ ply: steps.length, uci: makeUci(move), san })
  }

  return {
    steps,
    fen: makeFen(position.toSetup()),
    turn: position.turn,
    ply: steps.length,
    lastMove: steps.at(-1)?.uci ?? null,
    dests: chessgroundDests(position),
    truncated,
  }
}

/**
 * The line extended by one board move, or null when that move is not legal here.
 * A pawn reaching the last rank promotes to a queen — the explorer walks openings, and no
 * repertoire hinges on an underpromotion on move six.
 */
export function withMove(
  line: LinePosition,
  orig: string,
  dest: string,
): string[] | null {
  const position = replay(line.steps)
  const plain = parseUci(`${orig}${dest}`)
  if (!plain || !isNormal(plain)) return null

  const promotes =
    position.board.getRole(plain.from) === 'pawn' &&
    (dest.endsWith('8') || dest.endsWith('1'))
  const move: NormalMove = promotes ? { ...plain, promotion: 'queen' } : plain
  if (!position.isLegal(move)) return null
  return [...line.steps.map((step) => step.uci), makeUci(move)]
}

/** The UCI list truncated to `ply` moves — clicking a breadcrumb crumb. */
export function truncateTo(line: LinePosition, ply: number): string[] {
  return line.steps.slice(0, Math.max(0, ply)).map((step) => step.uci)
}

function replay(steps: readonly LineStep[]): Chess {
  const position = Chess.default()
  for (const step of steps) {
    const move = parseUci(step.uci)
    if (move && position.isLegal(move)) position.play(move)
  }
  return position
}

/** `e2e4,e7e5` — how a line rides in the URL. */
export function parseLineParam(value: string | null): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((uci) => uci.trim().toLowerCase())
    .filter((uci) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci))
}

export function formatLineParam(ucis: readonly string[]): string {
  return ucis.join(',')
}

/** `12.` for White, `12…` for Black — the move number a ply belongs to. */
export function plyLabel(ply: number): string {
  return `${Math.floor(ply / 2) + 1}${ply % 2 === 0 ? '.' : '…'}`
}
