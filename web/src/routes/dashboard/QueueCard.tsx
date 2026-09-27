/**
 * Design 2a, "Analysis queue" — the counts from `/analysis/queue` over the per-run rows
 * the `/events` socket carries (see `useRunActivity`).
 */
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { Link } from 'react-router-dom'

import { QueueDestinations } from '@/components/shell/QueueDestinations'
import { QueueMeter } from '@/components/shell/QueueMeter'
import { SectionHead } from '@/components/shell/Section'
import { Button } from '@/components/ui/button'
import { useGames, useMaiaFill, useQueueStatus, useRetryFailed } from '@/lib/api/queries'
import type { RunStatus } from '@/lib/api/types'
import { RUN_STYLES, runKind, runLabel } from '@/lib/chess/classification'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

import { Bar, ErrorBlock } from '@/routes/stats/kit/states'

import { useRunActivity, type RunActivity } from './useRunActivity'

/**
 * What a row calls the work. A Maia fill is queued like an import pass — for its engine
 * and for its place in the queue — so the node budget it carries is where it was filed,
 * not what it did: it searches nothing and only asks the human-move model for the levels a
 * game is missing. Labelling one with its budget is how the card would report a pass over
 * a game to an owner who had asked for the missing Maia levels and nothing else.
 *
 * Plain coloured text rather than a chip, like the run's own label on other rows: four
 * rows of bordered, filled chips in a narrow rail were the loudest thing on it, and the
 * colour alone already says which kind of work a row is.
 */
const MAIA_TEXT = 'text-brilliant'

/** How many rows the card shows before it collapses the rest into a count. */
const ROWS = 4
/** Enough recent games to name most runs; the rest are shown by id. */
const LOOKUP = 50

const DOT: Record<RunStatus, string> = {
  queued: 'bg-mistake',
  running: 'bg-accent-teal',
  done: 'bg-good',
  failed: 'bg-blunder',
}

/**
 * A row's own words for a status. Lower case and one word each, because they sit in a
 * narrow column at the end of a row rather than being headings. They are quiet on purpose:
 * the dot in front of the row already carries the status colour, and red is kept for a
 * failure.
 */
const STATUS_WORD: Record<RunStatus, MessageDescriptor> = {
  queued: msg`queued`,
  running: msg`running`,
  done: msg`done`,
  failed: msg`failed`,
}

function RunRow({
  run,
  label,
  onRetry,
  retrying,
}: {
  run: RunActivity
  label: string
  onRetry: () => void
  retrying: boolean
}) {
  const style = RUN_STYLES[runKind(run)]
  const { t, i18n } = useLingui()
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md px-1 py-1.5',
        run.status === 'failed' ? 'bg-blunder/5' : 'hover:bg-raised',
      )}
    >
      <span className={cn('size-[0.3125rem] flex-none rounded-full', DOT[run.status])} />
      <span
        className={cn(
          'flex-1 truncate text-data',
          run.status === 'queued' ? 'text-soft' : 'text-body',
        )}
      >
        {label}
      </span>
      <span
        title={run.maiaOnly ? t`the missing Maia levels only; nothing is searched` : undefined}
        className={cn(
          'text-label whitespace-nowrap',
          run.maiaOnly ? MAIA_TEXT : style.textClass,
        )}
      >
        {run.maiaOnly ? 'maia' : runLabel(run)}
      </span>
      {run.status === 'failed' ? (
        <>
          <span className="font-mono text-label text-blunder" title={run.error ?? undefined}>
            <Trans>failed</Trans>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRetry}
            disabled={retrying || run.gameId === null}
            className="-my-1.5 text-accent-teal hover:text-accent-link"
          >
            {retrying ? t`queued` : t`retry`}
          </Button>
        </>
      ) : (
        <span
          className={cn(
            'font-mono text-label tabular',
            run.status === 'running' ? 'text-soft' : 'text-dim',
          )}
        >
          {run.status === 'running'
            ? run.progress === null
              ? i18n._(STATUS_WORD.running)
              : `${run.progress}%`
            : i18n._(STATUS_WORD[run.status])}
        </span>
      )}
    </div>
  )
}

export function QueueCard() {
  const { t } = useLingui()
  const queue = useQueueStatus()
  const activity = useRunActivity()
  // Only to put a name on a run's game; the rows stand without it.
  const games = useGames({ limit: LOOKUP })
  // Neither mutation has a panel of its own on this card — a row's only trace of the press
  // is the "queued" label going back to "retry", which said nothing at all if the retry
  // itself failed. A toast is the whole fix: there is nowhere here to put a red sentence.
  //
  // A failed run is retried by its id rather than re-POSTed: the retry keeps the run's own
  // engine, limit, window, lines and priority, which a row assembled from socket frames
  // does not all know — and a POST from here would turn an import pass into one somebody
  // asked for, jumping it ahead of the queue it came from.
  const retry = useRetryFailed({
    onError: (error) => toast.error(error.message),
    onSuccess: (receipt) => {
      if (receipt.queued === 0) toast.info(t`Nothing queued — that game has been analysed since.`)
    },
  })
  // A failed fill is retried as a fill: a retry by id would do the same, but the fill
  // endpoint is what knows to ask only for the levels still missing now.
  const refill = useMaiaFill({ onError: (error) => toast.error(error.message) })

  const queued = queue.data?.queued ?? 0
  const running = queue.data?.running ?? 0
  const outstanding = queued + running
  const workersOff = queue.data?.workers === false
  const destinations = queue.data?.destinations ?? []

  /** What a run is called when nothing knows the opponent — the id, and the word for it. */
  const gameLabel = (id: number) => t`Game #${id}`

  const names = new Map<number, string>(
    (games.data?.games ?? []).map((game) => [game.id, game.opponent ?? gameLabel(game.id)]),
  )
  const shown = activity.slice(0, ROWS)
  const hidden = Math.max(0, queued - shown.filter((run) => run.status === 'queued').length)

  const state = workersOff
    ? { label: t`workers idle`, tone: 'text-mistake', dot: 'bg-mistake' }
    : running > 0
      ? { label: t`running`, tone: 'text-accent-teal', dot: 'bg-accent-teal' }
      : { label: t`idle`, tone: 'text-dim-2', dot: 'bg-faint' }

  return (
    <section className="flex flex-none flex-col gap-2">
      <SectionHead
        title={t`Analysis queue`}
        detail={
          <span className={cn('inline-flex items-center gap-1.5', state.tone)}>
            <span className={cn('size-[0.3125rem] rounded-full', state.dot)} />
            {state.label}
          </span>
        }
        end={
          <span className="font-mono text-label tabular text-soft">
            {running}/{outstanding}
          </span>
        }
      />

      {queue.isError ? (
        <ErrorBlock
          error={queue.error}
          onRetry={() => void queue.refetch()}
          className="flex-none"
        />
      ) : queue.isPending ? (
        <Bar className="h-[0.1875rem] w-full" />
      ) : (
        <>
          <QueueMeter
            queued={queued}
            running={running}
            stopped={workersOff}
            className="h-[0.1875rem] w-full bg-track"
          />

          {destinations.length > 1 ? (
            <div className="border-t border-hairline pt-2">
              <QueueDestinations destinations={destinations} />
            </div>
          ) : null}

          {shown.length > 0 ? (
            <div className="flex flex-col gap-px">
              {shown.map((run) => (
                <RunRow
                  key={run.runId}
                  run={run}
                  label={
                    run.gameId === null
                      ? t`ad-hoc position`
                      : (names.get(run.gameId) ?? gameLabel(run.gameId))
                  }
                  retrying={run.maiaOnly ? refill.isPending : retry.isPending}
                  onRetry={() => {
                    if (run.gameId === null) return
                    if (run.maiaOnly) refill.mutate([run.gameId])
                    else retry.mutate([run.runId])
                  }}
                />
              ))}
              {hidden > 0 ? (
                <div className="px-1 py-1.5 text-label text-dim">
                  <Trans>+ {hidden} more queued</Trans>
                </div>
              ) : null}
            </div>
          ) : outstanding > 0 ? (
            <p className="text-label leading-relaxed text-dim">
              <Trans>
                {queued} queued and {running} running. Individual runs appear here as the
                socket reports them.
              </Trans>
            </p>
          ) : (
            <p className="text-label leading-relaxed text-dim">
              <Trans>
                Nothing outstanding.{' '}
                <Link to="/games" className="text-accent-teal hover:text-accent-link">
                  Pick a game
                </Link>{' '}
                to put something in.
              </Trans>
            </p>
          )}

          {workersOff ? (
            <p className="border-t border-hairline pt-2.5 text-label leading-relaxed text-mistake">
              <Trans>
                This process is not draining the queue. Runs will sit there until a worker
                picks them up.
              </Trans>
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}
