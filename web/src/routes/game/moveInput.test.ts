import { Chess } from 'chessops/chess'
import { parseFen } from 'chessops/fen'
import { describe, expect, it } from 'vitest'

import { legalMoves, resolveTypedMove } from './moveInput'

function position(fen: string): Chess {
  return Chess.fromSetup(parseFen(fen).unwrap()).unwrap()
}

const START = position('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
/**
 * Knights on b1 and f1 that can both reach d2; a bishop on d4 and the b-pawn that can both
 * take the knight on c3; a second bishop on e2 that is the only piece able to reach d3.
 */
const TWO_KNIGHTS = position('r3k2r/ppp2ppp/8/8/3B4/2n5/PPP1BPPP/RN2KN1R w KQkq - 0 1')
/** White can castle either way; the pawn on e7 promotes on e8, giving no check from there. */
const CASTLE_AND_PROMOTE = position('8/4P3/1k6/8/8/8/8/R3K2R w KQ - 0 1')

function san(fen: Chess, text: string, locale: 'en' | 'de' = 'en'): string | null {
  const result = resolveTypedMove(fen, text, locale)
  return result.kind === 'move' ? result.move.san : null
}

describe('resolveTypedMove', () => {
  it('reads SAN, UCI and a lower-case piece letter as the same move', () => {
    expect(san(START, 'Nf3')).toBe('Nf3')
    expect(san(START, 'nf3')).toBe('Nf3')
    expect(san(START, 'g1f3')).toBe('Nf3')
    expect(san(START, ' e4 ')).toBe('e4')
  })

  it('does not need the signs the position already knows', () => {
    expect(san(TWO_KNIGHTS, 'bc3')).toBe('bxc3')
    expect(san(TWO_KNIGHTS, 'Bc3')).toBe('Bxc3')
    expect(san(TWO_KNIGHTS, 'Bxc3+')).toBe('Bxc3')
    expect(san(CASTLE_AND_PROMOTE, 'e8Q')).toBe('e8=Q')
    expect(san(CASTLE_AND_PROMOTE, 'e8=n')).toBe('e8=N')
    expect(san(CASTLE_AND_PROMOTE, 'e7e8r')).toBe('e8=R')
  })

  it('reads the piece letters of the reader’s language', () => {
    expect(san(START, 'Sf3', 'de')).toBe('Nf3')
    expect(san(START, 'sf3', 'de')).toBe('Nf3')
    expect(san(TWO_KNIGHTS, 'Lc3', 'de')).toBe('Bxc3')
    expect(san(CASTLE_AND_PROMOTE, 'e8D', 'de')).toBe('e8=Q')
    // English letters keep working in German — the store spells them that way.
    expect(san(START, 'Nf3', 'de')).toBe('Nf3')
    // And `d` is still a file: the d-pawn, not the Dame.
    expect(san(START, 'd4', 'de')).toBe('d4')
  })

  it('finds the one piece that can make an under-specified move, and refuses to guess between two', () => {
    expect(san(TWO_KNIGHTS, 'Nbd2')).toBe('Nbd2')
    const ambiguous = resolveTypedMove(TWO_KNIGHTS, 'Nd2', 'en')
    expect(ambiguous.kind).toBe('ambiguous')
    if (ambiguous.kind === 'ambiguous') {
      expect(ambiguous.moves.map((move) => move.san).sort()).toEqual(['Nbd2', 'Nfd2'])
    }
    // The same square, but only one piece of that kind can reach it.
    expect(san(TWO_KNIGHTS, 'Bd3')).toBe('Bd3')
  })

  it('spells castling however the keyboard had it, and waits at O-O for a possible O-O-O', () => {
    expect(san(CASTLE_AND_PROMOTE, '0-0')).toBe('O-O')
    expect(san(CASTLE_AND_PROMOTE, 'oo')).toBe('O-O')
    expect(san(CASTLE_AND_PROMOTE, 'O-O-O')).toBe('O-O-O')
    expect(san(CASTLE_AND_PROMOTE, '000')).toBe('O-O-O')

    const short = resolveTypedMove(CASTLE_AND_PROMOTE, 'O-O', 'en')
    expect(short).toMatchObject({ kind: 'move', complete: false })
    const long = resolveTypedMove(CASTLE_AND_PROMOTE, 'O-O-O', 'en')
    expect(long).toMatchObject({ kind: 'move', complete: true })
  })

  it('tells the start of a move from nonsense', () => {
    expect(resolveTypedMove(START, '', 'en')).toEqual({ kind: 'empty' })
    expect(resolveTypedMove(START, 'N', 'en')).toEqual({ kind: 'partial' })
    expect(resolveTypedMove(START, 'Nf', 'en')).toEqual({ kind: 'partial' })
    expect(resolveTypedMove(CASTLE_AND_PROMOTE, 'e8', 'en')).toEqual({ kind: 'partial' })
    expect(resolveTypedMove(START, 'Nf6', 'en')).toEqual({ kind: 'none' })
    expect(resolveTypedMove(START, 'zz', 'en')).toEqual({ kind: 'none' })
    expect(resolveTypedMove(START, 'e2e5', 'en')).toEqual({ kind: 'none' })
  })

  it('is complete the moment nothing else could be typed onto it', () => {
    expect(resolveTypedMove(START, 'e4', 'en')).toMatchObject({ kind: 'move', complete: true })
    expect(resolveTypedMove(START, 'Nf3', 'en')).toMatchObject({ kind: 'move', complete: true })
  })
})

describe('legalMoves', () => {
  it('lists one move per promotion piece', () => {
    const promotions = legalMoves(CASTLE_AND_PROMOTE)
      .filter((move) => move.uci.startsWith('e7e8'))
      .map((move) => move.san)
      .sort()
    expect(promotions).toEqual(['e8=B', 'e8=N', 'e8=Q', 'e8=R'])
  })
})
