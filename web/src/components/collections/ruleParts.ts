/**
 * A collection's rule as readable phrases — `Lichess`, `blitz · rapid`, `45+45`, `rated`.
 *
 * The clock is shown in minutes the way the games table shows it (`2700+45` is `45+45`),
 * while the rule itself keeps the stored seconds the backend matches on. Kept apart from
 * `RuleChips` so a screen that wants the words without the chips (a title, a tooltip) reads
 * the same ones.
 */
import type { I18n } from '@lingui/core'
import { msg } from '@lingui/core/macro'

import type { CollectionRule } from '@/lib/api/types'
import { formatClock } from '@/lib/chess/timeControl'
import { SPEED_WORDS } from '@/routes/games/filters'
import { SOURCE_LABELS } from '@/routes/games/format'

const RATED = msg({ message: 'rated', context: 'collection rule' })
const CASUAL = msg({ message: 'casual', context: 'collection rule' })
const AS_WHITE = msg({ message: 'as white', context: 'collection rule' })
const AS_BLACK = msg({ message: 'as black', context: 'collection rule' })

/** One phrase per key the rule sets, in `RULE_KEYS` order. */
export function ruleParts(rule: CollectionRule | null | undefined, i18n: I18n): string[] {
  if (!rule) return []
  const parts: string[] = []
  if (rule.source) parts.push(SOURCE_LABELS[rule.source] ?? rule.source)
  if (rule.speed?.length) {
    parts.push(
      rule.speed
        .map((speed) => (SPEED_WORDS[speed] ? i18n._(SPEED_WORDS[speed]) : speed))
        .join(' · '),
    )
  }
  if (rule.time_control) parts.push(formatClock(rule.time_control))
  if (typeof rule.rated === 'boolean') parts.push(i18n._(rule.rated ? RATED : CASUAL))
  if (rule.color) parts.push(i18n._(rule.color === 'white' ? AS_WHITE : AS_BLACK))
  if (rule.eco) parts.push(`ECO ${rule.eco}`)
  if (rule.opponent) {
    const opponent = rule.opponent
    parts.push(i18n._(msg({ message: `vs ${opponent}`, context: 'collection rule' })))
  }
  if (rule.variant) parts.push(rule.variant)
  return parts
}
