/**
 * The library's filter vocabulary, which is exactly `backend/api/deps.py:game_filters`.
 *
 * Filters live in the URL so a filtered library is a link — the explorer's "open these in
 * the library" and the dashboard's drill-downs both need that. Dates are held as plain
 * `YYYY-MM-DD` because that is what `<input type="date">` speaks; `until` is widened to
 * the end of the day on the way to the API, so "until 6 Dec" includes the 6th.
 */
import type { GameFilters, Outcome, Result, Source, Speed } from '@/lib/api/types'
import type { Color } from '@/lib/api/types'

import { OUTCOME_LABELS, SOURCE_LABELS } from './format'

export interface LibraryFilters {
  /** `YYYY-MM-DD`, inclusive. */
  since?: string
  /** `YYYY-MM-DD`, inclusive — widened to 23:59:59 for the API. */
  until?: string
  source?: Source
  color?: Color
  eco?: string
  result?: Result
  outcome?: Outcome
  speed?: Speed
  time_control?: string
  opponent?: string
  has_blunders?: boolean
  analyzed?: boolean
  deep_analyzed?: boolean
  text?: string
}

const SOURCES: readonly Source[] = ['lichess', 'chesscom', 'pgn', 'manual']
const COLORS: readonly Color[] = ['white', 'black']
const RESULTS: readonly Result[] = ['1-0', '0-1', '1/2-1/2']
const OUTCOMES: readonly Outcome[] = ['win', 'loss', 'draw']
const SPEEDS: readonly Speed[] = ['bullet', 'blitz', 'rapid', 'classical', 'correspondence']

export const FILTER_OPTIONS = {
  sources: SOURCES,
  colors: COLORS,
  results: RESULTS,
  outcomes: OUTCOMES,
  speeds: SPEEDS,
} as const

const DATE = /^\d{4}-\d{2}-\d{2}$/

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : undefined
}

function bool(value: string | null): boolean | undefined {
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

function text(value: string | null): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function date(value: string | null): string | undefined {
  return value && DATE.test(value) ? value : undefined
}

/** Read the filters out of a query string, dropping anything that is not a valid value. */
export function filtersFromParams(params: URLSearchParams): LibraryFilters {
  return prune({
    since: date(params.get('since')),
    until: date(params.get('until')),
    source: oneOf(params.get('source'), SOURCES),
    color: oneOf(params.get('color'), COLORS),
    eco: text(params.get('eco'))?.toUpperCase(),
    result: oneOf(params.get('result'), RESULTS),
    outcome: oneOf(params.get('outcome'), OUTCOMES),
    speed: oneOf(params.get('speed'), SPEEDS),
    time_control: text(params.get('time_control')),
    opponent: text(params.get('opponent')),
    has_blunders: bool(params.get('has_blunders')),
    analyzed: bool(params.get('analyzed')),
    deep_analyzed: bool(params.get('deep_analyzed')),
    text: text(params.get('q')),
  })
}

/** The same filters back as a query string. `text` rides as `q`, which is shorter to type. */
export function paramsFromFilters(filters: LibraryFilters): URLSearchParams {
  const params = new URLSearchParams()
  const { text: free, ...rest } = filters
  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined || value === '') continue
    params.set(key, String(value))
  }
  if (free) params.set('q', free)
  return params
}

/** Drop the keys that carry no value, so an empty filter set is `{}` and compares equal. */
export function prune(filters: LibraryFilters): LibraryFilters {
  const cleaned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '') continue
    cleaned[key] = value
  }
  return cleaned as LibraryFilters
}

/** How many filters are set — the "N active" the clear-all control needs. */
export function filterCount(filters: LibraryFilters): number {
  return Object.keys(prune(filters)).length
}

/**
 * The filters as the API takes them: `until` widened to the end of its day, everything
 * else passed straight through.
 */
export function toGameQuery(filters: LibraryFilters): GameFilters {
  const { until, ...rest } = prune(filters)
  const query: GameFilters = { ...rest }
  if (until) query.until = `${until}T23:59:59`
  return query
}

// --- the chips over the table --------------------------------------------

/** Which popover a chip belongs to; several filters share one. */
export type FilterGroup = 'date' | 'source' | 'color' | 'result' | 'opening' | 'time' | 'opponent' | 'analysis'

export const GROUP_LABELS: Record<FilterGroup, string> = {
  date: 'Date',
  source: 'Source',
  color: 'Colour',
  result: 'Result',
  opening: 'Opening',
  time: 'Time control',
  opponent: 'Opponent',
  analysis: 'Analysis',
}

/** Which filter keys each popover owns, so "clear this chip" clears the whole group. */
export const GROUP_KEYS: Record<FilterGroup, (keyof LibraryFilters)[]> = {
  date: ['since', 'until'],
  source: ['source'],
  color: ['color'],
  result: ['outcome', 'result'],
  opening: ['eco'],
  time: ['speed', 'time_control'],
  opponent: ['opponent'],
  analysis: ['has_blunders', 'analyzed', 'deep_analyzed'],
}

export const FILTER_GROUPS: FilterGroup[] = [
  'date',
  'source',
  'color',
  'result',
  'opening',
  'time',
  'opponent',
  'analysis',
]

/** `Colour: black` — what an active chip reads, or null when the group is unset. */
export function groupSummary(group: FilterGroup, filters: LibraryFilters): string | null {
  switch (group) {
    case 'date': {
      if (filters.since && filters.until) return `${filters.since} → ${filters.until}`
      if (filters.since) return `from ${filters.since}`
      if (filters.until) return `until ${filters.until}`
      return null
    }
    case 'source':
      return filters.source ? SOURCE_LABELS[filters.source] : null
    case 'color':
      return filters.color ?? null
    case 'result': {
      const parts = [
        filters.outcome ? OUTCOME_LABELS[filters.outcome].toLowerCase() : null,
        filters.result ?? null,
      ].filter(Boolean)
      return parts.length ? parts.join(' · ') : null
    }
    case 'opening':
      return filters.eco ?? null
    case 'time': {
      const parts = [filters.speed ?? null, filters.time_control ?? null].filter(Boolean)
      return parts.length ? parts.join(' · ') : null
    }
    case 'opponent':
      return filters.opponent ?? null
    case 'analysis': {
      const parts: string[] = []
      if (filters.has_blunders !== undefined) {
        parts.push(filters.has_blunders ? 'has blunders' : 'no blunders')
      }
      if (filters.analyzed !== undefined) {
        parts.push(filters.analyzed ? 'analysed' : 'unanalysed')
      }
      if (filters.deep_analyzed !== undefined) {
        parts.push(filters.deep_analyzed ? 'deep' : 'not deep')
      }
      return parts.length ? parts.join(' · ') : null
    }
  }
}

/** The group's keys removed, everything else kept. */
export function clearGroup(filters: LibraryFilters, group: FilterGroup): LibraryFilters {
  const next: LibraryFilters = { ...filters }
  for (const key of GROUP_KEYS[group]) delete next[key]
  return prune(next)
}
