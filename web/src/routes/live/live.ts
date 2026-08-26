/**
 * The live session, translated for the board.
 *
 * `backend/services/live.py` speaks chessground's own vocabulary — the four brush names
 * and plain square keys — precisely so this layer is a rename and not an interpretation.
 * What is left here is the defaulting: a mark the coach drew without naming a colour, and
 * which way round the board should face.
 */
import type { BoardArrow, BoardOrientation, BoardSquare } from '@/components/board/Board'
import type { GameSummary, LiveState } from '@/lib/api/types'

/** `backend/services/live.py: COLORS` — anything else would reach the board as no colour. */
export const LIVE_BRUSHES = ['green', 'red', 'blue', 'yellow'] as const

export const ARROW_FALLBACK = 'green'
export const SQUARE_FALLBACK = 'yellow'

function brush(color: string | undefined, fallback: string): string {
  return color && (LIVE_BRUSHES as readonly string[]).includes(color) ? color : fallback
}

export function boardArrows(state: LiveState | undefined): BoardArrow[] {
  return (state?.arrows ?? []).map((arrow) => ({
    from: arrow.from,
    to: arrow.to,
    color: brush(arrow.color, ARROW_FALLBACK),
  }))
}

export function boardSquares(state: LiveState | undefined): BoardSquare[] {
  return (state?.squares ?? []).map((square) => ({
    square: square.square,
    color: brush(square.color, SQUARE_FALLBACK),
  }))
}

/**
 * Which way the board faces: the owner's colour in the game being followed, White for an
 * ad-hoc position, and whatever the viewer flipped it to over both.
 */
export function orientationFor(
  game: GameSummary | undefined,
  flipped: boolean,
): BoardOrientation {
  const base: BoardOrientation = game?.color === 'black' ? 'black' : 'white'
  if (!flipped) return base
  return base === 'white' ? 'black' : 'white'
}

/**
 * Whether the board has left the game it was following.
 *
 * The service keeps the two apart on purpose: `ply` walks the stored line, and anything
 * played beyond it lands in `moves` — so a non-empty `moves` on a game session means the
 * coach is showing a variation, not what was played.
 */
export function isVariation(state: LiveState | undefined): boolean {
  return Boolean(state?.game_id) && (state?.moves.length ?? 0) > 0
}

/** The one-line description of what is on the board, for the page's header. */
export function describeSession(
  state: LiveState | undefined,
  game: GameSummary | undefined,
): string {
  if (!state?.active) return 'Nothing on the board'
  if (state.game_id) {
    const players = game ? `${game.white ?? '?'} — ${game.black ?? '?'}` : `game ${state.game_id}`
    const ply = typeof state.ply === 'number' ? ` · ply ${state.ply}` : ''
    return isVariation(state)
      ? `${players}${ply} + ${state.moves.length} played`
      : `${players}${ply}`
  }
  return state.moves.length > 0
    ? `Ad-hoc position + ${state.moves.length} played`
    : 'Ad-hoc position'
}

/** `4` -> `2…`, `3` -> `2.` — the move number a ply lands on, as the design writes it. */
export function plyLabel(ply: number): string {
  return ply % 2 === 0 ? `${Math.floor(ply / 2) + 1}.` : `${Math.floor(ply / 2) + 1}…`
}
