import { describe, expect, it } from 'vitest'

import { nextSort } from './sorting'

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
