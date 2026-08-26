/**
 * Score formatting and the win-percentage curve.
 *
 * The conversion mirrors `backend/services/analysis.py` exactly (Lichess's curve, the
 * same constants, the same clamps) so a number the UI derives can never disagree with a
 * number the engine pipeline stored.
 */

/** How the backend reports one evaluation: centipawns, or a mate distance. */
export interface Score {
  cp?: number | null
  mate?: number | null
}

export const WIN_PERCENT_K = 0.00368208
export const CP_CLAMP = 1000
export const MATE_CP_BASE = 21
export const MATE_CP_CAP = 10

/** The typographic minus the design uses for negative evals (U+2212). */
export const MINUS = '−'

function rawChances(cp: number): number {
  return 2 / (1 + Math.exp(-WIN_PERCENT_K * cp)) - 1
}

/** −1 (lost) .. +1 (won), from the point of view the score is given in. */
export function winningChances({ cp, mate }: Score): number {
  if (mate !== null && mate !== undefined) {
    const magnitude = (MATE_CP_BASE - Math.min(MATE_CP_CAP, Math.abs(mate))) * 100
    // `mate` is 0 both for "is mated" and for "has mated"; the folded centipawn score is
    // what carries the sign in that case.
    const sign = mate > 0 ? 1 : mate < 0 ? -1 : (cp ?? 0) >= 0 ? 1 : -1
    return rawChances(sign * magnitude)
  }
  if (cp === null || cp === undefined) return 0
  return rawChances(Math.max(-CP_CLAMP, Math.min(CP_CLAMP, cp)))
}

/** 0..100: how often the side the score belongs to wins from here. */
export function winPercent(score: Score): number {
  return round(50 + 50 * winningChances(score), 2)
}

/** The inverse of the centipawn branch of the curve, for placing a value back on an axis. */
export function winPercentToCp(win: number): number {
  const clamped = Math.min(99.99, Math.max(0.01, win))
  const chances = clamped / 50 - 1
  return Math.round(-Math.log(2 / (chances + 1) - 1) / WIN_PERCENT_K)
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** `1.24` -> `+1.24`, `-0.31` -> `−0.31`, always two decimals. */
export function formatPawns(pawns: number, { signed = true }: { signed?: boolean } = {}): string {
  const magnitude = Math.abs(pawns).toFixed(2)
  if (pawns < 0) return `${MINUS}${magnitude}`
  return signed ? `+${magnitude}` : magnitude
}

/** Centipawns as pawns: `124` -> `+1.24`. */
export function formatCp(cp: number, options?: { signed?: boolean }): string {
  return formatPawns(cp / 100, options)
}

/** `5` -> `M5`, `-3` -> `−M3`, `0` -> `#` (the game is over). */
export function formatMate(mate: number): string {
  if (mate === 0) return '#'
  return mate > 0 ? `M${mate}` : `${MINUS}M${Math.abs(mate)}`
}

/**
 * One evaluation as it is shown next to a move or on an axis. Mate wins over centipawns,
 * and an evaluation nobody has computed yet is an em dash rather than a zero.
 */
export function formatScore(
  score: Score | null | undefined,
  options: { signed?: boolean; empty?: string } = {},
): string {
  const { signed = true, empty = '—' } = options
  if (!score) return empty
  if (score.mate !== null && score.mate !== undefined) return formatMate(score.mate)
  if (score.cp === null || score.cp === undefined) return empty
  return formatCp(score.cp, { signed })
}

/** `62.417` -> `62.4%`. */
export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${value.toFixed(digits)}%`
}

/**
 * How much win percentage a move gave away, as the move list shows it. The backend stores
 * `win_loss` in percentage points and only ever positive, so this only adds the sign.
 */
export function formatWinLoss(winLoss: number | null | undefined, digits = 1): string {
  if (winLoss === null || winLoss === undefined || Number.isNaN(winLoss)) return '—'
  if (winLoss <= 0) return `0.0%`
  return `${MINUS}${winLoss.toFixed(digits)}%`
}

/** Accuracy-style numbers: one decimal, an em dash when there is nothing to show. */
export function formatAccuracy(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return value.toFixed(1)
}

/**
 * The eval-graph value for one point: win percentage from White's side, so the area chart
 * reads the way every chess eval bar does regardless of whose move it is.
 *
 * `pov` is the colour the score is given in; scores stored per-ply are from the mover's
 * point of view.
 */
export function whiteWinPercent(score: Score, pov: 'white' | 'black' = 'white'): number {
  const win = winPercent(score)
  return pov === 'white' ? win : round(100 - win, 2)
}

/** `123` -> `1.2M`, `4500` -> `4.5k` — engine node budgets, as the design writes them. */
export function formatNodes(nodes: number | null | undefined): string {
  if (nodes === null || nodes === undefined) return '—'
  if (nodes >= 1_000_000) return `${round(nodes / 1_000_000, 1)}M`
  if (nodes >= 1_000) return `${round(nodes / 1_000, 1)}k`
  return String(nodes)
}

/** `24` -> `12…` for Black, `12.` for White — the move-list number column. */
export function moveNumberLabel(ply: number): string {
  const moveNumber = Math.floor(ply / 2) + 1
  return ply % 2 === 0 ? `${moveNumber}.` : `${moveNumber}…`
}
