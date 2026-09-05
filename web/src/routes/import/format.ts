import { t } from '@lingui/core/macro'

import type { ImportJob } from '@/lib/api/types'

const WHEN = new Intl.DateTimeFormat(undefined, {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

/** `26 Aug 09:31` — an absolute stamp, because a sync history is read as a log. */
export function stamp(iso: string | null | undefined): string {
  if (!iso) return '—'
  const value = Date.parse(iso)
  return Number.isNaN(value) ? '—' : WHEN.format(value)
}

/** How long the sync took, as the history writes it: `1.3s`, `47s`, `4m 12s`. */
export function duration(job: ImportJob): string {
  if (!job.started_at || !job.finished_at) return '—'
  const ms = Date.parse(job.finished_at) - Date.parse(job.started_at)
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 10_000) return seconds((ms / 1000).toFixed(1))
  const whole = Math.round(ms / 1000)
  if (whole < 60) return seconds(String(whole))
  const mins = Math.floor(whole / 60)
  const secs = whole % 60
  return t({
    message: `${mins}m ${secs}s`,
    comment: 'A duration in minutes and seconds, e.g. "4m 12s"',
  })
}

/** The seconds half of `duration`, so both branches carry one message rather than two. */
function seconds(secs: string): string {
  return t({ message: `${secs}s`, comment: 'A duration in seconds, e.g. "1.3s" or "47s"' })
}
