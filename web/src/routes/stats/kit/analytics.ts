/**
 * The analytics vocabulary the Dashboard and the Stats page share: the time windows the
 * segmented controls offer, the `/stats/compare` binding, and the small numeric helpers
 * every card formats through.
 *
 * It lives under `src/routes/stats/` because Stats is the analytics home; the Dashboard
 * imports it. If a third screen ever needs it, promote the file to `src/lib/stats/`.
 */
import { useQuery } from '@tanstack/react-query'

import * as api from '@/lib/api/endpoints'
import { queryKeys } from '@/lib/api/keys'
import type { GameFilters, StatsBucket, StatsResponse } from '@/lib/api/types'

// --- windows --------------------------------------------------------------

export type WindowKey = '7d' | '30d' | '90d' | '1y' | 'all'

/** The design's segmented control is 30d · 90d · 1y; `7d` and `all` extend it. */
export const WINDOW_DAYS: Record<Exclude<WindowKey, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '1y': 365,
}

export const WINDOW_LABELS: Record<WindowKey, string> = {
  '7d': '7d',
  '30d': '30d',
  '90d': '90d',
  '1y': '1y',
  all: 'All',
}

/** How a window reads in prose when it ends now. */
const WINDOW_PROSE_NOW: Record<WindowKey, string> = {
  '7d': 'the last 7 days',
  '30d': 'the last 30 days',
  '90d': 'the last 90 days',
  '1y': 'the last 12 months',
  all: 'all time',
}

export interface Period {
  since?: string
  until?: string
}

const DAY_MS = 86_400_000

/**
 * Where a window ends.
 *
 * Not always now: a database can be years old (the dev one is from 2016), and "my last 30
 * days" should mean the last 30 days *of play*, not 30 empty days. So the anchor is the
 * newest game whenever that is in the past, and the clock otherwise.
 */
export function anchorOf(lastGame: string | null | undefined, now: Date = new Date()): Date {
  const played = lastGame ? Date.parse(lastGame) : Number.NaN
  if (Number.isNaN(played) || played >= now.getTime()) return now
  return new Date(played)
}

/** `30d` -> `{ since, until }` in the ISO form `/stats` and `/games` take. */
export function windowRange(window: WindowKey, anchor: Date = new Date()): Period {
  if (window === 'all') return {}
  const since = new Date(anchor.getTime() - WINDOW_DAYS[window] * DAY_MS)
  return { since: since.toISOString(), until: anchor.toISOString() }
}

/** "the last 30 days", or "the 30 days to 7 Dec 2016" when the anchor is in the past. */
export function windowProse(
  window: WindowKey,
  anchor: Date = new Date(),
  now: Date = new Date(),
): string {
  if (window === 'all') return WINDOW_PROSE_NOW.all
  // A day of slack, so "yesterday evening" still reads as the last N days.
  if (now.getTime() - anchor.getTime() <= DAY_MS) return WINDOW_PROSE_NOW[window]
  const to = anchor.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
  return `the ${WINDOW_DAYS[window]} days to ${to}`
}

export const DEFAULT_WINDOWS: WindowKey[] = ['30d', '90d', '1y', 'all']

// --- comparison -----------------------------------------------------------

/**
 * The window immediately before the one `filters` describes, of the same length.
 *
 * Derived from the filters rather than from the clock so that the query key is stable
 * across renders — `new Date()` inside a hook body would rebuild the key every time and
 * refetch forever. Returns null when the filters are not a bounded window.
 */
export function precedingWindow(filters: GameFilters): CompareWindows | null {
  if (!filters.since || !filters.until) return null
  const since = Date.parse(filters.since)
  const until = Date.parse(filters.until)
  if (Number.isNaN(since) || Number.isNaN(until) || until <= since) return null
  const span = until - since
  return {
    then_start: new Date(since - span).toISOString(),
    then_end: filters.since,
    now_start: filters.since,
    now_end: filters.until,
  }
}

export interface CompareWindows {
  then_start: string
  then_end: string
  now_start: string
  now_end: string
}

/**
 * One dimension over the window `filters` names and over the window before it.
 *
 * `/stats/compare` answers with `then`, `now` and a `delta` of every numeric field, so a
 * card reads `now` for its bars and `delta` for the movement next to a number. Disabled
 * when the filters are unbounded — all time has nothing before it.
 */
export function useCompare(
  dimension: string,
  filters: GameFilters = {},
  options: { enabled?: boolean } = {},
) {
  const { enabled = true } = options
  const windows = precedingWindow(filters)
  const query = windows ? { ...filters, dimension, ...windows } : null

  return useQuery({
    queryKey: query ? queryKeys.compare(query) : ['stats', 'compare', 'disabled', dimension],
    queryFn: () => api.comparePeriods(query as NonNullable<typeof query>),
    enabled: enabled && query !== null,
  })
}

// --- reading a bucket -----------------------------------------------------

/**
 * One numeric field off a stats bucket (or off any other open payload — `volume`, a
 * comparison's `delta`). Every dimension is `extra="allow"` on the backend and drops
 * nulls, so a field is read by name and defaulted rather than destructured.
 */
export function num(
  bucket: Record<string, unknown> | undefined | null,
  field: string,
): number | null {
  const value = bucket?.[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function numOr(
  bucket: Record<string, unknown> | undefined | null,
  field: string,
  fallback = 0,
): number {
  return num(bucket, field) ?? fallback
}

export function buckets(response: StatsResponse | undefined | null): StatsBucket[] {
  return response?.buckets ?? []
}

export function total(response: StatsResponse | undefined | null): StatsBucket | undefined {
  return response?.total
}

/** Every classification bucket carries these three; `blunder` is the one cards lead on. */
export function lossCounts(bucket: StatsBucket | undefined): {
  inaccuracy: number
  mistake: number
  blunder: number
} {
  return {
    inaccuracy: numOr(bucket, 'inaccuracy'),
    mistake: numOr(bucket, 'mistake'),
    blunder: numOr(bucket, 'blunder'),
  }
}

// --- numbers --------------------------------------------------------------

/** `0.4831` -> `48.3` — the backend reports scores and rates as fractions. */
export function asPercent(value: number | null | undefined, digits = 1): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  return Number((value * 100).toFixed(digits))
}

/** `1.6` against a `2.0` baseline -> `−0.4`, with the typographic minus. */
export function formatDelta(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const rounded = Number(value.toFixed(digits))
  if (rounded === 0) return `±${(0).toFixed(digits)}`
  return rounded > 0 ? `+${rounded.toFixed(digits)}` : `−${Math.abs(rounded).toFixed(digits)}`
}

/**
 * Which way a change should read. Fewer blunders is progress, a higher score is progress,
 * so the direction is the caller's to declare.
 */
export function deltaTone(
  value: number | null | undefined,
  lowerIsBetter: boolean,
): 'good' | 'blunder' | 'dim' {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) return 'dim'
  const improving = lowerIsBetter ? value < 0 : value > 0
  return improving ? 'good' : 'blunder'
}

/** `12` -> `12`, `1284` -> `1,284`. */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return Math.round(value).toLocaleString()
}

/** `2016-12-07T13:17:53Z` -> `7 Dec`. */
export function shortDate(value: string | null | undefined): string {
  if (!value) return '—'
  const stamp = new Date(value)
  if (Number.isNaN(stamp.getTime())) return '—'
  return stamp.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })
}

/** `2016-12` (a `rating_trend` bucket key) -> `Dec 16`. */
export function periodLabel(key: string): string {
  const monthly = /^(\d{4})-(\d{2})$/.exec(key)
  if (monthly) {
    const stamp = new Date(Number(monthly[1]), Number(monthly[2]) - 1, 1)
    return stamp.toLocaleDateString(undefined, {
      month: 'short',
      year: '2-digit',
    })
  }
  return key
}

/** `"07"` (a `performance_by_hour` key) -> `07:00`. */
export function hourLabel(key: string): string {
  return /^\d{1,2}$/.test(key) ? `${key.padStart(2, '0')}:00` : key
}
