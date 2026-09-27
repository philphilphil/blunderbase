/**
 * The collections list as a name lookup, for the places that only hold a collection's id —
 * the filter bar's Collection chip, the Save filter suggestion, the receipt of "Remove from
 * collection". One list (`useCollections`, which the chips on every row also read), so a
 * rename shows everywhere at once.
 */
import { useCallback } from 'react'

import { useCollections } from '@/lib/api/queries'

import type { CollectionNames } from './filters'

export function useCollectionNames(): CollectionNames {
  const { data } = useCollections()
  const list = data?.collections
  return useCallback(
    (id: number) => list?.find((collection) => collection.id === id)?.name,
    [list],
  )
}
