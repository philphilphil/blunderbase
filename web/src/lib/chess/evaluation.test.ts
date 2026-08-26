import { describe, expect, it } from 'vitest'

import {
  MINUS,
  formatAccuracy,
  formatCp,
  formatMate,
  formatNodes,
  formatPercent,
  formatScore,
  formatWinLoss,
  moveNumberLabel,
  whiteWinPercent,
  winPercent,
  winPercentToCp,
  winningChances,
} from './evaluation'

describe('formatCp', () => {
  it('writes centipawns as signed pawns with two decimals', () => {
    expect(formatCp(124)).toBe('+1.24')
    expect(formatCp(4)).toBe('+0.04')
    expect(formatCp(0)).toBe('+0.00')
  })

  it('uses the typographic minus the design sets negatives in', () => {
    expect(formatCp(-278)).toBe(`${MINUS}2.78`)
    expect(MINUS).toBe('−')
  })

  it('can drop the plus for an unsigned context', () => {
    expect(formatCp(296, { signed: false })).toBe('2.96')
    expect(formatCp(-31, { signed: false })).toBe(`${MINUS}0.31`)
  })
})

describe('formatMate', () => {
  it('names the side that mates', () => {
    expect(formatMate(5)).toBe('M5')
    expect(formatMate(-3)).toBe(`${MINUS}M3`)
  })

  it('renders a finished game as a hash', () => {
    expect(formatMate(0)).toBe('#')
  })
})

describe('formatScore', () => {
  it('prefers mate over centipawns', () => {
    expect(formatScore({ cp: -900, mate: 2 })).toBe('M2')
  })

  it('falls back to an em dash when nothing has been computed', () => {
    expect(formatScore(null)).toBe('—')
    expect(formatScore({})).toBe('—')
    expect(formatScore({ cp: null, mate: null })).toBe('—')
    expect(formatScore(undefined, { empty: '·' })).toBe('·')
  })

  it('formats a centipawn score', () => {
    expect(formatScore({ cp: 150 })).toBe('+1.50')
  })
})

describe('winPercent', () => {
  it('is even at a level position', () => {
    expect(winPercent({ cp: 0 })).toBe(50)
  })

  it('matches backend.services.analysis.win_percent', () => {
    // The reference implementation: 50 + 50 * (2 / (1 + exp(-K * cp)) - 1), rounded to 2.
    expect(winPercent({ cp: 100 })).toBeCloseTo(59.1, 1)
    expect(winPercent({ cp: -100 })).toBeCloseTo(40.9, 1)
    expect(winPercent({ cp: 100 }) + winPercent({ cp: -100 })).toBeCloseTo(100, 6)
  })

  it('clamps far-from-level scores so +12 and +30 are one kind of winning', () => {
    expect(winPercent({ cp: 1000 })).toBe(winPercent({ cp: 3000 }))
  })

  it('treats a mate as worth (21 - min(10, N)) pawns', () => {
    expect(winPercent({ mate: 1 })).toBeGreaterThan(winPercent({ mate: 8 }))
    expect(winPercent({ mate: 8 })).toBeGreaterThan(winPercent({ cp: 900 }))
    expect(winPercent({ mate: 10 })).toBe(winPercent({ mate: 30 }))
  })

  it('reads the sign off the folded centipawns when mate is zero', () => {
    expect(winPercent({ mate: 0, cp: -1 })).toBeLessThan(50)
    expect(winPercent({ mate: 0, cp: 1 })).toBeGreaterThan(50)
  })

  it('reports no evaluation as dead level rather than as losing', () => {
    expect(winningChances({})).toBe(0)
    expect(winPercent({ cp: null, mate: null })).toBe(50)
  })
})

describe('winPercentToCp', () => {
  it('inverts the centipawn branch of the curve', () => {
    for (const cp of [-800, -250, -10, 0, 10, 250, 800]) {
      expect(winPercentToCp(winPercent({ cp }))).toBeCloseTo(cp, 0)
    }
  })
})

describe('whiteWinPercent', () => {
  it('flips a score given from Black’s point of view', () => {
    expect(whiteWinPercent({ cp: 100 }, 'white')).toBeCloseTo(59.1, 1)
    expect(whiteWinPercent({ cp: 100 }, 'black')).toBeCloseTo(40.9, 1)
  })
})

describe('formatWinLoss', () => {
  it('writes a drop in percentage points, always negative', () => {
    expect(formatWinLoss(27.4)).toBe(`${MINUS}27.4%`)
    expect(formatWinLoss(0)).toBe('0.0%')
    expect(formatWinLoss(null)).toBe('—')
  })
})

describe('small formatters', () => {
  it('formats percentages and accuracies', () => {
    expect(formatPercent(62.417)).toBe('62.4%')
    expect(formatPercent(null)).toBe('—')
    expect(formatAccuracy(78.44)).toBe('78.4')
    expect(formatAccuracy(undefined)).toBe('—')
  })

  it('formats node budgets the way the design writes them', () => {
    expect(formatNodes(40_000_000)).toBe('40M')
    expect(formatNodes(4500)).toBe('4.5k')
    expect(formatNodes(120)).toBe('120')
    expect(formatNodes(null)).toBe('—')
  })

  it('numbers moves from a zero-based ply, White on the even ones', () => {
    expect(moveNumberLabel(0)).toBe('1.')
    expect(moveNumberLabel(1)).toBe('1…')
    expect(moveNumberLabel(46)).toBe('24.')
    expect(moveNumberLabel(47)).toBe('24…')
  })
})
