import { useLingui } from '@lingui/react/macro'
import { ChevronsUpDown, X, type LucideIcon } from 'lucide-react'
import type * as React from 'react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

import { pickerLook, type PickerSize } from './picker-look'

export type { PickerSize } from './picker-look'

/**
 * What a picker says: "Label", or "Label: value", then the ⇅.
 *
 * "Label: value" is one run of text with a word space after the colon, and the flex gap
 * only sits between it and the icons. Spaced by the gap instead, every picker came out a
 * few pixels wider than the prototype, enough to wrap the Notes filter row at 1280.
 * `hideLabel`'s value may shrink and truncate, for a strip that has run out of room.
 */
export function PickerContent({
  label,
  value,
  hideLabel = false,
  icon: Icon,
  leading,
  size = 'sm',
}: {
  label: string
  value?: ReactNode
  hideLabel?: boolean
  icon?: LucideIcon
  leading?: ReactNode
  size?: PickerSize
}) {
  const hasValue = value !== null && value !== undefined
  return (
    <>
      {leading}
      {Icon ? <Icon aria-hidden className="size-3.5 flex-none" /> : null}
      {hideLabel && hasValue ? (
        <span className="flex min-w-0 font-medium text-ink">{value}</span>
      ) : hasValue ? (
        <span>
          {label}: <span className="font-medium text-ink">{value}</span>
        </span>
      ) : (
        <span>{label}</span>
      )}
      <ChevronsUpDown
        aria-hidden
        className={cn('size-3 flex-none text-dim', size === 'sm' && '-mr-0.5')}
      />
    </>
  )
}

/**
 * A value picked from a list: the Games and Notes filters, Speed everywhere, the explorer's
 * date, Rows, the Maia level, the line-preview mode (docs/design/README.md, "Controls").
 *
 * It is a face, since you press it, and it ends in a `ChevronsUpDown` drawn inside the
 * button (a real child in its hit area): ⇅ says "a value from a list", where ⌄ is an action
 * menu and a bare ▾ said nothing a reader could tell apart. It names what it sets as well
 * as its value ("Date: Last 30 days"), so a glance down a bar reads as sentences.
 *
 * `set` is a non-default value: the same blue fill as a pressed toggle, because a set
 * filter narrows the data. The value is `font-medium text-ink`, never accent (accent text
 * is a link) and never mono. `onClear`, while set, adds a `×` segment inside the same
 * outline. `strip` is the pane-strip size: no face at rest, where three raised boxes in a
 * 35px strip would be noise, and the face on hover, focus and while open. Disabled is the
 * one silhouette-without-a-face every button shares.
 */
export function PickerButton({
  label,
  value,
  set = false,
  onClear,
  size = 'sm',
  icon,
  leading,
  hideLabel = false,
  className,
  disabled,
  ref,
  ...props
}: Omit<React.ComponentProps<'button'>, 'value'> & {
  /** What the picker sets ("Date"); also the clear segment's name. */
  label: string
  /** The current value, or null/undefined to show the label alone. */
  value?: ReactNode
  /** A non-default value: lit, and clearable when `onClear` is given. */
  set?: boolean
  onClear?: () => void
  size?: PickerSize
  icon?: LucideIcon
  /** Drawn before the text, e.g. the Maia purple dot. */
  leading?: ReactNode
  /** Show the value alone; the label then only names the button for a screen reader. */
  hideLabel?: boolean
}) {
  const { t } = useLingui()
  const content = (
    <PickerContent
      label={label}
      value={value}
      hideLabel={hideLabel}
      icon={icon}
      leading={leading}
      size={size}
    />
  )
  const pad = size === 'strip' ? 'gap-1 px-1.5' : 'gap-1.5 px-2.5'
  const ariaLabel = hideLabel ? label : undefined

  if (set && onClear && !disabled) {
    return (
      <span data-set="" className={cn(pickerLook({ size, set }), className)}>
        <button
          ref={ref}
          type="button"
          aria-label={ariaLabel}
          className={cn(
            'inline-flex items-center rounded-l-md focus-visible:outline-offset-[-0.125rem]',
            pad,
          )}
          {...props}
        >
          {content}
        </button>
        <button
          type="button"
          aria-label={t`Clear ${label} filter`}
          title={t`Clear ${label} filter`}
          onClick={onClear}
          className="inline-flex items-center rounded-r-md border-l border-accent-teal/45 px-1.5 text-soft transition-colors hover:bg-raised hover:text-ink focus-visible:outline-offset-[-0.125rem]"
        >
          <X aria-hidden className="size-3" />
        </button>
      </span>
    )
  }

  return (
    <button
      ref={ref}
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      data-set={set ? '' : undefined}
      className={cn(pickerLook({ size, set, disabled }), 'items-center', pad, className)}
      {...props}
    >
      {content}
    </button>
  )
}
