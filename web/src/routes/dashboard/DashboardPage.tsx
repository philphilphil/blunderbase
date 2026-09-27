/**
 * The overview.
 *
 * Two columns: the wide one carries the rating graphs and the worst recent moments, the
 * 326-design-pixel operational rail carries the recent-games list, the analysis queue and
 * the trend card. The page prints no heading of its own — the titlebar's crumb is its name,
 * and its two buttons, Import PGN and Sync all, follow the name in that bar
 * (`SetPageChrome`'s `actions`). The subtitle that used to sit under the heading went with
 * it: the game count is the rail's, and every panel says for itself when it is empty or
 * cannot reach the backend.
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
import { Trans, useLingui } from '@lingui/react/macro'
import { Link } from 'react-router-dom'

import { SetPageChrome } from '@/components/shell/PageChrome'
import { PageBody } from '@/components/shell/PageHeader'
import { Button } from '@/components/ui/button'
import { useEngineHidden } from '@/lib/ui/engineVisibility'

import { QueueCard } from './QueueCard'
import { RatingCard } from './RatingCard'
import { RecentGamesList } from './RecentGamesList'
import { SyncAllButton } from './SyncAllButton'
import { TrendsCard } from './TrendsCard'
import { WorstMomentsRow } from './WorstMomentsRow'

export function DashboardPage() {
  const { t } = useLingui()
  const engineHidden = useEngineHidden()

  return (
    <PageBody className="gap-[1.1875rem]">
      <SetPageChrome
        breadcrumb={[{ label: t`Overview` }]}
        manual="guide/dashboard"
        actions={
          <>
            <Button asChild variant="secondary" size="sm">
              <Link to="/library/import">
                <Trans>Import PGN</Trans>
              </Link>
            </Button>
            <SyncAllButton />
          </>
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
