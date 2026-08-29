import { describe, expect, it } from 'vitest'

import {
  clearGroup,
  filterCount,
  filtersFromParams,
  groupSummary,
  paramsFromFilters,
  prune,
  toGameQuery,
  type LibraryFilters,
} from './filters'

describe('filtersFromParams', () => {
  it('reads every filter the backend takes', () => {
    const params = new URLSearchParams(
      'since=2016-12-01&until=2016-12-07&source=lichess&color=black&eco=b2&result=1-0' +
        '&outcome=loss&speed=rapid&time_control=600%2B0&opponent=chillzone' +
        '&has_blunders=true&analyzed=false&deep_analyzed=false&q=alapin',
    )
    expect(filtersFromParams(params)).toEqual({
      since: '2016-12-01',
      until: '2016-12-07',
      source: 'lichess',
      color: 'black',
      eco: 'B2',
      result: '1-0',
      outcome: 'loss',
      speed: 'rapid',
      time_control: '600+0',
      opponent: 'chillzone',
      has_blunders: true,
      analyzed: false,
      deep_analyzed: false,
      text: 'alapin',
    })
  })

  it('drops values the backend would reject rather than sending them', () => {
    const params = new URLSearchParams(
      'source=fide&color=green&result=2-0&speed=hyper&since=december&has_blunders=maybe',
    )
    expect(filtersFromParams(params)).toEqual({})
  })

  it('round-trips through the query string', () => {
    const filters: LibraryFilters = {
      color: 'white',
      outcome: 'win',
      has_blunders: true,
      text: 'sicilian',
    }
    expect(filtersFromParams(paramsFromFilters(filters))).toEqual(filters)
  })

  it('keeps the free-text filter under the shorter `q`', () => {
    expect(paramsFromFilters({ text: 'tal' }).toString()).toBe('q=tal')
  })
})

describe('toGameQuery', () => {
  it('widens `until` to the end of its day, so the last day is included', () => {
    expect(toGameQuery({ since: '2016-12-01', until: '2016-12-07' })).toEqual({
      since: '2016-12-01',
      until: '2016-12-07T23:59:59',
    })
  })

  it('leaves a query with no dates alone', () => {
    expect(toGameQuery({ color: 'black' })).toEqual({ color: 'black' })
  })
})

describe('prune and filterCount', () => {
  it('treats an empty string as unset', () => {
    expect(prune({ eco: '', opponent: 'x' })).toEqual({ opponent: 'x' })
  })

  it('counts `false` as a set filter, because it narrows', () => {
    expect(filterCount({ deep_analyzed: false })).toBe(1)
    expect(filterCount({})).toBe(0)
  })
})

describe('groups', () => {
  it('summarises a group for its chip', () => {
    expect(groupSummary('color', { color: 'black' })).toBe('black')
    expect(groupSummary('result', { outcome: 'loss', result: '1-0' })).toBe('loss · 1-0')
    expect(groupSummary('analysis', { has_blunders: false })).toBe('no blunders')
    expect(groupSummary('analysis', { analyzed: false })).toBe('unanalysed')
    expect(groupSummary('date', { until: '2016-12-07' })).toBe('until 2016-12-07')
    expect(groupSummary('opponent', {})).toBeNull()
  })

  it('clears every key a group owns and nothing else', () => {
    const filters: LibraryFilters = {
      since: '2016-01-01',
      until: '2016-12-31',
      color: 'white',
    }
    expect(clearGroup(filters, 'date')).toEqual({ color: 'white' })
  })
})
