import { describe, expect, it } from 'vitest'

import { formatSan, hasLocalLetters } from './notation'

describe('formatSan', () => {
  it('leaves English letters alone', () => {
    expect(formatSan('Nc3', 'english', 'de')).toBe('Nc3')
    expect(formatSan('Nc3', 'local', 'en')).toBe('Nc3')
  })

  it('writes German letters for a German reader', () => {
    expect(formatSan('Nc3', 'local', 'de')).toBe('Sc3')
    expect(formatSan('Bxf7+', 'local', 'de')).toBe('Lxf7+')
    expect(formatSan('Qh5#', 'local', 'de')).toBe('Dh5#')
    expect(formatSan('Rfe8', 'local', 'de')).toBe('Tfe8')
    expect(formatSan('Kg1', 'local', 'de')).toBe('Kg1')
  })

  it('writes figurines in either language', () => {
    expect(formatSan('Nc3', 'figurines', 'en')).toBe('♞c3')
    expect(formatSan('Qxd8+', 'figurines', 'de')).toBe('♛xd8+')
  })

  it('renames a promotion piece and leaves castling and pawn moves alone', () => {
    expect(formatSan('e8=Q', 'local', 'de')).toBe('e8=D')
    expect(formatSan('exd8=N+', 'figurines', 'en')).toBe('exd8=♞+')
    expect(formatSan('O-O-O', 'local', 'de')).toBe('O-O-O')
    expect(formatSan('exd5', 'figurines', 'en')).toBe('exd5')
  })

  it('formats a whole numbered variation', () => {
    expect(formatSan('12…Nf6 13.Bg5 Be7', 'local', 'de')).toBe('12…Sf6 13.Lg5 Le7')
  })
})

describe('hasLocalLetters', () => {
  it('is true only where the language writes pieces differently from English', () => {
    expect(hasLocalLetters('en')).toBe(false)
    expect(hasLocalLetters('de')).toBe(true)
  })
})
