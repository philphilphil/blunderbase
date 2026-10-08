/**
 * This browser's copy of the games list's column choice (`GET /settings/game-columns`).
 *
 * The choice lives with the library, because it is the owner's and not a browser's. This
 * copy does two smaller jobs. On the public demo it is the only copy there is: the demo has
 * no owner and refuses every write, so the visitor's own browser is the one place the choice
 * can live, and it only has to survive the next reload. Everywhere else it is what the list
 * is drawn with while the server's answer is on its way, so a reload does not flash the
 * default columns before the chosen ones. It is rewritten on every answer from the server,
 * so a change made on another machine is what the next visit here starts from.
 *
 * Every access is guarded: a browser that will not store it (private mode, site data
 * blocked) draws the default first and the owner's choice a moment later, and the demo
 * forgets the visitor's — both failures this copy can afford.
 */
import type { GameColumns } from '@/lib/api/types'

export const GAME_COLUMNS_KEY = 'blunderbase.gameColumns'

function isIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id) => typeof id === 'string')
}

/** The stored copy, or `null` when there is none, it is not the right shape, or storage throws. */
export function readLocalColumns(): GameColumns | null {
  try {
    const raw = window.localStorage.getItem(GAME_COLUMNS_KEY)
    if (raw === null) return null
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return null
    const { order, hidden } = value as Record<string, unknown>
    if (!isIdList(order) || order.length === 0) return null
    return { order, hidden: isIdList(hidden) ? hidden : [] }
  } catch {
    return null
  }
}

/** Keep `value` as this browser's copy; `null`, or the default (an empty order), removes it. */
export function writeLocalColumns(value: GameColumns | null): void {
  try {
    if (value === null || value.order.length === 0) window.localStorage.removeItem(GAME_COLUMNS_KEY)
    else window.localStorage.setItem(GAME_COLUMNS_KEY, JSON.stringify(value))
  } catch {
    // See above: the list is drawn from the server's answer, or the default, instead.
  }
}
