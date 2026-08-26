import type { QueueDestination } from '@/lib/api/types'
import { cn } from '@/lib/utils'

/**
 * The backlog split by where it will actually be worked.
 *
 * The row that earns the endpoint is the last one: a runner with queued work and no link.
 * Nothing here will ever drain it — the local worker claims with every remote engine
 * excluded — and a queue that is stuck for that reason looks exactly like a queue that is
 * simply long unless it is said outright.
 *
 * With one destination there is nothing to split, so the whole block collapses: a
 * deployment with no runners sees precisely the UI it saw before.
 */
export function QueueDestinations({
  destinations,
  dense,
  className,
}: {
  destinations: QueueDestination[]
  /** For the titlebar tooltip: tighter rows, no header. */
  dense?: boolean
  className?: string
}) {
  if (destinations.length <= 1) return null

  return (
    <div className={cn('flex flex-col', dense ? 'gap-px' : 'gap-0.5', className)}>
      {destinations.map((destination) => {
        const stalled = !destination.connected && destination.queued > 0
        return (
          <div
            key={destination.runner_id ?? 'local'}
            title={
              stalled ? 'nothing will drain this until the machine connects' : undefined
            }
            className={cn(
              'flex items-center gap-2 rounded-[0.3125rem] px-1',
              dense ? 'py-0.5' : 'py-1',
              stalled ? 'bg-mistake/5' : null,
            )}
          >
            <span
              className={cn(
                'size-[0.3125rem] flex-none rounded-full',
                destination.connected ? 'bg-accent-teal' : 'bg-faint',
              )}
            />
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-[0.65625rem]',
                destination.destination === 'local' ? 'font-mono text-dim' : 'text-soft',
              )}
            >
              {destination.name}
            </span>
            <span className="flex-none font-mono text-[0.625rem] tabular text-dim-2">
              {destination.running}/{destination.slots ?? '—'}
            </span>
            <span
              className={cn(
                'w-10 flex-none text-right font-mono text-[0.625rem] tabular',
                stalled ? 'text-mistake' : 'text-dim-2',
              )}
            >
              {destination.queued} q
            </span>
          </div>
        )
      })}
    </div>
  )
}
