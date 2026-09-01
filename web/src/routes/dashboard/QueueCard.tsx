/**
 * Design 2a, "Analysis queue" — the counts from `/analysis/queue` over the per-run rows
 * the `/events` socket carries (see `useRunActivity`).
 */
import { Link } from 'react-router-dom'

import { QueueDestinations } from '@/components/shell/QueueDestinations'
import { QueueMeter } from '@/components/shell/QueueMeter'
import { SectionHead } from '@/components/shell/Section'
import { useGames, useMaiaFill, useQueueStatus, useRequestAnalysis } from '@/lib/api/queries'
import type { RunStatus } from '@/lib/api/types'
import { TIER_STYLES } from '@/lib/chess/classification'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

import { Bar, ErrorBlock } from '@/routes/stats/kit/states'

import { useRunActivity, type RunActivity } from './useRunActivity'

/**
 * What a row calls the work. A Maia fill is queued under the quick tier — for its engine
 * and for its place behind the deep passes — so the tier is where it was filed, not what
 * it did: it searches nothing and only asks the human-move model for the levels a game is
 * missing. Labelling one "quick" is how the card came to report a quick pass over a game
 * to an owner who had asked for the missing Maia levels and nothing else.
 */
const MAIA_CHIP = 'border-brilliant/40 bg-brilliant/10 text-brilliant'

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
  const style = TIER_STYLES[run.tier]
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-[0.3125rem] px-1 py-1.5',
        run.status === 'failed' ? 'bg-blunder/5' : 'hover:bg-raised',
      )}
    >
      <span className={cn('size-[0.3125rem] flex-none rounded-full', DOT[run.status])} />
      <span
        className={cn(
          'flex-1 truncate text-[0.71875rem]',
          run.status === 'queued' ? 'text-soft' : 'text-body',
        )}
      >
        {label}
      </span>
      <span
        title={run.maiaOnly ? 'the missing Maia levels only; nothing is searched' : undefined}
        className={cn(
          'rounded-sm border px-1.5 py-px text-[0.59375rem]',
          run.maiaOnly ? MAIA_CHIP : style.chipClass,
        )}
      >
        {run.maiaOnly ? 'maia' : run.tier}
      </span>
      {run.status === 'failed' ? (
        <>
          <span className="font-mono text-[0.65625rem] text-blunder" title={run.error ?? undefined}>
            failed
          </span>
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying || run.gameId === null}
            className="text-[0.65625rem] text-accent-teal hover:text-accent-link disabled:opacity-50"
          >
            {retrying ? 'queued' : 'retry'}
          </button>
        </>
      ) : (
        <span
          className={cn(
            'font-mono text-[0.65625rem] tabular',
            run.status === 'done'
              ? 'text-good'
              : run.status === 'running'
                ? 'text-soft'
                : 'text-dim-2',
          )}
        >
          {run.status === 'running'
            ? run.progress === null
              ? 'running'
              : `${run.progress}%`
            : run.status}
        </span>
      )}
    </div>
  )
}

export function QueueCard() {
  const queue = useQueueStatus()
  const activity = useRunActivity()
  // Only to put a name on a run's game; the rows stand without it.
  const games = useGames({ limit: LOOKUP })
  // Neither mutation has a panel of its own on this card — a row's only trace of the press
  // is the "queued" label going back to "retry", which said nothing at all if the retry
  // itself failed. A toast is the whole fix: there is nowhere here to put a red sentence.
  const retry = useRequestAnalysis({ onError: (error) => toast.error(error.message) })
  // A failed fill is retried as a fill: `retry` would queue a whole engine pass over a
  // game that has already had one, which is hours of search for the levels it is missing.
  const refill = useMaiaFill({ onError: (error) => toast.error(error.message) })

  const queued = queue.data?.queued ?? 0
  const running = queue.data?.running ?? 0
  const outstanding = queued + running
  const workersOff = queue.data?.workers === false
  const destinations = queue.data?.destinations ?? []

  const names = new Map<number, string>(
    (games.data?.games ?? []).map((game) => [game.id, game.opponent ?? `Game #${game.id}`]),
  )
  const shown = activity.slice(0, ROWS)
  const hidden = Math.max(0, queued - shown.filter((run) => run.status === 'queued').length)

  const state = workersOff
    ? { label: 'workers idle', tone: 'text-mistake', dot: 'bg-mistake' }
    : running > 0
      ? { label: 'running', tone: 'text-accent-teal', dot: 'bg-accent-teal' }
      : { label: 'idle', tone: 'text-dim-2', dot: 'bg-faint' }

  return (
    <section className="flex flex-none flex-col gap-2">
      <SectionHead
        title="Analysis queue"
        detail={
          <span className={cn('inline-flex items-center gap-1.5', state.tone)}>
            <span className={cn('size-[0.3125rem] rounded-full', state.dot)} />
            {state.label}
          </span>
        }
        end={
          <span className="font-mono text-[0.6875rem] tabular text-soft">
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
                      ? 'ad-hoc position'
                      : (names.get(run.gameId) ?? `Game #${run.gameId}`)
                  }
                  retrying={run.maiaOnly ? refill.isPending : retry.isPending}
                  onRetry={() => {
                    if (run.gameId === null) return
                    if (run.maiaOnly) refill.mutate([run.gameId])
                    else retry.mutate({ game_id: run.gameId, tier: run.tier })
                  }}
                />
              ))}
              {hidden > 0 ? (
                <div className="px-1 py-1.5 text-[0.6875rem] text-dim-2">+ {hidden} more queued</div>
              ) : null}
            </div>
          ) : outstanding > 0 ? (
            <p className="text-[0.6875rem] leading-relaxed text-dim-2">
              {queued} queued and {running} running. Individual runs appear here as the socket
              reports them.
            </p>
          ) : (
            <p className="text-[0.6875rem] leading-relaxed text-dim-2">
              Nothing outstanding.{' '}
              <Link to="/games" className="text-accent-teal hover:text-accent-link">
                Pick a game
              </Link>{' '}
              to put something in.
            </p>
          )}

          {workersOff ? (
            <p className="border-t border-hairline pt-2.5 text-[0.6875rem] leading-relaxed text-mistake">
              This process is not draining the queue. Runs will sit there until a worker picks them
              up.
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}
