import { ArrowUpRight, ChevronRight } from 'lucide-react'
import type * as React from 'react'
import { Link, type To } from 'react-router-dom'

import { cn } from '@/lib/utils'

const LOOK = {
  // The one "go there" of a region ("All 3,000 ›", "Open in Games ›").
  accent:
    'group/link inline-flex items-center gap-0.5 text-accent-teal underline-offset-2 hover:text-accent-link hover:underline',
  // Repeated metadata links in dense lists (note card feet, recent-game rows, sync counts).
  quiet:
    'group/link inline-flex items-center gap-0.5 text-soft underline-offset-2 hover:text-accent-teal hover:underline',
  // A link inside a sentence: underlined at rest, since nothing else marks it in prose.
  inline:
    'text-accent-teal underline decoration-accent-teal/40 underline-offset-2 hover:text-accent-link hover:decoration-current',
} as const

/**
 * Navigation, and nothing else (docs/design/README.md, "Controls"). Accent text had been
 * spent on toggles, cyclers and counts as well as on links, so it no longer said "this goes
 * somewhere"; now it does, and every link is this one component rather than a hand copy of
 * `text-accent-teal hover:text-accent-link` (`lib/ui/grammar.test.ts` holds that line).
 *
 * A standalone link ends in a `›` (an in-app place) or a `↗` (`external`: another site, a
 * new tab), so it reads as a way out even where it is not underlined. `tone="quiet"` is for
 * metadata repeated down a list: `soft` text with a faint `›` that turn accent on hover,
 * because every note card carrying two blue lines gave Notes more blue than the rail and
 * the segments took away. `placement="inline"` is a link inside running text: underlined at
 * rest and no chevron, since a glyph mid-sentence reads as punctuation.
 *
 * `to` is a router location (a `Link`); `href` is a plain address (an `<a>`).
 */
export function TextLink({
  to,
  href,
  state,
  replace,
  tone = 'accent',
  placement = 'standalone',
  external = false,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<'a'>, 'href'> & {
  to?: To
  href?: string
  state?: unknown
  replace?: boolean
  tone?: 'accent' | 'quiet'
  placement?: 'standalone' | 'inline'
  external?: boolean
}) {
  const inline = placement === 'inline'
  const classes = cn(inline ? LOOK.inline : LOOK[tone], className)
  const Glyph = external ? ArrowUpRight : ChevronRight
  const body = (
    <>
      {children}
      {inline ? null : (
        <Glyph
          aria-hidden
          className={cn(
            'size-3 flex-none',
            tone === 'quiet' && 'text-faint group-hover/link:text-current',
          )}
        />
      )}
    </>
  )
  const newTab = external ? { target: '_blank', rel: 'noreferrer' } : {}
  if (to !== undefined && !external) {
    return (
      <Link to={to} state={state} replace={replace} className={classes} {...props}>
        {body}
      </Link>
    )
  }
  return (
    <a
      href={href ?? (typeof to === 'string' ? to : undefined)}
      className={classes}
      {...newTab}
      {...props}
    >
      {body}
    </a>
  )
}
