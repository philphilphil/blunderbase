import * as LabelPrimitive from '@radix-ui/react-label'
import type * as React from 'react'

import { cn } from '@/lib/utils'

function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        'flex items-center gap-2 text-[0.6875rem] font-medium text-soft select-none',
        className,
      )}
      {...props}
    />
  )
}

export { Label }
