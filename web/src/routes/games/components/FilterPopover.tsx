/**
 * The dropdown chips over design 2b's table.
 *
 * A chip is a button that opens a small panel anchored under it. Deliberately hand-rolled
 * rather than pulled from `components/ui`: the design's chip is 4px/9px with an 11.5px
 * label and two states (teal when the group is set, hairline when it is not), and the
 * panel is the only floating surface in either of these two screens.
 */
import type * as React from 'react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

export function FilterChipButton({
  label,
  summary,
  onClear,
  ...props
}: React.ComponentProps<'button'> & {
  label: string
  /** The chip's current value, or null when the group is unset. */
  summary: string | null
  onClear?: () => void
}) {
  const active = summary !== null
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border text-[0.71875rem] transition-colors',
        active
          ? 'border-accent-teal/30 bg-accent-teal/10 text-accent-teal'
          : 'border-edge bg-elevated text-soft hover:border-edge-hover hover:text-ink',
      )}
    >
      <button
        type="button"
        className="inline-flex items-center gap-1.5 px-2.5 py-1 outline-none"
        {...props}
      >
        {active ? (
          <>
            <span className="text-[0.71875rem]">{label}:</span>
            <span className="font-mono">{summary}</span>
          </>
        ) : (
          <>
            {label}
            <span className="text-faint">▾</span>
          </>
        )}
      </button>
      {active && onClear ? (
        <button
          type="button"
          aria-label={`Clear ${label} filter`}
          onClick={onClear}
          className="px-1.5 py-1 text-accent-teal/70 outline-none hover:text-accent-teal"
        >
          ×
        </button>
      ) : null}
    </span>
  )
}

/**
 * A chip with a panel under it. Closes on Escape, on a click outside, and whenever the
 * caller says the interaction is finished (`closeOnApply`).
 *
 * Below `md` the chip stops being the panel's containing block (`max-md:static`) and the
 * filter bar becomes it instead, so the panel spans the bar and drops under the whole of
 * it. A 250px panel anchored to the left edge of a chip that is itself 250px along a
 * 375px screen hangs off the side, where the nearest ancestor with an overflow rule either
 * clips it or grows the page sideways; a bar-wide panel cannot. Every bar that hosts one
 * of these has to say `max-md:relative` for that to work — `FilterBar` and
 * `NoteFilterBar` both do.
 */
export function FilterPopover({
  label,
  value,
  onClear,
  children,
  width = '14.5rem',
}: {
  label: string
  value: string | null
  onClear?: () => void
  children: (close: () => void) => ReactNode
  width?: string
}) {
  const [open, setOpen] = useState(false)
  const host = useRef<HTMLDivElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (host.current && !host.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={host} className="relative max-md:static">
      <FilterChipButton
        label={label}
        summary={value}
        onClear={onClear}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((current) => !current)}
      />
      {open ? (
        <div
          id={panelId}
          // Handed over rather than set, so `max-md:right-0` can win below the breakpoint:
          // an inline width outranks every class.
          style={{ '--panel-width': width } as React.CSSProperties}
          className="absolute top-[calc(100%+0.375rem)] left-0 z-30 flex flex-col gap-2.5 rounded-lg border border-edge bg-elevated p-2.5 shadow-[0_1.125rem_2.5rem_-1.125rem_var(--bb-shadow)] md:w-[var(--panel-width)] max-md:right-0"
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  )
}

/** The label over one block inside a popover. */
export function PopoverLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[0.625rem] tracking-[.1em] text-faint uppercase">{children}</span>
  )
}

/** A radio-ish row of options; clicking the selected one clears it. */
export function OptionRow<T extends string>({
  options,
  value,
  onChange,
  labels,
}: {
  options: readonly T[]
  value: T | undefined
  onChange: (next: T | undefined) => void
  labels?: Partial<Record<T, string>>
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((option) => {
        const selected = value === option
        return (
          <button
            key={option}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(selected ? undefined : option)}
            className={cn(
              'rounded-sm border px-2 py-1 text-[0.71875rem] transition-colors',
              selected
                ? 'border-accent-teal/35 bg-accent-teal/10 text-accent-teal'
                : 'border-edge bg-raised text-soft hover:border-edge-hover hover:text-ink',
            )}
          >
            {labels?.[option] ?? option}
          </button>
        )
      })}
    </div>
  )
}

/** A yes / no / either tri-state, for the two boolean filters. */
export function TriState({
  value,
  onChange,
  yes = 'Yes',
  no = 'No',
}: {
  value: boolean | undefined
  onChange: (next: boolean | undefined) => void
  yes?: string
  no?: string
}) {
  return (
    <div className="flex gap-1">
      {[
        { label: yes, next: true },
        { label: no, next: false },
      ].map(({ label, next }) => {
        const selected = value === next
        return (
          <button
            key={label}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(selected ? undefined : next)}
            className={cn(
              'flex-1 rounded-sm border px-2 py-1 text-[0.71875rem] transition-colors',
              selected
                ? 'border-accent-teal/35 bg-accent-teal/10 text-accent-teal'
                : 'border-edge bg-raised text-soft hover:border-edge-hover hover:text-ink',
            )}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
