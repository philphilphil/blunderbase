import { TierBadge } from '@/components/badges/TierBadge'
import { Skeleton } from '@/components/ui/skeleton'
import type { TierStatusResponse } from '@/lib/api/types'
import { cn } from '@/lib/utils'

/**
 * What each analysis tier can actually do right now.
 *
 * `/engines/tiers` says in words why a tier cannot run, which is the whole point of the
 * endpoint: the alternative is a run that fails minutes later with the same sentence.
 */
export function TierStatus({
  tiers,
  isLoading,
  error,
}: {
  tiers: TierStatusResponse[] | undefined
  isLoading: boolean
  error: Error | null
}) {
  if (isLoading) {
    return (
      <div className="flex gap-2.5" data-testid="tiers-loading">
        <Skeleton className="h-12 flex-1" />
        <Skeleton className="h-12 flex-1" />
      </div>
    )
  }

  if (error) {
    return (
      <p className="rounded-lg border border-blunder/28 bg-blunder/5 px-3 py-2.5 text-[0.71875rem] text-blunder">
        Tier availability could not be read — {error.message}
      </p>
    )
  }

  if (!tiers || tiers.length === 0) return null

  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      {tiers.map((status) => (
        <div
          key={status.tier}
          className={cn(
            'flex items-center gap-2.5 rounded-lg border px-3 py-2.5',
            status.available ? 'border-line bg-panel' : 'border-mistake/28 bg-mistake/5',
          )}
        >
          <TierBadge tier={status.tier} />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[0.75rem] text-body">
              {status.engine_name ?? 'no engine'}
            </span>
            {status.available ? null : (
              <span className="truncate text-[0.6875rem] text-mistake" title={status.reason ?? ''}>
                {status.reason}
              </span>
            )}
          </div>
          <span
            className={cn(
              'size-[0.375rem] flex-none rounded-full',
              status.available ? 'bg-good' : 'bg-mistake',
            )}
            aria-label={status.available ? 'available' : 'unavailable'}
          />
        </div>
      ))}
    </div>
  )
}
