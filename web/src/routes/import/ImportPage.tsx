import { Hand } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import { SetPageChrome } from '@/components/shell/PageChrome'
import { PageBody, PageHeader } from '@/components/shell/PageHeader'
import { useGames, useImportJobs, useProfile } from '@/lib/api/queries'
import type { ImportJob, Source } from '@/lib/api/types'

import { ConnectAccount } from './ConnectAccount'
import { ConnectAssistant } from './ConnectAssistant'
import { PgnUpload } from './PgnUpload'
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

function latestOf(jobs: ImportJob[] | undefined, source: Source): ImportJob | undefined {
  return jobs?.find((job) => job.source === source)
}

/**
 * Import: connect an account, sync it, drop a PGN in, hand the coach the address of what
 * arrived, and read what every previous sync did. No dedicated design turn — the cards,
 * table and badges are the ones the rest of the app uses.
 */
export function ImportPage() {
  const jobs = useImportJobs({ limit: HISTORY_LIMIT })
  const profile = useProfile()
  const games = useGames({ limit: 1 })
  const progress = useImportProgress()

  const history = useMemo(() => newestFirst(jobs.data), [jobs.data])
  const accounts = profile.data?.accounts ?? []
  const total = games.data?.total

  return (
    <PageBody>
      <SetPageChrome breadcrumb={[{ label: 'Import' }]} />
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

      <div className="grid items-stretch gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <ConnectAccount
          source="lichess"
          account={accounts.find((account) => account.platform === 'lichess')}
          lastJob={latestOf(history, 'lichess')}
          progress={progress.lichess}
        />
        <ConnectAccount
          source="chesscom"
          account={accounts.find((account) => account.platform === 'chesscom')}
          lastJob={latestOf(history, 'chesscom')}
          progress={progress.chesscom}
        />
        <PgnUpload progress={progress.pgn} />
      </div>

      <ConnectAssistant />

      <div className="flex items-start gap-3 rounded-xl border border-dashed border-edge-strong bg-panel/60 px-3.5 py-3">
        <Hand className="mt-px size-3.5 flex-none text-faint" aria-hidden />
        <div className="flex flex-col gap-1">
          <span className="text-[0.75rem] font-medium text-soft">
            Over-the-board games, entered by hand
          </span>
          <p className="text-[0.71875rem] leading-[1.5] text-dim">
            Not built yet. An OTB game exported from a scoresheet app is a PGN — drop it in
            above and it arrives like any other import, under the{' '}
            <span className="font-mono text-soft-2">pgn</span> source.
          </p>
        </div>
      </div>

      <SyncHistory jobs={history} isLoading={jobs.isPending} error={jobs.error} />
    </PageBody>
  )
}
