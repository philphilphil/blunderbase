/**
 * The tab strip every pane of the game screen draws its tabs in: the 35-design-pixel chrome
 * band (`bb-pane-title`'s height) with the selected tab as the pane's own surface pushed up
 * into it, and a sliver of that surface laid over the strip's bottom rule so the tab and
 * the pane under it read as one region, the way a desktop tool draws a tab. A stronger
 * and quieter signal than an accent underline, and it costs the strip no colour at all.
 *
 * One place, so the notes track, the graph pane and whatever grows tabs next are the same
 * strip — three hand-copied class strings had already started to drift.
 */
import { buttonVariants } from '@/components/ui/button'

export const TAB_ROW =
  'flex h-[2.1875rem] flex-none items-stretch border-b border-line bg-panel pr-2.5 select-none'

/** An idle tab is a control, so its text is `soft` — never below it (the text ladder). */
export const TAB =
  'relative flex h-full items-center gap-1.5 px-3 text-data text-soft transition-colors hover:text-ink'

export const TAB_ON =
  'bg-surface font-medium text-ink after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-surface'

/** A count beside a tab's name ("Notes 3"): metadata, so the scale's floor in `dim-2`. */
export const PANE_COUNT = 'font-mono text-meta text-dim-2'

/**
 * An icon-only control in a pane's title strip (collapse, settings): the standard ghost
 * square at the strip's size, so every pane's tools are the same 24-design-px target.
 */
export const PANE_TOOL = buttonVariants({ variant: 'ghost', size: 'icon-xs' })
