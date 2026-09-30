/**
 * The table itself: the sticky column header, the body and the four states a body can be
 * in (loading, error, empty, rows) per design 1c.
 *
 * The body owns the scroll container rather than the page, which is what keeps the filter
 * bar above and the footer below pinned while one page of games is read. It is also what
 * lets the table say how many rows it has room for: `onCapacityChange` measures the
 * container against a rendered row, and the footer's "Fit" page size is that number.
 *
 * From `md` up the whole table (head and body together) scrolls sideways where its columns
 * do not fit, with a fade on the right edge while there is more, instead of clipping them:
 * at 1440 with the rail open the columns need more than the pane has, and the old table cut
 * Source mid-word and hid Analysis and Flags with nothing saying so. The heads follow the
 * control grammar: sortable ones are the table's `SortButton`, Analysis and Flags stay plain
 * dim caps, and the select-all box is the app's `Checkbox`, mixed while some rows are ticked.
 *
 * Below `md` the rows fold into cards (`GameRow`) and the header stops being a ruler over
 * them: it wraps into a strip of sort chips, one per column the card still shows. The
 * body keeps its own scroller there rather than handing the page one — it is the only
 * thing on the screen that scrolls, and the filter bar above and the selection footer
 * below are worth more pinned than scrolled past.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import { RotateCw } from 'lucide-react'
import type * as React from 'react'
import { useEffect, useRef } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { SortButton } from '@/components/ui/table'
import { useCollections } from '@/lib/api/queries'
import type { GameCard } from '@/lib/api/types'
import { useEngineHidden } from '@/lib/ui/engineVisibility'
import { isTyping } from '@/lib/ui/shortcuts'
import { useMoreRight } from '@/lib/ui/useMoreRight'
import { cn } from '@/lib/utils'

import { nextSort, type Sort } from '../sorting'
import {
  cellClass,
  cellStyle,
  columnsFor,
  PHONE_CARD,
  remWidth,
  ROW_HEIGHT,
  type Column,
} from './columns'
import { GameRow } from './GameRow'

/** The keys that move along the rows. Home and End reach past whatever has focus. */
const STEP_KEYS = ['ArrowDown', 'ArrowUp', 'Home', 'End']

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
  /** Games queued from this page since the cards were fetched, whose cards do not say so yet. */
  queued?: ReadonlySet<number>
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
  queued,
  onDelete,
  status,
  error,
  onRetry,
  busy = false,
  onCapacityChange,
  empty,
}: GamesTableProps) {
  const { t, i18n } = useLingui()
  // Whether the engine may speak here at all (⇧E). The table loses the `Worst` column with
  // it, and each row loses its flag badges — read once, at the top, so the header, the rows
  // and the skeleton are laid out from the same answer.
  const engineHidden = useEngineHidden()
  // No collections, no Collections column: an empty 160px strip down every row says nothing.
  const collectionsColumn = (useCollections().data?.collections?.length ?? 0) > 0
  const columns = columnsFor(engineHidden, collectionsColumn)
  const body = useRef<HTMLDivElement>(null)
  // Whether columns are still off to the right: the table scrolls sideways where they do
  // not fit, rather than cutting Source mid-word and leaving Analysis and Flags (with the
  // row's delete) off screen with nothing saying so.
  const {
    ref: frame,
    onScroll: measureOverflow,
    moreRight,
  } = useMoreRight<HTMLDivElement>(
    `${games.length}:${status}:${engineHidden}:${collectionsColumn}`,
  )
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
  // Some but not all: the head box says "mixed" (a minus), and a click selects the rest.
  const someSelected = !allSelected && games.some((game) => selected.has(game.id))

  /*
   * Arrow keys walk the rows, which is the one thing a table of a thousand games could not
   * do from the keyboard.
   *
   * It moves *focus* rather than keeping a highlight of its own: the rows are already
   * focusable and already open on Enter, so there is no second idea of "the current row" to
   * keep in step with the browser's, and tabbing in from the filter bar lands somewhere the
   * arrows then continue from.
   *
   * On `document` rather than on the body element, because the first press has to work
   * before anything in the table has focus — the reader arrives on the screen and presses
   * ↓. A field takes its own arrows, and a modifier makes them the browser's (⌘↑ is the top
   * of the document), so both are left alone. So is anything over the table — a popover
   * like Add to… or a modal like the collection dialog (`role="dialog"`, the convention
   * `useBoardKeys` stands down for): the dialog's colour swatches take the same keys, and
   * an arrow in either that moved focus to a game behind them would have Enter open it.
   */
  useEffect(() => {
    function walk(event: KeyboardEvent) {
      if (!STEP_KEYS.includes(event.key)) return
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      if (isTyping(event.target)) return
      if (event.target instanceof Element && event.target.closest('[role="dialog"]')) return
      if (document.querySelector('[aria-modal="true"]')) return
      const node = body.current
      if (!node) return
      const rows = Array.from(node.querySelectorAll<HTMLElement>('[data-games-row]'))
      if (rows.length === 0) return
      const last = rows.length - 1
      const here = rows.findIndex((row) => row.contains(event.target as Node))
      // Nothing focused yet — an arrow enters the list at the end it is coming from.
      const from = here === -1 ? (event.key === 'ArrowUp' ? rows.length : -1) : here
      const to =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? last
            : Math.min(last, Math.max(0, from + (event.key === 'ArrowDown' ? 1 : -1)))
      event.preventDefault()
      rows[to]?.focus()
    }
    document.addEventListener('keydown', walk)
    return () => document.removeEventListener('keydown', walk)
  }, [])

  return (
    <div
      ref={frame}
      role="table"
      aria-label={t`Games`}
      onScroll={measureOverflow}
      className={cn(
        'flex min-h-0 flex-1 flex-col md:overflow-x-auto md:*:min-w-max',
        // The fade on the right edge is the only sign there is more to the side: overlay
        // scrollbars show nothing at rest. It goes once the scroll reaches the end.
        moreRight &&
          'md:[mask-image:linear-gradient(to_right,black_calc(100%-3.5rem),transparent)]',
      )}
    >
      <div
        role="row"
        // The six chips and the checkbox measure ~260px of text; at `gap-x-3` the gaps
        // took the strip to 346px, which is exactly a 375px screen's content width, and
        // `Worst` fell off the end on its own. `gap-x-2` leaves about 30px in hand while
        // the padding stays at `px-3`, so the chips still line up with the cards below.
        className="flex h-[2.125rem] flex-none items-center gap-2.5 border-b border-hairline bg-panel px-5 text-meta font-medium tracking-[.06em] text-dim uppercase select-none max-md:h-auto max-md:flex-wrap max-md:gap-x-2 max-md:gap-y-1.5 max-md:px-3 max-md:py-2"
      >
        {columns.map((col) => {
          const active = col.sort === sort.key
          if (col.id === 'select') {
            return (
              <span key={col.id} style={cellStyle(col)} className={cn(cellClass(col), 'flex items-center')}>
                <Checkbox
                  checked={allSelected ? true : someSelected ? 'mixed' : false}
                  aria-label={t`Select every game on this page`}
                  onCheckedChange={() => onToggleAll()}
                  disabled={games.length === 0}
                />
              </span>
            )
          }
          return (
            <span
              key={col.id}
              role="columnheader"
              aria-sort={
                col.sort
                  ? active
                    ? sort.direction === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                  : undefined
              }
              style={cellStyle(col)}
              className={cn(
                cellClass(col),
                'flex items-center',
                // Only a sort earns a place in the phone's chip strip: `Flags` has none,
                // and a bare label there would read as a control that does nothing.
                !col.sort && 'max-md:hidden',
                col.align === 'right' && 'justify-end',
                col.align === 'center' && 'justify-center',
              )}
            >
              {col.sort ? (
                <SortButton
                  end={col.align === 'right'}
                  sorted={active ? sort.direction : false}
                  onSort={() => onSortChange(nextSort(sort, col.sort!))}
                  className={SORT_HEAD_FIT}
                >
                  {col.label ? i18n._(col.label) : null}
                </SortButton>
              ) : col.label ? (
                i18n._(col.label)
              ) : null}
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
          <LoadingRows columns={columns} />
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
              queued={game.queued === true || queued?.has(game.id) === true}
              engineHidden={engineHidden}
              collectionsColumn={collectionsColumn}
            />
          ))
        )}
      </div>
    </div>
  )
}

/**
 * The skeleton body: the same columns the rows will have, so the layout does not jump when
 * they land — and below `md` the same card grid, for the same reason. Which columns those
 * are is the caller's, since ⇧E takes one of them away.
 */
function LoadingRows({ columns, rows = 14 }: { columns: Column[]; rows?: number }) {
  return (
    <div aria-busy data-testid="games-loading">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          data-games-row
          style={{ opacity: 1 - index * (0.6 / rows) }}
          className={cn(
            'flex items-center gap-2.5 border-t border-hairline px-5',
            ROW_HEIGHT,
            PHONE_CARD,
            'max-md:gap-x-2 max-md:gap-y-1 max-md:px-3 max-md:py-2',
          )}
        >
          {columns.map((col) => (
            <span key={col.id} style={cellStyle(col)} className={cellClass(col)}>
              {col.id === 'select' ? null : (
                <Skeleton
                  className="h-[0.5625rem] rounded-sm"
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

/**
 * The query failed: the app's one error box (`.bb-error`), with the heading in the blunder
 * red and the backend's own message in body text, and the retry beside it as an ordinary
 * button rather than inside a card of its own.
 */
function ErrorState({ error, onRetry }: { error: Error | null; onRetry: () => void }) {
  const { t } = useLingui()
  return (
    <div className="flex flex-1 items-center justify-center p-10 max-md:p-4">
      <div className="flex max-w-md flex-col items-start gap-2.5">
        <div role="alert" className="bb-error">
          <span className="font-semibold text-blunder">
            <Trans>Could not load the library</Trans>
          </span>
          <p className="mt-1 leading-relaxed">{error?.message ?? t`The backend did not answer.`}</p>
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={onRetry}>
          <RotateCw aria-hidden />
          <Trans>Try again</Trans>
        </Button>
      </div>
    </div>
  )
}

/**
 * The sort head's geometry inside this grid's cells, which carry their own padding: the
 * table's one `SortButton` sized to its word, a small padding giving the hover a shape and
 * the negative margin keeping the word where the rows' text starts.
 */
const SORT_HEAD_FIT = '-mx-1.5 h-auto w-auto rounded-sm px-1.5 py-0.5'
