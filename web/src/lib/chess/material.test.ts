import { describe, expect, it } from 'vitest'

import { materialBalance } from './material'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

describe('materialBalance', () => {
  it('shows nothing at all in the starting position', () => {
    expect(materialBalance(START)).toEqual({
      white: { captured: [], advantage: 0 },
      black: { captured: [], advantage: 0 },
      balance: 0,
    })
  })

  it('credits a single capture to the side that made it', () => {
    // 1. e4 d5 2. exd5 — White is a pawn up and Black has taken nothing.
    const after = materialBalance('rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2')
    expect(after.white.captured).toEqual(['pawn'])
    expect(after.black.captured).toEqual([])
    expect(after.balance).toBe(1)
    expect(after.white.advantage).toBe(1)
    expect(after.black.advantage).toBe(-1)
  })

  it('cancels equal takings and lists the surplus heaviest first', () => {
    // A middlegame where both queens, both bishop pairs and two pawns each have gone:
    // all of that cancels. What is left is a rook and a pawn to White, a knight to Black.
    const mid = materialBalance('3r2k1/pp3ppp/4pn2/8/3P4/2P1P3/P4PPP/2R1R1K1 w - - 0 20')
    expect(mid.white.captured).toEqual(['rook', 'pawn'])
    expect(mid.black.captured).toEqual(['knight'])
    expect(mid.balance).toBe(3)
    expect(mid.black.advantage).toBe(-3)
  })

  it('reads level rather than throwing on a FEN it cannot parse', () => {
    expect(materialBalance('not a fen').balance).toBe(0)
    expect(materialBalance('').white.captured).toEqual([])
  })
})
