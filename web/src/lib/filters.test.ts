import { describe, expect, it } from 'vitest'

import { RATINGS, SPEEDS } from '@/routes/explorer/reference'

import { toggleFilter } from './filters'

describe('toggleFilter', () => {
  it('adds a chip back in the canonical order rather than at the end', () => {
    expect(toggleFilter(['blitz', 'classical'], 'rapid', SPEEDS)).toEqual([
      'blitz',
      'rapid',
      'classical',
    ])
  })

  it('removes a chip that is on', () => {
    expect(toggleFilter([1600, 1800, 2000], 1800, RATINGS)).toEqual([1600, 2000])
  })

  it('refuses to empty the filter — one chip left cannot be switched off', () => {
    expect(toggleFilter(['blitz'], 'blitz', SPEEDS)).toEqual(['blitz'])
    expect(toggleFilter([2500], 2500, RATINGS)).toEqual([2500])
  })
})
