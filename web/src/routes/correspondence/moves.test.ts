import { describe, expect, it } from 'vitest'

import { destsFor, parseMoveText, positionOf, uciFor } from './moves'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
/** White to move with a pawn on b7 and nothing in its way. */
const PROMOTING = '4k3/1P6/8/8/8/8/8/4K3 w - - 0 1'

describe('reading a board move', () => {
  it('answers with the UCI of a legal move', () => {
    expect(uciFor(START, 'e2', 'e4')).toBe('e2e4')
  })

  it('answers with nothing for a move the position refuses', () => {
    expect(uciFor(START, 'e2', 'e5')).toBeNull()
    expect(uciFor(START, 'e7', 'e5')).toBeNull()
  })

  it('promotes a pawn reaching the last rank to a queen', () => {
    expect(uciFor(PROMOTING, 'b7', 'b8')).toBe('b7b8q')
  })

  it('survives a FEN that is not a position', () => {
    expect(uciFor('not a fen', 'e2', 'e4')).toBeNull()
    expect(positionOf('not a fen')).toBeNull()
    expect(destsFor('not a fen').size).toBe(0)
  })
})

describe('reading a typed move', () => {
  it('takes SAN, which is how a move arrives by mail', () => {
    expect(parseMoveText(START, 'e4')).toBe('e2e4')
    expect(parseMoveText(START, 'Nf3')).toBe('g1f3')
  })

  it('takes UCI, which is how the API spells one', () => {
    expect(parseMoveText(START, 'g1f3')).toBe('g1f3')
    expect(parseMoveText(PROMOTING, 'b7b8q')).toBe('b7b8q')
  })

  it('takes a move number in front of it, the way the mail writes one', () => {
    expect(parseMoveText(START, '1.e4')).toBe('e2e4')
  })

  it('answers with nothing for a typo, an illegal move and an empty box', () => {
    expect(parseMoveText(START, 'Nf6')).toBeNull()
    expect(parseMoveText(START, 'zz')).toBeNull()
    expect(parseMoveText(START, '   ')).toBeNull()
  })
})
