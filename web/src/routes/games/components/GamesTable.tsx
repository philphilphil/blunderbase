/**
 * The table itself: the sticky column header, the body and the four states a body can be
 * in (loading, error, empty, rows) per design 1c.
 *
 * The body owns the scroll container rather than the page, which is what keeps the filter
 * bar above and the footer below pinned while one page of games is read. It is also what
 * lets the table say how many rows it has room for: `onCapacityChange` measures the
 * container against a rendered row, and the footer's "Fit" page size is that number.
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
  onDelete: (id: number) => void
  status: 'pending' | 'error' | 'success'
  error: Error | null
  onRetry: () => void
  /** True while another page is in flight and these rows are the previous one's. */
  busy?: boolean
  /** How many rows fit in the body right now, whenever that number changes. */
  onCapacityChange?: (rows: number) => void
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
  onDelete,
  status,
  error,
  onRetry,
  busy = false,
  onCapacityChange,
  empty,
}: GamesTableProps) {
  const body = useRef<HTMLDivElement>(null)
  const report = useRef(onCapacityChange)
  useEffect(() => {
    report.current = onCapacityChange
  })

  // What "as many rows as fit" means, measured rather than assumed: a row is 40px from
  // `md` up and a two-line card below it, and the app's scale moves both. The skeleton
  // rows carry the same marker, so the first measurement does not have to wait for data.
  useEffect(() => {
    const node = body.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const row = node.querySelector<HTMLElement>('[data-games-row]')
      const height = row?.offsetHeight || 0
      if (!height || !node.clientHeight) return
      report.current?.(Math.max(1, Math.floor(node.clientHeight / height)))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [games.length, status])

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
                  aria-label="Select every game on this page"
                  onClick={onToggleAll}
                  disabled={games.length === 0}
                  className={cn(
                    'size-[1.125rem] rounded-[0.1875rem] border transition-colors',
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

      <div
        ref={body}
        className={cn(
          'flex min-h-0 flex-1 flex-col overflow-y-auto transition-opacity',
          // The rows on screen belong to the page that is leaving; saying so is better
          // than blinking through a skeleton on every click of Next.
          busy && 'opacity-55',
        )}
      >
        {status === 'pending' ? (
          <LoadingRows />
        ) : status === 'error' ? (
          <ErrorState error={error} onRetry={onRetry} />
        ) : games.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-10 max-md:p-4">{empty}</div>
        ) : (
          games.map((game) => (
            <GameRow
              key={game.id}
              game={game}
              selected={selected.has(game.id)}
              onToggle={onToggle}
              onOpen={onOpen}
              onAnalyse={onAnalyse}
              onDelete={onDelete}
              analysing={analysing.has(game.id)}
            />
          ))
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
          data-games-row
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
