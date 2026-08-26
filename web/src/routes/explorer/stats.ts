/**
 * Reading `services.explorer.opening_explorer` the way design 2c draws it.
 *
 * Everything here is derived from what the endpoint actually sends. `score` is 0..1 from
 * the owner's side, `avg_win_loss` is win percentage given away by whoever was to move,
 * averaged over the games that have been analysed — `null` until something has looked at
 * the move, which is why an unanalysed continuation shows an em dash rather than a zero.
 */
import type { ExplorerMove, ExplorerResponse, GameSummary } from '@/lib/api/types'
import { MINUS } from '@/lib/chess/evaluation'

/** The three-part win / draw / loss bar, as percentages that always add up to 100. */
export interface Split {
  wins: number
  draws: number
  losses: number
  winPercent: number
  drawPercent: number
  lossPercent: number
  games: number
}

export function splitOf(source: {
  games?: number
  wins?: number
  draws?: number
  losses?: number
}): Split {
  const wins = source.wins ?? 0
  const draws = source.draws ?? 0
  const losses = source.losses ?? 0
  const scored = wins + draws + losses
  const share = (value: number) => (scored > 0 ? (value / scored) * 100 : 0)
  return {
    wins,
    draws,
    losses,
    winPercent: share(wins),
    drawPercent: share(draws),
    lossPercent: share(losses),
    games: source.games ?? scored,
  }
}

/** `0.519` -> `51.9`. */
export function scorePercent(score: number | null | undefined): number | null {
  return typeof score === 'number' ? Math.round(score * 1000) / 10 : null
}

/** Green above 55, red below 45 — the design colours the score column, not just the bar. */
export function scoreTone(score: number | null | undefined): string {
  const percent = scorePercent(score)
  if (percent === null) return 'text-dim-2'
  if (percent >= 55) return 'text-good'
  if (percent <= 45) return 'text-blunder'
  return 'text-body'
}

/**
 * `−0.71` in the design is pawns; the backend deals in win percentage, so the same column
 * shows `−4.2%`. Same meaning, real units.
 */
export function formatAvgDrop(avg: number | null | undefined): string {
  if (avg === null || avg === undefined) return '—'
  if (avg <= 0) return '0.0%'
  return `${MINUS}${avg.toFixed(1)}%`
}

export function dropTone(avg: number | null | undefined): string {
  if (avg === null || avg === undefined) return 'text-dim-2'
  if (avg >= 10) return 'text-blunder'
  if (avg >= 5) return 'text-mistake'
  if (avg >= 2) return 'text-inaccuracy'
  return 'text-soft'
}

/**
 * The average win percentage given away over the whole node, weighted by how often each
 * continuation was played. The endpoint reports this per move but not for the position, and
 * the summary card in design 2c wants one number for the line.
 */
export function averageDrop(moves: readonly ExplorerMove[]): number | null {
  let weight = 0
  let total = 0
  for (const move of moves) {
    if (typeof move.avg_win_loss !== 'number') continue
    const count = move.evaluated ?? move.games ?? 0
    if (count <= 0) continue
    weight += count
    total += move.avg_win_loss * count
  }
  return weight > 0 ? Math.round((total / weight) * 100) / 100 : null
}

/**
 * The continuation that costs the most, among those played often enough to mean anything.
 *
 * A move has to actually give something away to qualify: in a line where every move is
 * accurate there is no worst move, and naming one anyway would be a lie in red type.
 */
export function worstContinuation(
  moves: readonly ExplorerMove[],
  { minGames = 2, minDrop = 1 }: { minGames?: number; minDrop?: number } = {},
): ExplorerMove | null {
  const candidates = moves.filter(
    (move) =>
      typeof move.avg_win_loss === 'number' &&
      move.avg_win_loss >= minDrop &&
      (move.games ?? 0) >= minGames,
  )
  if (candidates.length === 0) return null
  return candidates.reduce((worst, move) =>
    (move.avg_win_loss ?? 0) > (worst.avg_win_loss ?? 0) ? move : worst,
  )
}

/**
 * The short note in the last column: what is actually true about this continuation, not a
 * generated opinion. Ordered so the most useful thing wins.
 */
export function moveNote(move: ExplorerMove, tree: ExplorerResponse): string | null {
  const main = tree.main_line?.[0]
  const leaves = tree.leaves_book_with as { uci?: string } | null | undefined
  if (main?.uci === move.uci) return 'main line'
  if (tree.book_depth === 0 && leaves?.uci === move.uci) return 'leaves your book'
  if ((move.blunders ?? 0) > 0) {
    return `${move.blunders} blunder${move.blunders === 1 ? '' : 's'} from here`
  }
  if ((move.games ?? 0) === 1) return 'played once'
  if ((move.games ?? 0) <= 3) return `${move.games} games, thin sample`
  if ((move.evaluated ?? 0) === 0) return 'not analysed'
  return null
}

/** Why the book walk stopped, in words rather than the service's own vocabulary. */
export function bookReason(reason: string | null | undefined): string {
  switch (reason) {
    case 'novelty':
      return 'you have only played the next move once'
    case 'no continuation':
      return 'no game of yours goes further'
    case 'depth limit':
      return 'the walk hit its depth limit'
    case 'unknown position':
      return 'the next position is not in the database'
    case 'unplayable continuation':
      return 'the stored continuation is not legal here'
    case 'no games':
      return 'you have never reached this position'
    default:
      return reason ?? 'unknown'
  }
}

/** The opening most of the games through this position are filed under. */
export function commonOpening(games: readonly { game: GameSummary }[]): {
  name: string
  eco: string | null
} | null {
  const counts = new Map<string, { name: string; eco: string | null; count: number }>()
  for (const { game } of games) {
    if (!game.opening) continue
    const key = `${game.eco ?? ''}|${game.opening}`
    const entry = counts.get(key) ?? { name: game.opening, eco: game.eco ?? null, count: 0 }
    entry.count += 1
    counts.set(key, entry)
  }
  let best: { name: string; eco: string | null; count: number } | null = null
  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) best = entry
  }
  return best ? { name: best.name, eco: best.eco } : null
}
