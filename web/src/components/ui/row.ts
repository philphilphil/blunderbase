/**
 * The row grammar for lists that are not a `<table>` (recent games, explorer moves, the
 * notes list, the engines list), the same as `TableRow` so a row reads alike everywhere
 * (docs/design/README.md, "One state, one channel").
 *
 * Hover is `raised` and nothing else; a selected row is the blue fill plus the 2px inset
 * accent bar and does not change under the pointer (never `hover:bg-selected`); the row
 * under a keyboard cursor is `row-active` plus the same bar, so it no longer rests on a
 * 1.1:1 tint alone. Focus is the global ring pulled inside, because lists clip their rows.
 */

/** Every clickable row. */
export const ROW = 'transition-colors hover:bg-raised focus-visible:outline-offset-[-0.125rem]'

/** Added to `ROW` on the selected row, through `cn` so its hover replaces the row's. */
export const ROW_SELECTED = 'bg-selected shadow-row-bar hover:bg-selected'

/** Added to `ROW` on the row under a keyboard cursor (the move list's pair). */
export const ROW_CURSOR = 'bg-row-active shadow-row-bar'

/** A column's head over such a list: caps are for column heads, and only for them. */
export const COLUMN_HEAD = 'text-meta font-normal uppercase tracking-[.06em] text-dim'
