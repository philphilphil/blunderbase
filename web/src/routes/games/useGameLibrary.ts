/**
 * The library's data: one page of `/games?cards=true` at a time.
 *
 * `cards=true` is what makes the analysis columns possible — `analyzed`, `deep` and the
 * three worst moments come with the row, so the table never fans out into a request per
 * game. The key stays under the `['games']` prefix, which is what the `/events` socket
 * invalidates (`src/lib/events/invalidation.ts`), so an import or a finished run refreshes
 * the table with no reload.
 *
 * Pages rather than infinite scroll, and the order is the server's: with one page on
 * screen at a time the controls stay where they are instead of retreating down an ever
 * longer list, and a column header sorts the whole filtered library rather than whatever
 * happened to be loaded. `keepPreviousData` is what makes paging feel like paging — the
 * rows on screen stay put until the next page lands, rather than blinking through a
 * skeleton every time.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import * as api from '@/lib/api/endpoints'
import { queryKeys } from '@/lib/api/keys'
import type { GameCard } from '@/lib/api/types'

import { toGameQuery, type LibraryFilters } from './filters'
import type { Sort } from './sorting'

/** The sizes the footer offers, beside "Fit" — as many rows as the window has room for. */
export const PAGE_SIZES = [25, 50, 100, 200] as const

/** What the backend will serve in one page (`backend/api/routes/games.py: MAX_PAGE`). */
export const MAX_PAGE_SIZE = 200

export interface LibraryQuery {
  filters: LibraryFilters
  sort: Sort
  /** 1-based, the way the footer says it. */
  page: number
  pageSize: number
}

export function useGameLibrary({ filters, sort, page, pageSize }: LibraryQuery) {
  const limit = Math.min(Math.max(pageSize, 1), MAX_PAGE_SIZE)
  const query = useMemo(
    () => ({
      ...toGameQuery(filters),
      order: sort.key,
      direction: sort.direction,
      limit,
      offset: (Math.max(page, 1) - 1) * limit,
    }),
    [filters, sort.key, sort.direction, limit, page],
  )

  const result = useQuery({
    queryKey: queryKeys.gameCards(query),
    queryFn: () => api.listGameCards(query),
    placeholderData: keepPreviousData,
  })

  const games: GameCard[] = result.data?.games ?? []
  const total = result.data?.total ?? 0
  return {
    ...result,
    games,
    /** How many games match the filters, as this page reported it. */
    total,
    pageCount: Math.max(1, Math.ceil(total / limit)),
    /** The rows are the previous page's while the next one is in flight. */
    isPaging: result.isPlaceholderData && result.isFetching,
  }
}
