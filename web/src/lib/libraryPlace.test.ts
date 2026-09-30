import { i18n } from '@lingui/core'
import { describe, expect, it } from 'vitest'

import { paramsFromFilters } from '@/routes/games/filters'
import { BUILT_IN_FILTERS } from '@/routes/games/savedFilters'

import {
  libraryPlace,
  pinnedCollectionFromSearch,
  pinnedCollectionHref,
  savedCutFromSearch,
} from './libraryPlace'

const collections = [
  { id: 7, name: 'League 2026' },
  { id: 9, name: 'Club OTB' },
]
const place = (search: string) =>
  libraryPlace(search, { i18n, saved: BUILT_IN_FILTERS, collections })

describe('pinned collections', () => {
  it('opens one as everyone’s games in it', () => {
    expect(pinnedCollectionHref(7)).toBe('/games?collection=7&whose=all')
  })

  it('reads the collection back only from exactly that address', () => {
    expect(pinnedCollectionFromSearch('?collection=7&whose=all')).toBe(7)
    expect(pinnedCollectionFromSearch('?whose=all&collection=7')).toBe(7)
    // Sorting or paging it is still reading that collection.
    expect(pinnedCollectionFromSearch('?collection=7&whose=all&order=black&page=3')).toBe(7)
    // Mine only, or narrowed further, is a filter on Games.
    expect(pinnedCollectionFromSearch('?collection=7')).toBeNull()
    expect(pinnedCollectionFromSearch('?collection=7&whose=mine')).toBeNull()
    expect(pinnedCollectionFromSearch('?collection=7&whose=all&outcome=loss')).toBeNull()
    expect(pinnedCollectionFromSearch('?collection=x&whose=all')).toBeNull()
    expect(pinnedCollectionFromSearch('')).toBeNull()
  })
})

describe('the library’s place', () => {
  it('is Games for the whole library, whichever view of it', () => {
    expect(place('')).toMatchObject({ kind: 'all', crumbs: [{ label: 'Games' }] })
    expect(place('?order=white&direction=asc&page=2').kind).toBe('all')
    expect(place('?whose=others').kind).toBe('all')
  })

  it('is Games › the cut for a saved filter, with Games a place to go back to', () => {
    const blunders = paramsFromFilters({ has_blunders: true }).toString()
    const answer = place(`?${blunders}&order=black`)
    expect(answer.kind).toBe('cut')
    expect(answer.cut?.id).toBe('with-blunders')
    expect(answer.crumbs).toEqual([{ label: 'Games', to: '/games' }, { label: 'Blunders' }])
    expect(savedCutFromSearch(`?${blunders}`, BUILT_IN_FILTERS)?.id).toBe('with-blunders')
  })

  it('is Collections › the name for a collection shown whole', () => {
    expect(place('?collection=9&whose=all')).toEqual({
      kind: 'collection',
      collectionId: 9,
      crumbs: [{ label: 'Collections', to: '/collections' }, { label: 'Club OTB' }],
    })
  })

  it('names a collection it cannot look up yet without guessing', () => {
    const answer = libraryPlace('?collection=4&whose=all', { i18n, saved: [] })
    expect(answer.crumbs[1]).toEqual({ label: 'Collection' })
  })

  it('is Games (filtered) for anything else, never "Library"', () => {
    const answer = place('?outcome=win&speed=blitz')
    expect(answer).toEqual({ kind: 'filtered', crumbs: [{ label: 'Games (filtered)' }] })
    expect(JSON.stringify([place(''), place('?x=1')])).not.toMatch(/library/i)
  })
})
