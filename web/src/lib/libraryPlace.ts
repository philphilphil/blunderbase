/**
 * Where the library is standing: the whole of Games, one of the saved cuts, a collection,
 * or some unnamed filtered view. Asked by three readers that must never disagree: the Games
 * title, the game page's trail (the list a game was opened from), and the rail's lit row.
 * Before this, the rail lit Games while the title said a collection's name, or the other
 * way round; one function answering all three is what keeps "where am I" one answer.
 *
 * It reads the address and nothing else, so a reload, a shared link and the back button
 * land in the same place the click did. That has one consequence worth saying: a collection
 * picked in the Games filter row writes the very address a pinned rail row does
 * (`collection=<id>&whose=all`, see `collectionPath`), so both are the collection's place.
 * Anything added on top of it (a result, a speed) is a filtered view of Games again.
 *
 * The view half of the address (sort and page) never changes the place, the rule
 * `libraryLinks.showsCut` already keeps for saved cuts: re-sorting a collection is still
 * reading that collection. Mine / Others / All is a view switch too (spec N10), so it alone
 * never makes Games "filtered"; it only counts where a saved cut or a collection names it.
 */
import type { I18n, MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react/macro'
import { useMemo } from 'react'

import type { Crumb } from '@/components/shell/PageChrome'
import { useCollections } from '@/lib/api/queries'
import type { Collection } from '@/lib/api/types'
import { paramsFromFilters } from '@/routes/games/filters'
import { showsCut } from '@/routes/games/libraryLinks'
import { filterLabel, useSavedFilters, type SavedFilter } from '@/routes/games/savedFilters'

/** The address a pinned collection opens: its games, everyone's, as the Collections page does. */
export function pinnedCollectionHref(id: number): string {
  return `/games?collection=${id}&whose=all`
}

/** Sort and page: how a list is being read, never which list it is. */
const VIEW_PARAMS = new Set(['order', 'direction', 'page'])

/**
 * The collection a Games address shows when it shows exactly one collection and nothing
 * else (`collection=<id>&whose=all`, in any order, however sorted or paged), else null.
 */
export function pinnedCollectionFromSearch(search: string): number | null {
  const params = new URLSearchParams(search)
  const keys = [...params.keys()].filter((key) => !VIEW_PARAMS.has(key))
  if (keys.length !== 2) return null
  if (params.getAll('collection').length !== 1 || params.getAll('whose').length !== 1) return null
  if (params.get('whose') !== 'all') return null
  const id = Number(params.get('collection'))
  return Number.isInteger(id) && id > 0 ? id : null
}

/** The saved cut a Games address shows exactly, if any (`showsCut` decides "exactly"). */
export function savedCutFromSearch(
  search: string,
  saved: readonly SavedFilter[],
): SavedFilter | null {
  return saved.find((filter) => showsCut(paramsFromFilters(filter.filters), search)) ?? null
}

/** Whether a Games address narrows nothing: only the view and the Mine/Others/All switch. */
function narrowsNothing(search: string): boolean {
  const params = new URLSearchParams(search)
  return [...params.keys()].every((key) => VIEW_PARAMS.has(key) || key === 'whose')
}

export type LibraryPlaceKind = 'all' | 'cut' | 'collection' | 'filtered'

export interface LibraryPlace {
  kind: LibraryPlaceKind
  /**
   * The title's trail for Games: every crumb but the last is a place and carries its `to`.
   * The game page takes these as its trail and links the last one to the list it came from.
   */
  crumbs: Crumb[]
  /** The saved cut, when `kind` is `cut`. */
  cut?: SavedFilter
  /** The collection's id, when `kind` is `collection`. */
  collectionId?: number
}

const NAMES = {
  games: msg`Games`,
  collections: msg`Collections`,
  filtered: msg`Games (filtered)`,
  // While the collection list is still on its way; replaced by the name when it lands.
  collection: msg`Collection`,
} satisfies Record<string, MessageDescriptor>

/** The place a Games address names, from what is already known. The hook below feeds it. */
export function libraryPlace(
  search: string,
  {
    i18n,
    saved,
    collections,
  }: { i18n: I18n; saved: readonly SavedFilter[]; collections?: readonly Pick<Collection, 'id' | 'name'>[] },
): LibraryPlace {
  const games = i18n._(NAMES.games)
  const collectionId = pinnedCollectionFromSearch(search)
  if (collectionId !== null) {
    const name =
      collections?.find((collection) => collection.id === collectionId)?.name ??
      i18n._(NAMES.collection)
    return {
      kind: 'collection',
      collectionId,
      crumbs: [{ label: i18n._(NAMES.collections), to: '/collections' }, { label: name }],
    }
  }
  const cut = savedCutFromSearch(search, saved)
  if (cut) {
    return {
      kind: 'cut',
      cut,
      crumbs: [{ label: games, to: '/games' }, { label: filterLabel(i18n, cut) }],
    }
  }
  if (narrowsNothing(search)) return { kind: 'all', crumbs: [{ label: games }] }
  return { kind: 'filtered', crumbs: [{ label: i18n._(NAMES.filtered) }] }
}

/** `libraryPlace` for the address `search`, with the saved cuts and collection names it needs. */
export function useLibraryPlace(search: string): LibraryPlace {
  const { i18n } = useLingui()
  const saved = useSavedFilters()
  const collections = useCollections().data?.collections
  return useMemo(
    () => libraryPlace(search, { i18n, saved, collections }),
    [search, i18n, saved, collections],
  )
}
