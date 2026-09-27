import { ExternalLink } from 'lucide-react'

import type { Source } from '@/lib/api/types'
import { SOURCE_STYLES } from '@/lib/chess/classification'
import { cn } from '@/lib/utils'

/**
 * Lichess / Chess.com / OTB / PGN, as design 1c draws them — in one of two weights.
 *
 * `chip` is the tinted badge, for the places where the source is the point: a game's own
 * header, the import screen. `plain` is a coloured dot and the name in `soft` text, for
 * the places where it is routine metadata repeated down a column — fifty identical tinted
 * chips in the games table were the loudest thing on the screen while saying the least.
 */
export function SourceBadge({
  source,
  size = 'md',
  variant = 'chip',
  className,
  title,
  href,
}: {
  source: Source
  size?: 'sm' | 'md'
  variant?: 'chip' | 'plain'
  className?: string
  /** A hover note about the source — what its adapter does, where a row has room for none. */
  title?: string
  /**
   * The game's own page on that site (`GameSummary.url`). Given, the badge is a link that
   * opens it in a new tab, with a small arrow so it says it goes somewhere: the same badge,
   * in the same place, rather than a second control for "open on Lichess". Clicks on it
   * stop where they are, because in the games table the badge sits inside a row that opens
   * the game on click and a link that also opened the row would do two things at once.
   *
   * Plain, the arrow shows only while the link itself is pointed at or focused. The group
   * is named (`group/src`) because the games row is a `group` of its own, and an unnamed
   * `group-hover` would light every row's arrow whenever the row was hovered.
   */
  href?: string | null
}) {
  const style = SOURCE_STYLES[source]
  const plain = variant === 'plain'
  const classes = plain
    ? cn(
        'inline-flex items-center gap-1.5 text-label text-soft',
        href && 'group/src hover:text-ink',
        className,
      )
    : cn(
        'inline-flex items-center rounded-sm border',
        size === 'sm' ? 'gap-1 px-1.5 py-px text-meta' : 'gap-1.5 px-2 py-[0.1875rem] text-label',
        style.chipClass,
        href && 'hover:brightness-125',
        className,
      )
  const body = plain ? (
    <>
      <span aria-hidden className={cn('size-1.5 flex-none rounded-full', style.dotClass)} />
      {style.label}
      {href ? (
        <ExternalLink
          className="size-3 text-dim opacity-0 transition-opacity group-hover/src:opacity-100 group-focus-visible/src:opacity-100"
          aria-hidden
        />
      ) : null}
    </>
  ) : (
    <>
      <span
        className={cn('rounded-full', size === 'sm' ? 'size-1' : 'size-[0.3125rem]', style.dotClass)}
      />
      {style.label}
      {href ? (
        <ExternalLink className={size === 'sm' ? 'size-2.5' : 'size-3'} aria-hidden />
      ) : null}
    </>
  )
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        title={title}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        className={classes}
      >
        {body}
      </a>
    )
  }
  return (
    <span title={title} className={classes}>
      {body}
    </span>
  )
}
