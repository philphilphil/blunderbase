import type * as React from 'react'

import { cn } from '@/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-8 w-full min-w-0 rounded-md border border-input bg-elevated px-2.5 text-xs text-ink outline-none transition-colors',
        'placeholder:text-faint focus-visible:border-accent-teal/50',
        'disabled:pointer-events-none disabled:opacity-50',
        'aria-invalid:border-blunder',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
