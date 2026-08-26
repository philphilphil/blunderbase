import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  BUILT_IN_FILTERS,
  MAX_LABEL_LENGTH,
  readSavedFilters,
  removeSavedFilter,
  resetSavedFilters,
  SAVED_FILTERS_KEY,
  saveFilter,
  suggestLabel,
} from './savedFilters'

/** jsdom in this setup exposes no `localStorage`, so the tests bring their own. */
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
  }
}

let storage: Storage

beforeEach(() => {
  storage = memoryStorage()
  vi.stubGlobal('localStorage', storage)
  resetSavedFilters()
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetSavedFilters()
})

describe('saveFilter', () => {
  it('keeps a cut under a name and reads it back after a reload', () => {
    saveFilter('Rapid losses', { speed: 'rapid', outcome: 'loss' })
    resetSavedFilters()
    expect(readSavedFilters()).toEqual([
      {
        id: 'rapid-losses',
        label: 'Rapid losses',
        filters: { speed: 'rapid', outcome: 'loss' },
        dotClass: 'bg-accent-teal',
      },
    ])
  })

  it('refuses a nameless save and an empty cut', () => {
    expect(saveFilter('  ', { color: 'black' })).toBeNull()
    expect(saveFilter('Everything', {})).toBeNull()
    expect(readSavedFilters()).toEqual([])
  })

  it('does not save the same cut twice', () => {
    const first = saveFilter('Rapid losses', { speed: 'rapid', outcome: 'loss' })
    const again = saveFilter('The same thing', { outcome: 'loss', speed: 'rapid' })
    expect(again).toEqual(first)
    expect(readSavedFilters()).toHaveLength(1)
  })

  it('keeps ids unique when two cuts want the same name', () => {
    saveFilter('Losses', { outcome: 'loss' })
    saveFilter('Losses', { outcome: 'loss', color: 'black' })
    expect(readSavedFilters().map((entry) => entry.id)).toEqual(['losses', 'losses-2'])
  })

  it('does not collide with a built-in’s id', () => {
    const entry = saveFilter('Losses as black', { outcome: 'loss', speed: 'blitz' })
    expect(BUILT_IN_FILTERS.some((row) => row.id === entry?.id)).toBe(false)
  })

  it('truncates a name that would overflow the rail', () => {
    const entry = saveFilter('x'.repeat(80), { color: 'white' })
    expect(entry?.label).toHaveLength(MAX_LABEL_LENGTH)
  })
})

describe('removeSavedFilter', () => {
  it('forgets one cut and leaves the rest', () => {
    saveFilter('Losses', { outcome: 'loss' })
    saveFilter('Wins', { outcome: 'win' })
    removeSavedFilter('losses')
    expect(readSavedFilters().map((entry) => entry.label)).toEqual(['Wins'])
  })
})

describe('readSavedFilters', () => {
  it('falls back to nothing rather than throwing on a corrupt entry', () => {
    storage.setItem(SAVED_FILTERS_KEY, 'not json')
    expect(readSavedFilters()).toEqual([])
  })

  it('drops rows that are not a filter', () => {
    storage.setItem(
      SAVED_FILTERS_KEY,
      JSON.stringify([
        { id: 'ok', label: 'Losses', filters: { outcome: 'loss' } },
        { id: 'no-filters', label: 'Empty', filters: {} },
        { label: 'No id', filters: { color: 'white' } },
        'nonsense',
      ]),
    )
    expect(readSavedFilters().map((entry) => entry.id)).toEqual(['ok'])
  })
})

describe('suggestLabel', () => {
  it('reads back what the chips over the table say', () => {
    expect(suggestLabel({ color: 'black', outcome: 'loss' })).toBe('black · loss')
  })

  it('is empty when nothing is filtered', () => {
    expect(suggestLabel({})).toBe('')
  })
})
