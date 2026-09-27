/**
 * The overview.
 *
 * A page heading with the page's own actions across the top, then two columns under it: the
 * wide one carries the rating graphs and the worst recent moments, the 326-design-pixel
 * operational rail carries the recent-games list, the analysis queue and the trend card. The
 * heading
 * spans both because it is about the page and not about the left column — it used to sit
 * inside that column, which put the title and the "Sync accounts" button a third of the way
 * across the window with nothing above the rail at all.
 *
 * Every panel fetches its own data and owns its own loading, empty and error state, so one
 * endpoint being down does not take the page with it. None of them draws a card: a panel is
 * a heading over a rule with its contents under it (`components/shell/Section`), which is
 * what makes the page read as one document rather than as five widgets.
 *
 * The rating graphs lead, two to a row so they stay short (`RatingCard`), which leaves the
 * worst moments room below them for boards big enough to read.
 *
 * ⇧E (the engine hidden, `useEngineHidden`) takes the worst moments off the page entirely:
 * every tile is the engine's verdict on a move, and there is nothing left of it without
 * that. Everything else stays — the recent games list quiets its own swing column.
 *
 * Below `md` the rail stops being a rail: the two columns become one, and the panels stack
 * in the order they are written — ratings and worst moments first, because they are what
 * the page is for, then the recent games, the queue and the trends under them.
 */
import { plural } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { Link } from 'react-router-dom'

import { SetPageChrome } from '@/components/shell/PageChrome'
import { PageBody, PageHeader } from '@/components/shell/PageHeader'
import { Button } from '@/components/ui/button'
import { useProfile, useStats } from '@/lib/api/queries'
import { useEngineHidden } from '@/lib/ui/engineVisibility'
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
  const { t } = useLingui()
  if (profile.isError) return t`The backend is not answering. Nothing below will be current.`
  if (profile.isPending) return t`Reading the database…`

  const games = num(profile.data.volume as Record<string, unknown>, 'games') ?? 0
  if (games === 0) return t`Nothing imported yet. Start with a sync or a PGN.`
  const blunders = numOr(total(phase.data), 'blunder')
  const gameCount = formatCount(games)
  if (!phase.data) return t`${gameCount} games in the database.`
  const blunderCount = formatCount(blunders)
  return t`${gameCount} games in the database. ${plural(blunders, {
    one: `${blunderCount} blunder`,
    other: `${blunderCount} blunders`,
  })} on the record.`
}

export function DashboardPage() {
  const subtitle = useSubtitle()
  const { t } = useLingui()
  const engineHidden = useEngineHidden()

  return (
    <PageBody className="gap-[1.1875rem]">
      <SetPageChrome breadcrumb={[{ label: t`Overview` }]} manual="guide/dashboard" />
      <PageHeader
        title={t`Overview`}
        description={subtitle}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="secondary" size="sm">
              <Link to="/library/import">
                <Trans>Import PGN</Trans>
              </Link>
            </Button>
            <SyncAllButton />
          </div>
        }
      />
      <div className="flex min-h-0 flex-1 gap-6 max-md:flex-col max-md:gap-5">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <RatingCard />
          {engineHidden ? null : <WorstMomentsRow />}
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
