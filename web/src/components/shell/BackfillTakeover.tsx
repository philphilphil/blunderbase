import { Loader2, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useCancelBackfill, useQueueStatus } from '@/lib/api/queries'
import { clearBackfillRun, formatDuration, type BackfillRun } from '@/lib/analysis'
import { formatCount } from '@/routes/games/format'

/**
 * What the app is while a whole-library analysis pass runs: this screen, and nothing else.
 *
 * `AppShell` renders it *instead of* the shell rather than over it, which is the point in
 * two ways. The owner asked for a mode they cannot wander out of — the nav, the library
 * and the board are all gone, not merely covered. And a pass over ten thousand games is
 * ten thousand `analysis.done` frames, each one invalidating the games keys: with the
 * pages unmounted those invalidations have no observer to refetch for, so the hours this
 * runs cost one poll of `/analysis/queue` rather than a night of refetch storms.
 *
 * Progress is read off that queue: `done` is the run's own total minus what is still
 * outstanding. The queue counts every tier, so another pass queued alongside this one
 * would hold the bar back — during a backfill it is this pass by a factor of thousands,
 * and a number that only ever understates progress is the safe way to be wrong.
 */

/** Frequent enough to feel alive, slow enough to run all night — the socket does the rest. */
const POLL_MS = 5_000
/** Below these the observed rate is noise, and a wild guess is worse than no guess. */
const ETA_MIN_DONE = 12
const ETA_MIN_ELAPSED_MS = 45_000
/** Long enough to read "done", short enough not to be in the way at 3am. */
const FINISHED_HOLD_MS = 2_500
/** The ETA is quoted in minutes; a slower clock than this would visibly stall. */
const CLOCK_MS = 10_000

export function BackfillTakeover({ run }: { run: BackfillRun }) {
  const queue = useQueueStatus({ refetchInterval: POLL_MS })
  const cancel = useCancelBackfill()
  const [confirming, setConfirming] = useState(false)
  const [sawWork, setSawWork] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  // A reading taken before the pass began says nothing about it: the POST queues the runs
  // in its own transaction, so only a fetch that resolved afterwards can be believed.
  const known = queue.dataUpdatedAt > run.startedAt
  const running = queue.data?.running ?? 0
  const outstanding = (queue.data?.queued ?? 0) + running
  const done = known ? Math.min(Math.max(run.total - outstanding, 0), run.total) : 0
  const drained = known && outstanding === 0

  // A latch, not a derivation: an empty queue means two different things depending on
  // whether this takeover ever saw the pass working, and only the takeover remembers.
  if (known && outstanding > 0 && !sawWork) setSawWork(true)

  useEffect(() => {
    if (!drained) return
    // Nothing outstanding on the first look means the pass this record describes ended
    // while the tab was closed: release without a finish nobody was waiting for.
    const timer = setTimeout(clearBackfillRun, sawWork ? FINISHED_HOLD_MS : 0)
    return () => clearTimeout(timer)
  }, [drained, sawWork])

  useEffect(() => {
    if (drained) return
    const timer = setInterval(() => setNow(Date.now()), CLOCK_MS)
    return () => clearInterval(timer)
  }, [drained])

  if (drained && !sawWork) return null

  const elapsed = now - run.startedAt
  // The rate this pass has actually managed, not a guess about engines: how long the games
  // behind us took is the only honest evidence about the ones ahead.
  const remaining =
    done >= ETA_MIN_DONE && done < run.total && elapsed >= ETA_MIN_ELAPSED_MS
      ? formatDuration(((run.total - done) * elapsed) / done / 1000)
      : null

  const stalled = queue.data?.workers === false

  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center bg-void px-6">
      <section
        aria-labelledby="backfill-title"
        className="flex w-full max-w-[27rem] flex-col gap-7"
      >
        <header className="flex flex-col gap-2">
          <h1
            id="backfill-title"
            className="text-[1.0625rem] font-semibold tracking-[-0.01em] text-ink"
          >
            {drained ? 'Your library is analysed' : 'Analysing your library'}
          </h1>
          <p className="text-[0.78125rem] leading-relaxed text-dim">
            {drained
              ? `${formatCount(run.total)} ${run.total === 1 ? 'game has' : 'games have'} been through a ${run.tier} pass. Handing the app back.`
              : `A ${run.tier} pass over every game that had not had one. It runs for hours — leave the tab open and come back to it.`}
          </p>
        </header>

        <div className="flex items-center gap-5">
          <Progress
            value={done}
            max={run.total}
            className="h-[0.375rem] flex-1"
            barClassName={stalled ? 'bg-mistake' : undefined}
          />
          <div className="flex flex-none flex-col items-end gap-1">
            <span className="font-mono text-[1.375rem] leading-none tabular text-ink">
              {known ? formatCount(done) : '—'}
            </span>
            <span className="font-mono text-[0.71875rem] leading-none tabular text-dim-2">
              of {formatCount(run.total)}
            </span>
          </div>
        </div>

        <p className="min-h-4 text-[0.71875rem] text-dim">
          {!known
            ? 'Reading the queue…'
            : drained
              ? null
              : [remaining ? `~${remaining} remaining` : null, `${running} running`]
                  .filter(Boolean)
                  .join(' · ')}
        </p>

        {stalled ? (
          <p className="flex items-start gap-2 text-[0.71875rem] leading-relaxed text-mistake">
            <TriangleAlert className="mt-px size-3.5 flex-none" aria-hidden />
            Nothing is draining the queue — the backend has no workers running, so the pass
            will not move until it does.
          </p>
        ) : null}

        {drained ? null : confirming ? (
          <div className="flex flex-col gap-3">
            <p className="text-[0.75rem] leading-relaxed text-body-3">
              {running > 0
                ? `The ${formatCount(running)} ${running === 1 ? 'game' : 'games'} already on an engine will finish. Everything still queued is dropped.`
                : 'Everything still queued is dropped. Nothing is lost — the games keep the analysis they already have.'}
            </p>
            {cancel.isError ? (
              <p className="text-[0.71875rem] leading-relaxed text-blunder">
                {cancel.error.message} — the pass is still queued.{' '}
                <button
                  type="button"
                  onClick={clearBackfillRun}
                  className="text-accent-teal underline-offset-2 hover:underline"
                >
                  Leave it running and go back to the app
                </button>
                .
              </p>
            ) : null}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="destructive"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate(run.tier, { onSuccess: clearBackfillRun })}
              >
                {cancel.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Stop the queued runs
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={cancel.isPending}
                onClick={() => {
                  cancel.reset()
                  setConfirming(false)
                }}
              >
                Keep going
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button type="button" variant="outline" onClick={() => setConfirming(true)}>
              Cancel
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}
