/**
 * The app's control for set membership: a row of small toggles where "blitz and rapid" is
 * one glance and one press, rather than a multi-select that hides the answer behind a menu.
 *
 * Chips rather than a `select` because a set is what is being asked about, and the values
 * are few and short enough to all be on screen at once — the explorer's speeds and rating
 * bands, the Stats page's time controls. Where a set has one obvious answer a `Segmented`
 * is the right control instead; these two are deliberately different shapes, because one
 * of them means "one of these" and the other "any of these".
 *
 * `toggleFilter` in `@/lib/filters` is the other half: it is what keeps a row from being
 * emptied, which every caller of these wants.
 */
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * A labelled row of chips. The label is set at the width of the longest one these pages
 * use, so stacked rows line their chips up; it names the group as well as showing it, so a
 * reader arriving at a pressed chip is told which filter it belongs to.
 */
export function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <span className="w-11 flex-none text-[0.65625rem] tracking-[.06em] text-dim-2 uppercase">
        {label}
      </span>
      {children}
    </div>
  )
}

export function FilterChip({
  label,
  on,
  onClick,
  name,
  title,
}: {
  label: ReactNode
  on: boolean
  onClick: () => void
  /** What to call it where the label is an abbreviation ("corr." for correspondence). */
  name?: string
  title?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={name}
      title={title}
      onClick={onClick}
      className={cn(
        'rounded-md border px-[0.4375rem] py-[0.0625rem] font-mono text-[0.6875rem] tabular transition-colors',
        on
          ? 'border-accent-teal/35 bg-accent-teal/10 text-accent-teal'
          : 'border-edge text-dim hover:text-ink',
      )}
    >
      {label}
    </button>
  )
}
