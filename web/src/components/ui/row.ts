/**
 * The row grammar for lists that are not a `<table>` (recent games, explorer moves, the
 * notes list, the engines list), the same as `TableRow` so a row reads alike everywhere
 * (docs/design/README.md, "One state, one channel").
 *
 * Hover is `raised` and nothing else; a selected row is the blue fill plus the 2px inset
 * accent bar and does not change under the pointer (never `hover:bg-selected`); a list's
 * cursor row (the Notes tab's active note) is `bg-row-active`. Focus is the global ring
 * pulled inside, because lists clip their rows.
 */

/** Every clickable row. */
export const ROW = 'transition-colors hover:bg-raised focus-visible:outline-offset-[-0.125rem]'

/** Added to `ROW` on the selected row, through `cn` so its hover replaces the row's. */
export const ROW_SELECTED = 'bg-selected shadow-row-bar hover:bg-selected'

/** A column's head over such a list: caps are for column heads, and only for them. */
export const COLUMN_HEAD = 'text-meta font-normal uppercase tracking-[.06em] text-dim'
