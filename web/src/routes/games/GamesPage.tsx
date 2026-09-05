/**
 * Design 2b — the games library.
 *
 * Edge-to-edge rather than inside `<PageBody>`: the design gives this screen its own
 * scroll region between a fixed filter bar and a fixed footer, which a page-level scroll
 * would fight with.
 *
 * Filters live in the URL (`/games?color=black&outcome=loss`), so a filtered library is a
 * link — the opening explorer and the dashboard both point into it that way. The page and
 * its size do not: which slice you are reading is not what a link to a filtered library is
 * about, and the size is a preference the reader keeps (`./paging`).
 */
import { plural } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import type * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { SetPageChrome } from '@/components/shell/PageChrome'
import { ApiError } from '@/lib/api/client'
import { useDeleteGames, useRequestAnalysisBatch } from '@/lib/api/queries'
import { isTyping } from '@/lib/ui/shortcuts'
import { cn } from '@/lib/utils'

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
import { formatCount } from './format'
import { rememberTrail } from './gameTrail'
import {
  FALLBACK_FIT_ROWS,
  readPageSize,
  resolvePageSize,
  writePageSize,
  type PageSizeChoice,
} from './paging'
import { DEFAULT_SORT, type Sort } from './sorting'
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
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT)
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const [message, setMessage] = useState<string | null>(null)
  const [analysing, setAnalysing] = useState<Set<number>>(() => new Set())
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSizeChoice>(readPageSize)
  // How many rows the table last measured room for. Only "Fit" spends it, but it is
  // measured either way so the option can say what choosing it would mean.
  const [fitRows, setFitRows] = useState(FALLBACK_FIT_ROWS)
  /** The games a confirmation is open over: a row's own, or the whole selection. */
  const [doomed, setDoomed] = useState<number[] | null>(null)
  const lastClicked = useRef<number | null>(null)

  const rowsPerPage = resolvePageSize(pageSize, fitRows)
  const library = useGameLibrary({ filters, sort, page, pageSize: rowsPerPage })
  const rows = library.games
  // The row button queues one game through the same call: one id is a batch of one, and
  // one path here is one receipt and one set of spinning rows. Deleting works the same way.
  const analysis = useRequestAnalysisBatch()
  const deletion = useDeleteGames()

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
          query: { ...toGameQuery(filters), order: sort.key, direction: sort.direction },
          offset: (Math.max(page, 1) - 1) * rowsPerPage + at,
          gameId: id,
        })
      }
      navigate(`/games/${id}`)
    },
    [rows, filters, sort, page, rowsPerPage, navigate],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
      if (isTyping(event.target)) return
      // Or the slash lands in the box along with the intention to type in it.
      event.preventDefault()
      document.getElementById(SEARCH_ID)?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const setFilters = useCallback(
    (next: LibraryFilters) => {
      setParams(paramsFromFilters(prune(next)), { replace: true })
    },
    [setParams],
  )

  // Anything that changes what the first page holds starts again at it: reading page 7 of
  // one filter says nothing about where to stand in another. Adjusted during the render
  // that notices rather than in an effect — React re-runs this render before it commits
  // anything, so the table is never painted showing page 7 of a library that has three.
  const queryKey = `${params.toString()}|${sort.key}|${sort.direction}|${rowsPerPage}`
  const [lastQueryKey, setLastQueryKey] = useState(queryKey)
  if (lastQueryKey !== queryKey) {
    setLastQueryKey(queryKey)
    setPage(1)
  }
  // The same, for a library that shrank under the reader — a delete, an import — and left
  // the page past the end of it, which would be an empty table over a full library.
  if (page > library.pageCount) setPage(library.pageCount)

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
    async (ids: number[], tier: 'quick' | 'deep') => {
      if (ids.length === 0) return
      setAnalysing((current) => new Set([...current, ...ids]))
      setMessage(null)
      // The whole selection in one call: the backend queues it in one transaction and
      // answers with what it took per game, so the receipt is that answer rather than a
      // tally kept across as many round-trips as there were rows.
      let queued = 0
      let refused = ids.length
      let reason: string | null = null
      try {
        const receipt = await analysis.mutateAsync({ game_ids: ids, tier })
        queued = receipt.queued.length
        refused = receipt.refused.length
      } catch (error) {
        // A call that never landed refused the selection whole, and the backend always
        // says why — a selection over the batch cap, a tier with no engine behind it.
        // Without the reason on the receipt the refusal reads as the server losing the
        // selection for no stated cause, which is the one thing that never happened.
        reason = refusalReason(error, t`the request never landed`)
      }
      setAnalysing((current) => {
        const next = new Set(current)
        for (const id of ids) next.delete(id)
        return next
      })
      // One whole message per tier rather than the tier word dropped into a shared frame:
      // "quick" and "deep" decline with the noun beside them in most languages.
      const queuedMessage =
        tier === 'quick'
          ? t`${plural(queued, { one: '# quick run', other: '# quick runs' })} queued`
          : t`${plural(queued, { one: '# deep run', other: '# deep runs' })} queued`
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

  // The message is a receipt, not a state — it goes away on its own.
  useEffect(() => {
    if (!message) return
    const timer = setTimeout(() => setMessage(null), 6_000)
    return () => clearTimeout(timer)
  }, [message])

  const active = filterCount(filters)
  const loaded = rows.length
  const totalGames = formatCount(library.total)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SetPageChrome breadcrumb={[{ label: t`Games`, to: '/games' }]} manual="guide/games" />

      <div className="flex flex-none flex-col gap-3 border-b border-hairline px-5 pt-4 pb-3 max-md:px-3 max-md:pt-3">
        {/* Below `md` the search box takes a line of its own: at 375px it and the title
            cannot share one, and shrinking a box you type an opponent's name into is the
            wrong half to give up. The two buttons wrap under it. */}
        <div className="flex items-end gap-3 max-md:flex-wrap max-md:gap-y-2.5">
          <div className="flex flex-col gap-[0.1875rem]">
            <h1 className="text-[1.1875rem] font-semibold tracking-[-0.01em] text-ink">
              <Trans>Games</Trans>
            </h1>
            {/* One `Trans` per case rather than a count swapped inside a shared frame: the
                sentence is what a translator needs whole, and the mono count is part of it. */}
            <p className="text-[0.78125rem] text-dim">
              {library.status === 'pending' ? (
                t`Counting…`
              ) : active === 1 ? (
                <Trans>
                  <span className="font-mono text-soft">{totalGames}</span> of your games match this
                  filter
                </Trans>
              ) : active > 0 ? (
                <Trans>
                  <span className="font-mono text-soft">{totalGames}</span> of your games match
                  these {active} filters
                </Trans>
              ) : (
                <Trans>
                  <span className="font-mono text-soft">{totalGames}</span> games in the database
                </Trans>
              )}
            </p>
          </div>

          <div className="flex-1" />

          <DebouncedInput
            id={SEARCH_ID}
            aria-label={t`Search games`}
            placeholder={t`Opponent, ECO, PGN text…`}
            value={filters.text ?? ''}
            onCommit={(value) => setFilters({ ...filters, text: value || undefined })}
            className="h-8 w-[13.75rem] text-xs max-md:w-full"
          />

          {active > 0 ? (
            <button
              type="button"
              onClick={() => setFilters({})}
              className="rounded-md border border-edge-input px-2.5 py-1.5 text-xs text-soft transition-colors hover:border-edge-hover hover:text-ink"
            >
              <Trans>Clear {active}</Trans>
            </button>
          ) : null}

          <Link
            to="/library/import"
            className="rounded-md border border-edge-input px-2.5 py-1.5 text-xs text-soft transition-colors hover:border-edge-hover hover:text-ink"
          >
            <Trans>Import</Trans>
          </Link>
        </div>

        <FilterBar filters={filters} onChange={setFilters} />
      </div>

      <GamesTable
        games={rows}
        sort={sort}
        onSortChange={setSort}
        selected={selectedVisible}
        onToggle={toggle}
        onToggleAll={toggleAll}
        onOpen={open}
        onAnalyse={(id) => void queueAnalysis([id], 'quick')}
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
        loadedCount={loaded}
        total={library.total}
        queueing={analysis.isPending}
        deleting={deletion.isPending}
        onQueue={(tier) => void queueAnalysis([...selectedVisible], tier)}
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

function EmptyState({ active, onClear }: { active: number; onClear: () => void }) {
  return (
    <div
      className={cn(
        'flex max-w-md flex-col items-center gap-2.5 rounded-xl border border-dashed border-edge-strong bg-panel/60 p-10 text-center max-md:p-6',
      )}
    >
      <span className="text-[0.8125rem] font-semibold text-ink">
        {active > 0 ? (
          <Trans>Nothing matches these filters</Trans>
        ) : (
          <Trans>No games yet</Trans>
        )}
      </span>
      <p className="text-[0.78125rem] leading-relaxed text-dim">
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
        <button
          type="button"
          onClick={onClear}
          className="rounded-md border border-edge-input px-2.5 py-1 text-[0.71875rem] text-soft hover:border-edge-hover hover:text-ink"
        >
          <Trans>Clear the filters</Trans>
        </button>
      ) : (
        <Link
          to="/library/import"
          className="rounded-md border border-edge-input px-2.5 py-1 text-[0.71875rem] text-soft hover:border-edge-hover hover:text-ink"
        >
          <Trans>Go to import</Trans>
        </Link>
      )}
    </div>
  )
}
