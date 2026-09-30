import type * as React from 'react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

import { FIELD } from './input'
import { PickerContent } from './picker-button'
import { pickerLook, type PickerSize } from './picker-look'

/**
 * The browser's own select, for forms and dialogs only: a FIELD like every input beside it
 * (sunk, `--bb-field`, the inner top shade), with the browser's arrow. In a form a select
 * is one more field to fill in, so it should look like its neighbours.
 */
export function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select data-slot="native-select" className={cn(FIELD, 'h-7 px-2', className)} {...props} />
  )
}

export interface PickerSelectOption<T extends string> {
  value: T
  label: string
  /** Offered but not pickable (a Maia level the position has no data for). */
  disabled?: boolean
}

/**
 * A native select dressed as a `PickerButton`, for toolbars and pane strips: the picker's
 * face and ⇅ are drawn underneath, and the real `<select>` is laid over them, transparent
 * (Apple's pop-up button). So a toolbar shows one picker look whatever the list is, while
 * the keyboard, the screen reader and the phone's wheel all get the native control.
 *
 * Its focus ring is drawn on the look (`has-focus-visible`), since the select itself is
 * invisible.
 */
export function PickerSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  size = 'sm',
  set = false,
  title,
  leading,
  hideLabel = false,
  display,
  disabled = false,
  className,
  testId,
}: {
  /** What it sets ("Rows"); also the select's accessible name. */
  label: string
  value: T
  options: readonly PickerSelectOption<T>[]
  onChange: (value: T) => void
  size?: PickerSize
  /** A non-default value: lit, the way a set filter is. */
  set?: boolean
  title?: string
  /** Drawn before the text, e.g. the Maia purple dot. */
  leading?: ReactNode
  /** Show the value alone ("1500" in the Maia strip). */
  hideLabel?: boolean
  /**
   * What the face shows in place of the chosen option's words, when a strip wants more than
   * a word: the Maia level with its human mark, the engine name that truncates.
   */
  display?: ReactNode
  disabled?: boolean
  className?: string
  testId?: string
}) {
  const chosen = options.find((option) => option.value === value)
  return (
    <span
      data-testid={testId}
      title={title}
      className={cn(
        pickerLook({ size, set, disabled }),
        'relative items-center',
        size === 'strip' ? 'gap-1 px-1.5' : 'gap-1.5 px-2.5',
        'has-focus-visible:outline-[0.125rem] has-focus-visible:outline-offset-[0.125rem] has-focus-visible:outline-accent-teal',
        className,
      )}
    >
      <PickerContent
        label={label}
        value={display ?? chosen?.label ?? value}
        hideLabel={hideLabel}
        leading={leading}
        size={size}
      />
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as T)}
        className="absolute inset-0 cursor-pointer opacity-0 focus-visible:outline-none disabled:cursor-not-allowed"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  )
}
