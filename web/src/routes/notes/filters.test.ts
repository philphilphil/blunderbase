import { describe, expect, it } from 'vitest'

import {
  clearGroup,
  filterCount,
  filtersFromParams,
  groupSummary,
  paramsFromFilters,
  prune,
  toNoteExportQuery,
  toNoteQuery,
  toggleTag,
} from './filters'

describe('filtersFromParams', () => {
  it('reads every filter the notes route takes', () => {
    const params = new URLSearchParams(
      'q=rook+endgame&tag=endgame&tag=rooks&scope=position&game=412&since=2026-01-01&until=2026-02-01',
    )
    expect(filtersFromParams(params)).toEqual({
      text: 'rook endgame',
      tags: ['endgame', 'rooks'],
      scope: 'position',
      game_id: 412,
      since: '2026-01-01',
      until: '2026-02-01',
    })
  })

  it('drops values it cannot trust rather than passing them to the API', () => {
    const params = new URLSearchParams('q=+&scope=sideways&game=-3&since=yesterday&until=2026-13')
    expect(filtersFromParams(params)).toEqual({})
  })

  it('dedupes and trims the tags', () => {
    const params = new URLSearchParams('tag=endgame&tag=+endgame+&tag=&tag=rooks')
    expect(filtersFromParams(params).tags).toEqual(['endgame', 'rooks'])
  })
})

describe('paramsFromFilters', () => {
  it('round-trips through the URL', () => {
    const filters = {
      text: 'zwischenzug',
      tags: ['tactics', 'blunder'],
      scope: 'line' as const,
      game_id: 7,
      since: '2026-03-01',
      until: '2026-03-31',
    }
    expect(filtersFromParams(paramsFromFilters(filters))).toEqual(filters)
  })

  it('carries the highlighted note along, so a chip change does not lose it', () => {
    const params = paramsFromFilters({ scope: 'game' }, { note: 12 })
    expect(params.get('note')).toBe('12')
    expect(params.get('scope')).toBe('game')
    // …and leaves it out when there is none.
    expect(paramsFromFilters({ scope: 'game' }, { note: null }).has('note')).toBe(false)
    expect(paramsFromFilters({ scope: 'game' }).has('note')).toBe(false)
  })

  it('writes one tag= per tag', () => {
    expect(paramsFromFilters({ tags: ['a', 'b'] }).getAll('tag')).toEqual(['a', 'b'])
  })
})

describe('prune and filterCount', () => {
  it('treats an empty tag list as no filter at all', () => {
    expect(prune({ tags: [] })).toEqual({})
    expect(filterCount({ tags: [], text: '' })).toBe(0)
  })

  it('counts a date range as one filter per end', () => {
    expect(filterCount({ since: '2026-01-01', until: '2026-02-01' })).toBe(2)
  })
})

describe('toNoteQuery', () => {
  it('renames the free text and widens `until` to the end of its day', () => {
    expect(toNoteQuery({ text: 'pin', until: '2026-02-01' }, 50)).toEqual({
      query: 'pin',
      until: '2026-02-01T23:59:59',
      limit: 50,
    })
  })

  it('exports without a page size — the document is capped by the backend', () => {
    expect(toNoteExportQuery({ scope: 'free' })).toEqual({ scope: 'free' })
    expect('limit' in toNoteExportQuery({ scope: 'free' })).toBe(false)
  })
})

describe('the chips', () => {
  it('summarises a group only when it is set', () => {
    expect(groupSummary('tags', {})).toBeNull()
    expect(groupSummary('tags', { tags: ['endgame'] })).toBe('endgame')
    expect(groupSummary('tags', { tags: ['endgame', 'rooks'] })).toBe('2 tags')
    expect(groupSummary('scope', { scope: 'position' })).toBe('on a position')
    expect(groupSummary('game', { game_id: 9 })).toBe('#9')
    expect(groupSummary('date', { since: '2026-01-01' })).toBe('from 2026-01-01')
    expect(groupSummary('date', { until: '2026-01-01' })).toBe('until 2026-01-01')
  })

  it('clears a whole group, both ends of the date included', () => {
    const filters = { text: 'pin', since: '2026-01-01', until: '2026-02-01' }
    expect(clearGroup(filters, 'date')).toEqual({ text: 'pin' })
  })

  it('toggles one tag and keeps the rest', () => {
    expect(toggleTag({ tags: ['a'] }, 'b').tags).toEqual(['a', 'b'])
    expect(toggleTag({ tags: ['a', 'b'] }, 'a').tags).toEqual(['b'])
    expect(toggleTag({ tags: ['a'] }, 'a')).toEqual({})
  })
})
