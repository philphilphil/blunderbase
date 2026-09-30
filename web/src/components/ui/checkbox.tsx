import { Check, Minus } from 'lucide-react'
import type * as React from 'react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * The one checkbox: row selection in Games (with the header's mixed state), the import
 * lists, the checklists inside a popover (Speed). Native checkboxes were drawn by each
 * browser in its own blue, and a hand-built one had been a filled grey square: a tiny face.
 *
 * A checkbox is an input, so it is drawn like a field (docs/design/README.md, "Controls"):
 * off is an outlined box on `--bb-field` with no shade, whose strong edge (≥ 3:1) is the
 * whole signal; on is the accent fill with a check, mixed the same fill with a minus
 * (`aria-checked="mixed"`). Never a solid square without a glyph. With a `label` the words
 * sit inside the button, so they are part of the hit area and name it.
 *
 * `onCheckedChange` is handed the click as well, for the rows that read Shift (a range)
 * or must stop the click reaching the row under them.
 */
export function Checkbox({
  checked,
  onCheckedChange,
  label,
  disabled,
  className,
  ...props
}: Omit<React.ComponentProps<'button'>, 'onClick' | 'children'> & {
  checked: boolean | 'mixed'
  onCheckedChange: (next: boolean, event: React.MouseEvent<HTMLButtonElement>) => void
  label?: ReactNode
}) {
  const on = checked !== false
  const Glyph = checked === 'mixed' ? Minus : Check
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked === 'mixed' ? 'mixed' : checked}
      disabled={disabled}
      onClick={(event) => onCheckedChange(checked !== true, event)}
      className={cn(
        'group inline-flex flex-none items-center gap-2 rounded-sm text-left text-data text-body disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          'relative inline-flex size-4 flex-none items-center justify-center rounded-sm border transition-colors',
          on
            ? 'border-accent-teal bg-accent-teal'
            : 'border-control-edge-strong bg-field group-enabled:group-hover:border-soft',
        )}
      >
        {on ? <Glyph className="size-3 stroke-[3] text-accent-ink" /> : null}
      </span>
      {label === undefined ? null : <span>{label}</span>}
    </button>
  )
}
