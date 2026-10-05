import { Trans } from '@lingui/react/macro'
import { Link } from 'react-router-dom'

import { Button, buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError } from '@/lib/api/client'
import { cn } from '@/lib/utils'

import { COMPOSER_REST } from './NoteComposer'

/** A pane's title strip, as every pane on the screen draws it (`paneTabs.TAB_ROW`'s box). */
const STRIP = 'h-[2.1875rem] flex-none border-b border-line bg-panel'

/**
 * The geometry the page settles into, held while the payload is in flight — and below `md`
 * the phone's own instead.
 *
 * It models the screen as it is built now and has to keep doing so: the skeleton is the
 * first frame of the page, and any disagreement between the two is a visible jump the moment
 * the game lands. So it draws what `GamePage` draws, in the same boxes: the header bar across
 * the whole workspace; the board flush left in a column sized to its board (the same
 * `100dvh` width and floors) with the moves column taking the rest; the splitter's rule; and
 * in the moves column one grid of panes bounded by rules rather than cards with gaps — the
 * engine band's two ruled cells, the move table with the composer's one-line field at its
 * foot beside the notes track, the eval graph — each under the 35-design-pixel title strip
 * it will have. Nothing here is rounded past a
 * control's radius, because nothing on the real screen is.
 *
 * The moves column's floor has to come *off* on a phone — 26.875rem is 516 physical pixels,
 * and holding it on a 375px screen would open the game with a sideways scrollbar and then
 * take it away again when the payload landed — so below `md` the whole grid is dropped and
 * one plain pane stands in for the tabbed one.
 */
export function GameViewSkeleton() {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col max-md:overflow-y-auto"
      data-testid="game-skeleton"
    >
      {/* the header bar, `GameHeaderBar`'s height and rule */}
      <div className="flex h-[2.625rem] flex-none items-center gap-2 border-b border-edge-strong bg-surface px-4 max-md:px-3">
        <Skeleton className="h-4 w-56 rounded-sm" />
      </div>

      <div className="flex min-h-0 flex-1 max-md:flex-none max-md:flex-col">
        {/* a player row, the eval bar and board, the other player row, and the control row
            — `BoardPanel`'s own order, at the board column's own padding. On a phone the
            board is the whole width and the player rows are not drawn. */}
        <div className="flex w-[calc(100dvh-9.5625rem)] max-w-full min-w-[24.5rem] shrink grow-0 flex-col gap-2.5 overflow-hidden px-3.5 py-2.5 xl:min-w-[26.25rem] max-md:w-auto max-md:min-w-0 max-md:px-3 max-md:py-3">
          <Skeleton className="h-6 w-48 rounded-sm max-md:hidden" />
          <div className="flex gap-1.5">
            <Skeleton className="w-3.5 flex-none rounded-sm" />
            <Skeleton className="aspect-square min-w-0 flex-1 rounded-sm" />
          </div>
          <Skeleton className="h-6 w-48 rounded-sm max-md:hidden" />
          <Skeleton className="h-7 w-full rounded-md" />
        </div>

        {/* the splitter's rule, which is a control rather than a skeleton */}
        <div className="flex flex-none justify-center px-[0.3125rem] max-md:hidden">
          <div className="w-px bg-edge-strong" />
        </div>

        <div
          className={cn(
            'grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto] max-md:hidden',
            // `GamePage`'s moves-column tracks and floors.
            'grid-cols-[15.625rem_minmax(0,1fr)] min-w-[26.875rem]',
            'min-[90rem]:min-w-[31.75rem] min-[90rem]:grid-cols-[18.75rem_minmax(0,1fr)]',
            'min-[100rem]:min-w-[35.25rem] min-[100rem]:grid-cols-[21.25rem_minmax(0,1fr)]',
          )}
        >
          {/* the engine band: Maia and Stockfish as two cells divided by a rule, spanning
              both tracks and ruled off from the table below */}
          <div className="col-span-2 grid grid-cols-[minmax(9rem,1fr)_minmax(0,3fr)] border-b border-edge-strong">
            {[0, 1].map((cell) => (
              <div
                key={cell}
                className={cn('flex flex-col', cell === 1 && 'border-l border-edge-strong')}
              >
                <div className={STRIP} />
                <div className="flex h-[6.5rem] flex-col gap-2 px-3 py-2.5">
                  {Array.from({ length: 3 }, (_, index) => (
                    <Skeleton key={index} className="h-4 rounded-sm" />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex min-h-0 flex-col border-r border-edge-strong">
            <div className={STRIP} />
            <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden px-1.5 py-1.5">
              {Array.from({ length: 10 }, (_, index) => (
                <Skeleton key={index} className="h-[1.625rem] flex-none rounded-sm" />
              ))}
            </div>
            {/* the composer's slot at the table's foot (`ComposerSlot`), with the one-line
                field it holds at rest */}
            <div className="h-[2.875rem] flex-none px-1.5 pt-1.5 pb-2">
              <Skeleton className={cn(COMPOSER_REST, 'rounded-md')} />
            </div>
          </div>

          <div className="flex min-h-0 flex-col">
            <div className={STRIP} />
            <div className="flex flex-1 flex-col gap-1 px-1.5 py-1.5">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-[1.625rem] rounded-sm" />
              ))}
            </div>
          </div>

          {/* the eval graph, at its own height under its own strip */}
          <div className="col-span-2 flex h-[11.5rem] flex-col border-t border-edge-strong xl:h-[12.75rem]">
            <div className={STRIP} />
            <Skeleton className="m-3 min-h-0 flex-1 rounded-sm" />
          </div>
        </div>
      </div>

      {/* below `md` there are no columns at all: the phone's pinned board over one pane */}
      <div className="hidden flex-col gap-1.5 px-3 pb-3 max-md:flex">
        <div className="h-[2.5rem] flex-none border-b border-hairline" />
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-[1.625rem] rounded-sm" />
        ))}
      </div>
    </div>
  )
}

/** A failed fetch, told apart from a game that simply is not there. */
export function GameLoadError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const missing = error instanceof ApiError && error.status === 404

  return (
    <div data-testid="game-error" className="flex min-h-0 flex-1 items-center justify-center p-10">
      <div className="flex max-w-md flex-col items-start gap-3 rounded-md border border-line bg-panel p-6">
        <span className="inline-flex items-center gap-2 text-lead font-semibold text-ink">
          <span className="size-[0.375rem] rounded-full bg-blunder" />
          {missing ? <Trans>No such game</Trans> : <Trans>Could not load this game</Trans>}
        </span>
        <p className="text-data leading-relaxed text-soft">
          {missing ? (
            <Trans>
              The id in the URL does not match a game in this database. It may have been removed, or
              the database may be a different one than when the link was made.
            </Trans>
          ) : (
            error.message
          )}
        </p>
        <div className="flex items-center gap-2 pt-1">
          <Link to="/games" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            <Trans>Back to the library</Trans>
          </Link>
          {missing ? null : (
            <Button type="button" size="sm" onClick={onRetry}>
              <Trans>Retry</Trans>
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
