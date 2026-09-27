/**
 * How the collections screen draws its collections — a grid of cards or a table of rows.
 *
 * A per-browser reading preference (`lib/ui/viewPreference`), the same kind as the notes'
 * stream / sheet / list. The grid is the default: it is the shelf a handful of collections
 * reads best as; the table is for when there are enough of them to compare down a column.
 */
import { viewPreference } from '@/lib/ui/viewPreference'

export type CollectionView = 'grid' | 'table'

export const COLLECTION_VIEW_KEY = 'blunderbase.collectionView'

const pref = viewPreference<CollectionView>(COLLECTION_VIEW_KEY, ['grid', 'table'], 'grid')

export const setCollectionView = pref.set
export const resetCollectionView = pref.reset
export const useCollectionView = pref.use
