/**
 * The notes screen's filter vocabulary, which is exactly `GET /notes`' own
 * (`backend/api/routes/notes.py:search_notes`) minus the two filters nothing on this page
 * sets by hand — `fen` and `line_id`, which arrive as links from elsewhere.
 *
 * Like the library's filters these live in the URL, so a cut of the notes is a link: the
 * dashboard, a game page and the export buttons all point at `/notes?...`.
 */
import type { MessageDescriptor } from '@lingui/core'
import { msg, plural, t } from '@lingui/core/macro'

import type { NoteExportQuery, NoteQuery } from '@/lib/api/endpoints'
import {
  NOTE_SCOPES,
  NOTE_SOURCES,
  type NoteScope,
  type NoteSource,
  type Outcome,
} from '@/lib/api/types'

export interface NoteFilters {
  /** Free text over the note body — `q` in the URL, `query` to the API. */
  text?: string
  /** Notes carrying *every* one of these tags. */
  tags?: string[]
  scope?: NoteScope
  game_id?: number
  /** `YYYY-MM-DD`, inclusive. */
  since?: string
  /** `YYYY-MM-DD`, inclusive — widened to 23:59:59 on the way to the API. */
  until?: string
  /**
   * The next two are about the game a note was written on, and mean what the library means
   * by them (`services/games.opponent_condition`, `outcome_condition`): part of the other
   * side's name, and how the game went for the owner. A note with no game matches neither.
   */
  opponent?: string
  outcome?: Outcome
  /** Who wrote it: typed here, saved by the assistant over MCP, or grabbed off the live board. */
  source?: NoteSource
}

export const SCOPE_LABELS: Record<NoteScope, MessageDescriptor> = {
  game: msg`On a game`,
  position: msg`On a position`,
  line: msg`On a variation`,
  free: msg`Loose`,
}

export const OUTCOMES: readonly Outcome[] = ['win', 'loss', 'draw']

export const OUTCOME_LABELS: Record<Outcome, MessageDescriptor> = {
  win: msg`Won`,
  loss: msg`Lost`,
  draw: msg`Drawn`,
}

export const SOURCE_LABELS: Record<NoteSource, MessageDescriptor> = {
  web: msg`In the app`,
  mcp: msg`Assistant`,
  live: msg`Live board`,
}

/** The chip's lower-case words, as their own messages for the reason `scopeSummary` gives. */
function outcomeSummary(outcome: Outcome): string {
  switch (outcome) {
    case 'win':
      return t`games won`
    case 'loss':
      return t`games lost`
    case 'draw':
      return t`games drawn`
  }
}

function sourceSummary(source: NoteSource): string {
  switch (source) {
    case 'web':
      return t`in the app`
    case 'mcp':
      return t`assistant`
    case 'live':
      return t`live board`
  }
}

/**
 * The same four scopes as the chip reads them, under the group's own name.
 *
 * A second table rather than `SCOPE_LABELS[…].toLowerCase()`: lowercasing a translated
 * label is an English habit, and German would capitalise the noun whatever the chip wants.
 */
function scopeSummary(scope: NoteScope): string {
  switch (scope) {
    case 'game':
      return t`on a game`
    case 'position':
      return t`on a position`
    case 'line':
      return t`on a variation`
    case 'free':
      return t`loose`
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

function text(value: string | null): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function date(value: string | null): string | undefined {
  return value && DATE.test(value) ? value : undefined
}

function positive(value: string | null): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : undefined
}

/** Every `tag=` in the query string, trimmed, deduped, in the order they were written. */
function tags(params: URLSearchParams): string[] | undefined {
  const found: string[] = []
  for (const raw of params.getAll('tag')) {
    const tag = raw.trim()
    if (tag && !found.includes(tag)) found.push(tag)
  }
  return found.length ? found : undefined
}

/** Read the filters out of a query string, dropping anything that is not a valid value. */
export function filtersFromParams(params: URLSearchParams): NoteFilters {
  return prune({
    text: text(params.get('q')),
    tags: tags(params),
    scope: oneOf(params.get('scope'), NOTE_SCOPES),
    game_id: positive(params.get('game')),
    since: date(params.get('since')),
    until: date(params.get('until')),
    opponent: text(params.get('opponent')),
    outcome: oneOf(params.get('outcome'), OUTCOMES),
    source: oneOf(params.get('source'), NOTE_SOURCES),
  })
}

/**
 * The same filters back as a query string. `note` rides along untouched: the highlight the
 * command palette links to is part of the address, not one of the filters, and changing a
 * chip must not lose it.
 */
export function paramsFromFilters(
  filters: NoteFilters,
  extra: { note?: number | null } = {},
): URLSearchParams {
  const params = new URLSearchParams()
  const clean = prune(filters)
  if (clean.text) params.set('q', clean.text)
  for (const tag of clean.tags ?? []) params.append('tag', tag)
  if (clean.scope) params.set('scope', clean.scope)
  if (clean.game_id !== undefined) params.set('game', String(clean.game_id))
  if (clean.since) params.set('since', clean.since)
  if (clean.until) params.set('until', clean.until)
  if (clean.opponent) params.set('opponent', clean.opponent)
  if (clean.outcome) params.set('outcome', clean.outcome)
  if (clean.source) params.set('source', clean.source)
  if (extra.note !== undefined && extra.note !== null) params.set('note', String(extra.note))
  return params
}

/** Drop the keys that carry no value, so an empty filter set is `{}` and compares equal. */
export function prune(filters: NoteFilters): NoteFilters {
  const cleaned: NoteFilters = {}
  if (filters.text) cleaned.text = filters.text
  if (filters.tags?.length) cleaned.tags = [...filters.tags]
  if (filters.scope) cleaned.scope = filters.scope
  if (filters.game_id !== undefined) cleaned.game_id = filters.game_id
  if (filters.since) cleaned.since = filters.since
  if (filters.until) cleaned.until = filters.until
  const opponent = filters.opponent?.trim()
  if (opponent) cleaned.opponent = opponent
  if (filters.outcome) cleaned.outcome = filters.outcome
  if (filters.source) cleaned.source = filters.source
  return cleaned
}

/** How many filters are set — what the "clear all" control counts. */
export function filterCount(filters: NoteFilters): number {
  return Object.keys(prune(filters)).length
}

/** The filters as the API takes them: `until` widened to the end of its day. */
export function toNoteExportQuery(filters: NoteFilters): NoteExportQuery {
  const { text: free, until, ...rest } = prune(filters)
  const query: NoteExportQuery = { ...rest }
  if (free) query.query = free
  if (until) query.until = `${until}T23:59:59`
  return query
}

/** The same, with the page size the list asks for. */
export function toNoteQuery(filters: NoteFilters, limit: number): NoteQuery {
  return { ...toNoteExportQuery(filters), limit }
}

// --- the chips over the list ---------------------------------------------

/**
 * Which popover a filter belongs to; the date chip owns two keys.
 *
 * What the note says (tags, what it is about), then the game it was written on (who, how it
 * went, which one), then the note's own history (when, by whom) — the order somebody
 * narrows a pile of notes in.
 */
export type NoteFilterGroup =
  | 'tags'
  | 'scope'
  | 'opponent'
  | 'outcome'
  | 'game'
  | 'date'
  | 'source'

export const NOTE_FILTER_GROUPS: NoteFilterGroup[] = [
  'tags',
  'scope',
  'opponent',
  'outcome',
  'game',
  'date',
  'source',
]

export const GROUP_LABELS: Record<NoteFilterGroup, MessageDescriptor> = {
  tags: msg`Tags`,
  scope: msg`About`,
  opponent: msg`Opponent`,
  outcome: msg`Result`,
  game: msg`Game`,
  date: msg`Written`,
  source: msg`Written by`,
}

const GROUP_KEYS: Record<NoteFilterGroup, (keyof NoteFilters)[]> = {
  tags: ['tags'],
  scope: ['scope'],
  opponent: ['opponent'],
  outcome: ['outcome'],
  game: ['game_id'],
  date: ['since', 'until'],
  source: ['source'],
}

/** What an active chip reads, or null when the group is unset. */
export function groupSummary(group: NoteFilterGroup, filters: NoteFilters): string | null {
  switch (group) {
    case 'tags': {
      const tagged = filters.tags ?? []
      if (tagged.length === 0) return null
      return tagged.length === 1
        ? tagged[0]!
        : plural(tagged.length, { one: '# tag', other: '# tags' })
    }
    case 'scope':
      return filters.scope ? scopeSummary(filters.scope) : null
    case 'opponent':
      return filters.opponent ?? null
    case 'outcome':
      return filters.outcome ? outcomeSummary(filters.outcome) : null
    case 'source':
      return filters.source ? sourceSummary(filters.source) : null
    case 'game':
      return filters.game_id === undefined ? null : `#${filters.game_id}`
    case 'date': {
      const since = filters.since
      const until = filters.until
      if (since && until) return `${since} → ${until}`
      if (since) return t`from ${since}`
      if (until) return t`until ${until}`
      return null
    }
  }
}

/** The group's keys removed, everything else kept. */
export function clearGroup(filters: NoteFilters, group: NoteFilterGroup): NoteFilters {
  const next: NoteFilters = { ...filters }
  for (const key of GROUP_KEYS[group]) delete next[key]
  return prune(next)
}

/** One tag on or off, keeping the rest — the tag popover's whole behaviour. */
export function toggleTag(filters: NoteFilters, tag: string): NoteFilters {
  const current = filters.tags ?? []
  const next = current.includes(tag) ? current.filter((one) => one !== tag) : [...current, tag]
  return prune({ ...filters, tags: next })
}
