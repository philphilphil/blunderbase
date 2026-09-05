import { useLingui } from '@lingui/react/macro'

import { cn } from '@/lib/utils'

/**
 * A composition meter, not a progress bar: the whole width is the outstanding queue,
 * split into work currently running and work still waiting to be claimed.
 */
export function QueueMeter({
  queued,
  running,
  stopped = false,
  className,
}: {
  queued: number
  running: number
  stopped?: boolean
  className?: string
}) {
  const total = queued + running
  const share = (count: number) => (total === 0 ? 0 : (count / total) * 100)
  const { t } = useLingui()

  return (
    <div
      role="img"
      aria-label={t`${running} running, ${queued} queued`}
      className={cn('flex overflow-hidden rounded-sm bg-edge', className)}
    >
      {running > 0 ? (
        <div
          className={cn(
            'h-full transition-[width] duration-500',
            stopped ? 'bg-mistake' : 'bg-accent-teal',
          )}
          style={{ width: `${share(running)}%` }}
        />
      ) : null}
      {queued > 0 ? (
        <div
          className={cn(
            'h-full transition-[width] duration-500',
            stopped ? 'bg-mistake/35' : 'bg-meter',
          )}
          style={{ width: `${share(queued)}%` }}
        />
      ) : null}
    </div>
  )
}
