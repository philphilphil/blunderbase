import { describe, expect, it } from 'vitest'

import {
  COLLECTION_COLOR_CLASSES,
  COLLECTION_COLORS,
  collectionColorClasses,
  collectionPath,
  collectionStatsPath,
  isRuleEmpty,
  membershipOf,
  ruleFilters,
  ruleFromFilters,
} from './collections'

describe('collection colours', () => {
  it('has classes for every colour key the backend accepts', () => {
    for (const color of COLLECTION_COLORS) {
      expect(COLLECTION_COLOR_CLASSES[color].fill).toMatch(/^bg-/)
    }
  })

  it('reads an unknown key as the default rather than drawing nothing', () => {
    expect(collectionColorClasses('chartreuse')).toBe(COLLECTION_COLOR_CLASSES.accent)
    expect(collectionColorClasses(null)).toBe(COLLECTION_COLOR_CLASSES.accent)
  })

  it('maps accent onto the teal alias, which is what the app calls its accent', () => {
    expect(COLLECTION_COLOR_CLASSES.accent.chip).toContain('accent-teal')
  })
})

describe('collection paths', () => {
  it('is the whole collection in the library, and Stats scoped to it', () => {
    expect(collectionPath(7)).toBe('/games?collection=7&whose=all')
    expect(collectionStatsPath(7)).toBe('/stats?collection=7')
  })
})

describe('ruleFromFilters', () => {
  it('keeps the keys that describe an arriving game and drops the rest', () => {
    expect(
      ruleFromFilters({
        source: 'lichess',
        time_control: '2700+45',
        rated: true,
        // Not rule-able: dates, text, analysis.
        ...({ since: '2026-01-01', text: 'x', has_blunders: true } as object),
      }),
    ).toEqual({ source: 'lichess', time_control: '2700+45', rated: true })
  })

  it('turns one speed into the list a rule holds', () => {
    expect(ruleFromFilters({ speed: 'blitz' })).toEqual({ speed: ['blitz'] })
    expect(ruleFromFilters({ speed: ['blitz', 'rapid'] })).toEqual({ speed: ['blitz', 'rapid'] })
  })

  it('keeps rated=false, which is a rule (casual only) and not an unset one', () => {
    expect(ruleFromFilters({ rated: false })).toEqual({ rated: false })
  })

  it('trims text and upper-cases the ECO prefix', () => {
    expect(ruleFromFilters({ eco: ' c6 ', opponent: '  kestrel ' })).toEqual({
      eco: 'C6',
      opponent: 'kestrel',
    })
  })

  it('answers null for a filter with nothing rule-able in it', () => {
    expect(ruleFromFilters({})).toBeNull()
    expect(ruleFromFilters({ speed: [], opponent: '   ' })).toBeNull()
  })
})

describe('isRuleEmpty', () => {
  it('treats null, {} and empty values as no rule', () => {
    expect(isRuleEmpty(null)).toBe(true)
    expect(isRuleEmpty({})).toBe(true)
    expect(isRuleEmpty({ speed: [], opponent: '' })).toBe(true)
    expect(isRuleEmpty({ rated: false })).toBe(false)
  })
})

describe('ruleFilters', () => {
  it('is the library filter the rule stands for', () => {
    expect(
      ruleFilters({ source: 'lichess', speed: ['classical'], time_control: '2700+45', rated: true }),
    ).toEqual({ source: 'lichess', speed: ['classical'], time_control: '2700+45', rated: true })
  })

  it('round-trips through ruleFromFilters', () => {
    const rule = { source: 'chesscom' as const, color: 'black' as const, eco: 'B1', rated: false }
    expect(ruleFromFilters(ruleFilters(rule))).toEqual(rule)
  })
})

describe('membershipOf', () => {
  const games = [
    { id: 1, collections: [3, 4] },
    { id: 2, collections: [3] },
    { id: 3, collections: [] },
  ]

  it('is all when every game is in', () => {
    expect(membershipOf(games.slice(0, 2), 3)).toEqual({ state: 'all', count: 2 })
  })

  it('is some, with how many, when only part of the selection is in', () => {
    expect(membershipOf(games, 3)).toEqual({ state: 'some', count: 2 })
    expect(membershipOf(games, 4)).toEqual({ state: 'some', count: 1 })
  })

  it('is none when no game is in, or when there are no games', () => {
    expect(membershipOf(games, 9)).toEqual({ state: 'none', count: 0 })
    expect(membershipOf([], 3)).toEqual({ state: 'none', count: 0 })
  })

  it('reads a game without the field as in nothing', () => {
    const bare: { id: number; collections?: number[] }[] = [{ id: 1 }]
    expect(membershipOf(bare, 3)).toEqual({ state: 'none', count: 0 })
  })
})
