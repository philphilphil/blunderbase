import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'

import { SourceBadge } from '@/components/badges/SourceBadge'
import { StatusDot, type StatusDotTone } from '@/components/badges/StatusDot'
import { Button } from '@/components/ui/button'
import { Pager } from '@/components/ui/pager'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { ImportJob, JobStatus } from '@/lib/api/types'
import { useDateFormat } from '@/lib/i18n/dateFormat'
import { cn } from '@/lib/utils'

import { pageRange } from '@/routes/games/paging'

import { duration, stamp } from './format'

const STATUS: Record<JobStatus, { label: MessageDescriptor; tone: StatusDotTone; text: string }> = {
  queued: { label: msg`Queued`, tone: 'waiting', text: 'text-body' },
  running: { label: msg`Running`, tone: 'working', text: 'text-body' },
  done: { label: msg`Done`, tone: 'healthy', text: 'text-body' },
  failed: { label: msg`Failed`, tone: 'error', text: 'text-blunder' },
  // Stopped on purpose, part-way: not a failure, and not a run whose cursor anything
  // resumes from. What it stored is in the library like any other import.
  cancelled: { label: msg`Stopped`, tone: 'degraded', text: 'text-mistake' },
}

/**
 * A run's state as a readout: the status dot and the word. It had been a bordered box with
 * a raised fill, the same silhouette as the buttons on the page, and a state is a fact
 * about the run, not something to press.
 */
function StatusWord({ status }: { status: JobStatus }) {
  const { i18n } = useLingui()
  const style = STATUS[status] ?? STATUS.queued
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-data', style.text)}>
      <StatusDot tone={style.tone} />
      {i18n._(style.label)}
    </span>
  )
}

function Count({ value, tone }: { value: number; tone?: string }) {
  return (
    <span className={cn('font-mono text-data tabular', value === 0 ? 'text-faint' : tone ?? 'text-body')}>
      {value}
    </span>
  )
}

function Failures({ job, columns }: { job: ImportJob; columns: number }) {
  const { t } = useLingui()
  return (
    <tr className="border-b border-hairline bg-surface-2">
      <td colSpan={columns} className="px-2.5 py-2.5">
        <ul className="flex flex-col gap-1">
          {job.errors.map((failure, index) => (
            <li key={index} className="flex gap-3 font-mono text-label">
              <span className="w-40 flex-none truncate text-soft-2">{failure.ref ?? '—'}</span>
              <span className="min-w-0 flex-1 text-blunder">{failure.error ?? t`failed`}</span>
            </li>
          ))}
        </ul>
      </td>
    </tr>
  )
}

/**
 * Every sync that has run, newest first, with the per-game failures folded under the row
 * that carries them — `ImportJob.errors` is the only place a game that did not make it in
 * is recorded.
 *
 * A page at a time, because this list only grows: every sync of every account writes a row,
 * and an installation that syncs on a schedule reaches hundreds of them in a month. The
 * pager appears only when there is a second page — one press of Sync all on a fresh
 * install writes three rows, and a pager under three rows is furniture.
 */
export function SyncHistory({
  jobs,
  isLoading,
  error,
  page,
  pageCount,
  total,
  pageSize,
  onPageChange,
}: {
  jobs: ImportJob[] | undefined
  isLoading: boolean
  error: Error | null
  /** 1-based. */
  page: number
  pageCount: number
  /** How many syncs the history holds, not how many this page shows. */
  total: number
  pageSize: number
  onPageChange: (page: number) => void
}) {
  const { t } = useLingui()
  const dateFormat = useDateFormat()
  const [open, setOpen] = useState<number | null>(null)
  // The deleted column earns its width only on a library where something was deleted, and
  // the folded-out failure row has to span whatever that leaves.
  const anyBlocked = (jobs ?? []).some((job) => job.games_blocked > 0)
  const columns = anyBlocked ? 10 : 9
  // The same reading the games table's footer gives, over the same helper: which slice of
  // the whole history this page is, counted off what actually came back.
  const { first, last } = pageRange(page, pageSize, jobs?.length ?? 0, total)

  return (
    <section className="flex flex-col rounded-xl border border-line bg-panel">
      <div className="flex items-center gap-2.5 border-b border-hairline px-3.5 py-3">
        <span className="text-data font-semibold text-ink">
          <Trans>Sync history</Trans>
        </span>
        <div className="flex-1" />
        {jobs ? (
          <span className="font-mono text-meta text-dim tabular">{total}</span>
        ) : null}
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2 p-3.5" data-testid="history-loading">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-8 w-full" />
          ))}
        </div>
      ) : error ? (
        <div className="px-3.5 py-6 text-center">
          <p className="text-data text-blunder">
            <Trans>The sync history could not be read.</Trans>
          </p>
          <p className="mt-1 font-mono text-label text-dim">{error.message}</p>
        </div>
      ) : !jobs || jobs.length === 0 ? (
        <div className="px-3.5 py-8 text-center">
          <p className="text-data text-soft">
            <Trans>Nothing has been synced yet.</Trans>
          </p>
          <p className="mt-1 text-label text-dim">
            <Trans>Connect an account above, or drop a PGN export in.</Trans>
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-8" />
              <TableHead className="w-28">
                <Trans>Source</Trans>
              </TableHead>
              <TableHead className="w-32">
                <Trans>Started</Trans>
              </TableHead>
              <TableHead className="w-20 text-right">
                <Trans>Took</Trans>
              </TableHead>
              <TableHead className="w-16 text-right">
                <Trans>Seen</Trans>
              </TableHead>
              <TableHead className="w-20 text-right">
                <Trans>Imported</Trans>
              </TableHead>
              <TableHead className="w-20 text-right">
                <Trans>Skipped</Trans>
              </TableHead>
              {/* Only when some run has one: a column of zeroes on every library that has
                  never deleted a game is a column that only takes width from the ones
                  people read. */}
              {anyBlocked ? (
                <TableHead className="w-24 text-right">
                  <Trans>Deleted</Trans>
                </TableHead>
              ) : null}
              <TableHead className="w-16 text-right">
                <Trans>Failed</Trans>
              </TableHead>
              <TableHead>
                <Trans>Status</Trans>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((job) => {
              const expandable = job.errors.length > 0
              const expanded = open === job.id
              return [
                <TableRow key={job.id} data-state={expanded ? 'selected' : undefined}>
                  <TableCell className="pr-0">
                    {expandable ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={expanded ? t`Hide failures` : t`Show failures`}
                        title={expanded ? t`Hide failures` : t`Show failures`}
                        aria-expanded={expanded}
                        onClick={() => setOpen(expanded ? null : job.id)}
                      >
                        {expanded ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
                      </Button>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <SourceBadge source={job.source} variant="plain" className="text-data text-body" />
                  </TableCell>
                  <TableCell className="font-mono text-data text-soft tabular">
                    {stamp(job.started_at ?? job.created_at, dateFormat)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-data text-dim tabular">
                    {duration(job)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Count value={job.games_seen} />
                  </TableCell>
                  <TableCell className="text-right">
                    {/* Ink, the heaviest figure in the row: it is what the run was for.
                        Accent text is kept for links, and this goes nowhere. */}
                    <Count value={job.games_imported} tone="font-medium text-ink" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Count value={job.games_skipped} tone="text-soft-2" />
                  </TableCell>
                  {anyBlocked ? (
                    <TableCell className="text-right">
                      <Count value={job.games_blocked} tone="text-mistake" />
                    </TableCell>
                  ) : null}
                  <TableCell className="text-right">
                    <Count value={job.games_failed} tone="text-blunder" />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <StatusWord status={job.status} />
                      {job.message ? (
                        <span
                          title={job.message}
                          className={cn(
                            'max-w-[24ch] truncate font-mono text-label',
                            job.status === 'failed' ? 'text-blunder' : 'text-dim',
                          )}
                        >
                          {job.message}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>,
                expandable && expanded ? <Failures key={`${job.id}-errors`} job={job} columns={columns} /> : null,
              ]
            })}
          </TableBody>
        </Table>
      )}

      {pageCount > 1 ? (
        <div className="flex items-center gap-2 border-t border-hairline px-3.5 py-2">
          <span className="font-mono text-label text-dim tabular">
            <Trans>
              {first}–{last} of {total}
            </Trans>
          </span>
          <div className="flex-1" />
          <Pager
            label={t`Pages`}
            page={page}
            pages={pageCount}
            onPrev={() => onPageChange(page - 1)}
            onNext={() => onPageChange(page + 1)}
          />
        </div>
      ) : null}
    </section>
  )
}
