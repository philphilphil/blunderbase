import { Check } from 'lucide-react'

import { cn } from '@/lib/utils'

const LABEL = 'Skip evaluation'

/**
 * The one option every import card shares: store the games and stop there.
 *
 * Evaluation is what the rest of the app reads a game through, so the pass stays the
 * default and this is the exception — the first sync of a long archive, where a thousand
 * queued passes are better asked for a few at a time from the library afterwards.
 *
 * The box, the label and the hint are one hit target rather than a checkbox with a label
 * beside it: nothing here is nested, and the whole row toggles.
 */
export function SkipEvaluation({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={LABEL}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group flex items-start gap-2 rounded-md text-left outline-none disabled:opacity-50"
    >
      <span
        aria-hidden
        className={cn(
          'mt-px flex size-3.5 flex-none items-center justify-center rounded-sm border transition-colors',
          checked
            ? 'border-accent-teal/40 bg-accent-teal/15 text-accent-teal'
            : 'border-edge text-transparent group-hover:border-edge-hover',
        )}
      >
        <Check className="size-2.5" strokeWidth={3} />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className={cn('text-[0.6875rem]', checked ? 'text-soft' : 'text-dim')}>
          {LABEL}
        </span>
        <span className="text-[0.65625rem] leading-[1.45] text-faint">
          games land unanalyzed; queue passes later from the library
        </span>
      </span>
    </button>
  )
}
