import { describe, expect, it } from 'vitest'

import { dayStart, localDay } from '@/lib/days'

import {
  DEFAULT_RATINGS,
  DEFAULT_SPEEDS,
  formatCount,
  formatCsv,
  ownFilterQuery,
  parseDayRange,
  parseOwnSpeeds,
  playedDays,
  parsePeriod,
  parseRatings,
  parseSource,
  parseSpeeds,
  resultOf,
  sharePercent,
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

describe('the owner’s own filters', () => {
  it('reads every speed, correspondence included, and falls back to all of them', () => {
    expect(parseOwnSpeeds('correspondence,blitz')).toEqual(['blitz', 'correspondence'])
    expect(parseOwnSpeeds(null)).toEqual([
      'bullet',
      'blitz',
      'rapid',
      'classical',
      'correspondence',
    ])
    expect(parseOwnSpeeds('nonsense')).toHaveLength(5)
  })

  it('reads a quick pick and nothing else', () => {
    expect(parsePeriod('90d')).toBe('90d')
    expect(parsePeriod('today')).toBe('today')
    expect(parsePeriod('all')).toBeNull()
    expect(parsePeriod(null)).toBeNull()
  })

  it('sends nothing for every speed and every game', () => {
    expect(ownFilterQuery(parseOwnSpeeds(null), null)).toEqual({})
  })

  it('sends a pick as the local midnight it reaches back to, open to now', () => {
    const query = ownFilterQuery(['blitz'], '30d')
    expect(query).toEqual({ speed: ['blitz'], since: dayStart(localDay(30)) })
  })

  it('reads a day range, either end open, the right way round', () => {
    expect(parseDayRange(null, null)).toBeNull()
    expect(parseDayRange('garbage', '')).toBeNull()
    expect(parseDayRange('2026-09-27', null)).toEqual({ from: '2026-09-27', to: undefined })
    expect(parseDayRange('2026-09-27', '2026-09-01')).toEqual({
      from: '2026-09-01',
      to: '2026-09-27',
    })
  })

  it('sends a typed range as the reader’s local midnights, over the pick', () => {
    const query = ownFilterQuery(parseOwnSpeeds(null), '30d', null, {
      from: '2026-09-27',
      to: '2026-09-27',
    })
    expect(query.since).toBe(new Date(2026, 8, 27).toISOString())
    expect(query.until).toBe(new Date(2026, 8, 27, 23, 59, 59, 999).toISOString())
  })

  it('shows a pick as the dates it means', () => {
    expect(playedDays('today', null)).toEqual({ from: localDay(), to: undefined })
    expect(playedDays(null, null)).toBeNull()
  })
})
