import { describe, expect, it } from 'vitest'

import { asLine, foldMate, MATE_SCORE, pov, storedCp, whiteScore } from './search'

/**
 * The sign convention, on its own, against the numbers `adapters/stockfish.py` produces.
 *
 * This is the one piece of arithmetic the two halves of Blunderbase cannot be allowed to
 * disagree about, and it is also the one whose failure is silent: a wrong sign does not
 * throw, it stores "White is winning" on the plies where Black was. So the cases below are
 * the three that carry the whole convention — an engine reports from the side to move, the
 * schema stores White's, and `mate 0` means both "has mated" and "is mated".
 */
describe('whiteScore', () => {
  it('leaves a White-to-move score alone', () => {
    expect(whiteScore(35, null, 'white')).toEqual({ cp: 35, mateIn: null, foldedCp: 35 })
  })

  it('flips a Black-to-move score, which is where a wrong sign would hide', () => {
    // The engine says "+60 for me"; the mover is Black, so the schema stores −60.
    expect(whiteScore(60, null, 'black')).toEqual({ cp: -60, mateIn: null, foldedCp: -60 })
    // And a position Black is losing reads as White winning.
    expect(whiteScore(-250, null, 'black')).toEqual({ cp: 250, mateIn: null, foldedCp: 250 })
  })

  it('folds a mate onto the centipawn scale so one integer orders every evaluation', () => {
    expect(foldMate(3)).toBe(MATE_SCORE - 3)
    expect(foldMate(-3)).toBe(-MATE_SCORE + 3)
    expect(whiteScore(null, 3, 'white')).toEqual({
      cp: null,
      mateIn: 3,
      foldedCp: MATE_SCORE - 3,
    })
    // Black to move and mating in two: White is the one being mated.
    expect(whiteScore(null, 2, 'black')).toEqual({
      cp: null,
      mateIn: -2,
      foldedCp: -(MATE_SCORE - 2),
    })
  })

  it('keeps mate 0 unambiguous in both of its readings', () => {
    // `Mate(0)` — the side to move has been mated. White to move: White is mated.
    const whiteMated = whiteScore(null, 0, 'white')
    expect(whiteMated.mateIn).toBe(0)
    expect(whiteMated.foldedCp).toBe(-MATE_SCORE)
    // The same engine output with Black to move is the other reading of the same number.
    const blackMated = whiteScore(null, 0, 'black')
    expect(blackMated.mateIn).toBe(0)
    expect(blackMated.foldedCp).toBe(MATE_SCORE)

    // `mate_in` alone cannot tell the two apart, so `stored_cp` carries the sign — and it
    // is the *only* place it is carried.
    expect(storedCp(whiteMated)).toBe(-MATE_SCORE)
    expect(storedCp(blackMated)).toBe(MATE_SCORE)
    // Every other score stores its own `cp`, mate or not.
    expect(storedCp({ cp: null, mateIn: 3, foldedCp: MATE_SCORE - 3 })).toBeNull()
    expect(storedCp({ cp: 35, mateIn: null, foldedCp: 35 })).toBe(35)
  })
})

describe('pov', () => {
  it('turns White’s reading of the dial to face either colour', () => {
    const white = { cp: 120, mateIn: null, foldedCp: 120 }
    expect(pov(white, 'white')).toEqual(white)
    expect(pov(white, 'black')).toEqual({ cp: -120, mateIn: null, foldedCp: -120 })
  })

  it('is its own inverse, so before and after are two readings of one dial', () => {
    const white = { cp: null, mateIn: -4, foldedCp: -MATE_SCORE + 4 }
    expect(pov(pov(white, 'black'), 'black')).toEqual(white)
  })

  it('leaves no negative zero behind for a delivered mate', () => {
    // JavaScript has two zeroes and Python has one. Flipping `mate 0` is the common case,
    // not a corner, and `-0` compares unequal to `0` under `Object.is`.
    const flipped = pov({ cp: null, mateIn: 0, foldedCp: MATE_SCORE }, 'black')
    expect(Object.is(flipped.mateIn, 0)).toBe(true)
  })
})

describe('asLine', () => {
  it('is Candidate.as_line, with the delivered mate folded into cp', () => {
    expect(
      asLine({
        rank: 1,
        uci: 'e2e4',
        score: { cp: 35, mateIn: null, foldedCp: 35 },
        pv: ['e2e4', 'e7e5'],
      }),
    ).toEqual({ multipv: 1, cp: 35, mate: null, pv: ['e2e4', 'e7e5'] })

    expect(
      asLine({ rank: 2, uci: 'd1h5', score: { cp: null, mateIn: 0, foldedCp: MATE_SCORE }, pv: [] }),
    ).toEqual({ multipv: 2, cp: MATE_SCORE, mate: 0, pv: [] })
  })
})
