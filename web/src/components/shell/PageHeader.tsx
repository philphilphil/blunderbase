import { forwardRef, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

/*
 * There is no page heading. A screen's name is the titlebar's last crumb and its buttons
 * follow it in that bar (`TopBar`, `SetPageChrome`); an in-page title under it
 * repeated the crumb and the rail's highlighted row.
 */

/**
 * The scrolling canvas every page sits on: 18px/20px padding, 16px column gap.
 *
 * A `ref` is forwarded to the scrolling element itself rather than a wrapper, so a page
 * that puts its own sticky chrome inside (a tab bar, say) can scroll itself back to the top
 * when that chrome changes what it is showing — see `EnginesPage`, which is the reason this
 * exists. Every other caller ignores it; a page that never asks for the ref behaves exactly
 * as before.
 *
 * The bottom padding is `max(1.125rem, …)` of the safe-area inset rather than half of
 * `py-4.5`, so the last row of a page installed to an iPhone's home screen clears the home
 * indicator. Off a notched device the inset is 0 and the padding is the 18px it was.
 */
export const PageBody = forwardRef<HTMLDivElement, { children: ReactNode; className?: string }>(
  function PageBody({ children, className }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          'flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pt-[1.375rem] pb-[max(1.75rem,env(safe-area-inset-bottom,0rem))] max-md:px-4',
          className,
        )}
      >
        {children}
      </div>
    )
  },
)
