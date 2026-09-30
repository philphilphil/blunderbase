/**
 * The app's control for set membership: a row of small toggles where "2000+ and 2200+" is
 * one glance and one press, rather than a multi-select that hides the answer behind a menu.
 *
 * Chips rather than a `select` because a set is what is being asked about, and the values
 * are few and short enough to all be on screen at once: the explorer's rating bands, a
 * note's clickable tags. Speed is not a chip set any more: it is the one `SpeedPicker`
 * ("Speed: Blitz, Rapid") on every page, because it had been drawn two ways (the clarity
 * pass). Where a set has one obvious answer a `Segmented` is the right control instead;
 * the two are deliberately different shapes, because one means "one of these" and the
 * other "any of these".
 *
 * A chip is a border with no face (docs/design/README.md, "Controls"): lighter than a
 * button on purpose, since many sit in a row. An on chip always carries a leading ✓, so
 * "on" never rests on a fill alone; the blue fill means "this narrows the data" and so
 * appears only once the set is narrowed. A set with every member on narrows nothing, and
 * five blue chips had been the loudest thing on Stats while saying so.
 *
 * `toggleFilter` in `@/lib/filters` is the other half: it is what keeps a row from being
 * emptied, which every caller of these wants.
 */
import { Check } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * A labelled row of chips. The label is set at the width of the longest one these pages
 * use, so stacked rows line their chips up; it names the group as well as showing it, so a
 * reader arriving at a pressed chip is told which filter it belongs to. Sentence case like
 * every label: spaced capitals are kept for column heads, so a filter row does not read as
 * a table.
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
        className={cn('flex-none text-label text-dim', trailing ? 'pr-0.5' : 'w-11')}
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
  narrowed = true,
  disabled,
}: {
  label: ReactNode
  on: boolean
  onClick: () => void
  /** What to call it where the label is an abbreviation ("corr." for correspondence). */
  name?: string
  title?: string
  /**
   * Whether the set this chip belongs to is narrowed (at least one member off). An on chip
   * in a set with every member on narrows nothing, so it stays neutral with a dim ✓.
   */
  narrowed?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={name}
      title={title}
      disabled={disabled}
      onClick={onClick}
      // Sans, like every other label: a chip names a choice ("blitz", "2000+"), and mono is
      // for figures that must line up.
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-md border px-2 font-sans text-label tabular transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        !on && 'border-edge text-soft enabled:hover:border-edge-hover enabled:hover:text-ink',
        on && narrowed && 'border-accent-teal/45 bg-selected text-ink [&_svg]:text-accent-teal',
        on &&
          !narrowed &&
          'border-edge text-body enabled:hover:border-edge-hover enabled:hover:text-ink [&_svg]:text-dim',
      )}
    >
      {on ? <Check aria-hidden className="-ml-0.5 size-3 flex-none" /> : null}
      {label}
    </button>
  )
}
