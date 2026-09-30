import { Search } from 'lucide-react'
import type * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * FIELD: what every place you type into is drawn as (inputs, `Textarea`, `NativeSelect`).
 *
 * A field is sunk where a button is raised (docs/design/README.md, "Controls"): its own
 * `--bb-field` fill, below the surface in both themes, and a 1px inner *top* shade
 * (`shadow-field`), the inverse of a face's bottom shade. In light the old `elevated` fill
 * sat 1.04:1 from a button, so the two told themselves apart by border alone. Focus is the
 * accent border *and* the global ring (no `outline-none`): the border change alone was too
 * quiet to find the caret by. Invalid is the blunder border, with `.bb-error` text below.
 */
export const FIELD =
  'rounded-md border border-edge-input bg-field text-data text-body shadow-field transition-colors placeholder:text-faint hover:border-edge-hover focus-visible:border-accent-teal disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-blunder'

function Input({
  className,
  type,
  inputSize = 'default',
  ...props
}: React.ComponentProps<'input'> & {
  /** `default` (h-8) in forms and dialogs, `sm` (h-7) in toolbars and popovers. */
  inputSize?: 'default' | 'sm'
}) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        FIELD,
        'w-full min-w-0 px-2',
        inputSize === 'sm' ? 'h-7' : 'h-8',
        className,
      )}
      {...props}
    />
  )
}

/**
 * A page's own search field (Games, Notes): a field with a leading magnifier and, from the
 * caller, a scoped placeholder ("Filter notes…"), so it never reads as the rail's "Search
 * everything" palette button. `wrapperClassName` sizes the whole thing; `className` goes on
 * the input as with `Input`.
 */
function SearchInput({
  wrapperClassName,
  className,
  ...props
}: React.ComponentProps<typeof Input> & { wrapperClassName?: string }) {
  return (
    <div className={cn('relative', wrapperClassName)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-dim"
      />
      <Input className={cn('pl-7', className)} {...props} />
    </div>
  )
}

export { Input, SearchInput }
