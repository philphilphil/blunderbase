import type * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * The 3px hairline bar the design uses for the queue, storage and MCP tool counts.
 * Deliberately not the Radix primitive: it is decorative everywhere it appears, and the
 * number next to it is the accessible value.
 */
function Progress({
  value,
  max = 100,
  className,
  barClassName,
  ...props
}: React.ComponentProps<'div'> & { value: number; max?: number; barClassName?: string }) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0
  return (
    <div
      data-slot="progress"
      className={cn('h-[0.1875rem] overflow-hidden rounded-sm bg-edge', className)}
      {...props}
    >
      <div
        data-slot="progress-bar"
        className={cn('h-full bg-accent-teal transition-[width] duration-300', barClassName)}
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  )
}

export { Progress }
