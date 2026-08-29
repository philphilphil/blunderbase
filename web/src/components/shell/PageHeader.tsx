import { forwardRef, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * The page heading from the design: a 19px title with a 12.5px line under it and the
 * page's own actions pushed to the right.
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
    <div className={cn('flex items-end gap-3 max-md:flex-wrap', className)}>
      <div className="flex flex-col gap-[0.1875rem]">
        <h1 className="text-[1.1875rem] font-semibold tracking-[-0.01em] text-ink">{title}</h1>
        {description ? (
          <p className="text-[0.78125rem] text-dim">{description}</p>
        ) : null}
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
          'flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pt-4.5 pb-[max(1.125rem,env(safe-area-inset-bottom,0rem))]',
          className,
        )}
      >
        {children}
      </div>
    )
  },
)

/** What a route renders before the screen behind it is built. */
export function Placeholder({ note }: { note: string }) {
  return (
    <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-edge-strong bg-panel/60 p-10 text-center">
      <p className="max-w-md text-[0.78125rem] leading-relaxed text-dim">{note}</p>
    </div>
  )
}
