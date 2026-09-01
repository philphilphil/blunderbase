/**
 * The overview.
 *
 * A page heading with the page's own actions across the top, then two columns under it: the
 * wide one carries the rating graphs and the worst recent moments, the 310px operational
 * rail carries the recent-games list, the analysis queue and the trend card. The heading
 * spans both because it is about the page and not about the left column — it used to sit
 * inside that column, which put the title and the "Sync accounts" button a third of the way
 * across the window with nothing above the rail at all.
 *
 * Every panel fetches its own data and owns its own loading, empty and error state, so one
 * endpoint being down does not take the page with it. None of them draws a card: a panel is
 * a heading over a rule with its contents under it (`components/shell/Section`), which is
 * what makes the page read as one document rather than as five widgets.
 *
 * Below `md` the rail stops being a rail: the two columns become one, and the panels stack
 * in the order they are written — ratings and worst moments first, because they are what
 * the page is for, then the recent games, the queue and the trends under them.
 */
import { Link } from 'react-router-dom'

import { SetPageChrome } from '@/components/shell/PageChrome'
import { PageBody, PageHeader } from '@/components/shell/PageHeader'
import { useProfile, useStats } from '@/lib/api/queries'
import { formatCount, num, numOr, total } from '@/routes/stats/kit/analytics'

import { QueueCard } from './QueueCard'
import { RatingCard } from './RatingCard'
import { RecentGamesList } from './RecentGamesList'
import { SyncAllButton } from './SyncAllButton'
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
    <PageBody className="gap-[1.1875rem]">
      <SetPageChrome breadcrumb={[{ label: 'Overview' }]} />
      <PageHeader
        title="Overview"
        description={subtitle}
        actions={
          <div className="flex items-center gap-2">
            <Link
              to="/library/import"
              className="rounded-md border border-input bg-elevated px-2.5 py-[0.4375rem] text-xs text-soft transition-colors hover:border-edge-hover hover:text-ink"
            >
              Import PGN
            </Link>
            <SyncAllButton />
          </div>
        }
      />
      <div className="flex min-h-0 flex-1 gap-6 max-md:flex-col max-md:gap-5">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <RatingCard />
          <WorstMomentsRow />
        </div>

        <aside className="flex w-[20.375rem] flex-none flex-col gap-6 max-md:w-full">
          <RecentGamesList />
          <QueueCard />
          <TrendsCard />
        </aside>
      </div>
    </PageBody>
  )
}
