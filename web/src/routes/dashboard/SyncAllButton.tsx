/**
 * "Sync all" — the overview's one-press refresh.
 *
 * The Import page syncs one account at a time because it also has to *connect* them; the
 * dashboard only ever re-syncs what is already connected, so it needs no form. Which
 * accounts those are is read off `/import/jobs`: a sync that finished cleanly records the
 * username it was given in `ImportJob.message`, and that is the only place the last-used
 * username survives a reload. Nothing synced yet — nothing to press, so the button becomes
 * a link to the page that can connect an account.
 */
import { Loader2, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { useImportJobs, useStartImport } from '@/lib/api/queries'
import type { ImportJob, Source } from '@/lib/api/types'
import { useImportProgress } from '@/routes/import/useImportProgress'
import { cn } from '@/lib/utils'

/** The sources a sync can be started for — `pgn` is an upload and `manual` is by hand. */
const SYNCABLE = ['lichess', 'chesscom', 'fics'] as const
type Syncable = (typeof SYNCABLE)[number]

const PLATFORM_LABEL: Record<Syncable, string> = {
  lichess: 'Lichess',
  chesscom: 'Chess.com',
  fics: 'FICS',
}

/** Enough history to find the last good sync of each source without paging. */
const JOB_LIMIT = 25

const BUTTON =
  'inline-flex items-center gap-1.5 rounded-md bg-accent-teal px-2.5 py-[0.4375rem] text-xs font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-60 disabled:hover:bg-accent-teal'

export interface SyncTarget {
  source: Syncable
  username: string
}

function stampOf(job: ImportJob): number {
  const at = Date.parse(job.finished_at ?? job.started_at ?? job.created_at)
  return Number.isFinite(at) ? at : 0
}

/**
 * One target per source, taken from the newest job that finished cleanly.
 *
 * A failed job overwrites `message` with the exception text
 * (`services/import_service.py`), so only a `done` job may seed a sync — otherwise the
 * next press would post `AdapterError: …` as the username and fail again.
 */
export function syncTargets(jobs: ImportJob[] | undefined): SyncTarget[] {
  const newest = new Map<Syncable, { at: number; username: string }>()
  for (const job of jobs ?? []) {
    if (job.status !== 'done') continue
    if (!(SYNCABLE as readonly string[]).includes(job.source)) continue
    const username = job.message?.trim()
    if (!username) continue
    const source = job.source as Syncable
    const at = stampOf(job)
    const current = newest.get(source)
    if (!current || at > current.at) newest.set(source, { at, username })
  }
  return SYNCABLE.filter((source) => newest.has(source)).map((source) => ({
    source,
    username: newest.get(source)!.username,
  }))
}

export function SyncAllButton() {
  const jobs = useImportJobs({ limit: JOB_LIMIT })
  const progress = useImportProgress()
  const start = useStartImport()
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const targets = syncTargets(jobs.data?.jobs)
  // `/events` is the only thing that knows a sync is still walking the archive: the POST
  // has long since answered with a job id by then.
  const syncing = pending || targets.some((target) => progress[target.source]?.running === true)

  async function syncAll() {
    setPending(true)
    setFailure(null)
    const results = await Promise.allSettled(
      targets.map((target) =>
        start.mutateAsync({
          source: target.source as Source,
          body: { username: target.username },
        }),
      ),
    )
    const rejected = results.find((result) => result.status === 'rejected')
    setFailure(
      rejected ? ((rejected.reason as Error | undefined)?.message ?? 'the sync did not start') : null,
    )
    setPending(false)
  }

  if (!jobs.isPending && targets.length === 0) {
    return (
      <Link to="/library/import" className={BUTTON}>
        Connect account
      </Link>
    )
  }

  return (
    <>
      {failure ? (
        <span className="max-w-[24ch] truncate text-[0.6875rem] text-blunder" title={failure}>
          {failure}
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => void syncAll()}
        disabled={jobs.isPending || syncing}
        aria-busy={syncing}
        title={
          targets.length === 0
            ? undefined
            : targets
                .map((target) => `${PLATFORM_LABEL[target.source]}: ${target.username}`)
                .join(' · ')
        }
        className={cn(BUTTON)}
      >
        {syncing ? (
          <Loader2 className="size-3 animate-spin" aria-hidden />
        ) : (
          <RefreshCw className="size-3" aria-hidden />
        )}
        {syncing ? 'Syncing' : 'Sync all'}
      </button>
    </>
  )
}
