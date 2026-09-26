/**
 * What every screen that shows a collection shares: its colours, where it lives, and how a
 * rule and the library's filters turn into each other.
 *
 * The colours are keys rather than hex because the palette is the theme's — a collection
 * picked "good" is the app's green in both themes, and follows `index.css` if that moves.
 * The class strings are spelled out whole, never assembled, so Tailwind's scanner sees
 * every one of them.
 *
 * A rule is deliberately a subset of the library's own filter vocabulary: the keys that
 * describe a game as it arrives (where from, how fast, which side, against whom) and none
 * that describe the library around it (dates, text, analysis). That is why "Make a
 * collection" can take the filter the owner has open and why the backend can match a new
 * import with the same `GameFilters` the library list uses.
 */
import { msg } from '@lingui/core/macro'
import type { MessageDescriptor } from '@lingui/core'

import type {
  CollectionColor,
  CollectionRule,
  Color,
  GameFilters,
  Source,
  Speed,
} from '@/lib/api/types'

export const COLLECTION_COLORS: readonly CollectionColor[] = [
  'accent',
  'good',
  'otb',
  'way-back',
  'mistake',
  'info',
  'blunder',
]

export interface CollectionColorClasses {
  /** The colour as text — a chip's label, a count. */
  text: string
  /** A tinted chip: the colour at about a tenth for the fill, a third for the border. */
  chip: string
  /** The colour solid — the rail's square, a swatch, a chip's dot. */
  fill: string
}

export const COLLECTION_COLOR_CLASSES: Record<CollectionColor, CollectionColorClasses> = {
  accent: {
    text: 'text-accent-teal',
    chip: 'border-accent-teal/30 bg-accent-teal/10 text-accent-teal',
    fill: 'bg-accent-teal',
  },
  good: {
    text: 'text-good',
    chip: 'border-good/30 bg-good/10 text-good',
    fill: 'bg-good',
  },
  otb: {
    text: 'text-otb',
    chip: 'border-otb/30 bg-otb/10 text-otb',
    fill: 'bg-otb',
  },
  'way-back': {
    text: 'text-way-back',
    chip: 'border-way-back/30 bg-way-back/10 text-way-back',
    fill: 'bg-way-back',
  },
  mistake: {
    text: 'text-mistake',
    chip: 'border-mistake/30 bg-mistake/10 text-mistake',
    fill: 'bg-mistake',
  },
  info: {
    text: 'text-info',
    chip: 'border-info/30 bg-info/10 text-info',
    fill: 'bg-info',
  },
  blunder: {
    text: 'text-blunder',
    chip: 'border-blunder/30 bg-blunder/10 text-blunder',
    fill: 'bg-blunder',
  },
}

/** What a swatch is called to a screen reader. Plain colour words, since the keys are not. */
export const COLLECTION_COLOR_NAMES: Record<CollectionColor, MessageDescriptor> = {
  accent: msg`Blue`,
  good: msg`Green`,
  otb: msg`Sand`,
  'way-back': msg`Orange`,
  mistake: msg`Amber`,
  info: msg`Slate`,
  blunder: msg`Red`,
}

/** The classes for a colour key, reading one this build does not know as the default. */
export function collectionColorClasses(color: string | null | undefined): CollectionColorClasses {
  return COLLECTION_COLOR_CLASSES[color as CollectionColor] ?? COLLECTION_COLOR_CLASSES.accent
}

/** A collection's page: the library, filtered to it. */
export function collectionPath(id: number): string {
  return `/games?collection=${id}`
}

/** Stats, scoped to the collection. */
export function collectionStatsPath(id: number): string {
  return `/stats?collection=${id}`
}

/** The keys a rule may carry, in the order a rule is read out. */
export const RULE_KEYS = [
  'source',
  'speed',
  'time_control',
  'rated',
  'color',
  'eco',
  'opponent',
  'variant',
] as const satisfies readonly (keyof CollectionRule)[]

/**
 * Anything that carries some of a rule's keys — the library's URL filters (one speed) or
 * the API's `GameFilters` (one speed or several).
 */
export interface RuleSource {
  source?: Source
  speed?: Speed | readonly Speed[]
  time_control?: string
  rated?: boolean
  color?: Color
  eco?: string
  opponent?: string
  variant?: string
}

/**
 * The rule-able part of a filter, or null when nothing of it is — dates, text and the
 * analysis flags are dropped, because a rule looks at a game as it arrives.
 */
export function ruleFromFilters(filters: RuleSource): CollectionRule | null {
  const rule: CollectionRule = {}
  if (filters.source) rule.source = filters.source
  if (filters.speed !== undefined) {
    const speeds = (Array.isArray(filters.speed) ? filters.speed : [filters.speed]) as Speed[]
    if (speeds.length) rule.speed = [...speeds]
  }
  const timeControl = filters.time_control?.trim()
  if (timeControl) rule.time_control = timeControl
  if (typeof filters.rated === 'boolean') rule.rated = filters.rated
  if (filters.color) rule.color = filters.color
  const eco = filters.eco?.trim().toUpperCase()
  if (eco) rule.eco = eco
  const opponent = filters.opponent?.trim()
  if (opponent) rule.opponent = opponent
  const variant = filters.variant?.trim()
  if (variant) rule.variant = variant
  return isRuleEmpty(rule) ? null : rule
}

/** True for a rule that names nothing — which the backend stores as no rule at all. */
export function isRuleEmpty(rule: CollectionRule | null | undefined): boolean {
  if (!rule) return true
  return RULE_KEYS.every((key) => {
    const value = rule[key]
    if (value === undefined || value === null || value === '') return true
    return Array.isArray(value) && value.length === 0
  })
}

/**
 * The library filter a rule stands for, over the owner's own games — what the dialog counts
 * with `GET /games?limit=1`, and the same `GameFilters` the backend matches imports with.
 */
export function ruleFilters(rule: CollectionRule): GameFilters {
  const filters: GameFilters = {}
  if (rule.source) filters.source = rule.source
  if (rule.speed?.length) filters.speed = rule.speed
  if (rule.time_control) filters.time_control = rule.time_control
  if (typeof rule.rated === 'boolean') filters.rated = rule.rated
  if (rule.color) filters.color = rule.color
  if (rule.eco) filters.eco = rule.eco
  if (rule.opponent) filters.opponent = rule.opponent
  if (rule.variant) filters.variant = rule.variant
  return filters
}

export type MembershipState = 'all' | 'some' | 'none'

/**
 * Whether a set of games is all in a collection, partly in it or not in it — the tick, the
 * half-tick and the empty box of the "Add to…" checklist — and how many of them are in.
 */
export function membershipOf(
  games: readonly { collections?: readonly number[] | null }[],
  collectionId: number,
): { state: MembershipState; count: number } {
  const count = games.filter((game) => game.collections?.includes(collectionId)).length
  if (count === 0 || games.length === 0) return { state: 'none', count: 0 }
  return { state: count === games.length ? 'all' : 'some', count }
}
