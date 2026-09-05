import { Trans, useLingui } from '@lingui/react/macro'
import { Loader2, Pause, Play } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useClearQueue, useQueueStatus, useSetQueuePaused } from '@/lib/api/queries'
import { cn } from '@/lib/utils'

import { QueueDestinations } from './QueueDestinations'
import { QueueMeter } from './QueueMeter'

/**
 * The titlebar queue widget from the design: a label, a 64×3 meter and `3/7` in mono.
 *
 * `/analysis/queue` reports queued and running counts, so the meter fills its whole width
 * with the outstanding work and splits it into running and waiting segments. It cannot be
 * an honest progress bar: the queue has no stable start or batch total, and new work may
 * arrive at any time.
 *
 * The tooltip carries the same sentence the `title` attribute used to, plus the
 * per-destination split when there is more than one place the work can go.
 *
 * Two controls sit beside it, in the order the queue is thought about: pause first, then
 * Clear. Pause is shown while there is something to pause *or* while the queue is already
 * paused — the second half is not optional, because pausing and then letting the last
 * claimed run finish would otherwise leave a paused queue with no button to resume it.
 * Paused is a state of the widget too: the label says so, since a stopped queue that reads
 * `Idle` is a queue the owner will wait on forever.
 */
export function QueueIndicator({ className }: { className?: string }) {
  const { data } = useQueueStatus()
  const queued = data?.queued ?? 0
  const running = data?.running ?? 0
  const total = queued + running
  const paused = data?.paused ?? false
  const idle = total === 0 && !paused
  const destinations = data?.destinations ?? []
  const { t } = useLingui()

  // Whole sentences rather than a stem with a clause appended: what is bolted on in
  // English is a different word order elsewhere.
  const summary = paused
    ? t`${queued} queued, ${running} running — the queue is paused`
    : !data
      ? t`analysis queue`
      : data.workers
        ? t`${queued} queued, ${running} running`
        : t`${queued} queued, ${running} running — workers are not draining the queue`

  return (
    <div className="flex items-center gap-1.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              'flex items-center gap-2 rounded-md border border-edge bg-elevated px-2.5 py-[0.3125rem]',
              className,
            )}
          >
            {/*
              The word and the full-width bar are the first things to go on a phone: the
              `3/7` beside them already says whether anything is running, and the titlebar
              has four other things to fit into 375px.
            */}
            <span
              className={cn(
                'text-[0.6875rem] max-md:hidden',
                paused ? 'text-mistake' : idle ? 'text-dim-2' : 'text-soft',
              )}
            >
              {paused ? t`Paused` : idle ? t`Idle` : t`Analysing`}
            </span>
            <QueueMeter
              queued={queued}
              running={running}
              stopped={paused || data?.workers === false}
              className="h-[0.1875rem] w-16 max-md:w-8"
            />
            <span
              className={cn(
                'font-mono text-[0.6875rem] tabular',
                idle ? 'text-faint' : 'text-ink',
              )}
            >
              {running}/{total}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-[15rem]">
          <p>{summary}</p>
          {paused ? (
            <p className="mt-1 text-faint">
              <Trans>
                Nothing new is claimed while it is paused; a run already started finishes.
              </Trans>
            </p>
          ) : null}
          {queued > 0 ? (
            <p className="mt-1 text-faint">
              <Trans>
                Clear drops what is still queued; a run already being worked finishes.
              </Trans>
            </p>
          ) : null}
          <QueueDestinations destinations={destinations} dense className="mt-1.5" />
        </TooltipContent>
      </Tooltip>
      {/*
        Shown while there is something to pause, and while it is already paused: without
        the second half, letting the last claimed run finish would strand a paused queue
        with no way back. Before Clear, so the queue's two controls read stop-then-empty.
      */}
      {total > 0 || paused ? <PauseQueueButton paused={paused} /> : null}
      {queued > 0 ? <ClearQueueButton queued={queued} /> : null}
    </div>
  )
}

/**
 * Stop the queue where it is, and start it again. One click each way, no arming: pausing
 * is undone by the next press, which is the whole difference between this and Clear.
 *
 * The paused state carries the same warning colour the bar takes when nothing is draining
 * the queue — it is a stopped queue rather than a neutral toggle, and it has to be findable
 * in a titlebar the owner is not looking at.
 */
function PauseQueueButton({ paused }: { paused: boolean }) {
  const setPaused = useSetQueuePaused()
  const pending = setPaused.isPending
  const { t } = useLingui()
  const label = paused ? t`Resume the analysis queue` : t`Pause the analysis queue`

  return (
    <button
      type="button"
      data-testid="pause-queue"
      disabled={pending}
      aria-label={label}
      title={label}
      onClick={() => setPaused.mutate(!paused)}
      className={cn(
        'flex items-center rounded-md border px-2.5 py-[0.3125rem] transition-colors disabled:opacity-60',
        paused
          ? 'border-mistake/40 bg-mistake/10 text-mistake hover:bg-mistake/20'
          : 'border-edge text-dim hover:border-edge-hover hover:text-ink',
      )}
    >
      {/* The spinner is the icon's size, not the Clear button's: this one is icon-only,
          and a narrower glyph mid-flight would jog the row it sits in. */}
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : paused ? (
        <Play className="size-3.5" aria-hidden />
      ) : (
        <Pause className="size-3.5" aria-hidden />
      )}
    </button>
  )
}

/** How long the armed "Clear 825?" waits for its second click before standing down. */
const ARMED_MS = 4000

/**
 * The undo for a queue built up by mistake — eight hundred Maia-fill runs from one press.
 * Two clicks, no dialog: the first turns the button into the question with the count in it,
 * the second drops everything still queued. Left alone, it stands down by itself.
 */
function ClearQueueButton({ queued }: { queued: number }) {
  const [armed, setArmed] = useState(false)
  const clear = useClearQueue({ onSettled: () => setArmed(false) })
  const { t } = useLingui()

  useEffect(() => {
    if (!armed) return
    const timer = window.setTimeout(() => setArmed(false), ARMED_MS)
    return () => window.clearTimeout(timer)
  }, [armed])

  const pending = clear.isPending
  return (
    <button
      type="button"
      data-testid="clear-queue"
      disabled={pending}
      aria-label={armed ? t`Clear ${queued} queued runs` : t`Clear the analysis queue`}
      title={armed ? undefined : t`Drop everything still queued`}
      onClick={() => {
        if (!armed) {
          setArmed(true)
          return
        }
        clear.mutate()
      }}
      className={cn(
        'flex items-center gap-1 rounded-md border px-2.5 py-[0.3125rem] font-mono text-[0.6875rem] transition-colors disabled:opacity-60',
        armed
          ? 'border-blunder/40 bg-blunder/10 text-blunder hover:bg-blunder/20'
          : 'border-edge text-dim hover:border-edge-hover hover:text-ink',
      )}
    >
      {pending ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
      {armed ? t`Clear ${queued}?` : t`Clear`}
    </button>
  )
}
