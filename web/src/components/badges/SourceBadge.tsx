import { ExternalLink } from 'lucide-react'

import type { Source } from '@/lib/api/types'
import { SOURCE_STYLES } from '@/lib/chess/classification'
import { cn } from '@/lib/utils'

/** Lichess / Chess.com / OTB / PGN, as design 1c draws them. */
export function SourceBadge({
  source,
  size = 'md',
  className,
  title,
  href,
}: {
  source: Source
  size?: 'sm' | 'md'
  className?: string
  /** A hover note about the source — what its adapter does, where a row has room for none. */
  title?: string
  /**
   * The game's own page on that site (`GameSummary.url`). Given, the chip is a link that
   * opens it in a new tab, with a small arrow so the chip says it goes somewhere: the same
   * chip, in the same place, rather than a second control for "open on Lichess". Clicks on it
   * stop where they are, because in the games table the chip sits inside a row that opens
   * the game on click and a link that also opened the row would do two things at once.
   */
  href?: string | null
}) {
  const style = SOURCE_STYLES[source]
  const classes = cn(
    'inline-flex items-center rounded-sm border',
    size === 'sm' ? 'gap-1 px-1.5 py-px text-[0.625rem]' : 'gap-1.5 px-2 py-[0.1875rem] text-[0.71875rem]',
    style.chipClass,
    href && 'hover:brightness-125',
    className,
  )
  const body = (
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
