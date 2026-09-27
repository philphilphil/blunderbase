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
      text: 'alapin',
    })
    // `deep_analyzed` is from the days of two passes: an old link carrying it still reads.
    expect(filtersFromParams(params)).not.toHaveProperty('deep_analyzed')
  })

  it('reads whose games to show, and never the default spelled out', () => {
    // The default cut is the owner's games and a URL does not spell the default, so the
    // two values that change it are read and `whose=mine` is the same as saying nothing.
    expect(filtersFromParams(new URLSearchParams('whose=others'))).toEqual({ whose: 'others' })
    expect(filtersFromParams(new URLSearchParams('whose=all'))).toEqual({ whose: 'all' })
    expect(filtersFromParams(new URLSearchParams('whose=mine'))).toEqual({})
    expect(filtersFromParams(new URLSearchParams('whose=theirs'))).toEqual({})
    expect(paramsFromFilters({ whose: 'all' }).toString()).toBe('whose=all')
    expect(toGameQuery({ whose: 'others' })).toEqual({ whose: 'others' })
  })

  it('treats a collection as one more filter, over the owner’s games unless it says otherwise', () => {
    // No default of its own: `collection=7` is the owner's games in it, and a link that
    // means every game in it spells `whose=all`, which survives as it would anywhere.
    expect(filtersFromParams(new URLSearchParams('collection=7'))).toEqual({ collection: 7 })
    expect(filtersFromParams(new URLSearchParams('collection=7&whose=all'))).toEqual({
      collection: 7,
      whose: 'all',
    })
    expect(filtersFromParams(new URLSearchParams('collection=7&whose=mine'))).toEqual({
      collection: 7,
    })
    expect(toGameQuery({ collection: 7 })).toEqual({ collection: 7 })
    expect(toGameQuery({ collection: 7, whose: 'all' })).toEqual({ collection: 7, whose: 'all' })
    expect(filterCount({ collection: 7, whose: 'all' })).toBe(2)
    // Adding a collection and clearing it again leaves an explicit `whose` where it was.
    expect(clearGroup({ collection: 7, whose: 'all' }, 'collection')).toEqual({ whose: 'all' })
    expect(prune({ collection: 7, whose: 'all' })).toEqual({ collection: 7, whose: 'all' })
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
    expect(filterCount({ analyzed: false })).toBe(1)
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

describe('collections and rated', () => {
  it('reads a collection id and the rated flag, and puts the collection first in the URL', () => {
    const filters = filtersFromParams(new URLSearchParams('rated=true&source=lichess&collection=7'))
    expect(filters).toEqual({ collection: 7, source: 'lichess', rated: true })
    expect(paramsFromFilters(filters).toString()).toBe('collection=7&source=lichess&rated=true')
    expect(filtersFromParams(new URLSearchParams('rated=false')).rated).toBe(false)
  })

  it('drops a collection that is not an id', () => {
    for (const bad of ['0', '-3', '2.5', 'league', '']) {
      expect(filtersFromParams(new URLSearchParams(`collection=${bad}`))).toEqual({})
    }
  })

  it('passes both through to the API query', () => {
    expect(toGameQuery({ collection: 7, rated: false })).toEqual({ collection: 7, rated: false })
  })

  it('reads rated or casual on the Time control chip, and clears it with the clock', () => {
    expect(groupSummary('time', { time_control: '2700+45', rated: true })).toBe('2700+45 · rated')
    expect(groupSummary('time', { rated: false })).toBe('casual')
    expect(clearGroup({ time_control: '2700+45', rated: true, color: 'white' }, 'time')).toEqual({
      color: 'white',
    })
  })

  it('names the collection on its chip, or falls back to the id', () => {
    const names = (id: number) => (id === 7 ? '45-45 League' : undefined)
    expect(groupSummary('collection', { collection: 7 }, names)).toBe('45-45 League')
    expect(groupSummary('collection', { collection: 9 }, names)).toBe('#9')
    expect(groupSummary('collection', { collection: 9 })).toBe('#9')
    expect(groupSummary('collection', {})).toBeNull()
  })

  it('counts the collection as a filter', () => {
    expect(filterCount({ collection: 7, color: 'black' })).toBe(2)
  })
})
