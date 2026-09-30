import type { AnalyseLimitKind } from './AnalyseDialog'

/**
 * The limit as the request carries it, or `null` when the box cannot be sent. Seconds may
 * be a fraction; depth and nodes are whole. Unlike a correspondence search an empty box is
 * not "no limit" — every move needs one — so it holds the button back instead.
 *
 * A module of its own rather than beside the dialog: a `.tsx` that exports a helper next
 * to its components loses React Fast Refresh.
 */
export function parseLimit(kind: AnalyseLimitKind, value: string): number | null {
  const text = value.trim()
  const parsed = Number(text)
  if (text === '' || !Number.isFinite(parsed) || parsed <= 0) return null
  if (kind === 'seconds') return parsed
  return parsed >= 1 ? Math.trunc(parsed) : null
}
