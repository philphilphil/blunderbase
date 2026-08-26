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
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
