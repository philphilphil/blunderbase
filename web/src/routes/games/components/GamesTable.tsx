/**
 * The table itself: the sticky column header, the body and the four states a body can be
 * in (loading, error, empty, rows) per design 1c.
 *
 * The table owns its scroll container rather than the page, which is what keeps the filter
 * bar above and the footer below pinned while one page of games is read. It is also what
 * lets the table say how many rows it has room for: `onCapacityChange` measures the
 * container, less the header, against a rendered row, and the footer's "Fit" page size is
 * that number.
 *
 * From `md` up the table is one CSS grid and every row is a subgrid of it, so each column
 * is a single track sized to its widest cell on the page, header included (`columns.ts`
 * says how wide, `tracksFor` how the tracks share the pane), and the header and the rows
 * line up because they are laid out together rather than given the same fixed widths.
 * There is one scroller for both axes, with the header `sticky` inside it: a header in a
 * scroller of its own would need its sideways scroll kept in step by hand. Where the
 * columns do not fit, the whole table scrolls sideways with a fade on the right edge while
 * there is more, instead of clipping them. The heads follow the control grammar: sortable
 * ones are the table's `SortButton`, Analysis and Flags stay plain dim caps, and the
 * select-all box is the app's `Checkbox`, mixed while some rows are ticked. Which columns
 * there are, and in what order, is the owner's choice (`useGameColumns`); a column they hid
 * has no head and no track, and the last one shown takes the spare width and the row's bin.
 *
 * Two rules keep the subgrid honest. Nothing between the scroller and a cell has
 * `overflow` set: a subgrid that is also a scroll container falls out of line with its
 * parent in WebKit after a relayout. And every wrapper between the body and its rows (the
 * skeleton's) is a subgrid level of its own, or it would be one grid item in the first
 * track with every row squeezed inside it.
 *
 * Below `md` the rows fold into cards (`GameRow`) and the header stops being a ruler over
 * them: it wraps into a strip of sort chips, one per column shown from md up that the card
 * also has, and the grid is a plain column of them. The table keeps its own scroller there too rather than
 * handing the page one — it is the only thing on the screen that scrolls, and the filter
 * bar above and the selection footer below are worth more pinned than scrolled past.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import { RotateCw } from 'lucide-react'
import type * as React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { SortButton } from '@/components/ui/table'
import { useCollections } from '@/lib/api/queries'
import type { GameCard } from '@/lib/api/types'
import { isTyping } from '@/lib/ui/shortcuts'
import { FADE_RIGHT_MD, useMoreRight } from '@/lib/ui/useMoreRight'
import { cn } from '@/lib/utils'

import { nextSort, type Sort } from '../sorting'
import { useGameColumns } from '../useGameColumns'
import {
  cellClass,
  PHONE_CARD,
  ROW_HEIGHT,
  ROW_SUBGRID,
  tracksFor,
  type LaidColumn,
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
  const { t, i18n } = useLingui()
  // The owner's arrangement of the columns, less what the engine being hidden (⇧E) and an
  // empty collections list take away — read once, at the top, so the header, the rows and
  // the skeleton are laid out from the same answer, and from the same one the page picks
  // its sort by (`useGameColumns`).
  const { columns, engineHidden } = useGameColumns()
  const collections = useCollections().data?.collections
  // Every row's Collections cell reads its names from here, so a page of rows is one walk
  // of the list and one subscription to it rather than one per row in a collection.
  const collectionNames = useMemo(
    () => new Map((collections ?? []).map((collection) => [collection.id, collection.name])),
    [collections],
  )
  const tracks = useMemo(() => tracksFor(columns), [columns])
  const head = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  // Whether columns are still off to the right: the table scrolls sideways where they do
  // not fit, rather than cutting Source mid-word and leaving Analysis and Flags (with the
  // row's delete) off screen with nothing saying so. It watches the header as well as the
  // frame, because the header spans every track: the tracks follow the page's content, so
  // the table can widen or narrow while the frame and the full-width grid stay as they are.
  const {
    ref: frame,
    onScroll: measureOverflow,
    moreRight,
  } = useMoreRight<HTMLDivElement>(`${games.length}:${status}:${tracks}`, head)
  const report = useRef(onCapacityChange)
  useEffect(() => {
    report.current = onCapacityChange
  })
  // The header's height, as the scroller's top scroll padding (below).
  const [scrollPad, setScrollPad] = useState(0)

  // What "as many rows as fit" means, measured rather than assumed: a row is 40px from
  // `md` up and a two-line card below it, and the app's scale moves both. The header sits
  // inside the scroller, so its height comes off the room first. The skeleton rows carry
  // the same marker, so the first measurement does not have to wait for data.
  //
  // The same measurement sets the scroller's top scroll padding to the header's height, so
  // a row the arrow keys bring into view lands below the sticky header rather than under
  // it. Measured, not assumed: the phone's chip strip wraps to as many lines as it needs.
  useEffect(() => {
    const node = frame.current
    const header = head.current
    if (!node || !header || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const headHeight = header.offsetHeight
      setScrollPad(headHeight)
      const row = body.current?.querySelector<HTMLElement>('[data-games-row]')
      const height = row?.offsetHeight || 0
      if (!height || !node.clientHeight) return
      report.current?.(Math.max(1, Math.floor((node.clientHeight - headHeight) / height)))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    observer.observe(header)
    return () => observer.disconnect()
  }, [frame, games.length, status])

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

  // The empty and error states are one box filling the body; rows and the skeleton stack
  // from the top.
  const state = status === 'error' || (status === 'success' && games.length === 0)

  return (
    <div
      ref={frame}
      role="table"
      aria-label={t`Games`}
      onScroll={measureOverflow}
      style={{ scrollPaddingTop: scrollPad }}
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-auto',
        // The fade on the right edge is the only sign there is more to the side: overlay
        // scrollbars show nothing at rest. It goes once the scroll reaches the end.
        moreRight && FADE_RIGHT_MD,
      )}
    >
      <div
        // The tracks are inline because they follow the column list; a phone, where this
        // is a flex column of cards, ignores them. Full width, so the last track takes the
        // pane's spare room (`tracksFor`); past the tracks' floors the grid overflows the
        // scroller and the table scrolls sideways. `flex-none` and not just the minimum
        // height: a flex item may shrink to its `min-h-full`, and the sticky header can
        // only stick inside its parent's box, so a grid shrunk to one screen would let the
        // header scroll away with the first screen of rows.
        style={{ gridTemplateColumns: tracks }}
        className="flex-none md:grid md:min-h-full md:w-full md:grid-rows-[auto_1fr] md:gap-x-2.5 max-md:flex max-md:min-h-full max-md:flex-col"
      >
        <div
          ref={head}
          role="row"
          // The six chips and the checkbox measure ~260px of text; at `gap-x-3` the gaps
          // took the strip to 346px, which is exactly a 375px screen's content width, and
          // `Worst` fell off the end on its own. `gap-x-2` leaves about 30px in hand while
          // the padding stays at `px-3`, so the chips still line up with the cards below.
          className="sticky top-0 z-10 border-b border-hairline bg-panel px-5 text-meta font-medium tracking-[.06em] text-dim uppercase select-none md:col-span-full md:grid md:h-[2.125rem] md:grid-cols-subgrid md:items-center max-md:flex max-md:flex-none max-md:flex-wrap max-md:items-center max-md:gap-x-2 max-md:gap-y-1.5 max-md:px-3 max-md:py-2"
        >
          {columns.map((col) => {
            // A column the owner hid has no head: from `md` up it has no track to stand
            // over, and on a phone no sort chip, since the sort falls back with it.
            if (!col.wide) return null
            const active = col.sort === sort.key
            if (col.id === 'select') {
              return (
                <span key={col.id} className={cn(cellClass(col), 'flex items-center')}>
                  <Checkbox
                    checked={allSelected ? true : someSelected ? 'mixed' : false}
                    aria-label={t`Select every game on this page`}
                    onCheckedChange={() => onToggleAll()}
                    disabled={games.length === 0}
                  />
                </span>
              )
            }
            // No head clips its word: `SORT_HEAD_FIT`'s pill and the focus ring reach past
            // the cell, and a truncating head would cut them off.
            const align = cn(
              col.align === 'right' && 'justify-end',
              col.align === 'center' && 'justify-center',
            )
            const label = col.sort ? (
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
            ) : null
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
                className={cn(
                  cellClass(col),
                  'flex items-center',
                  // Only a sort earns a place in the phone's chip strip: `Flags` has none,
                  // and a bare label there would read as a control that does nothing.
                  !col.sort && 'max-md:hidden',
                  col.last ? 'gap-2' : align,
                )}
              >
                {col.last ? (
                  // The last head mirrors the last cell (`GameRow`): the word, then a blank
                  // the size of the row's delete, so a right-aligned word (Notes) stands
                  // over its figures rather than over the bin.
                  <>
                    <span className={cn('flex flex-1 items-center', align)}>{label}</span>
                    <span aria-hidden className="size-6 flex-none max-md:hidden" />
                  </>
                ) : (
                  label
                )}
              </span>
            )
          })}
        </div>

        <div
          ref={body}
          role="rowgroup"
          className={cn(
            ROW_SUBGRID,
            'transition-opacity max-md:flex max-md:flex-1 max-md:flex-col',
            state ? 'md:grid-rows-[1fr]' : 'md:content-start',
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
            <div className="col-span-full flex flex-1 items-center justify-center p-10 max-md:p-4">
              {empty}
            </div>
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
                queued={game.queued === true}
                engineHidden={engineHidden}
                columns={columns}
                collectionNames={collectionNames}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The skeleton body: the same columns the rows will have, so the layout does not jump when
 * they land — and below `md` the same card grid, for the same reason. Which columns those
 * are is the caller's, since ⇧E takes one of them away. Each bar is about as wide as what
 * its column usually holds (`bar`), so the tracks the skeleton sizes are near the ones the
 * rows will.
 *
 * The wrapper is a subgrid level of its own: as a plain box it would be one grid item in
 * the first track, and every skeleton row would be squeezed into the checkbox column.
 */
function LoadingRows({ columns, rows = 14 }: { columns: LaidColumn[]; rows?: number }) {
  return (
    <div
      aria-busy
      data-testid="games-loading"
      className={cn(ROW_SUBGRID, 'md:content-start')}
    >
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          data-games-row
          style={{ opacity: 1 - index * (0.6 / rows) }}
          className={cn(
            'items-center border-t border-hairline px-5',
            ROW_SUBGRID,
            ROW_HEIGHT,
            PHONE_CARD,
            'max-md:gap-x-2 max-md:gap-y-1 max-md:px-3 max-md:py-2',
          )}
        >
          {columns.map((col) => (
            <span key={col.id} className={cellClass(col)}>
              {col.bar > 0 ? (
                <Skeleton
                  className={cn(
                    'h-[0.5625rem] rounded-sm',
                    col.align === 'right' && 'ml-auto',
                    col.align === 'center' && 'mx-auto',
                  )}
                  style={{ width: `${col.bar}rem` }}
                />
              ) : null}
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
    <div className="col-span-full flex flex-1 items-center justify-center p-10 max-md:p-4">
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
