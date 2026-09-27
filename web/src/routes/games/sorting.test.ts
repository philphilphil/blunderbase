import { describe, expect, it } from 'vitest'

import { DEFAULT_SORT, nextSort, sortFromParams, writeSortParams } from './sorting'

describe('nextSort', () => {
  it('flips the direction when the same column is clicked again', () => {
    expect(nextSort({ key: 'opponent', direction: 'asc' }, 'opponent')).toEqual({
      key: 'opponent',
      direction: 'desc',
    })
  })

  it('starts a new column in the direction that column reads naturally', () => {
    expect(nextSort({ key: 'opponent', direction: 'asc' }, 'worst')).toEqual({
      key: 'worst',
      direction: 'desc',
    })
    expect(nextSort({ key: 'worst', direction: 'desc' }, 'opening')).toEqual({
      key: 'opening',
      direction: 'asc',
    })
  })
})

describe('the sort in the address', () => {
  function written(sort: Parameters<typeof writeSortParams>[1]): string {
    const params = new URLSearchParams()
    writeSortParams(params, sort)
    return params.toString()
  }

  it('leaves the default column and a natural direction out', () => {
    expect(written(DEFAULT_SORT)).toBe('')
    expect(written({ key: 'black', direction: 'asc' })).toBe('order=black')
    expect(written({ key: 'black', direction: 'desc' })).toBe('order=black&direction=desc')
    expect(written({ key: 'played_at', direction: 'asc' })).toBe('direction=asc')
  })

  it('reads back what it wrote, and nonsense as the default', () => {
    for (const sort of [
      DEFAULT_SORT,
      { key: 'black', direction: 'desc' } as const,
      { key: 'worst', direction: 'asc' } as const,
    ]) {
      expect(sortFromParams(new URLSearchParams(written(sort)))).toEqual(sort)
    }
    expect(sortFromParams(new URLSearchParams('order=tier&direction=up'))).toEqual(DEFAULT_SORT)
  })
})
