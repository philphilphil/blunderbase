import { Link } from 'react-router-dom'

import { SetPageChrome } from '@/components/shell/PageChrome'
import { PageBody, PageHeader } from '@/components/shell/PageHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useCoverage } from '@/lib/api/queries'
import { QueueCard } from '@/routes/dashboard/QueueCard'
import { formatCount } from '@/routes/games/format'

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
 * running, and a deep pass was not reachable at all, which is why 7,253 games had never had
 * one.
 *
 * It renders from a single `GET /analysis/coverage`. One read rather than six, because
 * this is one picture: a page that assembled the split, the backlogs and the Maia counts
 * from separate requests could show a breakdown that does not add up to its own total.
 *
 * The queue is the dashboard's card, rendered rather than rebuilt — the live view of what
 * these buttons put in it already exists, and two of them would drift.
 */
export function AnalysisPage() {
  const coverage = useCoverage()

  return (
    <PageBody>
      <SetPageChrome breadcrumb={[{ label: 'Analysis' }]} />
      <PageHeader
        title="Analysis"
        description={
          coverage.data
            ? `${formatCount(coverage.data.deep + coverage.data.quick_only)} of ${formatCount(coverage.data.total)} games have had an engine over them.`
            : 'What the library has been analysed with, and what finishing it would cost.'
        }
        actions={
          <Link to="/games" className="text-[0.6875rem] text-accent-teal hover:text-accent-link">
            the library
          </Link>
        }
      />

      {coverage.isPending ? (
        <Skeleton className="h-28 w-full max-w-3xl" data-testid="coverage-loading" />
      ) : coverage.isError ? (
        <div className="max-w-2xl rounded-md border border-blunder/28 bg-blunder/5 px-3 py-2.5">
          <p className="text-[0.75rem] text-blunder">The coverage could not be read.</p>
          <p className="mt-1 font-mono text-[0.6875rem] text-blunder/80">
            {coverage.error.message}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2.5"
            onClick={() => void coverage.refetch()}
          >
            Try again
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
