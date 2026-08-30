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

/**
 * A line rooted at a bare position — how a note written about a position links back into
 * the explorer, where nobody recorded the move order that reached it.
 */
describe('a line rooted at a position', () => {
  // After 1.e4 c5 2.Nf3: Black to move, so ply 3 is the next half-move.
  const SICILIAN = 'rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2'

  it('counts plies from the root rather than from the initial array', () => {
    const line = buildLine([], SICILIAN)
    expect(line.fen).toBe(SICILIAN)
    expect(line.turn).toBe('black')
    expect(line.basePly).toBe(3)
    expect(line.ply).toBe(3)
    expect(line.steps).toEqual([])
  })

  it('numbers moves played from the root the way a player would call them', () => {
    const line = buildLine(['b8c6', 'd2d4'], SICILIAN)
    expect(line.steps.map((step) => step.san)).toEqual(['Nc6', 'd4'])
    expect(line.steps.map((step) => step.ply)).toEqual([3, 4])
    expect(plyLabel(line.steps[1]!.ply)).toBe('3.')
    expect(line.ply).toBe(5)
  })

  it('truncates on an absolute ply and clamps below the root to the root itself', () => {
    const line = buildLine(['b8c6', 'd2d4'], SICILIAN)
    expect(truncateTo(line, 4)).toEqual(['b8c6'])
    // What the breadcrumb's `start` crumb asks for: everything back to the root.
    expect(truncateTo(line, 0)).toEqual([])
  })

  it('plays a further move from the root position, not from the initial array', () => {
    const line = buildLine([], SICILIAN)
    expect(withMove(line, 'b8', 'c6')).toEqual(['b8c6'])
    // White is not to move here, so a white move is not legal.
    expect(withMove(line, 'd2', 'd4')).toBeNull()
  })

  it('falls back to the initial array rather than throwing on a FEN it cannot read', () => {
    const line = buildLine([], 'not a position')
    expect(line.fen).toBe(START)
    expect(line.basePly).toBe(0)
  })
})
