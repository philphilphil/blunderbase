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
 *
 * `trailing` is a group that follows another on the same line rather than starting one, so
 * there is no column to line up with and its label is as wide as its word.
 */
export function ChipRow({
  label,
  children,
  trailing = false,
}: {
  label: string
  children: ReactNode
  trailing?: boolean
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <span
        className={cn(
          'flex-none text-meta tracking-[.06em] text-dim uppercase',
          trailing ? 'pr-0.5' : 'w-11',
        )}
      >
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
      // Sans, like every other label: a chip names a choice ("blitz", "2000+"), and mono is
      // for figures that must line up. On is the app's one selected state (`Button`'s
      // `aria-pressed`), so a pressed chip and a pressed toggle are the same blue.
      className={cn(
        'inline-flex h-6 items-center rounded-md border px-2 font-sans text-label tabular transition-colors',
        on
          ? 'border-accent-teal/45 bg-selected text-ink'
          : 'border-edge text-soft hover:border-edge-hover hover:text-ink',
      )}
    >
      {label}
    </button>
  )
}
