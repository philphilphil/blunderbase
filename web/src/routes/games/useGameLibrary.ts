/**
 * The library's data: one infinite `/games?cards=true` query.
 *
 * `cards=true` is what makes the analysis columns possible — `analyzed`, `deep` and the
 * three worst moments come with the row, so the table never fans out into a request per
 * game. The key stays under the `['games']` prefix, which is what the `/events` socket
 * invalidates (`src/lib/events/invalidation.ts`), so an import or a finished run refreshes
 * the table with no reload.
 */
import { useInfiniteQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import * as api from '@/lib/api/endpoints'
import { queryKeys } from '@/lib/api/keys'
import type { GameCard } from '@/lib/api/types'

import { toGameQuery, type LibraryFilters } from './filters'

export const PAGE_SIZE = 50

export function useGameLibrary(filters: LibraryFilters) {
  const query = useMemo(() => toGameQuery(filters), [filters])

  const infinite = useInfiniteQuery({
    queryKey: [...queryKeys.gameCards(query), 'infinite'],
    queryFn: ({ pageParam }) =>
      api.listGameCards({ ...query, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => {
      const loaded = last.offset + last.games.length
      // An empty page means the end even if `total` disagrees, which it briefly can while
      // an import is writing rows under the query.
      return last.games.length > 0 && loaded < last.total ? loaded : undefined
    },
  })

  // Pages are fetched at fixed offsets over a newest-first list, so a game imported while
  // the user scrolls shifts every offset down and the next page re-serves rows already on
  // screen. Keeping the first occurrence of each id is what stops duplicate React keys and
  // a game appearing twice until the debounced import invalidation refetches.
  const games = useMemo<GameCard[]>(() => {
    const seen = new Set<number>()
    const rows: GameCard[] = []
    for (const page of infinite.data?.pages ?? []) {
      for (const game of page.games) {
        if (seen.has(game.id)) continue
        seen.add(game.id)
        rows.push(game)
      }
    }
    return rows
  }, [infinite.data])

  return {
    ...infinite,
    games,
    /** How many games match the filters, as the last page reported it. */
    total: infinite.data?.pages.at(-1)?.total ?? 0,
  }
}
