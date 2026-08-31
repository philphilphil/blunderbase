import { Link } from 'react-router-dom'

import { Skeleton } from '@/components/ui/skeleton'
import { ApiError } from '@/lib/api/client'
import { cn } from '@/lib/utils'

/**
 * The geometry the page settles into, held while the payload is in flight — and below `md`
 * the phone's own instead.
 *
 * It models the *rebuilt* screen and has to keep doing so: the skeleton is the first frame
 * of the page, and any disagreement between the two is a visible jump the moment the game
 * lands. So the board column is `flex-1` and flush left (it is the column that takes the
 * spare width now), the right column is the sized one at the same per-band basis `GamePage`
 * gives it, and inside it the same four rows sit on the same two tracks — engine band, move
 * table beside the notes track, eval graph, footer — with the moves/notes rule in the same
 * place. The one thing not repeated here is the board's `100vh` cap: a square that is a
 * little too tall for a moment is not worth a second copy of that arithmetic.
 *
 * The right column's floor has to come *off* on a phone — 26.875rem is 516 physical pixels,
 * and holding it on a 375px screen would open the game with a sideways scrollbar and then
 * take it away again when the payload landed — so below `md` the whole grid is dropped and
 * one plain pane stands in for the tabbed one.
 */
export function GameViewSkeleton() {
  return (
    <div
      className="flex min-h-0 flex-1 max-md:flex-col max-md:overflow-y-auto"
      data-testid="game-skeleton"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3.5 overflow-hidden px-5 py-[1.125rem] xl:min-w-[26.25rem] max-md:px-3 max-md:py-3">
        {/* the one-line header, then a player row, the eval bar and board, the other
            player row, and the transport row — `BoardPanel`'s own order */}
        <Skeleton className="h-[1.875rem] w-full rounded-md" />
        <Skeleton className="h-6 w-64 rounded-md max-md:hidden" />
        <div className="flex gap-2.5">
          <Skeleton className="w-3.5 flex-none rounded-[0.1875rem]" />
          <Skeleton className="aspect-square min-w-0 flex-1 rounded-[0.1875rem]" />
        </div>
        <Skeleton className="h-6 w-64 rounded-md max-md:hidden" />
        <Skeleton className="h-7 w-full rounded-md" />
      </div>

      {/* the splitter's hairline, which is a control rather than a skeleton */}
      <div className="w-px flex-none bg-hairline max-md:hidden" />

      <div
        className={cn(
          'grid min-h-0 min-w-[26.875rem] grow-0 basis-[28rem] max-md:hidden',
          'grid-cols-[15.625rem_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto_auto]',
          'xl:min-w-[31.75rem] xl:basis-[36rem] xl:grid-cols-[18.75rem_minmax(0,1fr)]',
          'min-[100rem]:min-w-[35.25rem] min-[100rem]:basis-[40rem]',
          'min-[100rem]:grid-cols-[21.25rem_minmax(0,1fr)]',
        )}
      >
        {/* the engine band: two cards with a gap, spanning both tracks */}
        <div className="col-span-2 m-3 grid grid-cols-[minmax(9rem,1fr)_minmax(0,3fr)] gap-2.5">
          <Skeleton className="h-[7.5rem] rounded-xl" />
          <Skeleton className="h-[7.5rem] rounded-xl" />
        </div>

        <div className="flex min-h-0 flex-col border-r border-hairline">
          <div className="h-[2.375rem] flex-none border-b border-hairline" />
          <div className="flex flex-1 flex-col gap-1.5 p-3">
            {Array.from({ length: 10 }, (_, index) => (
              <Skeleton key={index} className="h-[1.625rem] rounded-[0.3125rem]" />
            ))}
          </div>
        </div>

        <div className="flex min-h-0 flex-col">
          <div className="h-[2.375rem] flex-none border-b border-hairline" />
          <div className="flex flex-1 flex-col gap-1.5 p-3">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-[1.625rem] rounded-[0.3125rem]" />
            ))}
          </div>
          {/* the composer's slot, `NotesTrack`'s own 9rem — it keeps that height whatever
              the pane above it is showing, which is the whole point of it */}
          <div className="h-[9rem] flex-none px-1.5 pt-1.5 pb-2">
            <Skeleton className="h-full rounded-md" />
          </div>
        </div>

        <Skeleton className="col-span-2 m-2.5 h-[9.375rem] rounded-lg xl:m-3 xl:h-[10.625rem]" />

        <div className="col-span-2 flex flex-none flex-col gap-1.5 border-t border-hairline p-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-[1.625rem] rounded-[0.3125rem]" />
        </div>
      </div>

      {/* below `md` there are no columns at all: the phone's pinned board over one pane */}
      <div className="hidden flex-col gap-1.5 px-3 pb-3 max-md:flex">
        <div className="h-[2.5rem] flex-none border-b border-hairline" />
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-[1.625rem] rounded-[0.3125rem]" />
        ))}
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
