/**
 * Reading and writing the explorer's filter state — the reference books' and the owner's
 * own — and the small formatters the reference table needs.
 *
 * `/explorer` keeps everything it is looking at in the URL — the line, the colour scope,
 * the root FEN — so which book it is asking and how that book is filtered belong there
 * too: a masters position with the ratings the owner cares about is then a link, and the
 * browser's back button is the undo. That makes parsing the params a pure job with an
 * answer worth testing, which is what this file is.
 *
 * Every parser is total. A hand-edited or stale param never throws and never produces an
 * empty filter: the lichess database answers a request with no speeds by counting nothing,
 * so an empty list is not a state the page is allowed to reach, and anything unreadable
 * falls back to the defaults instead.
 */
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'

import { ApiError } from '@/lib/api/client'
import { SPEEDS as GAME_SPEEDS } from '@/lib/api/types'
import type { ReferenceSource, Speed as GameSpeed } from '@/lib/api/types'
import { DEFAULT_WINDOWS, WINDOW_DAYS, type WindowKey } from '@/routes/stats/kit/analytics'

/** What the source control can be on. `mine` is the owner's own games — the default. */
export type ExplorerSource = 'mine' | ReferenceSource

export const SOURCES: readonly ExplorerSource[] = ['mine', 'masters', 'lichess']

/** How each source names itself in the segmented control. */
export const SOURCE_LABELS: Record<ExplorerSource, MessageDescriptor> = {
  mine: msg`my games`,
  masters: msg`masters`,
  lichess: msg({ message: 'lichess', comment: 'The site’s own name — keep it as it is.' }),
}

/** The four Lichess time controls the explorer buckets games into. */
export const SPEEDS = ['bullet', 'blitz', 'rapid', 'classical'] as const
export type Speed = (typeof SPEEDS)[number]

/**
 * Bullet is off by default: it is the largest bucket on Lichess and the least like the
 * games the owner is preparing for, so leaving it in would swamp the counts with moves
 * played in three seconds.
 */
export const DEFAULT_SPEEDS: readonly Speed[] = ['blitz', 'rapid', 'classical']

/** Lichess's rating buckets, each one the floor of a 200-point band (2500 is 2500+). */
export const RATINGS = [1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500] as const

/**
 * Centred on where the owner plays. The bands either side of 1700 are what a game of
 * theirs will actually look like; a masters-strength band would be a different question,
 * and that question already has its own source.
 */
export const DEFAULT_RATINGS: readonly number[] = [1600, 1800, 2000]

export function parseSource(value: string | null): ExplorerSource {
  return value === 'masters' || value === 'lichess' ? value : 'mine'
}

/**
 * Which failures the token card answers instead of the error card. Both are the same
 * problem from the owner's side — the books cannot be read until a token is stored — and
 * neither is retryable, so offering "try again" would be offering the same 409.
 *
 * It lives beside the parsers rather than on the explorer because every screen that reads a
 * reference source fails this way: the model-game viewer fetches its PGN with the same
 * token, so a revoked one has to be nameable there too, or the page dead-ends on a retry
 * button that can only fetch the same refusal again.
 */
export function tokenTrouble(error: unknown): 'missing' | 'rejected' | null {
  if (!(error instanceof ApiError)) return null
  if (error.error === 'lichess_token_missing') return 'missing'
  if (error.error === 'lichess_token_rejected') return 'rejected'
  return null
}

/** `blitz,rapid` — unknown names are dropped, and nothing readable means the defaults. */
export function parseSpeeds(value: string | null): Speed[] {
  const kept = (value ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is Speed => (SPEEDS as readonly string[]).includes(item))
  const unique = SPEEDS.filter((speed) => kept.includes(speed))
  return unique.length > 0 ? [...unique] : [...DEFAULT_SPEEDS]
}

/** `1600,1800` — anything that is not one of Lichess's own buckets is dropped. */
export function parseRatings(value: string | null): number[] {
  const kept = (value ?? '')
    .split(',')
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => (RATINGS as readonly number[]).includes(item))
  const unique = RATINGS.filter((rating) => kept.includes(rating))
  return unique.length > 0 ? [...unique] : [...DEFAULT_RATINGS]
}

/**
 * `?tc=blitz,rapid` — which of the owner's own games the tree counts, by speed.
 *
 * Its own param rather than a second reading of `speeds`: the two books bucket games
 * differently (the owner has correspondence games, lichess's explorer does not) and start
 * from different defaults, so one param would carry a filter from one source into another
 * where it means something else. Nothing readable, or every speed, is all of them.
 */
export function parseOwnSpeeds(value: string | null): GameSpeed[] {
  const kept = (value ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
  const unique = GAME_SPEEDS.filter((speed) => kept.includes(speed))
  return unique.length > 0 ? unique : [...GAME_SPEEDS]
}

/** The periods the owner's tree can be narrowed to — the Stats page's own windows. */
export const PERIODS: readonly WindowKey[] = DEFAULT_WINDOWS

/** `?period=90d`; anything else is every game the owner has. */
export function parsePeriod(value: string | null): WindowKey {
  return PERIODS.find((period) => period === value) ?? 'all'
}

/**
 * What the owner's tree sends for its two lenses, and what it leaves out. Every speed on
 * is no speed filter, so a game whose speed was never parsed still counts until somebody
 * names the speeds they want — the rule the Stats page keeps.
 */
export function ownFilterQuery(
  speeds: readonly GameSpeed[],
  period: WindowKey,
): { speed?: GameSpeed[]; days?: number } {
  return {
    ...(speeds.length < GAME_SPEEDS.length ? { speed: [...speeds] } : {}),
    ...(period === 'all' ? {} : { days: WINDOW_DAYS[period] }),
  }
}

/** How a filter rides in the URL and how it goes to the backend: a comma-joined list. */
export function formatCsv(values: readonly (string | number)[]): string {
  return values.join(',')
}


/**
 * `2.6M`, `12.4k`, `482` — the reference databases count in millions and the column is
 * four glyphs wide. Rounded down to one decimal so a number never reads as larger than it
 * is, and the unit is always shown, so `1.0M` and `1.0k` cannot be confused.
 */
export function formatCount(games: number): string {
  if (!Number.isFinite(games) || games < 0) return '—'
  if (games >= 1_000_000) return `${(Math.floor(games / 100_000) / 10).toFixed(1)}M`
  if (games >= 10_000) return `${(Math.floor(games / 100) / 10).toFixed(1)}k`
  return String(Math.round(games))
}

/** A move's share of the position, as the whole percent the table prints. Null with no games. */
export function sharePercent(games: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null
  return Math.round((games / total) * 100)
}

/** `1-0` / `0-1` / `1/2-1/2` from the winner Lichess reports, which is null for a draw. */
export function resultOf(winner: 'white' | 'black' | null | undefined): string {
  if (winner === 'white') return '1-0'
  if (winner === 'black') return '0-1'
  return '1/2-1/2'
}
