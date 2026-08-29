import { formatDuration } from '@/lib/analysis'

/**
 * A cost estimate as a button is allowed to print it.
 *
 * `/analysis/coverage` answers in engine-*seconds*: the raw work, measured off the runs
 * this deployment has actually finished at the budget configured now. What an owner is
 * deciding about is the wall clock, and that is the work divided by how many runs the
 * backend does at once — so the division happens here, once, rather than in each of the
 * four places a number appears.
 *
 * Null in, null out, and the caller shows nothing at all. The backend returns null when it
 * has too few finished runs to average, and inventing a number for a page whose entire
 * purpose is "what will this cost me" would be worse than the empty space.
 */
export function estimateLabel(
  seconds: number | null | undefined,
  concurrency: number,
): string | null {
  if (seconds === null || seconds === undefined) return null
  // A backend that reported no concurrency still runs one at a time.
  const wall = seconds / Math.max(1, concurrency)
  // `formatDuration` already says "under a minute", which a "~" in front of would only
  // make less certain than it is.
  return wall < 60 ? formatDuration(wall) : `~${formatDuration(wall)}`
}
