import { useQueueStatus } from '@/lib/api/queries'
import { cn } from '@/lib/utils'

/**
 * The titlebar queue widget from the design: a label, a 64×3 bar and `3/7` in mono.
 *
 * `/analysis/queue` reports queued and running counts, so "total" is the two added
 * together and "done" is what is no longer queued — the widget is about the work that is
 * outstanding right now, not about a run's history.
 */
export function QueueIndicator({ className }: { className?: string }) {
  const { data } = useQueueStatus()
  const queued = data?.queued ?? 0
  const running = data?.running ?? 0
  const total = queued + running
  const idle = total === 0

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border border-edge bg-elevated px-2.5 py-[0.3125rem]',
        className,
      )}
      title={
        data
          ? `${queued} queued, ${running} running${data.workers ? '' : ' — workers are not draining the queue'}`
          : 'analysis queue'
      }
    >
      <span className={cn('text-[0.6875rem]', idle ? 'text-dim-2' : 'text-soft')}>
        {idle ? 'Idle' : 'Analysing'}
      </span>
      <div className="h-[0.1875rem] w-16 overflow-hidden rounded-sm bg-edge">
        <div
          className={cn(
            'h-full transition-[width] duration-500',
            data?.workers === false ? 'bg-mistake' : 'bg-accent-teal',
          )}
          style={{ width: total === 0 ? '0%' : `${Math.round((running / total) * 100)}%` }}
        />
      </div>
      <span
        className={cn('font-mono text-[0.6875rem] tabular', idle ? 'text-faint' : 'text-ink')}
      >
        {running}/{total}
      </span>
    </div>
  )
}
