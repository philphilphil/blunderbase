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
export const TAB_ROW =
  'flex h-[2.1875rem] flex-none items-stretch border-b border-line bg-panel pr-2.5'

export const TAB =
  'relative flex h-full items-center gap-1.5 px-3 text-xs text-dim transition-colors hover:text-body-3'

export const TAB_ON =
  'bg-surface font-medium text-ink after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-surface'
