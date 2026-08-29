/**
 * The 13 columns of design 2b, at the widths the design draws them (emitted as `rem`).
 *
 * Two of the design's columns — per-game accuracy and ACPL — have no backend behind them:
 * `/games?cards=true` carries the eval curve and the three worst moments, not a per-game
 * accuracy aggregate, and nothing in `/stats` computes one per game either. They are
 * replaced by one honest column, `Worst` (the largest win percentage the owner gave away
 * in that game), which comes straight off `worst_moments[0]`.
 */
import type * as React from 'react'

import type { SortKey } from '../sorting'

export interface Column {
  id: string
  label: string
  width: number | 'flex'
  align?: 'left' | 'right' | 'center'
  sort?: SortKey
  /** Set in mono, tabular — dates, ratings, counts. */
  mono?: boolean
  /**
   * Where the cell lands in the two-line card a row folds into below `md`, as the grid
   * placement classes for it — `null` for a column the phone drops. See `PHONE_CARD`.
   */
  phone: string | null
}

/**
 * Thirteen columns do not fit on a 375px screen, so below `md` a row stops being a line of
 * a table and becomes a two-line card laid out on this grid:
 *
 * ```
 *   ┌───┬───┬──────────────┬───────┬───────┐
 *   │ ☑ │ ● │ opponent     │   Elo │   Res │   <- row 1
 *   │   ├───┴──────────────┼───────┼───────┤
 *   │   │ date             │ worst │ flags │   <- row 2
 *   └───┴──────────────────┴───────┴───────┘
 * ```
 *
 * The opening, the clock, the move count, the source and the tier are the five that go:
 * they are the ones a phone can look up by opening the game, and dropping them is what
 * buys the opponent's name a readable width. The header drops their sort with them, so
 * what a phone can sort by is exactly what it can see.
 */
export const PHONE_CARD = 'max-md:grid max-md:grid-cols-[auto_auto_minmax(0,1fr)_auto_auto]'

/**
 * One body row's height from `md` up. A class rather than the inline style it used to be:
 * below `md` the card sizes itself to its two lines, and an inline height would win over
 * every variant that tried to say so. Shared by the rows and the skeleton standing in for
 * them (`h-10` is the design's 40px at the app's scale).
 */
export const ROW_HEIGHT = 'md:h-10'

/**
 * The five cells of the card's first line and the three of its second, in grid terms.
 * Spans are written as an end line rather than as `col-span-2` / `row-span-2`: those set
 * the `grid-column` / `grid-row` shorthand, which would throw the start line away again.
 */
const CARD = {
  select: 'max-md:col-start-1 max-md:row-start-1 max-md:row-end-3',
  color: 'max-md:col-start-2 max-md:row-start-1',
  opponent: 'max-md:col-start-3 max-md:row-start-1',
  rating: 'max-md:col-start-4 max-md:row-start-1',
  result: 'max-md:col-start-5 max-md:row-start-1',
  date: 'max-md:col-start-2 max-md:col-end-4 max-md:row-start-2',
  worst: 'max-md:col-start-4 max-md:row-start-2',
  flags: 'max-md:col-start-5 max-md:row-start-2 max-md:justify-end',
} as const

export const COLUMNS: Column[] = [
  { id: 'select', label: '', width: 20, phone: CARD.select },
  { id: 'date', label: 'Date', width: 78, sort: 'played_at', mono: true, phone: CARD.date },
  { id: 'opponent', label: 'Opponent', width: 136, sort: 'opponent', phone: CARD.opponent },
  { id: 'rating', label: 'Elo', width: 46, align: 'right', sort: 'opponent_rating', mono: true, phone: CARD.rating },
  { id: 'color', label: 'Col', width: 30, align: 'center', sort: 'color', phone: CARD.color },
  { id: 'opening', label: 'Opening', width: 186, sort: 'opening', phone: null },
  { id: 'result', label: 'Res', width: 40, align: 'center', sort: 'result', phone: CARD.result },
  { id: 'time', label: 'Time', width: 70, sort: 'time_control', mono: true, phone: null },
  { id: 'moves', label: 'Mv', width: 40, align: 'right', sort: 'ply_count', mono: true, phone: null },
  { id: 'worst', label: 'Worst', width: 56, align: 'right', sort: 'worst', mono: true, phone: CARD.worst },
  { id: 'source', label: 'Source', width: 82, sort: 'source', phone: null },
  { id: 'tier', label: 'Tier', width: 84, sort: 'tier', phone: null },
  { id: 'flags', label: 'Flags', width: 'flex', phone: CARD.flags },
]

/**
 * The inline style one cell gets. A fixed column hands its width over as a custom property
 * rather than setting it, because an inline `width` outranks every class and the phone card
 * needs the cells to size themselves; `cellClass` is what spends it, from `md` up. The last
 * column is the flexible one, and `flex` on a grid item is ignored, so it can stay inline.
 * The design's pixels are emitted as `rem` so the table grows with the app's scale.
 */
export function cellStyle(column: Column): React.CSSProperties {
  return column.width === 'flex'
    ? { flex: 1, minWidth: 0 }
    : ({ '--cell-width': remWidth(column.width) } as React.CSSProperties)
}

/**
 * The classes that go with `cellStyle`: the column's width from `md` up, and below it
 * either the cell's place in the phone card or nothing at all.
 */
export function cellClass(column: Column): string {
  const width = column.width === 'flex' ? '' : 'md:w-[var(--cell-width)] md:flex-none'
  return `${width} ${column.phone ?? 'max-md:hidden'}`.trim()
}

/** A design-file column width as a root-relative length. */
export function remWidth(width: number): string {
  return `${width / 16}rem`
}
