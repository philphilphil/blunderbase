/**
 * A collection's rule read out as small neutral chips — `Lichess`, `45+45`, `rated`.
 *
 * Neutral rather than in the collection's colour: the chips describe a filter, and the
 * library's own filter chips are the thing they should look like, not the collection.
 */
import { useLingui } from '@lingui/react/macro'

import type { CollectionRule } from '@/lib/api/types'
import { cn } from '@/lib/utils'

import { ruleParts } from './ruleParts'

export function RuleChips({
  rule,
  className,
}: {
  rule: CollectionRule | null | undefined
  className?: string
}) {
  const { i18n } = useLingui()
  const parts = ruleParts(rule, i18n)
  if (!parts.length) return null
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1', className)}>
      {parts.map((part) => (
        <span
          key={part}
          className="rounded-sm border border-edge bg-raised px-1.5 font-mono text-[0.65625rem] leading-[1.0625rem] text-soft"
        >
          {part}
        </span>
      ))}
    </span>
  )
}
