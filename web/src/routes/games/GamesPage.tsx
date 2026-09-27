/**
 * Design 2b — the games library.
 *
 * Edge-to-edge rather than inside `<PageBody>`: the design gives this screen its own
 * scroll region between a fixed filter bar and a fixed footer, which a page-level scroll
 * would fight with.
 *
 * Filters live in the URL (`/games?color=black&outcome=loss`), so a filtered library is a
 * link — the opening explorer and the dashboard both point into it that way. The sort and
 * the page ride along (`?order=…&direction=…&page=3`), because opening a game unmounts this
 * screen and Back has to land on the page and order the row was found in; state held here
 * would come back as page 1, newest first. Every write replaces the history entry rather
 * than pushing one, so paging through the library does not fill Back with pages, and none
 * of them spells a default. The size stays out: it is a preference the reader keeps
 * (`./paging`), not part of what a link is about.
 *
 * It is always the whole library. A collection is one of its filters and nothing more — the
 * Collection chip, over the owner's games unless the link says `whose=all`, and cleared by
 * "Clear" like any other — because a collection as a thing of its own (its record, its
 * rule, Edit) is the Collections screen's (`routes/collections`). The title, the default
 * and Clear mean the same whichever chips are set. What a collection filter does add is the
 * way out of it: "Remove from collection" in the footer, next to Add to….
 */
import { plural } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import type * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { SetPageChrome } from '@/components/shell/PageChrome'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api/client'
import {
  useDeleteGames,
  useRemoveFromCollection,
  useRequestAnalysisBatch,
} from '@/lib/api/queries'
import { useEngineHidden } from '@/lib/ui/engineVisibility'
import { isTyping } from '@/lib/ui/shortcuts'

import { CollectionDialog } from './components/CollectionDialog'
import { DeleteGamesDialog } from './components/DeleteGamesDialog'
import { DebouncedInput, FilterBar } from './components/FilterBar'
import { GamesTable } from './components/GamesTable'
import { TableFooter } from './components/TableFooter'
import {
  filterCount,
  filtersFromParams,
  paramsFromFilters,
  prune,
  toGameQuery,
  type LibraryFilters,
} from './filters'
import { rememberTrail } from './gameTrail'
import {
  FALLBACK_FIT_ROWS,
  pageFromParams,
  readPageSize,
  resolvePageSize,
  writePageParam,
  writePageSize,
  type PageSizeChoice,
} from './paging'
import { DEFAULT_SORT, sortFromParams, writeSortParams, type Sort } from './sorting'
import { useCollectionNames } from './useCollectionNames'
import { useGameLibrary } from './useGameLibrary'

/**
 * The free-text box, named so `/` can reach it.
 *
 * `/` to search is the idiom every list on the web has, and the alternative — reaching for
 * the mouse to click into a box that is already on screen — is the gesture this whole
 * screen is trying to avoid.
 */
const SEARCH_ID = 'games-search'

export function GamesPage() {
  const { t } = useLingui()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const filters = useMemo(() => filtersFromParams(params), [params])
  const sort = useMemo(() => sortFromParams(params), [params])
  const page = pageFromParams(params)
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const [message, setMessage] = useState<string | null>(null)
  const [analysing, setAnalysing] = useState<Set<number>>(() => new Set())
  const [pageSize, setPageSize] = useState<PageSizeChoice>(readPageSize)
  // How many rows the table last measured room for. Only "Fit" spends it, but it is
  // measured either way so the option can say what choosing it would mean.
  const [fitRows, setFitRows] = useState(FALLBACK_FIT_ROWS)
  /** The games a confirmation is open over: a row's own, or the whole selection. */
  const [doomed, setDoomed] = useState<number[] | null>(null)
  const lastClicked = useRef<number | null>(null)

  /**
   * The sort the table is actually read under.
   *
   * Hiding the engine takes the `Worst` column away (`columns.ts`), and the header that
   * sorted by it goes with the column — so a library left sorted worst-first would go on
   * being ordered by a verdict, with nothing on screen saying so and no header left to
   * change it back. It falls back to the default while the engine is hidden.
   *
   * Derived rather than written back over `sort`: the reader's own choice is still their
   * choice, and it is standing again the moment the engine is.
   */
  const engineHidden = useEngineHidden()
  const readSort = engineHidden && sort.key === 'worst' ? DEFAULT_SORT : sort

  const rowsPerPage = resolvePageSize(pageSize, fitRows)
  const library = useGameLibrary({ filters, sort: readSort, page, pageSize: rowsPerPage })
  const rows = library.games
  // The row button queues one game through the same call: one id is a batch of one, and
  // one path here is one receipt and one set of spinning rows. Deleting works the same way.
  const analysis = useRequestAnalysisBatch()
  const deletion = useDeleteGames()
  const removal = useRemoveFromCollection()

  // The collection the filter is set to, if it is — what "Remove from collection" takes the
  // selection out of, named in its receipt from the list the chip already reads.
  const inCollection = filters.collection
  const collectionName = useCollectionNames()
  /** Games handed to "+ New collection from these N…", while its dialog is open. */
  const [newFrom, setNewFrom] = useState<number[] | null>(null)

  /**
   * Open a game, and hand the run it was opened from over with it.
   *
   * What goes over is the query and where in it this row sits, not the page of ids on
   * screen: `[` and `]` then walk the whole filtered library in the table's own order
   * rather than stopping at the end of whatever page happened to be up (`gameTrail`).
   * Recorded on the way out rather than on every render, because "the run I was reading" is
   * a thing the reader chose, not a thing the table happened to be showing while they typed
   * in the filter bar.
   */
  const open = useCallback(
    (id: number) => {
      const at = rows.findIndex((game) => game.id === id)
      if (at !== -1) {
        rememberTrail({
          query: {
            ...toGameQuery(filters),
            order: readSort.key,
            direction: readSort.direction,
          },
          offset: (Math.max(page, 1) - 1) * rowsPerPage + at,
          gameId: id,
          // The address itself too, for the game screen's "Library" crumb to go back to.
          library: { search: params.toString(), rowsPerPage },
        })
      }
      navigate(`/games/${id}`)
    },
    [rows, filters, readSort, page, rowsPerPage, params, navigate],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
      if (isTyping(event.target)) return
      // Not from inside a popover or a dialog, nor while a modal is open: the box sits
      // behind it, and what is typed next would re-filter the table under the dialog. The
      // table's arrow keys stand down the same way (`GamesTable`).
      if (event.target instanceof Element && event.target.closest('[role="dialog"]')) return
      if (document.querySelector('[aria-modal="true"]')) return
      // Or the slash lands in the box along with the intention to type in it.
      event.preventDefault()
      document.getElementById(SEARCH_ID)?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  /**
   * Rewrite the library's address — filters, sort and page — in place. What `next` leaves
   * out is kept from the address, except the page: anything that changes what the first
   * page holds starts again at it, because reading page 7 of one filter says nothing about
   * where to stand in another. Built from the address it replaces rather than from this
   * render's values, so two writes in one tick do not undo each other.
   */
  const writeView = useCallback(
    (next: { filters?: LibraryFilters; sort?: Sort; page?: number }) => {
      setParams(
        (current) => {
          const written = paramsFromFilters(prune(next.filters ?? filtersFromParams(current)))
          writeSortParams(written, next.sort ?? sortFromParams(current))
          writePageParam(written, next.page ?? 1)
          return written
        },
        { replace: true },
      )
    },
    [setParams],
  )
  const setFilters = useCallback(
    (next: LibraryFilters) => writeView({ filters: next }),
    [writeView],
  )
  const setSort = useCallback((next: Sort) => writeView({ sort: next }), [writeView])
  const setPage = useCallback((next: number) => writeView({ page: next }), [writeView])

  // A library that shrank under the reader — a delete, an import — can leave the page past
  // the end of it, which would be an empty table over a full library. Only once this very
  // query has answered: before that the page count is a placeholder of one, and an address
  // arriving at page 3 (Back from a game) would be sent to the first before it ever loaded.
  // Nor does the table measuring a new "Fit" row count move the page — that happens on
  // every mount, and would throw the page Back returned to away again.
  const pastEnd = library.isSuccess && !library.isPlaceholderData && page > library.pageCount
  const lastPage = library.pageCount
  useEffect(() => {
    if (pastEnd) setPage(lastPage)
  }, [pastEnd, lastPage, setPage])

  // A row that a filter change or a page turn took off the table can no longer be acted
  // on. The raw selection is kept (going back brings it back) but everything the page
  // reads goes through what is actually on screen — deleting what you cannot see is
  // exactly the thing a confirmation dialog cannot protect you from.
  const visible = useMemo(() => new Set(rows.map((game) => game.id)), [rows])
  const selectedVisible = useMemo(
    () => new Set([...selected].filter((id) => visible.has(id))),
    [selected, visible],
  )

  const toggle = useCallback(
    (id: number, event: React.MouseEvent) => {
      setSelected((current) => {
        const next = new Set(current)
        // Shift-click extends from the last row that was clicked, the way every table does.
        if (event.shiftKey && lastClicked.current !== null) {
          const ids = rows.map((game) => game.id)
          const from = ids.indexOf(lastClicked.current)
          const to = ids.indexOf(id)
          if (from !== -1 && to !== -1) {
            const [start, end] = from < to ? [from, to] : [to, from]
            for (const between of ids.slice(start, end + 1)) next.add(between)
            return next
          }
        }
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
      lastClicked.current = id
    },
    [rows],
  )

  const toggleAll = useCallback(() => {
    setSelected((current) => {
      const all = rows.map((game) => game.id)
      if (all.length > 0 && all.every((id) => current.has(id))) return new Set()
      return new Set(all)
    })
  }, [rows])

  const queueAnalysis = useCallback(
    async (ids: number[]) => {
      if (ids.length === 0) return
      setAnalysing((current) => new Set([...current, ...ids]))
      setMessage(null)
      // The whole selection in one call: the backend queues it in one transaction and
      // answers with what it took per game, so the receipt is that answer rather than a
      // tally kept across as many round-trips as there were rows. The body is ids and nothing
      // else: a selection gets the import pass at the Settings page's budget and the import
      // pass's place in the queue, so five hundred ticked rows never jump ahead of a game
      // somebody is waiting on. Deeper work is Analyse… on the game.
      let queued = 0
      let refused = ids.length
      let reason: string | null = null
      try {
        const receipt = await analysis.mutateAsync({ game_ids: ids })
        queued = receipt.queued.length
        refused = receipt.refused.length
      } catch (error) {
        // A call that never landed refused the selection whole, and the backend always
        // says why — a selection over the batch cap, an analysis role with no engine behind it.
        // Without the reason on the receipt the refusal reads as the server losing the
        // selection for no stated cause, which is the one thing that never happened.
        reason = refusalReason(error, t`the request never landed`)
      }
      setAnalysing((current) => {
        const next = new Set(current)
        for (const id of ids) next.delete(id)
        return next
      })
      const queuedMessage = t`${plural(queued, { one: '# run', other: '# runs' })} queued`
      setMessage(
        refused === 0
          ? queuedMessage
          : reason
            ? t`${queued} queued, ${refused} refused — ${reason}`
            : t`${queued} queued, ${refused} refused`,
      )
    },
    [analysis, t],
  )

  // Deleting goes through the dialog, which is what `doomed` is: the ids it is open over.
  // A failed call keeps the dialog up carrying the reason, because the one thing worse
  // than a delete that did not happen is a delete that did not happen quietly.
  const confirmDelete = useCallback(async () => {
    const ids = doomed ?? []
    if (ids.length === 0) return
    let receipt
    try {
      receipt = await deletion.mutateAsync(ids)
    } catch {
      return
    }
    setDoomed(null)
    setSelected((current) => {
      const next = new Set(current)
      for (const id of ids) next.delete(id)
      return next
    })
    const deleted = receipt.games
    setMessage(t`${plural(deleted, { one: '# game', other: '# games' })} deleted`)
  }, [deletion, doomed, t])

  const closeDelete = useCallback(() => {
    setDoomed(null)
    deletion.reset()
  }, [deletion])

  // What Add to… ticks from: the selected rows, each with the collections it is in.
  const selectedGames = useMemo(
    () =>
      rows
        .filter((game) => selectedVisible.has(game.id))
        .map((game) => ({ id: game.id, collections: game.collections ?? [] })),
    [rows, selectedVisible],
  )

  // Taking games out of the collection the filter is set to. No confirmation: nothing is
  // deleted, the games are one Add to… away from coming back, and a rule never re-adds them.
  const removeFromCollection = useCallback(async () => {
    const ids = [...selectedVisible]
    if (inCollection === undefined || ids.length === 0) return
    const name = collectionName(inCollection) ?? `#${inCollection}`
    try {
      const receipt = await removal.mutateAsync({ collectionId: inCollection, gameIds: ids })
      setSelected((current) => {
        const next = new Set(current)
        for (const id of ids) next.delete(id)
        return next
      })
      const removed = receipt.removed
      setMessage(t`${plural(removed, { one: '# game', other: '# games' })} taken out of ${name}`)
    } catch (error) {
      setMessage(t`Could not take the games out — ${refusalReason(error, t`the request never landed`)}`)
    }
  }, [removal, inCollection, collectionName, selectedVisible, t])

  // The message is a receipt, not a state — it goes away on its own.
  useEffect(() => {
    if (!message) return
    const timer = setTimeout(() => setMessage(null), 6_000)
    return () => clearTimeout(timer)
  }, [message])

  const active = filterCount(filters)
  const loaded = rows.length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* No heading of its own: the titlebar's crumb names the page and carries Import, and
          the count is the footer's ("1–50 of 312") and the rail's. What is left is the one
          toolbar — whose games, the filters, then Clear and the search at its right end. */}
      <SetPageChrome
        breadcrumb={[{ label: t`Games`, to: '/games' }]}
        manual="guide/games"
        actions={
          <Button asChild size="sm" variant="secondary">
            <Link to="/library/import">
              <Trans>Import</Trans>
            </Link>
          </Button>
        }
      />

      <div className="flex-none border-b border-hairline px-5 py-3 max-md:px-3">
        <FilterBar
          filters={filters}
          onChange={setFilters}
          trailing={
            <>
              {active > 0 ? (
                <Button type="button" size="sm" variant="outline" onClick={() => setFilters({})}>
                  <Trans>Clear {active}</Trans>
                </Button>
              ) : null}
              {/* On a phone it takes the rest of its own line: shrinking a box you type an
                  opponent's name into is the wrong half to give up. */}
              <DebouncedInput
                id={SEARCH_ID}
                aria-label={t`Search games`}
                placeholder={t`Opponent, ECO, PGN text…`}
                value={filters.text ?? ''}
                onCommit={(value) => setFilters({ ...filters, text: value || undefined })}
                // `/` puts the cursor here, so Esc takes it back out — the rows' arrow keys
                // and `/` itself are dead while it is in a text box. The text stays.
                onKeyDown={(event) => {
                  if (event.key === 'Escape') event.currentTarget.blur()
                }}
                className="h-7 w-[13.75rem] max-md:w-auto max-md:flex-1"
              />
            </>
          }
        />
      </div>

      <GamesTable
        games={rows}
        sort={readSort}
        onSortChange={setSort}
        selected={selectedVisible}
        onToggle={toggle}
        onToggleAll={toggleAll}
        onOpen={open}
        onAnalyse={(id) => void queueAnalysis([id])}
        analysing={analysing}
        onDelete={(id) => setDoomed([id])}
        status={library.status}
        error={library.error}
        onRetry={() => void library.refetch()}
        busy={library.isPaging}
        onCapacityChange={setFitRows}
        empty={<EmptyState active={active} onClear={() => setFilters({})} />}
      />

      <TableFooter
        selectedCount={selectedVisible.size}
        selectedGames={selectedGames}
        onNewCollection={() => setNewFrom([...selectedVisible])}
        inCollection={inCollection !== undefined}
        removing={removal.isPending}
        onRemoveFromCollection={() => void removeFromCollection()}
        loadedCount={loaded}
        total={library.total}
        queueing={analysis.isPending}
        deleting={deletion.isPending}
        onQueue={() => void queueAnalysis([...selectedVisible])}
        onDelete={() => setDoomed([...selectedVisible])}
        onClearSelection={() => setSelected(new Set())}
        message={message}
        page={page}
        pageCount={library.pageCount}
        onPageChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={(size) => {
          setPageSize(size)
          writePageSize(size)
          // A new size re-cuts every page, so the number on screen no longer names the
          // rows that were on it: start again at the first.
          setPage(1)
        }}
        rowsPerPage={rowsPerPage}
        fitRows={fitRows}
      />

      {doomed ? (
        <DeleteGamesDialog
          count={doomed.length}
          pending={deletion.isPending}
          error={deletion.isError ? refusalReason(deletion.error, t`the request never landed`) : null}
          onConfirm={() => void confirmDelete()}
          onClose={closeDelete}
        />
      ) : null}

      {newFrom ? (
        <CollectionDialog
          gameIds={newFrom}
          onClose={() => setNewFrom(null)}
          onSaved={(collection) => {
            const name = collection.name
            setMessage(t`Made ${name}`)
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * What the backend called it, or the nearest true sentence when it never answered. The
 * fallback is handed in rather than written here, because this is not a component and the
 * only sentence in it has to come from the caller's catalog.
 */
function refusalReason(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message || error.error
  if (error instanceof Error && error.message) return error.message
  return fallback
}

/**
 * What the body says when the query came back empty. An unboxed block of text in the
 * middle of the table's own space: the table is already the region, and a dashed card
 * inside it was a second frame around one sentence. An empty library has one thing to do,
 * so importing is the filled primary; a filter that matched nothing is routine and gets
 * the quieter outline.
 */
function EmptyState({ active, onClear }: { active: number; onClear: () => void }) {
  return (
    <div className="mx-auto flex max-w-[28rem] flex-col items-center gap-2.5 py-10 text-center max-md:py-6">
      <span className="text-heading font-semibold text-ink">
        {active > 0 ? (
          <Trans>Nothing matches these filters</Trans>
        ) : (
          <Trans>No games yet</Trans>
        )}
      </span>
      <p className="text-data leading-relaxed text-dim">
        {active > 0 ? (
          <Trans>
            Loosen a filter — the library only ever shows games that are already imported.
          </Trans>
        ) : (
          <Trans>
            Import a Lichess or Chess.com account, or drop a PGN in, and the library fills itself.
          </Trans>
        )}
      </p>
      {active > 0 ? (
        <Button type="button" size="sm" variant="outline" onClick={onClear}>
          <Trans>Clear the filters</Trans>
        </Button>
      ) : (
        <Button asChild size="sm">
          <Link to="/library/import">
            <Trans>Go to import</Trans>
          </Link>
        </Button>
      )}
    </div>
  )
}
