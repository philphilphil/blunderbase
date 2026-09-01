import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * A region of a page, and the ruled line that names it.
 *
 * This is the flat replacement for the rounded card the overview used to build every panel
 * out of. Five cards floating on a canvas read as five unrelated widgets and spend a border,
 * a radius and a padding ring each on saying so; a heading over a rule says the same thing
 * in one line, costs nothing, and — because every heading sits on the same baseline grid —
 * makes the page read as one document with sections rather than as a dashboard.
 *
 * `title` is the heading, `detail` the quiet qualifier beside it ("Blitz", "by win
 * percentage given away"), and `end` whatever belongs hard right: a link to the full list, a
 * segmented control, a count. The rule is `--bb-edge-strong` — the same weight as the rules
 * between panes on the game screen, so a section boundary and a pane boundary are one idea.
 */
export function SectionHead({
  title,
  detail,
  end,
  className,
}: {
  title: ReactNode
  detail?: ReactNode
  end?: ReactNode
  className?: string
}) {
  return (
    <header
      className={cn(
        'flex min-h-[1.9375rem] flex-none items-baseline gap-2.5 border-b border-edge-strong pb-[0.4375rem]',
        className,
      )}
    >
      {/* The heading never wraps: a two-line "Last 30 days" beside a segmented control is
          the rule losing its argument with the controls on it, and the detail beside it is
          the part that can afford to be truncated instead. */}
      <h2 className="flex-none text-[0.875rem] font-semibold whitespace-nowrap text-ink">
        {title}
      </h2>
      {detail ? <span className="min-w-0 truncate text-[0.6875rem] text-dim">{detail}</span> : null}
      {end ? <div className="ml-auto flex items-baseline gap-2.5">{end}</div> : null}
    </header>
  )
}

/**
 * The region itself: a heading, a rule, and whatever the section is about under it. No
 * surface of its own — the page's canvas *is* the section's ground, which is the point.
 */
export function Section({
  title,
  detail,
  end,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode
  detail?: ReactNode
  end?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={cn('flex min-h-0 flex-col', className)}>
      <SectionHead title={title} detail={detail} end={end} />
      <div className={cn('flex min-h-0 flex-col', bodyClassName)}>{children}</div>
    </section>
  )
}
