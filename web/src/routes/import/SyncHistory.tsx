import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'

import { SourceBadge } from '@/components/badges/SourceBadge'
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
import { cn } from '@/lib/utils'

import { duration, stamp } from './format'

const STATUS: Record<JobStatus, { label: string; dot: string; text: string }> = {
  queued: { label: 'Queued', dot: 'bg-mistake', text: 'text-soft' },
  running: { label: 'Running', dot: 'bg-accent-teal', text: 'text-soft' },
  done: { label: 'Done', dot: 'bg-good', text: 'text-soft' },
  failed: { label: 'Failed', dot: 'bg-blunder', text: 'text-blunder' },
}

function StatusChip({ status }: { status: JobStatus }) {
  const style = STATUS[status] ?? STATUS.queued
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[0.3125rem] border border-edge-strong bg-raised px-2 py-[0.1875rem] text-[0.71875rem]',
        style.text,
      )}
    >
      <span className={cn('size-[0.3125rem] rounded-full', style.dot)} />
      {style.label}
    </span>
  )
}

function Count({ value, tone }: { value: number; tone?: string }) {
  return (
    <span className={cn('font-mono text-[0.71875rem] tabular', value === 0 ? 'text-faint' : tone ?? 'text-body')}>
      {value}
    </span>
  )
}

function Failures({ job }: { job: ImportJob }) {
  return (
    <tr className="border-b border-hairline bg-surface-2">
      <td colSpan={9} className="px-2.5 py-2.5">
        <ul className="flex flex-col gap-1">
          {job.errors.map((failure, index) => (
            <li key={index} className="flex gap-3 font-mono text-[0.6875rem]">
              <span className="w-40 flex-none truncate text-soft-2">{failure.ref ?? '—'}</span>
              <span className="min-w-0 flex-1 text-blunder">{failure.error ?? 'failed'}</span>
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
 */
export function SyncHistory({
  jobs,
  isLoading,
  error,
}: {
  jobs: ImportJob[] | undefined
  isLoading: boolean
  error: Error | null
}) {
  const [open, setOpen] = useState<number | null>(null)

  return (
    <section className="flex flex-col rounded-xl border border-line bg-panel">
      <div className="flex items-center gap-2.5 border-b border-hairline px-3.5 py-3">
        <span className="text-xs font-semibold text-ink">Sync history</span>
        <div className="flex-1" />
        {jobs ? (
          <span className="font-mono text-[0.625rem] text-dim tabular">{jobs.length}</span>
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
          <p className="text-[0.78125rem] text-blunder">The sync history could not be read.</p>
          <p className="mt-1 font-mono text-[0.6875rem] text-dim">{error.message}</p>
        </div>
      ) : !jobs || jobs.length === 0 ? (
        <div className="px-3.5 py-8 text-center">
          <p className="text-[0.78125rem] text-soft">Nothing has been synced yet.</p>
          <p className="mt-1 text-[0.71875rem] text-dim">
            Connect an account above, or drop a PGN export in.
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-8" />
              <TableHead className="w-28">Source</TableHead>
              <TableHead className="w-32">Started</TableHead>
              <TableHead className="w-20 text-right">Took</TableHead>
              <TableHead className="w-16 text-right">Seen</TableHead>
              <TableHead className="w-20 text-right">Imported</TableHead>
              <TableHead className="w-20 text-right">Skipped</TableHead>
              <TableHead className="w-16 text-right">Failed</TableHead>
              <TableHead>Status</TableHead>
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
                      <button
                        type="button"
                        aria-label={expanded ? 'Hide failures' : 'Show failures'}
                        aria-expanded={expanded}
                        onClick={() => setOpen(expanded ? null : job.id)}
                        className="text-faint hover:text-ink"
                      >
                        {expanded ? (
                          <ChevronDown className="size-3.5" aria-hidden />
                        ) : (
                          <ChevronRight className="size-3.5" aria-hidden />
                        )}
                      </button>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <SourceBadge source={job.source} size="sm" />
                  </TableCell>
                  <TableCell className="font-mono text-[0.71875rem] text-soft tabular">
                    {stamp(job.started_at ?? job.created_at)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[0.71875rem] text-dim tabular">
                    {duration(job)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Count value={job.games_seen} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Count value={job.games_imported} tone="text-accent-teal" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Count value={job.games_skipped} tone="text-soft-2" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Count value={job.games_failed} tone="text-blunder" />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <StatusChip status={job.status} />
                      {job.message ? (
                        <span
                          title={job.message}
                          className={cn(
                            'max-w-[24ch] truncate font-mono text-[0.6875rem]',
                            job.status === 'failed' ? 'text-blunder' : 'text-dim',
                          )}
                        >
                          {job.message}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>,
                expandable && expanded ? <Failures key={`${job.id}-errors`} job={job} /> : null,
              ]
            })}
          </TableBody>
        </Table>
      )}
    </section>
  )
}
