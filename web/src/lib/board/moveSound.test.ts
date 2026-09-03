import { describe, expect, it } from 'vitest'

import { moveSoundKind, playMoveSound } from './moveSound'

describe('moveSoundKind', () => {
  it('has nothing to play for the starting position or a move list without SAN', () => {
    expect(moveSoundKind(null)).toBeNull()
    expect(moveSoundKind(undefined)).toBeNull()
    expect(moveSoundKind('')).toBeNull()
  })

  it('tells the four kinds apart', () => {
    expect(moveSoundKind('e4')).toBe('move')
    expect(moveSoundKind('Nf3')).toBe('move')
    expect(moveSoundKind('exd5')).toBe('capture')
    expect(moveSoundKind('Qxf7')).toBe('capture')
    expect(moveSoundKind('O-O')).toBe('castle')
    expect(moveSoundKind('O-O-O')).toBe('castle')
    expect(moveSoundKind('Bb5+')).toBe('check')
    expect(moveSoundKind('Qh7#')).toBe('check')
  })

  // A checking capture is a check first: it is the louder fact about the position, and the
  // capture is already visible on the board the sound arrives with.
  it('lets check outrank capture', () => {
    expect(moveSoundKind('Qxf7#')).toBe('check')
    expect(moveSoundKind('Nxe5+')).toBe('check')
  })

  // Castling long ends in a rank the SAN spells with hyphens, not an `x`, and a promotion
  // that captures is still a capture.
  it('is not fooled by the odd notations', () => {
    expect(moveSoundKind('O-O+')).toBe('check')
    expect(moveSoundKind('e8=Q')).toBe('move')
    expect(moveSoundKind('exd8=Q')).toBe('capture')
  })
})

// jsdom has no Web Audio at all, which is exactly the browser this must not throw in.
describe('playMoveSound', () => {
  it('is silent rather than fatal where there is no audio', () => {
    expect(() => playMoveSound('capture', 60)).not.toThrow()
  })
})
