/**
 * Design 2a — the overview.
 *
 * Two columns: the main one carries the recent-games strip, the rating graph and the worst
 * recent moments; the 326px rail carries the analysis queue, the MCP panel and the trend
 * card. Every panel fetches its own data and owns its own loading, empty and error state,
 * so one endpoint being down does not take the page with it.
 */
import { Link } from 'react-router-dom'

import { SetPageChrome } from '@/components/shell/PageChrome'
import { PageBody, PageHeader } from '@/components/shell/PageHeader'
import { useProfile, useStats } from '@/lib/api/queries'
import { formatCount, num, numOr, total } from '@/routes/stats/kit/analytics'

import { McpCard } from './McpCard'
import { QueueCard } from './QueueCard'
import { RatingCard } from './RatingCard'
import { RecentGamesStrip } from './RecentGamesStrip'
import { TrendsCard } from './TrendsCard'
import { WorstMomentsRow } from './WorstMomentsRow'

/** "1,284 games in the database. 47 blunders still unexplained." */
function useSubtitle(): string {
  const profile = useProfile()
  const phase = useStats('blunders_by_phase')
  if (profile.isError) return 'The backend is not answering. Nothing below will be current.'
  if (profile.isPending) return 'Reading the database…'

  const games = num(profile.data.volume as Record<string, unknown>, 'games') ?? 0
  if (games === 0) return 'Nothing imported yet. Start with a sync or a PGN.'
  const blunders = numOr(total(phase.data), 'blunder')
  if (!phase.data) return `${formatCount(games)} games in the database.`
  return `${formatCount(games)} games in the database. ${formatCount(blunders)} blunder${
    blunders === 1 ? '' : 's'
  } on the record.`
}

export function DashboardPage() {
  const subtitle = useSubtitle()

  return (
    <PageBody className="gap-4">
      <SetPageChrome breadcrumb={[{ label: 'Overview' }]} />
      <div className="flex min-h-0 flex-1 gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <PageHeader
            title="Overview"
            description={subtitle}
            actions={
              <div className="flex items-center gap-2">
                <Link
                  to="/import"
                  className="rounded-md border border-input px-2.5 py-[0.4375rem] text-xs text-soft transition-colors hover:border-edge-hover hover:text-ink"
                >
                  Import PGN
                </Link>
                <Link
                  to="/import?source=lichess"
                  className="rounded-md bg-accent-teal px-2.5 py-[0.4375rem] text-xs font-semibold text-accent-ink transition-colors hover:bg-accent-hover"
                >
                  Sync Lichess
                </Link>
              </div>
            }
          />
          <RecentGamesStrip />
          <RatingCard />
          <WorstMomentsRow />
        </div>

        <aside className="flex w-[20.375rem] flex-none flex-col gap-3.5">
          <QueueCard />
          <McpCard />
          <TrendsCard />
        </aside>
      </div>
    </PageBody>
  )
}
