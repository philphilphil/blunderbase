import { Trans, useLingui } from '@lingui/react/macro'

import { SetPageChrome } from '@/components/shell/PageChrome'
import { PageBody } from '@/components/shell/PageHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useCoverage } from '@/lib/api/queries'
import { QueueCard } from '@/routes/dashboard/QueueCard'

import { CoverageSplit } from './CoverageSplit'
import { FailedRuns } from './FailedRuns'
import { LibraryActions } from './LibraryActions'
import { MaiaLevels } from './MaiaLevels'

/**
 * Analysis: what the library has been analysed with, and what finishing it would cost.
 *
 * The screen the app was missing. Every whole-library operation used to live wherever it
 * had first been needed — an "Analyse all" on the library, the Maia fill inside a configuration
 * card, "Clear the queue" inside a titlebar widget that only appears while something is
 * queued — and none of them said what they would cost. So a pass over eight thousand games
 * was one click from an owner who had no way to learn it was forty hours until it was
 * running, and the games an import had skipped had no way back into the queue but one at a
 * time.
 *
 * It renders from a single `GET /analysis/coverage`. One read rather than six, because
 * this is one picture: a page that assembled the split, the backlogs and the Maia counts
 * from separate requests could show a breakdown that does not add up to its own total.
 *
 * The queue is the dashboard's card, rendered rather than rebuilt — the live view of what
 * these buttons put in it already exists, and two of them would drift.
 */
export function AnalysisPage() {
  const { t } = useLingui()
  const coverage = useCoverage()

  return (
    <PageBody>
      <SetPageChrome
        breadcrumb={[{ label: t`Analysis`, to: '/analysis' }, { label: t`Coverage` }]}
        manual="guide/analysis#what-is-left-to-analyse"
      />
      {coverage.isPending ? (
        <Skeleton className="h-28 w-full max-w-3xl" data-testid="coverage-loading" />
      ) : coverage.isError ? (
        <div className="max-w-2xl rounded-md border border-blunder/28 bg-blunder/5 px-3 py-2.5">
          <p className="text-data text-blunder">
            <Trans>The coverage could not be read.</Trans>
          </p>
          <p className="mt-1 font-mono text-label text-blunder/80">
            {coverage.error.message}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2.5"
            onClick={() => void coverage.refetch()}
          >
            <Trans>Try again</Trans>
          </Button>
        </div>
      ) : (
        <>
          <CoverageSplit coverage={coverage.data} />
          <LibraryActions coverage={coverage.data} />

          <div className="grid items-start gap-3 lg:grid-cols-2">
            <MaiaLevels maia={coverage.data.maia} />
            <QueueCard />
          </div>

          <FailedRuns failed={coverage.data.failed} />
        </>
      )}
    </PageBody>
  )
}
