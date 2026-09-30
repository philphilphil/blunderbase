import { useLingui } from '@lingui/react/macro'
import { keepPreviousData } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { SetPageChrome } from '@/components/shell/PageChrome'
import { PageBody } from '@/components/shell/PageHeader'
import { useImportJobs, useProfile } from '@/lib/api/queries'
import type { ImportJob, Source } from '@/lib/api/types'

import { PgnCard } from './PgnCard'
import { SourcesPanel } from './SourcesPanel'
import { SyncHistory } from './SyncHistory'
import { useImportProgress } from './useImportProgress'

/** Syncs per page of the history. One press of Sync all writes one row per account. */
const HISTORY_PAGE = 25

/** Newest first, whatever order the API happened to answer in. */
function newestFirst(jobs: ImportJob[] | undefined): ImportJob[] | undefined {
  if (!jobs) return jobs
  return [...jobs].sort(
    (left, right) => Date.parse(right.created_at) - Date.parse(left.created_at),
  )
}

/**
 * Import: connect an account, sync it, drop a PGN in, and read what every previous sync
 * did.
 *
 * Three regions in the order the work happens: the accounts games are synced from, a PGN
 * file, then what every run of either did. Each region carries its own primary (Sync all,
 * Upload), so the bar carries none: the page's commands belong to the region they act on.
 * Export and reset live on Library → Manage, where those database-wide actions have a
 * stable route and cannot be mistaken for another import source.
 */
export function ImportPage() {
  const { t } = useLingui()
  const [page, setPage] = useState(1)
  // `keepPreviousData` is not decoration here: without it the page being turned to has no
  // data for a beat, the total reads as zero, and the clamp below would send the reader
  // straight back to page one before the request for page two had left.
  const jobs = useImportJobs(
    { limit: HISTORY_PAGE, offset: (page - 1) * HISTORY_PAGE },
    { placeholderData: keepPreviousData },
  )
  // What the sources table needs is the newest sync of each source, which is a fact about
  // the front of the history rather than about the page being read. Its own query, keyed
  // identically to the first page's, so standing there is one request rather than two.
  const latest = useImportJobs({ limit: HISTORY_PAGE, offset: 0 })
  const profile = useProfile()
  const progress = useImportProgress()

  const history = useMemo(() => newestFirst(jobs.data?.jobs), [jobs.data])
  const front = useMemo(() => newestFirst(latest.data?.jobs), [latest.data])
  const accounts = profile.data?.accounts ?? []
  const syncs = jobs.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(syncs / HISTORY_PAGE))
  // A history that shrank under the reader — a wipe takes the sync rows with it — must not
  // leave the page past the end of it. Only once something has answered: a page count read
  // off a history nobody has counted yet is 1, and every page but the first would bounce.
  if (jobs.data && page > pageCount) setPage(pageCount)

  const latestOf = (source: Source) => front?.find((job) => job.source === source)

  return (
    <PageBody>
      <SetPageChrome
        breadcrumb={[{ label: t`Library`, to: '/library' }, { label: t`Import` }]}
        manual="guide/library#import"
      />
      <SourcesPanel accounts={accounts} latestOf={latestOf} progress={progress} />

      <PgnCard progress={progress.pgn} />

      <SyncHistory
        jobs={history}
        isLoading={jobs.isPending}
        error={jobs.error}
        page={page}
        pageCount={pageCount}
        total={syncs}
        pageSize={HISTORY_PAGE}
        onPageChange={setPage}
      />
    </PageBody>
  )
}
