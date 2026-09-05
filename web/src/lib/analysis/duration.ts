/**
 * How long a stretch of engine work is quoted, in the one place the app decides.
 *
 * It began inside the backfill takeover, where it turns an observed rate into "~3h 20m
 * remaining". The Analysis page prices four buttons the same way — an estimate is only
 * useful next to the press that spends it — and two spellings of the same duration on two
 * screens is exactly the kind of drift that makes a number look made up.
 */
import { t } from '@lingui/core/macro'

/** `3h 20m`, `14m`, `under a minute` — the granularity the number deserves and no more. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 60) return t`under a minute`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return t`${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? t`${hours}h` : t`${hours}h ${rest}m`
}
