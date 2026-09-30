import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * A mode or a setting that persists: Hide engine, vs previous window, Sync automatically,
 * Maia on analysis. A switch rather than a pressed button because it states how things are
 * rather than doing something, and its own shape (a track and a thumb) keeps it from being
 * read as a command or a lit chip.
 *
 * Promoted from the engines page's Toggle and keeping its look, muted on purpose: on is a
 * pale accent track with an accent thumb, never the saturated iOS pill, so a bar's primary
 * stays its only strong blue block. The off track's edge is `control-edge-strong` because
 * the boundary is the whole signal there (3:1, WCAG 1.4.11). The label sits inside the
 * button, so it is part of the hit area and names the switch; `hideLabel` keeps it for
 * screen readers only where a row already says what it is. Focus draws the ring around the
 * track, not the whole row, so it marks the control rather than the words.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  hideLabel = false,
  disabled,
  title,
  thumbIcon,
  className,
}: {
  checked: boolean
  onCheckedChange: (next: boolean) => void
  label: string
  /** The label as the accessible name only. */
  hideLabel?: boolean
  disabled?: boolean
  title?: string
  /** A glyph inside the thumb, for a switch whose two states want a picture. */
  thumbIcon?: ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={hideLabel ? label : undefined}
      title={title}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'group inline-flex flex-none items-center gap-[0.4375rem] py-0.5 text-label text-soft focus-visible:outline-none enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 aria-checked:text-ink',
        className,
      )}
    >
      <span
        aria-hidden
        className="relative inline-block h-4 w-7 flex-none rounded-full border border-control-edge-strong bg-elevated transition-colors group-focus-visible:outline-[0.125rem] group-focus-visible:outline-offset-[0.125rem] group-focus-visible:outline-accent-teal group-aria-checked:border-accent-teal/45 group-aria-checked:bg-accent-teal/25"
      >
        <span className="absolute top-1/2 left-0.5 flex size-2.5 -translate-y-1/2 items-center justify-center rounded-full bg-faint transition-all group-aria-checked:left-[calc(100%-0.75rem)] group-aria-checked:bg-accent-teal">
          {thumbIcon}
        </span>
      </span>
      {hideLabel ? null : <span>{label}</span>}
    </button>
  )
}
