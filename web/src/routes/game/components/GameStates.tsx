import { Link } from 'react-router-dom'

import { Skeleton } from '@/components/ui/skeleton'
import { ApiError } from '@/lib/api/client'

/** The three-column geometry, held while the payload is in flight (design 1c). */
export function GameViewSkeleton() {
  return (
    <div className="flex min-h-0 flex-1" data-testid="game-skeleton">
      <div className="flex shrink-[2] grow-0 basis-[32.75rem] flex-col gap-3.5 border-r border-hairline px-5 py-[1.125rem] min-w-[24rem]">
        <div className="flex items-start gap-2.5">
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-48" />
          </div>
          <Skeleton className="h-5 w-24" />
        </div>
        <div className="flex gap-2.5">
          <Skeleton className="w-3.5 flex-none rounded-[0.1875rem]" />
          <Skeleton className="aspect-square min-w-0 flex-1 rounded-[0.1875rem]" />
        </div>
        <Skeleton className="h-8 w-full rounded-md" />
        <Skeleton className="min-h-[6.875rem] flex-1 rounded-lg" />
      </div>

      <div className="flex min-w-[16rem] flex-1 flex-col border-r border-hairline">
        <div className="h-[2.375rem] flex-none border-b border-hairline" />
        <div className="flex flex-1 flex-col gap-1.5 p-3">
          {Array.from({ length: 12 }, (_, index) => (
            <Skeleton key={index} className="h-7 rounded-[0.3125rem]" />
          ))}
        </div>
        <div className="flex flex-none flex-col gap-1.5 border-t border-hairline p-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-[1.625rem] rounded-[0.3125rem]" />
          <Skeleton className="h-[1.625rem] rounded-[0.3125rem]" />
        </div>
      </div>

      <div className="flex w-[19.75rem] flex-none flex-col bg-panel">
        <div className="h-[2.375rem] flex-none border-b border-hairline" />
        <div className="flex flex-1 flex-col gap-3.5 p-3">
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-16 rounded-lg" />
        </div>
      </div>
    </div>
  )
}

/** A failed fetch, told apart from a game that simply is not there. */
export function GameLoadError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const missing = error instanceof ApiError && error.status === 404

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-10">
      <div className="flex max-w-md flex-col items-start gap-3 rounded-xl border border-line bg-panel p-6">
        <span className="inline-flex items-center gap-2 text-[0.8125rem] font-semibold text-ink">
          <span className="size-[0.375rem] rounded-full bg-blunder" />
          {missing ? 'No such game' : 'Could not load this game'}
        </span>
        <p className="text-[0.78125rem] leading-relaxed text-dim">
          {missing
            ? 'The id in the URL does not match a game in this database. It may have been removed, or the database may be a different one than when the link was made.'
            : error.message}
        </p>
        <div className="flex items-center gap-2 pt-1">
          <Link
            to="/games"
            className="rounded-md border border-edge bg-elevated px-2.5 py-1.5 text-xs text-soft hover:text-ink"
          >
            Back to the library
          </Link>
          {missing ? null : (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-md bg-accent-teal px-2.5 py-1.5 text-xs font-semibold text-accent-ink hover:bg-accent-hover"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
