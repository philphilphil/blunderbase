import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import { SetPageChrome } from '@/components/shell/PageChrome'
import { PageBody, PageHeader } from '@/components/shell/PageHeader'
import { useGames, useImportJobs, useProfile } from '@/lib/api/queries'
import type { ImportJob, Source } from '@/lib/api/types'

import { SourcesTable } from './SourcesTable'
import { SyncHistory } from './SyncHistory'
import { useImportProgress } from './useImportProgress'

const HISTORY_LIMIT = 25

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
 * Two tables in the order the work happens: what games come from, then what every run of
 * it did. Export and reset live on Library → Manage, where those database-wide actions
 * have a stable route and cannot be mistaken for another import source.
 */
export function ImportPage() {
  const jobs = useImportJobs({ limit: HISTORY_LIMIT })
  const profile = useProfile()
  const games = useGames({ limit: 1 })
  const progress = useImportProgress()

  const history = useMemo(() => newestFirst(jobs.data), [jobs.data])
  const accounts = profile.data?.accounts ?? []
  const total = games.data?.total

  const latestOf = (source: Source) => history?.find((job) => job.source === source)

  return (
    <PageBody>
      <SetPageChrome
        breadcrumb={[{ label: 'Library', to: '/library' }, { label: 'Import' }]}
      />
      <PageHeader
        title="Import"
        description={
          total === undefined
            ? 'Connect an account, sync it, or upload a PGN export.'
            : `${total.toLocaleString()} games in the database. Every import is deduplicated on the way in.`
        }
        actions={
          total ? (
            <Link to="/games" className="text-[0.6875rem] text-accent-teal hover:text-accent-link">
              all {total.toLocaleString()}
            </Link>
          ) : null
        }
      />

      <SourcesTable accounts={accounts} latestOf={latestOf} progress={progress} />

      <SyncHistory jobs={history} isLoading={jobs.isPending} error={jobs.error} />
    </PageBody>
  )
}
