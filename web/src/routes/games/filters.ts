/**
 * The library's filter vocabulary, which is exactly `backend/api/deps.py:game_filters`.
 *
 * Filters live in the URL so a filtered library is a link — the explorer's "open these in
 * the library" and the dashboard's drill-downs both need that. Dates are held as plain
 * `YYYY-MM-DD` because that is what `<input type="date">` speaks; `until` is widened to
 * the end of the day on the way to the API, so "until 6 Dec" includes the 6th.
 */
import { i18n, type MessageDescriptor } from '@lingui/core'
import { msg, t } from '@lingui/core/macro'

import type { GameFilters, Outcome, Result, Source, Speed, Whose } from '@/lib/api/types'
import type { Color } from '@/lib/api/types'

import { SOURCE_LABELS } from './format'

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
  /**
   * Whose games: `others` is the ones added from the reference books, `all` is both.
   * Absent is the default cut, the owner's own — never spelled as `mine`, because a URL
   * should not spell the default.
   */
  whose?: Exclude<Whose, 'mine'>
}

const WHOSE: readonly Exclude<Whose, 'mine'>[] = ['others', 'all']

const SOURCES: readonly Source[] = ['lichess', 'chesscom', 'fics', 'pgn', 'manual', 'masters']
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
    whose: oneOf(params.get('whose'), WHOSE),
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

export const GROUP_LABELS: Record<FilterGroup, MessageDescriptor> = {
  date: msg`Date`,
  source: msg`Source`,
  color: msg`Colour`,
  result: msg`Result`,
  opening: msg`Opening`,
  time: msg`Time control`,
  opponent: msg`Opponent`,
  analysis: msg`Analysis`,
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

/**
 * A chip reads `Colour: black`, in lower case and in the middle of a line — so the words a
 * summary is built from are their own messages rather than the title-case labels the
 * popovers set over the same options. Lower-casing a translated `Sieg` or `Weiß` is not
 * how any language but English writes them.
 */
const COLOR_SUMMARY: Record<Color, MessageDescriptor> = {
  white: msg({ message: 'white', context: 'filter chip' }),
  black: msg({ message: 'black', context: 'filter chip' }),
}

const OUTCOME_SUMMARY: Record<Outcome, MessageDescriptor> = {
  win: msg({ message: 'win', context: 'filter chip' }),
  loss: msg({ message: 'loss', context: 'filter chip' }),
  draw: msg({ message: 'draw', context: 'filter chip' }),
}

/** Also the speed popover's own option labels, which the design writes in lower case too. */
export const SPEED_WORDS: Record<Speed, MessageDescriptor> = {
  bullet: msg({ message: 'bullet', context: 'filter chip' }),
  blitz: msg({ message: 'blitz', context: 'filter chip' }),
  rapid: msg({ message: 'rapid', context: 'filter chip' }),
  classical: msg({ message: 'classical', context: 'filter chip' }),
  correspondence: msg({ message: 'correspondence', context: 'filter chip' }),
}

/** `Colour: black` — what an active chip reads, or null when the group is unset. */
export function groupSummary(group: FilterGroup, filters: LibraryFilters): string | null {
  switch (group) {
    case 'date': {
      const since = filters.since
      const until = filters.until
      if (since && until) return `${since} → ${until}`
      if (since) return t`from ${since}`
      if (until) return t`until ${until}`
      return null
    }
    case 'source':
      return filters.source ? SOURCE_LABELS[filters.source] : null
    case 'color':
      return filters.color ? i18n._(COLOR_SUMMARY[filters.color]) : null
    case 'result': {
      const parts = [
        filters.outcome ? i18n._(OUTCOME_SUMMARY[filters.outcome]) : null,
        filters.result ?? null,
      ].filter(Boolean)
      return parts.length ? parts.join(' · ') : null
    }
    case 'opening':
      return filters.eco ?? null
    case 'time': {
      const parts = [
        filters.speed ? i18n._(SPEED_WORDS[filters.speed]) : null,
        filters.time_control ?? null,
      ].filter(Boolean)
      return parts.length ? parts.join(' · ') : null
    }
    case 'opponent':
      return filters.opponent ?? null
    case 'analysis': {
      const parts: string[] = []
      if (filters.has_blunders !== undefined) {
        parts.push(filters.has_blunders ? t`has blunders` : t`no blunders`)
      }
      if (filters.analyzed !== undefined) {
        parts.push(filters.analyzed ? t`analysed` : t`unanalysed`)
      }
      if (filters.deep_analyzed !== undefined) {
        parts.push(filters.deep_analyzed ? t`deep` : t`not deep`)
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
