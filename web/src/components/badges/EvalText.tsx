import { formatScore, type Score } from '@/lib/chess/evaluation'
import { cn } from '@/lib/utils'

/**
 * One evaluation in mono, tabular, coloured by which side it favours — the numeric
 * treatment from design 1c ("Type & numerals": every eval, rating, ECO and percentage is
 * tabular).
 */
export function EvalText({
  score,
  signed = true,
  className,
}: {
  score: Score | null | undefined
  signed?: boolean
  className?: string
}) {
  const value = score?.mate ?? score?.cp ?? null
  // No score and a level 0.00 are read like any other value, so they sit on `dim` — the
  // lowest step that still clears AA — rather than on `faint`, which is decoration only.
  const tone =
    value === null
      ? 'text-dim'
      : value > 0
        ? 'text-body'
        : value < 0
          ? 'text-soft-2'
          : 'text-dim'
  return (
    <span className={cn('font-mono tabular', tone, className)}>
      {formatScore(score, { signed })}
    </span>
  )
}
