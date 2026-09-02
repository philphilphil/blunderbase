import { describe, expect, it } from 'vitest'

import {
  DEFAULT_RATINGS,
  DEFAULT_SPEEDS,
  RATINGS,
  SPEEDS,
  formatCount,
  formatCsv,
  parseRatings,
  parseSource,
  parseSpeeds,
  resultOf,
  sharePercent,
  toggleFilter,
} from './reference'

describe('parseSource', () => {
  it('answers the owner’s own games for anything it does not recognise', () => {
    expect(parseSource(null)).toBe('mine')
    expect(parseSource('')).toBe('mine')
    expect(parseSource('everything')).toBe('mine')
    expect(parseSource('mine')).toBe('mine')
  })

  it('reads the two reference books', () => {
    expect(parseSource('masters')).toBe('masters')
    expect(parseSource('lichess')).toBe('lichess')
  })
})

describe('parseSpeeds', () => {
  it('falls back to the defaults when the param says nothing usable', () => {
    expect(parseSpeeds(null)).toEqual([...DEFAULT_SPEEDS])
    expect(parseSpeeds('')).toEqual([...DEFAULT_SPEEDS])
    expect(parseSpeeds('correspondence,ultrabullet')).toEqual([...DEFAULT_SPEEDS])
  })

  it('keeps what it recognises, in the canonical order, without duplicates', () => {
    expect(parseSpeeds('rapid,bullet,rapid')).toEqual(['bullet', 'rapid'])
    expect(parseSpeeds(' BLITZ , classical ')).toEqual(['blitz', 'classical'])
  })
})

describe('parseRatings', () => {
  it('drops buckets Lichess does not have and falls back when nothing is left', () => {
    expect(parseRatings('1700,1900')).toEqual([...DEFAULT_RATINGS])
    expect(parseRatings(null)).toEqual([...DEFAULT_RATINGS])
  })

  it('keeps real buckets in ascending order', () => {
    expect(parseRatings('2000,1000')).toEqual([1000, 2000])
    expect(parseRatings('2500')).toEqual([2500])
  })
})

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

describe('formatCount', () => {
  it('shortens the millions and the ten-thousands and leaves small counts alone', () => {
    expect(formatCount(2_640_000)).toBe('2.6M')
    expect(formatCount(12_450)).toBe('12.4k')
    expect(formatCount(9_999)).toBe('9999')
    expect(formatCount(482)).toBe('482')
    expect(formatCount(0)).toBe('0')
  })

  it('never rounds a count up into a bigger number than it is', () => {
    expect(formatCount(1_999_999)).toBe('1.9M')
    expect(formatCount(19_999)).toBe('19.9k')
  })
})

describe('sharePercent', () => {
  it('is a whole percent of the position’s total', () => {
    expect(sharePercent(25, 100)).toBe(25)
    expect(sharePercent(1, 3)).toBe(33)
  })

  it('is null when there is nothing to take a share of', () => {
    expect(sharePercent(0, 0)).toBeNull()
  })
})

describe('resultOf', () => {
  it('reads a null winner as the draw it is', () => {
    expect(resultOf('white')).toBe('1-0')
    expect(resultOf('black')).toBe('0-1')
    expect(resultOf(null)).toBe('1/2-1/2')
    expect(resultOf(undefined)).toBe('1/2-1/2')
  })
})

describe('formatCsv', () => {
  it('is what both the URL and the backend take', () => {
    expect(formatCsv(['blitz', 'rapid'])).toBe('blitz,rapid')
    expect(formatCsv([1600, 1800])).toBe('1600,1800')
  })
})
