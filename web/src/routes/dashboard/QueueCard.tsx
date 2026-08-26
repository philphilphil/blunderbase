/**
 * Design 2a, "Analysis queue" — the counts from `/analysis/queue` over the per-run rows
 * the `/events` socket carries (see `useRunActivity`).
 */
import { Link } from 'react-router-dom'

import { useGames, useQueueStatus, useRequestAnalysis } from '@/lib/api/queries'
import type { RunStatus } from '@/lib/api/types'
import { TIER_STYLES } from '@/lib/chess/classification'
import { cn } from '@/lib/utils'

import { Bar, ErrorBlock } from '@/routes/stats/kit/states'

import { useRunActivity, type RunActivity } from './useRunActivity'

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
      <span className={cn('rounded-sm border px-1.5 py-px text-[0.59375rem]', style.chipClass)}>
        {run.tier}
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
  const retry = useRequestAnalysis()

  const queued = queue.data?.queued ?? 0
  const running = queue.data?.running ?? 0
  const outstanding = queued + running
  const workersOff = queue.data?.workers === false

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
    <section className="flex flex-none flex-col gap-[0.6875rem] rounded-xl border border-line bg-panel p-[0.8125rem]">
      <header className="flex items-center gap-2">
        <h2 className="text-xs font-semibold text-ink">Analysis queue</h2>
        <span className={cn('inline-flex items-center gap-1.5 text-[0.625rem]', state.tone)}>
          <span className={cn('size-[0.3125rem] rounded-full', state.dot)} />
          {state.label}
        </span>
        <div className="flex-1" />
        <span className="font-mono text-[0.6875rem] tabular text-soft">
          {running}/{outstanding}
        </span>
      </header>

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
          <div className="h-[0.1875rem] overflow-hidden rounded-sm bg-track">
            <div
              className={cn(
                'h-full transition-[width] duration-500',
                workersOff ? 'bg-mistake' : 'bg-accent-teal',
              )}
              style={{
                width: outstanding === 0 ? '0%' : `${(running / outstanding) * 100}%`,
              }}
            />
          </div>

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
                  retrying={retry.isPending}
                  onRetry={() => {
                    if (run.gameId !== null) {
                      retry.mutate({ game_id: run.gameId, tier: run.tier })
                    }
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
