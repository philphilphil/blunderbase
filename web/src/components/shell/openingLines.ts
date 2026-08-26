/**
 * The rail's "Your lines" list (design 2c): the openings that come up most in the games
 * the explorer is scoped to, with how they score.
 *
 * The backend has no opening aggregation — `/stats/{dimension}` knows phases, pieces,
 * speeds, hours and clocks, not ECO codes — so the codes are counted here over one page of
 * game summaries, which carry `eco`, `opening` and `outcome` already.
 */
import type { GameSummary } from '@/lib/api/types'

export interface OpeningLine {
  eco: string
  name: string
  games: number
  /** Points per game as a percentage: a win is 1, a draw a half. */
  score: number
}

/** How many games the rail counts over. One page, newest first. */
export const LINE_SAMPLE = 200

export function topLines(games: GameSummary[] | undefined, limit: number): OpeningLine[] {
  const rows = new Map<string, { name: string; games: number; points: number }>()
  for (const game of games ?? []) {
    const eco = game.eco?.trim()
    if (!eco) continue
    const row = rows.get(eco) ?? { name: game.opening ?? eco, games: 0, points: 0 }
    row.games += 1
    if (game.outcome === 'win') row.points += 1
    else if (game.outcome === 'draw') row.points += 0.5
    // A shorter name is the family rather than one of its variations, which is what the
    // rail has room for: "Sicilian" beats "Sicilian, Alapin, 2…Nf6 3.e5".
    if (game.opening && game.opening.length < row.name.length) row.name = game.opening
    rows.set(eco, row)
  }

  return [...rows.entries()]
    .map(([eco, row]) => ({
      eco,
      name: row.name,
      games: row.games,
      score: (row.points / row.games) * 100,
    }))
    .sort((left, right) => right.games - left.games || left.eco.localeCompare(right.eco))
    .slice(0, limit)
}

/** The design's three bands: green from 55, yellow from 45, red below it. */
export function scoreTone(score: number): string {
  if (score >= 55) return 'text-good'
  if (score >= 45) return 'text-inaccuracy'
  return 'text-blunder'
}
