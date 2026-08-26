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
}

/**
 * The height of one body row, in `rem` so a row grows with the app's scale like everything
 * else. Shared by the rows and the skeleton that stands in for them.
 */
export const ROW_HEIGHT = '2.5rem'

export const COLUMNS: Column[] = [
  { id: 'select', label: '', width: 14 },
  { id: 'date', label: 'Date', width: 78, sort: 'played_at', mono: true },
  { id: 'opponent', label: 'Opponent', width: 136, sort: 'opponent' },
  { id: 'rating', label: 'Elo', width: 46, align: 'right', sort: 'opponent_rating', mono: true },
  { id: 'color', label: 'Col', width: 30, align: 'center', sort: 'color' },
  { id: 'opening', label: 'Opening', width: 186, sort: 'opening' },
  { id: 'result', label: 'Res', width: 40, align: 'center', sort: 'result' },
  { id: 'time', label: 'Time', width: 70, sort: 'time_control', mono: true },
  { id: 'moves', label: 'Mv', width: 40, align: 'right', sort: 'ply_count', mono: true },
  { id: 'worst', label: 'Worst', width: 56, align: 'right', sort: 'worst', mono: true },
  { id: 'source', label: 'Source', width: 82, sort: 'source' },
  { id: 'tier', label: 'Tier', width: 84, sort: 'tier' },
  { id: 'flags', label: 'Flags', width: 'flex' },
]

/**
 * The inline style one cell gets: a fixed width that never flexes, or the last flexible one.
 * The design's pixels are emitted as `rem` so the table grows with the app's scale.
 */
export function cellStyle(column: Column): React.CSSProperties {
  return column.width === 'flex'
    ? { flex: 1, minWidth: 0 }
    : { width: remWidth(column.width), flex: 'none' }
}

/** A design-file column width as a root-relative length. */
export function remWidth(width: number): string {
  return `${width / 16}rem`
}
