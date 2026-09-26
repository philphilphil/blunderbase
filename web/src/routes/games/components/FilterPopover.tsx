/**
 * The dropdown chips over design 2b's table.
 *
 * A chip is a button that opens a small panel anchored under it. Deliberately hand-rolled
 * rather than pulled from `components/ui`: the chip is two buttons in one frame (open, and
 * clear once set), and the panel is the only floating surface in either of these two
 * screens.
 *
 * The chip is as tall as a `sm` Button (h-7) so the bar's controls share one line, and it
 * has the app's two states: the tool look (`elevated`, `body` text) when the group is
 * unset, and the one selected state (`bg-selected`, `ink`, the accent on the border) when
 * it is set, with the summary picked out in the accent so a glance down the bar finds the
 * filters that are on. The options inside a panel light the same way.
 */
import { useLingui } from '@lingui/react/macro'
import type * as React from 'react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * One option button inside a panel — `OptionRow`, `TriState` and the date presets — so
 * the three cannot drift apart: bordered tool look when off, the selected blue when on.
 * `selected` undefined is a plain action (a preset), which has no pressed state to report.
 */
export function OptionButton({
  selected,
  className,
  ...props
}: React.ComponentProps<'button'> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        'rounded-md border px-2 py-1 text-label transition-colors',
        selected
          ? 'border-accent-teal/45 bg-selected text-ink'
          : 'border-edge bg-elevated text-body hover:bg-raised hover:text-ink',
        className,
      )}
      {...props}
    />
  )
}

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
  const { t } = useLingui()
  const active = summary !== null
  return (
    <span
      className={cn(
        'inline-flex h-7 items-stretch rounded-md border font-sans text-label transition-colors',
        active
          ? 'border-accent-teal/45 bg-selected text-ink'
          : 'border-edge bg-elevated text-body hover:bg-raised hover:text-ink',
      )}
    >
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-md px-2.5 outline-none focus-visible:ring-1 focus-visible:ring-accent-teal/55 focus-visible:ring-inset"
        {...props}
      >
        {active ? (
          <>
            <span>{label}:</span>
            <span className="font-mono text-accent-teal">{summary}</span>
          </>
        ) : (
          <>
            {label}
            <span className="text-dim">▾</span>
          </>
        )}
      </button>
      {active && onClear ? (
        <button
          type="button"
          aria-label={t`Clear ${label} filter`}
          onClick={onClear}
          className="rounded-md px-1.5 text-soft outline-none hover:text-ink focus-visible:ring-1 focus-visible:ring-accent-teal/55 focus-visible:ring-inset"
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
          className="bb-pop-in absolute top-[calc(100%+0.375rem)] left-0 z-30 flex flex-col gap-2.5 rounded-md border border-edge bg-elevated p-2.5 shadow-[0_1.125rem_2.5rem_-1.125rem_var(--bb-shadow)] md:w-[var(--panel-width)] max-md:right-0"
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
    <span className="text-meta tracking-[.1em] text-dim uppercase">{children}</span>
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
          <OptionButton
            key={option}
            selected={selected}
            onClick={() => onChange(selected ? undefined : option)}
          >
            {labels?.[option] ?? option}
          </OptionButton>
        )
      })}
    </div>
  )
}

/**
 * A yes / no / either tri-state, for the boolean filters. "Either" is clicking the chosen
 * one again; `either` also draws it as a button of its own, for a filter whose unset state
 * is the one most people mean and should be seen to be chosen (rated / casual / either).
 */
export function TriState({
  value,
  onChange,
  yes,
  no,
  either,
}: {
  value: boolean | undefined
  onChange: (next: boolean | undefined) => void
  yes?: string
  no?: string
  either?: string
}) {
  const { t } = useLingui()
  const options: { label: string; next: boolean | undefined }[] = [
    { label: yes ?? t`Yes`, next: true },
    { label: no ?? t`No`, next: false },
  ]
  if (either) options.unshift({ label: either, next: undefined })
  return (
    <div className="flex gap-1">
      {options.map(({ label, next }) => {
        const selected = value === next
        return (
          <OptionButton
            key={label}
            selected={selected}
            onClick={() => onChange(selected ? undefined : next)}
            className="flex-1"
          >
            {label}
          </OptionButton>
        )
      })}
    </div>
  )
}
