/**
 * Design 2b — the games library.
 *
 * Edge-to-edge rather than inside `<PageBody>`: the design gives this screen its own
 * scroll region between a fixed filter bar and a fixed selection footer, which a page-level
 * scroll would fight with.
 *
 * Filters live in the URL (`/games?color=black&outcome=loss`), so a filtered library is a
 * link — the opening explorer and the dashboard both point into it that way.
 */
import type * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { SetPageChrome } from '@/components/shell/PageChrome'
import { useRequestAnalysis } from '@/lib/api/queries'
import { cn } from '@/lib/utils'

import { DebouncedInput, FilterBar } from './components/FilterBar'
import { DEFAULT_DENSITY, DENSITIES, type Density } from './components/density'
import { GamesTable } from './components/GamesTable'
import { SelectionFooter } from './components/SelectionFooter'
import {
  filterCount,
  filtersFromParams,
  paramsFromFilters,
  prune,
  type LibraryFilters,
} from './filters'
import { formatCount } from './format'
import { DEFAULT_SORT, isServerOrder, sortGames, type Sort } from './sorting'
import { useGameLibrary } from './useGameLibrary'

export function GamesPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const filters = useMemo(() => filtersFromParams(params), [params])
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT)
  const [density, setDensity] = useState<Density>(DEFAULT_DENSITY)
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const [queueMessage, setQueueMessage] = useState<string | null>(null)
  const [analysing, setAnalysing] = useState<Set<number>>(() => new Set())
  const lastClicked = useRef<number | null>(null)

  const library = useGameLibrary(filters)
  const rows = useMemo(() => sortGames(library.games, sort), [library.games, sort])
  const analysis = useRequestAnalysis()

  const setFilters = useCallback(
    (next: LibraryFilters) => {
      setParams(paramsFromFilters(prune(next)), { replace: true })
    },
    [setParams],
  )

  // A row that a filter change took off the table can no longer be acted on. The raw
  // selection is kept (going back to the old filter brings it back) but everything the
  // page reads goes through what is actually on screen.
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
      setQueueMessage(null)
      let queued = 0
      let failed = 0
      for (const id of ids) {
        try {
          await analysis.mutateAsync({ game_id: id, tier })
          queued += 1
        } catch {
          failed += 1
        }
      }
      setAnalysing((current) => {
        const next = new Set(current)
        for (const id of ids) next.delete(id)
        return next
      })
      setQueueMessage(
        failed === 0
          ? `${queued} ${tier} ${queued === 1 ? 'run' : 'runs'} queued`
          : `${queued} queued, ${failed} refused`,
      )
    },
    [analysis],
  )

  // The message is a receipt, not a state — it goes away on its own.
  useEffect(() => {
    if (!queueMessage) return
    const timer = setTimeout(() => setQueueMessage(null), 6_000)
    return () => clearTimeout(timer)
  }, [queueMessage])

  const active = filterCount(filters)
  const loaded = rows.length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SetPageChrome breadcrumb={[{ label: 'Library', to: '/games' }]} />

      <div className="flex flex-none flex-col gap-3 border-b border-hairline px-5 pt-4 pb-3">
        <div className="flex items-end gap-3">
          <div className="flex flex-col gap-[0.1875rem]">
            <h1 className="text-[1.1875rem] font-semibold tracking-[-0.01em] text-ink">Games</h1>
            <p className="text-[0.78125rem] text-dim">
              {library.status === 'pending' ? (
                'Counting…'
              ) : active > 0 ? (
                <>
                  <span className="font-mono text-soft">{formatCount(library.total)}</span> of your
                  games match {active === 1 ? 'this filter' : `these ${active} filters`}
                </>
              ) : (
                <>
                  <span className="font-mono text-soft">{formatCount(library.total)}</span> games in
                  the database
                </>
              )}
            </p>
          </div>

          <div className="flex-1" />

          <DebouncedInput
            aria-label="Search games"
            placeholder="Opponent, ECO, PGN text…"
            value={filters.text ?? ''}
            onCommit={(value) => setFilters({ ...filters, text: value || undefined })}
            className="h-8 w-[13.75rem] text-xs"
          />

          {active > 0 ? (
            <button
              type="button"
              onClick={() => setFilters({})}
              className="rounded-md border border-edge-input px-2.5 py-1.5 text-xs text-soft transition-colors hover:border-edge-hover hover:text-ink"
            >
              Clear {active}
            </button>
          ) : null}

          <Link
            to="/import"
            className="rounded-md border border-edge-input px-2.5 py-1.5 text-xs text-soft transition-colors hover:border-edge-hover hover:text-ink"
          >
            Import
          </Link>
        </div>

        <FilterBar
          filters={filters}
          onChange={setFilters}
          density={density}
          onDensityChange={setDensity}
        />
      </div>

      <GamesTable
        games={rows}
        height={DENSITIES[density].height}
        sort={sort}
        onSortChange={setSort}
        selected={selectedVisible}
        onToggle={toggle}
        onToggleAll={toggleAll}
        onOpen={(id) => navigate(`/games/${id}`)}
        onAnalyse={(id) => void queueAnalysis([id], 'quick')}
        analysing={analysing}
        status={library.status}
        error={library.error}
        onRetry={() => void library.refetch()}
        hasNextPage={library.hasNextPage}
        isFetchingNextPage={library.isFetchingNextPage}
        onLoadMore={() => void library.fetchNextPage()}
        empty={<EmptyState active={active} onClear={() => setFilters({})} />}
      />

      <SelectionFooter
        selectedCount={selectedVisible.size}
        loadedCount={loaded}
        total={library.total}
        sortedClientSide={!isServerOrder(sort) && library.hasNextPage}
        queueing={analysis.isPending}
        onQueue={(tier) => void queueAnalysis([...selectedVisible], tier)}
        onClearSelection={() => setSelected(new Set())}
        message={queueMessage}
      />
    </div>
  )
}

function EmptyState({ active, onClear }: { active: number; onClear: () => void }) {
  return (
    <div
      className={cn(
        'flex max-w-md flex-col items-center gap-2.5 rounded-xl border border-dashed border-edge-strong bg-panel/60 p-10 text-center',
      )}
    >
      <span className="text-[0.8125rem] font-semibold text-ink">
        {active > 0 ? 'Nothing matches these filters' : 'No games yet'}
      </span>
      <p className="text-[0.78125rem] leading-relaxed text-dim">
        {active > 0
          ? 'Loosen a filter — the library only ever shows games that are already imported.'
          : 'Import a Lichess or Chess.com account, or drop a PGN in, and the library fills itself.'}
      </p>
      {active > 0 ? (
        <button
          type="button"
          onClick={onClear}
          className="rounded-md border border-edge-input px-2.5 py-1 text-[0.71875rem] text-soft hover:border-edge-hover hover:text-ink"
        >
          Clear the filters
        </button>
      ) : (
        <Link
          to="/import"
          className="rounded-md border border-edge-input px-2.5 py-1 text-[0.71875rem] text-soft hover:border-edge-hover hover:text-ink"
        >
          Go to import
        </Link>
      )}
    </div>
  )
}
