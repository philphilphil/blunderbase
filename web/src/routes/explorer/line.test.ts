import { describe, expect, it } from 'vitest'

import { buildLine, parseLineParam, plyLabel, truncateTo, withMove } from './line'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

describe('buildLine', () => {
  it('is the initial position for an empty line', () => {
    const line = buildLine([])
    expect(line.fen).toBe(START)
    expect(line.turn).toBe('white')
    expect(line.ply).toBe(0)
    expect(line.lastMove).toBeNull()
    expect(line.truncated).toBe(false)
  })

  it('replays UCI into SAN with the ply each move belongs to', () => {
    const line = buildLine(['e2e4', 'e7e5', 'g1f3', 'b8c6'])
    expect(line.steps.map((step) => step.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6'])
    expect(line.steps.map((step) => step.ply)).toEqual([0, 1, 2, 3])
    expect(line.turn).toBe('white')
    expect(line.lastMove).toBe('b8c6')
  })

  it('produces the FEN the backend normalises, en-passant square included', () => {
    expect(buildLine(['e2e4']).fen).toBe(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
    )
    // The ep square is only written when it can actually be captured, which is exactly
    // what `python-chess`'s `epd(en_passant="legal")` does on the other side.
    expect(buildLine(['e2e4', 'd7d5', 'e4e5', 'f7f5']).fen).toContain(' w KQkq f6 ')
  })

  it('stops at the first move that is not legal instead of throwing', () => {
    const line = buildLine(['e2e4', 'e2e4', 'g1f3'])
    expect(line.steps.map((step) => step.san)).toEqual(['e4'])
    expect(line.truncated).toBe(true)
  })

  it('drops a move that is not UCI at all', () => {
    expect(buildLine(['hello']).steps).toHaveLength(0)
  })

  it('offers the legal destinations the board needs', () => {
    const line = buildLine([])
    expect(line.dests.get('e2')).toEqual(expect.arrayContaining(['e3', 'e4']))
    expect(line.dests.has('e7')).toBe(false)
  })
})

describe('withMove', () => {
  it('extends the line with a legal move', () => {
    const line = buildLine(['e2e4'])
    expect(withMove(line, 'e7', 'e5')).toEqual(['e2e4', 'e7e5'])
  })

  it('refuses a move that is not legal here', () => {
    const line = buildLine(['e2e4'])
    expect(withMove(line, 'e7', 'e4')).toBeNull()
    expect(withMove(line, 'a3', 'a4')).toBeNull()
  })

  it('promotes a pawn reaching the last rank to a queen', () => {
    // 1.b4 a5 2.bxa5 b5 3.axb6 e.p. Na6 4.b7 e6 — White has a pawn on b7 and b8 is empty.
    const line = buildLine(['b2b4', 'a7a5', 'b4a5', 'b7b5', 'a5b6', 'b8a6', 'b6b7', 'e7e6'])
    expect(line.steps.map((step) => step.san)).toEqual([
      'b4',
      'a5',
      'bxa5',
      'b5',
      'axb6',
      'Na6',
      'b7',
      'e6',
    ])
    expect(withMove(line, 'b7', 'b8')?.at(-1)).toBe('b7b8q')
  })
})

describe('truncateTo', () => {
  it('keeps the first `ply` moves', () => {
    const line = buildLine(['e2e4', 'e7e5', 'g1f3'])
    expect(truncateTo(line, 2)).toEqual(['e2e4', 'e7e5'])
    expect(truncateTo(line, 0)).toEqual([])
    expect(truncateTo(line, -3)).toEqual([])
  })
})

describe('the URL form of a line', () => {
  it('reads a comma-separated list and rejects anything that is not a move', () => {
    expect(parseLineParam('e2e4,E7E5, g1f3 ,nope,a7a8q')).toEqual([
      'e2e4',
      'e7e5',
      'g1f3',
      'a7a8q',
    ])
    expect(parseLineParam(null)).toEqual([])
  })
})

describe('plyLabel', () => {
  it('numbers White’s move and elides it for Black’s reply', () => {
    expect(plyLabel(0)).toBe('1.')
    expect(plyLabel(1)).toBe('1…')
    expect(plyLabel(8)).toBe('5.')
    expect(plyLabel(9)).toBe('5…')
  })
})
