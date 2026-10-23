/**
 * How long a stretch of engine work is quoted, in the one place the app decides.
 *
 * It began inside the backfill takeover, where it turns an observed rate into "~3h 20m
 * remaining". The Analysis page prices four buttons the same way — an estimate is only
 * useful next to the press that spends it — and two spellings of the same duration on two
 * screens is exactly the kind of drift that makes a number look made up.
 */
import { t } from '@lingui/core/macro'

/**
 * `0:42`, `4:12`, `1:02:03` — time already spent, as a clock reads it. Not an estimate, so
 * none of `formatDuration`'s rounding: a search that is being watched moves every second.
 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`
}

/** `3h 20m`, `14m`, `under a minute` — the granularity the number deserves and no more. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 60) return t`under a minute`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return t`${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? t`${hours}h` : t`${hours}h ${rest}m`
}
