import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useClearQueue, useQueueStatus } from '@/lib/api/queries'
import { cn } from '@/lib/utils'

import { QueueDestinations } from './QueueDestinations'

/**
 * The titlebar queue widget from the design: a label, a 64×3 bar and `3/7` in mono.
 *
 * `/analysis/queue` reports queued and running counts, so "total" is the two added
 * together and "done" is what is no longer queued — the widget is about the work that is
 * outstanding right now, not about a run's history.
 *
 * The tooltip carries the same sentence the `title` attribute used to, plus the
 * per-destination split when there is more than one place the work can go.
 */
export function QueueIndicator({ className }: { className?: string }) {
  const { data } = useQueueStatus()
  const queued = data?.queued ?? 0
  const running = data?.running ?? 0
  const total = queued + running
  const idle = total === 0
  const destinations = data?.destinations ?? []

  const summary = data
    ? `${queued} queued, ${running} running${data.workers ? '' : ' — workers are not draining the queue'}`
    : 'analysis queue'

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
              className={cn('text-[0.6875rem] max-md:hidden', idle ? 'text-dim-2' : 'text-soft')}
            >
              {idle ? 'Idle' : 'Analysing'}
            </span>
            <div className="h-[0.1875rem] w-16 overflow-hidden rounded-sm bg-edge max-md:w-8">
              <div
                className={cn(
                  'h-full transition-[width] duration-500',
                  data?.workers === false ? 'bg-mistake' : 'bg-accent-teal',
                )}
                style={{ width: total === 0 ? '0%' : `${Math.round((running / total) * 100)}%` }}
              />
            </div>
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
          {queued > 0 ? (
            <p className="mt-1 text-faint">
              Clear drops what is still queued; a run already being worked finishes.
            </p>
          ) : null}
          <QueueDestinations destinations={destinations} dense className="mt-1.5" />
        </TooltipContent>
      </Tooltip>
      {queued > 0 ? <ClearQueueButton queued={queued} /> : null}
    </div>
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
      aria-label={armed ? `Clear ${queued} queued runs` : 'Clear the analysis queue'}
      title={armed ? undefined : 'Drop everything still queued'}
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
      {armed ? `Clear ${queued}?` : 'Clear'}
    </button>
  )
}
