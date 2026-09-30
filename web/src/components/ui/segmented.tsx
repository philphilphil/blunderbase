import type { LucideIcon } from 'lucide-react'
import { useRef, type KeyboardEvent, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  /** What the option means, on hover. */
  title?: string
  icon?: LucideIcon
  disabled?: boolean
}

/**
 * One value out of two to five short options that are all on screen: a window, a colour,
 * mine / others / all, a way of drawing a list, a theme. One component, because the app
 * drew this choice fourteen ways and the most common one looked like the move transport.
 *
 * The silhouette is its own (docs/design/README.md, "Controls"): a sunken `void` track with
 * the chosen option as a raised neutral thumb (`bg-control` and `shadow-thumb`, decision
 * D2-A). Neutral rather than the blue fill because a setting's value is not a selection of
 * data, and blue is kept for "on" and "narrowed". No dividers, so it cannot read as a
 * button group ("do one of these") where it means "pick one of these". Idle options do not
 * fill on hover: hover must not preview "chosen". Sans and never wrapping, like every label.
 *
 * In `aria` terms it is what it is: a radiogroup with one tab stop and the arrow keys
 * moving and choosing. (The `aria-pressed` form it kept while screens moved over went
 * with the last of them.)
 */
export function Segmented<T extends string>({
  value,
  onChange,
  label,
  options,
  size = 'sm',
  disabled = false,
  className,
  labelClassName,
}: {
  value: T
  onChange: (value: T) => void
  /** The group's accessible name ("How to show the notes"). */
  label: string
  options: readonly SegmentedOption<T>[]
  /** `sm` (h-7) in toolbars and control rows, `xs` (h-6) in pane strips. */
  size?: 'sm' | 'xs'
  disabled?: boolean
  className?: string
  /** Classes on each option's text, e.g. `max-sm:sr-only` where the icons carry it. */
  labelClassName?: string
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const enabled = options.filter((option) => !option.disabled && !disabled)
  // The one tab stop: the chosen option, or the first that can be chosen.
  const stop = enabled.some((option) => option.value === value) ? value : enabled[0]?.value

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (enabled.length === 0) return
    const current = enabled.findIndex((option) => option.value === options[index]?.value)
    let next: number
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (current + 1) % enabled.length
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (current - 1 + enabled.length) % enabled.length
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = enabled.length - 1
        break
      default:
        return
    }
    event.preventDefault()
    const target = enabled[next]!
    onChange(target.value)
    refs.current[options.indexOf(target)]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={cn(
        'inline-flex flex-none items-stretch gap-0.5 rounded-md border border-hairline bg-void p-0.5',
        size === 'xs' ? 'h-6' : 'h-7',
        disabled && 'opacity-50',
        className,
      )}
    >
      {options.map((option, index) => {
        const chosen = option.value === value
        const Icon = option.icon
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node
            }}
            type="button"
            role="radio"
            aria-checked={chosen}
            tabIndex={option.value === stop ? 0 : -1}
            title={option.title}
            disabled={disabled || option.disabled}
            onClick={() => {
              if (!chosen) onChange(option.value)
            }}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-sm px-2 font-sans text-label whitespace-nowrap transition-colors focus-visible:outline-offset-[-0.125rem] disabled:cursor-not-allowed',
              chosen
                ? 'bg-control font-medium text-ink shadow-thumb [&_svg]:text-body-3'
                : 'text-soft enabled:hover:text-ink enabled:active:bg-raised-2 disabled:text-faint-2',
            )}
          >
            {Icon ? <Icon className={size === 'xs' ? 'size-3' : 'size-3.5'} aria-hidden /> : null}
            <span className={labelClassName}>{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
