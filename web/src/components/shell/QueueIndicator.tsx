import { Trans, useLingui } from '@lingui/react/macro'
import { ListX, Loader2, Pause, Play } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useClearQueue, useQueueStatus, useSetQueuePaused } from '@/lib/api/queries'
import { cn } from '@/lib/utils'

import { QueueDestinations } from './QueueDestinations'
import { QueueMeter } from './QueueMeter'

/**
 * The analysis queue as a readout at the right end of the titlebar: a state word, a meter
 * while there is work, and `running/total` in mono, with its two controls after it.
 *
 * In the titlebar, not the rail foot. The clarity pass moved it down beside the engines
 * ("what is the machine doing"), where the 200px foot had room for the figure and two
 * 20px icons and nothing else: the word went under the spinner, and a paused queue's Clear
 * was squeezed out of sight. Up here it has the width to say its state in words and to give
 * Pause and Clear full-size toolbar faces.
 *
 * Unboxed (the clarity pass): a readout has no face and no border, because nothing about it
 * is pressed — a bordered box made the number look like a field. The meter shows only while
 * work is running: idle, `Idle 0/0` is the whole story, and an empty trough beside a number
 * reads as a control (paused, the word says why nothing moves). Idle is `dim-2`, not
 * `faint`, which is under 4.5:1 on the panel. The word and the meter give way below `lg`:
 * the figure already says whether anything runs, and a tablet's bar has the page's actions
 * to fit as well.
 *
 * `/analysis/queue` reports queued and running counts, so the meter fills its whole width
 * with the outstanding work and splits it into running and waiting segments. It cannot be
 * an honest progress bar: the queue has no stable start or batch total, and new work may
 * arrive at any time.
 *
 * The tooltip carries the same sentence the `title` attribute used to, plus the
 * per-destination split when there is more than one place the work can go.
 *
 * Two controls sit beside it, the toolbar's `sm` tool buttons, shown only when they have
 * something to act on, in the order the queue is thought about: pause first, then Clear.
 * Pause is shown while there is something to pause *or* while the queue is already paused
 * — the second half is not optional, because pausing and then letting the last claimed run
 * finish would otherwise leave a paused queue with no button to resume it. Clear is shown
 * while anything is queued, paused or not. Paused is a state of the readout too: the word
 * says so, since a stopped queue that reads `Idle` is a queue the owner will wait on
 * forever.
 */
export function QueueIndicator({ className }: { className?: string }) {
  const { data } = useQueueStatus()
  const queued = data?.queued ?? 0
  const running = data?.running ?? 0
  const total = queued + running
  const paused = data?.paused ?? false
  const idle = total === 0 && !paused
  // Work outstanding and the queue not stopped: the one state that draws the meter.
  const working = total > 0 && !paused
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
    <div className={cn('flex flex-none items-center gap-1.5', className)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2 text-label">
            <span
              className={cn(
                'inline-flex items-center gap-1 max-lg:hidden',
                paused ? 'text-mistake' : idle ? 'text-dim-2' : 'text-soft',
              )}
            >
              {working ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
              {paused ? t`Paused` : idle ? t`Idle` : t`Analysing`}
            </span>
            {working ? (
              <QueueMeter
                queued={queued}
                running={running}
                stopped={paused || data?.workers === false}
                className="h-[0.1875rem] w-16 max-lg:hidden"
              />
            ) : null}
            <span className={cn('font-mono tabular', total === 0 ? 'text-dim-2' : 'text-ink')}>
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
 * Paused, the play glyph takes the warning colour the word beside it has — a stopped queue
 * rather than a neutral toggle, and findable in a titlebar the owner is not looking at.
 */
function PauseQueueButton({ paused }: { paused: boolean }) {
  const setPaused = useSetQueuePaused()
  const pending = setPaused.isPending
  const { t } = useLingui()
  const label = paused ? t`Resume the analysis queue` : t`Pause the analysis queue`

  return (
    <Button
      variant="secondary"
      size="icon-sm"
      data-testid="pause-queue"
      disabled={pending}
      aria-label={label}
      title={label}
      onClick={() => setPaused.mutate(!paused)}
      className={cn(paused && 'text-mistake')}
    >
      {/* The spinner is the icon's size: a narrower glyph mid-flight would jog the row. */}
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : paused ? (
        <Play className="size-3.5" aria-hidden />
      ) : (
        <Pause className="size-3.5" aria-hidden />
      )}
    </Button>
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
  // A tool button at rest; armed, the question with the count in it, red-outlined (the
  // toolbar's red command), since the second press cannot be taken back.
  return (
    <Button
      variant={armed ? 'destructive-outline' : 'secondary'}
      size="sm"
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
    >
      {pending ? (
        <Loader2 className="animate-spin" aria-hidden />
      ) : (
        <ListX aria-hidden />
      )}
      {armed ? t`Clear ${queued}?` : t`Clear`}
    </Button>
  )
}
