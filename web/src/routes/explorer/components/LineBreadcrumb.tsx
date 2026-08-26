/**
 * Design 2c's line breadcrumb: `1.c4 › e5 › 2.Nc3 › …` with the current move highlighted.
 * Every crumb walks the tree back to that point.
 */
import { cn } from '@/lib/utils'

import { plyLabel, type LineStep } from '../line'

export function LineBreadcrumb({
  steps,
  onTruncate,
}: {
  steps: readonly LineStep[]
  /** `ply` moves are kept — 0 goes back to the initial position. */
  onTruncate: (ply: number) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 font-mono text-[0.71875rem]">
      <button
        type="button"
        onClick={() => onTruncate(0)}
        className={cn(
          'rounded-[0.3125rem] border px-[0.4375rem] py-0.5 transition-colors',
          steps.length === 0
            ? 'border-accent-teal/35 bg-accent-teal/10 text-accent-teal'
            : 'border-edge bg-raised text-soft hover:text-ink',
        )}
      >
        start
      </button>
      {steps.map((step, index) => {
        const last = index === steps.length - 1
        // White's move carries its number; Black's follows it without repeating it.
        const label = step.ply % 2 === 0 ? `${plyLabel(step.ply)}${step.san}` : step.san
        return (
          <span key={`${step.ply}-${step.uci}`} className="flex items-center gap-1.5">
            <span className="text-faint-2">›</span>
            <button
              type="button"
              onClick={() => onTruncate(step.ply + 1)}
              className={cn(
                'rounded-[0.3125rem] border px-[0.4375rem] py-0.5 transition-colors',
                last
                  ? 'border-accent-teal/35 bg-accent-teal/10 text-accent-teal'
                  : 'border-edge bg-raised text-soft hover:text-ink',
              )}
            >
              {label}
            </button>
          </span>
        )
      })}
    </div>
  )
}
