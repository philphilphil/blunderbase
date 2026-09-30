/**
 * A collection's rule read out as small neutral tags — `Lichess`, `45+45`, `rated`.
 *
 * Neutral rather than in the collection's colour: they describe a filter, not the
 * collection. And readouts (`Badge`: a borderless tint, no face, no hover), not chips: in
 * the control grammar a bordered chip is something you press to toggle, and these are facts
 * about the rule that nothing here changes by clicking.
 */
import { useLingui } from '@lingui/react/macro'

import { Badge } from '@/components/ui/badge'
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
        <Badge key={part} size="md" className="py-0 text-soft">
          {part}
        </Badge>
      ))}
    </span>
  )
}
