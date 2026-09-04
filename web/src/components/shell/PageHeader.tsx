import { forwardRef, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * The page heading: a 21px title with a 12.5px line under it and the page's own actions
 * pushed to the right, over a minimum height so the row does not jump as a subtitle
 * resolves from "Reading the database…" to a sentence about the library.
 *
 * Below `md` the row is allowed to wrap: a title and a pair of buttons do not share 375px,
 * and a second line is better than either half being squeezed out of legibility. The
 * spacer keeps the actions on the right whenever they still fit on the first.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex min-h-[2.75rem] flex-none items-end gap-4 max-md:min-h-0 max-md:flex-wrap',
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-[0.125rem]">
        <h1 className="text-[1.3125rem] leading-none font-semibold tracking-[-0.02em] text-ink">
          {title}
        </h1>
        {description ? <p className="text-[0.78125rem] text-dim">{description}</p> : null}
      </div>
      <div className="flex-1" />
      {actions}
    </div>
  )
}

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
