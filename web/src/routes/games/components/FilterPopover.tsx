/**
 * The filter pickers over design 2b's table, and the panel each opens.
 *
 * The trigger is the app's `PickerButton` (components/ui/picker-button.tsx): a face that
 * reads "Label" or "Label: value" and ends in ⇅, lit with the blue fill while it narrows
 * the data, with a `×` segment inside its outline to clear it. It is as tall as a `sm`
 * Button (h-7) so the bar's controls share one line. The panel under it is hand-rolled:
 * it is the only floating surface in these screens, and it needs the phone behaviour
 * described on `FilterPopover`.
 *
 * Inside a panel, a choice is drawn as a chip (a border with no face, a ✓ and the blue
 * fill when on), because it is one of a set of values; a preset that simply does something
 * ("Last 30 days") is a small tool button.
 */
import { useLingui } from '@lingui/react/macro'
import { Check } from 'lucide-react'
import type * as React from 'react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

import { buttonVariants } from '@/components/ui/button'
import { PickerButton } from '@/components/ui/picker-button'
import { cn } from '@/lib/utils'

/**
 * One option button inside a panel (`OptionRow`, `TriState`, the date presets), so the
 * three cannot drift apart. A choice (`selected` given) is a chip: bordered, no face, and
 * when on a leading ✓ and the blue fill. `selected` undefined is a plain action (a preset),
 * which has no on state to report, so it is the `xs` tool button.
 */
export function OptionButton({
  selected,
  className,
  children,
  ...props
}: React.ComponentProps<'button'> & { selected?: boolean }) {
  if (selected === undefined) {
    return (
      <button
        type="button"
        className={cn(buttonVariants({ variant: 'secondary', size: 'xs' }), className)}
        {...props}
      >
        {children}
      </button>
    )
  }
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        'inline-flex h-6 items-center justify-center gap-1 rounded-md border px-2 font-sans text-label transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        selected
          ? 'border-accent-teal/45 bg-selected text-ink [&_svg]:text-accent-teal'
          : 'border-edge text-soft enabled:hover:border-edge-hover enabled:hover:text-ink',
        className,
      )}
      {...props}
    >
      {selected ? <Check aria-hidden className="-ml-0.5 size-3 flex-none" /> : null}
      {children}
    </button>
  )
}

export function FilterChipButton({
  label,
  summary,
  onClear,
  placeholder,
  ...props
}: Omit<React.ComponentProps<'button'>, 'value'> & {
  label: string
  /** The chip's current value, or null when the group is unset. */
  summary: string | null
  onClear?: () => void
  /**
   * What an unset picker names as its value ("Speed: All", "Date: Any time"), for a group
   * whose unset state is itself a value worth reading.
   */
  placeholder?: string
}) {
  return (
    <PickerButton
      label={label}
      value={summary ?? placeholder ?? null}
      set={summary !== null}
      onClear={onClear}
      aria-haspopup="dialog"
      {...props}
    />
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
 *
 * `align="end"` hangs the panel from the chip's right edge instead of its left, from `md`
 * up, for a chip that stands at the right of its region (the Dashboard's Speed, the
 * explorer's filters): opened rightwards, those panels covered the next column or ran off
 * the window.
 */
export function FilterPopover({
  label,
  value,
  onClear,
  children,
  width = '14.5rem',
  placeholder,
  align = 'start',
}: {
  label: string
  value: string | null
  onClear?: () => void
  children: (close: () => void) => ReactNode
  width?: string
  /** See `FilterChipButton`. */
  placeholder?: string
  /** Which edge of the chip the panel hangs from, from `md` up. */
  align?: 'start' | 'end'
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
        placeholder={placeholder}
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
          className={cn(
            'bb-pop-in absolute top-[calc(100%+0.375rem)] left-0 z-30 flex flex-col gap-2.5 rounded-md border border-edge bg-elevated p-2.5 shadow-[0_1.125rem_2.5rem_-1.125rem_var(--bb-shadow)] md:w-[var(--panel-width)] max-md:right-0',
            align === 'end' && 'md:right-0 md:left-auto',
          )}
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
