import type * as React from 'react'

import { cn } from '@/lib/utils'

import { FIELD } from './input'

/**
 * A multi-line field: the same sunk FIELD as `Input` (its own `--bb-field` fill and a 1px
 * inner top shade), so a note composer and a search box are one kind of thing, and neither
 * can be mistaken for a raised button. Its own padding, because a block of text wants a
 * little air above its first line where a one-line field centres its text.
 */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(FIELD, 'w-full min-w-0 px-2 py-1.5', className)}
      {...props}
    />
  )
}

export { Textarea }
