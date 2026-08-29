/**
 * The table itself: the sticky column header, the scrolling body and the four states a
 * body can be in (loading, error, empty, rows) per design 1c.
 *
 * The next page is fetched by an `IntersectionObserver` on a sentinel below the last row,
 * which is why the body owns the scroll container rather than the page.
 *
 * Below `md` the rows fold into cards (`GameRow`) and the header stops being a ruler over
 * them: it wraps into a strip of sort chips, one per column the card still shows. The
 * body keeps its own scroller there rather than handing the page one — it is the only
 * thing on the screen that scrolls, and the filter bar above and the selection footer
 * below are worth more pinned than scrolled past.
 */
import type * as React from 'react'
import { useEffect, useRef } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import type { GameCard } from '@/lib/api/types'
import { cn } from '@/lib/utils'

import { nextSort, type Sort } from '../sorting'
import { cellClass, cellStyle, COLUMNS, PHONE_CARD, remWidth, ROW_HEIGHT } from './columns'
import { GameRow } from './GameRow'

export interface GamesTableProps {
  games: GameCard[]
  sort: Sort
  onSortChange: (next: Sort) => void
  selected: Set<number>
  onToggle: (id: number, event: React.MouseEvent) => void
  onToggleAll: () => void
  onOpen: (id: number) => void
  onAnalyse: (id: number) => void
  analysing: Set<number>
  status: 'pending' | 'error' | 'success'
  error: Error | null
  onRetry: () => void
  hasNextPage: boolean
  isFetchingNextPage: boolean
  onLoadMore: () => void
  /** Rendered in place of the rows when the query succeeded with nothing in it. */
  empty: React.ReactNode
}

export function GamesTable({
  games,
  sort,
  onSortChange,
  selected,
  onToggle,
  onToggleAll,
  onOpen,
  onAnalyse,
  analysing,
  status,
  error,
  onRetry,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  empty,
}: GamesTableProps) {
  const sentinel = useRef<HTMLDivElement>(null)
  const loadMore = useRef(onLoadMore)
  // The observer stays connected while a page is in flight, so the sentinel scrolling out
  // and back in would call `fetchNextPage` again — and TanStack's default `cancelRefetch`
  // aborts the request already running and starts it over. The guard the "Load more"
  // button gets from being hidden, the observer has to make for itself.
  const fetching = useRef(isFetchingNextPage)
  useEffect(() => {
    loadMore.current = onLoadMore
    fetching.current = isFetchingNextPage
  })

  useEffect(() => {
    const node = sentinel.current
    // jsdom has no IntersectionObserver; the footer's "load more" button is the fallback
    // there and for anyone scrolling with the keyboard.
    if (!node || !hasNextPage || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (fetching.current) return
        if (entries.some((entry) => entry.isIntersecting)) loadMore.current()
      },
      { rootMargin: '400px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasNextPage, games.length])

  const allSelected = games.length > 0 && games.every((game) => selected.has(game.id))

  return (
    <div className="flex min-h-0 flex-1 flex-col" role="table" aria-label="Games">
      <div
        role="row"
        // The six chips and the checkbox measure ~260px of text; at `gap-x-3` the gaps
        // took the strip to 346px, which is exactly a 375px screen's content width, and
        // `Worst` fell off the end on its own. `gap-x-2` leaves about 30px in hand while
        // the padding stays at `px-3`, so the chips still line up with the cards below.
        className="flex h-[2.125rem] flex-none items-center gap-2.5 border-b border-hairline bg-panel px-5 text-[0.65625rem] tracking-[.06em] text-dim-2 uppercase max-md:h-auto max-md:flex-wrap max-md:gap-x-2 max-md:gap-y-1.5 max-md:px-3 max-md:py-2"
      >
        {COLUMNS.map((col) => {
          const active = col.sort === sort.key
          const arrow = active ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ''
          if (col.id === 'select') {
            return (
              <span key={col.id} style={cellStyle(col)} className={cn(cellClass(col), 'flex items-center')}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={allSelected}
                  aria-label="Select every loaded game"
                  onClick={onToggleAll}
                  disabled={games.length === 0}
                  className={cn(
                    'size-[0.6875rem] rounded-[0.1875rem] border transition-colors max-md:size-[1.125rem]',
                    allSelected
                      ? 'border-accent-teal bg-accent-teal'
                      : 'border-edge-strong hover:border-edge-hover',
                  )}
                />
              </span>
            )
          }
          return (
            <span
              key={col.id}
              style={cellStyle(col)}
              className={cn(
                cellClass(col),
                // Only a sort earns a place in the phone's chip strip: `Flags` has none,
                // and a bare label there would read as a control that does nothing.
                !col.sort && 'max-md:hidden',
                col.align === 'right' && 'text-right',
                col.align === 'center' && 'text-center',
              )}
            >
              {col.sort ? (
                <button
                  type="button"
                  onClick={() => onSortChange(nextSort(sort, col.sort!))}
                  aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className={cn(
                    'uppercase transition-colors hover:text-ink',
                    active ? 'text-soft' : 'text-dim-2',
                  )}
                >
                  {col.label}
                  {arrow}
                </button>
              ) : (
                col.label
              )}
            </span>
          )
        })}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {status === 'pending' ? (
          <LoadingRows />
        ) : status === 'error' ? (
          <ErrorState error={error} onRetry={onRetry} />
        ) : games.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-10 max-md:p-4">{empty}</div>
        ) : (
          <>
            {games.map((game) => (
              <GameRow
                key={game.id}
                game={game}
                selected={selected.has(game.id)}
                onToggle={onToggle}
                onOpen={onOpen}
                onAnalyse={onAnalyse}
                analysing={analysing.has(game.id)}
              />
            ))}
            <div ref={sentinel} className="h-px flex-none" aria-hidden />
            {isFetchingNextPage ? <LoadingRows rows={4} /> : null}
            {hasNextPage && !isFetchingNextPage ? (
              <button
                type="button"
                onClick={onLoadMore}
                className="flex-none border-t border-raised py-3 text-[0.71875rem] text-accent-teal hover:text-accent-link"
              >
                Load more
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * The skeleton body: the same 13 columns, so the layout does not jump when rows land — and
 * below `md` the same card grid, for the same reason.
 */
function LoadingRows({ rows = 14 }: { rows?: number }) {
  return (
    <div aria-busy data-testid="games-loading">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          style={{ opacity: 1 - index * (0.6 / rows) }}
          className={cn(
            'flex items-center gap-2.5 border-t border-raised px-5',
            ROW_HEIGHT,
            PHONE_CARD,
            'max-md:gap-x-2 max-md:gap-y-1 max-md:px-3 max-md:py-2',
          )}
        >
          {COLUMNS.map((col) => (
            <span key={col.id} style={cellStyle(col)} className={cellClass(col)}>
              {col.id === 'select' ? null : (
                <Skeleton
                  className="h-[0.5625rem] rounded-[0.1875rem]"
                  style={{ width: col.width === 'flex' ? '30%' : remWidth(Math.min(Number(col.width), 90)) }}
                />
              )}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}

function ErrorState({ error, onRetry }: { error: Error | null; onRetry: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center p-10 max-md:p-4">
      <div className="flex max-w-md flex-col items-start gap-2.5 rounded-xl border border-blunder/28 bg-blunder/5 p-5">
        <span className="text-[0.75rem] font-semibold text-blunder">Could not load the library</span>
        <p className="text-[0.78125rem] leading-relaxed text-soft">
          {error?.message ?? 'The backend did not answer.'}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-edge-input px-2.5 py-1 text-[0.71875rem] text-soft hover:border-edge-hover hover:text-ink"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
