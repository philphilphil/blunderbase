/**
 * The tab strip every pane of the game screen draws its tabs in: the 35-design-pixel chrome
 * band (`bb-pane-title`'s height), holding tabs, then facts, then tools.
 *
 * The selected tab is a folder tab (the clarity pass, decision D1-A): the pane's own surface
 * pushed up into the strip between two side rules, a sliver of that surface laid over the
 * strip's bottom rule so the tab and the pane under it read as one region, and a 2px accent
 * top edge. The surface step alone (1.13:1) had left tabs reading as labels; the accent edge
 * is 6.47:1 on the strip. It hangs 1px below the strip's top (`shadow-tab-on` paints the
 * first pixel in the surface), so under a stacked pane (Evaluation / Move time) it stays on
 * the tab and cannot read as the underline of the pane above.
 *
 * A tab never has a face, a box or the blue fill: those are buttons, chips and selection.
 * Every tab carries `border-x` (transparent while idle), so its label does not shift a pixel
 * when it is chosen. `PaneTabList` / `PaneTab` (PaneTabList.tsx) are the structure; these are
 * the classes, one place, so the notes track, the graph pane and whatever grows tabs next
 * are the same strip.
 */
import { buttonVariants } from '@/components/ui/button'

export const TAB_ROW =
  'flex h-[2.1875rem] flex-none items-stretch border-b border-line bg-panel pr-2.5 select-none'

/** An idle tab is a control, so its text is `soft`, never below it (the text ladder). */
export const TAB =
  'relative flex h-full items-center gap-1.5 border-x border-transparent px-3 text-data text-soft transition-colors hover:bg-raised hover:text-ink focus-visible:outline-offset-[-0.125rem] disabled:cursor-not-allowed disabled:text-faint-2 disabled:hover:bg-transparent'

/**
 * Added to `TAB` on the chosen tab. The first tab's left rule stays transparent: it sits on
 * the pane's own edge.
 */
export const TAB_ON =
  'border-x-line bg-surface font-medium text-ink shadow-tab-on hover:bg-surface first:border-l-transparent after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-surface'

/** The strip's facts after the tabs ("40 plies"): metadata, `meta` in `dim-2`. */
export const STRIP_FACTS = 'text-meta text-dim-2'

/** The rule between a strip's facts and its tools. */
export const STRIP_RULE = 'h-4 w-px flex-none bg-hairline'

/** A count beside a tab's name ("Notes 3"): metadata, so the scale's floor in `dim-2`. */
export const PANE_COUNT = 'font-mono text-meta text-dim-2'

/**
 * An icon-only control in a pane's title strip (collapse, settings): the standard ghost
 * square at the strip's size, so every pane's tools are the same 24-design-px target.
 */
export const PANE_TOOL = buttonVariants({ variant: 'ghost', size: 'icon-xs' })
