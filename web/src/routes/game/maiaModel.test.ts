/**
 * The multi-level Maia derivations: which level a position speaks for, what a reader may
 * switch to, and the grid that reads every level at once.
 *
 * A separate file from `gameModel.test.ts` because these are one feature's worth of
 * derivation over that module rather than more of the same — the whole of the panel's
 * behaviour is decided here, and none of it needs a DOM.
 */
import { describe, expect, it } from 'vitest'

import type { MoveRow } from '@/lib/api/types'

import {
  buildGameLine,
  engineLines,
  maiaComparison,
  maiaLevelFor,
  maiaLevelOptions,
  maiaLevels,
  maiaLive,
  maiaLiveLevels,
  nearestLevel,
  preferredLevel,
} from './gameModel'

/** 1.e4 d5 — the blunder the panel exists to explain. */
const OPENING: MoveRow[] = [
  { ply: 0, move_number: 1, san: 'e4', uci: 'e2e4' },
  {
    ply: 1,
    move_number: 1,
    san: 'd5',
    uci: 'd7d5',
    classification: 'blunder',
    win_loss: 26.3,
    eval_after_cp: -300,
    best_lines: [
      { multipv: 1, cp: 40, mate: null, pv: ['c7c6', 'd2d4'] },
      { multipv: 2, cp: 120, mate: null, pv: ['e7e6', 'd2d4'] },
    ],
  },
]

/** The same position at three levels: the blunder is popular below, and gone above. */
const POLICY = {
  '1100': [
    { uci: 'd7d5', san: 'd5', rank: 1, p: 0.71 },
    { uci: 'a7a6', san: 'a6', rank: 2, p: 0.12 },
    { uci: 'e7e6', san: 'e6', rank: 3, p: 0.09 },
  ],
  '1700': [
    { uci: 'd7d5', san: 'd5', rank: 1, p: 0.42 },
    { uci: 'c7c6', san: 'c6', rank: 2, p: 0.3 },
    { uci: 'e7e6', san: 'e6', rank: 3, p: 0.2 },
  ],
  '2000': [
    { uci: 'c7c6', san: 'c6', rank: 1, p: 0.51 },
    { uci: 'e7e6', san: 'e6', rank: 2, p: 0.3 },
    { uci: 'g8f6', san: 'Nf6', rank: 3, p: 0.1 },
    { uci: 'd7d5', san: 'd5', rank: 4, p: 0.04 },
  ],
}

describe('maiaLiveLevels', () => {
  it('reads every level of one query, lowest first, with its own rollout', () => {
    const views = maiaLiveLevels({
      elo: 1500,
      policy: [{ uci: 'g8f6', san: 'Nf6', rank: 1, p: 0.4 }],
      rollout: [{ uci: 'g8f6', san: 'Nf6', p: 0.4 }],
      levels: {
        '1500': {
          elo: 1500,
          policy: [{ uci: 'g8f6', san: 'Nf6', rank: 1, p: 0.4 }],
          rollout: [{ uci: 'g8f6', san: 'Nf6', p: 0.4 }],
        },
        '1100': {
          elo: 1100,
          policy: [{ uci: 'b8c6', san: 'Nc6', rank: 1, p: 0.3 }],
          rollout: [],
        },
      },
    })
    expect(views.map((view) => view.level.rating)).toEqual(['1100', '1500'])
    expect(views[1].rollout.map((move) => move.san)).toEqual(['Nf6'])
  })

  it('reads a payload with no `levels` at all as the one level it names', () => {
    // The shape the board read before there was more than one level, and what an older
    // deployment still answers with.
    const views = maiaLiveLevels({ elo: 1700, policy: [{ uci: 'g8f6', san: 'Nf6', rank: 1 }] })
    expect(views).toHaveLength(1)
    expect(views[0].level.rating).toBe('1700')
    expect(maiaLive({ elo: 1700, policy: [{ uci: 'g8f6', san: 'Nf6', rank: 1 }] })?.level.rating).toBe(
      '1700',
    )
  })

  it('folds a build that answers every question with one level into one column', () => {
    // A fixed-weights engine asked at three levels: three keys, one answer, and a
    // comparison of it against itself would be a comparison nobody made.
    const views = maiaLiveLevels({
      elo: 1900,
      policy: [{ uci: 'g8f6', san: 'Nf6', rank: 1, p: 0.4 }],
      levels: {
        '1100': { elo: 1900, policy: [{ uci: 'g8f6', san: 'Nf6', rank: 1, p: 0.4 }] },
        '1700': { elo: 1900, policy: [{ uci: 'g8f6', san: 'Nf6', rank: 1, p: 0.4 }] },
      },
    })
    expect(views).toHaveLength(1)
    expect(views[0].level.rating).toBe('1900')
  })

  it('claims no level for a build that named none, whatever it was asked at', () => {
    const views = maiaLiveLevels({
      elo: null,
      policy: [],
      levels: { '1700': { elo: null, policy: [{ uci: 'g8f6', san: 'Nf6', rank: 1 }] } },
    })
    expect(views).toHaveLength(1)
    expect(views[0].level.rating).toBeNull()
  })

  it('is nothing at all where there is no policy to show', () => {
    expect(maiaLiveLevels(null)).toEqual([])
    expect(maiaLiveLevels({ elo: 1700, policy: [], levels: {} })).toEqual([])
  })
})

describe('nearestLevel', () => {
  const levels = maiaLevels(POLICY)

  it('is exactly the level asked for where it is there', () => {
    expect(nearestLevel(levels, 1700)?.rating).toBe('1700')
  })

  it('is the nearest level rather than nothing for a pick nobody computed', () => {
    // A standing pick of 1900 against a run made at 1100/1700/2000: the nearest human it
    // has is a better answer than an empty column.
    expect(nearestLevel(levels, 1900)?.rating).toBe('2000')
    expect(nearestLevel(levels, 1200)?.rating).toBe('1100')
  })

  it('has nothing to say without a pick, or without a named level', () => {
    expect(nearestLevel(levels, null)).toBeNull()
    expect(nearestLevel([{ rating: null, moves: [] }], 1700)).toBeNull()
  })
})

describe('maiaLevelFor', () => {
  const levels = maiaLevels(POLICY)

  it('honours the reader’s pick over both the game and the deployment', () => {
    expect(maiaLevelFor(levels, 1100, 1500, 2000)?.rating).toBe('1100')
  })

  it('resolves a pick the run was never made at to the nearest it has', () => {
    const legacy = maiaLevels({ '1300': POLICY['1100'], '1500': POLICY['1700'] })
    expect(maiaLevelFor(legacy, 1700, 1500, 2000)?.rating).toBe('1500')
  })

  it('falls back to the deployment’s first level where nobody has picked', () => {
    expect(maiaLevelFor(levels, null, 1500, 2000)?.rating).toBe('2000')
    // And to what the run was actually computed for, where that level is not among them.
    const legacy = maiaLevels({ '1300': POLICY['1100'], '1500': POLICY['1700'] })
    expect(maiaLevelFor(legacy, null, 1450, 2000)?.rating).toBe('1500')
    expect(preferredLevel(legacy, 1450, 2000)?.rating).toBe('1500')
  })

  it('is nothing where the position carries no level at all', () => {
    expect(maiaLevelFor([], 1700, 1500, 1700)).toBeNull()
  })
})

describe('maiaLevelOptions', () => {
  it('offers what the position has and what the deployment is configured for', () => {
    const options = maiaLevelOptions(maiaLevels(POLICY), [1500, 1700])
    expect(options).toEqual([
      // Computed but no longer configured: still readable, so still offered.
      { elo: 1100, available: true },
      // Configured but never computed here: offered disabled, because the fix is a pass.
      { elo: 1500, available: false },
      { elo: 1700, available: true },
      { elo: 2000, available: true },
    ])
  })

  it('offers the configured levels alone on a game nobody has analysed', () => {
    expect(maiaLevelOptions([], [1700, 1100])).toEqual([
      { elo: 1100, available: false },
      { elo: 1700, available: false },
    ])
  })

  it('leaves out a level nothing can name', () => {
    // A live answer from a fixed-weights build: there is no number to switch to.
    expect(maiaLevelOptions([{ rating: null, moves: [] }], null)).toEqual([])
  })
})

describe('maiaComparison', () => {
  const line = buildGameLine(OPENING)
  const played = OPENING[1]
  const lines = engineLines(line, 1, played)
  const columns = maiaComparison(maiaLevels(POLICY), lines, played)

  it('is one column per level, lowest first, three moves deep', () => {
    expect(columns.map((column) => column.rating)).toEqual(['1100', '1700', '2000'])
    expect(columns.every((column) => column.moves.length === 3)).toBe(true)
    expect(columns[0].moves.map((move) => move.san)).toEqual(['d5', 'a6', 'e6'])
  })

  it('carries the engine’s verdict into every column — it does not change with the level', () => {
    for (const column of columns) {
      expect(column.played?.classification).toBe('blunder')
      expect(column.played?.loss).toBe(26.3)
    }
    expect(columns[2].moves[0]).toMatchObject({ san: 'c6', classification: 'best', multipv: 1 })
  })

  it('keeps the played move on the column that did not rank it in its top three', () => {
    // The whole comparison: everybody at 1100 plays it, and a 2000 barely considers it.
    expect(columns[0].moves[0]).toMatchObject({ san: 'd5', played: true, probability: 0.71 })
    expect(columns[2].moves.some((move) => move.played)).toBe(false)
    expect(columns[2].played).toMatchObject({ san: 'd5', rank: 4, probability: 0.04 })
  })

  it('reads a live position, where there are no engine lines to cross', () => {
    const live = maiaLiveLevels({
      elo: 1100,
      policy: POLICY['1100'],
      levels: {
        '1100': { elo: 1100, policy: POLICY['1100'] },
        '2000': { elo: 2000, policy: POLICY['2000'] },
      },
    })
    const off = maiaComparison(
      live.map((view) => view.level),
      [],
      undefined,
    )
    expect(off.map((column) => column.rating)).toEqual(['1100', '2000'])
    expect(off.every((column) => column.played === null)).toBe(true)
    expect(off[0].moves.every((move) => move.classification === null)).toBe(true)
  })

  it('has as many columns as there are levels, and none without', () => {
    expect(maiaComparison([], lines, played)).toEqual([])
  })
})
