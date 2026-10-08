import { describe, expect, it } from 'vitest'

import type { GameCard } from '@/lib/api/types'

import {
  dropTone,
  flagCounts,
  formatDrop,
  formatGameDate,
  formatPoints,
  formatResult,
  formatTimeControl,
  moveCount,
  outcomeTone,
  analysisOf,
  worstDrop,
} from './format'

describe('formatGameDate', () => {
  // Midday UTC, so the reader's calendar day is the 3rd in every test zone.
  const played = '2014-01-03T12:00:00Z'

  it('writes the whole date in figures in the chosen order', () => {
    expect(formatGameDate(played, 'dmy-dot')).toBe('03.01.2014')
    expect(formatGameDate(played, 'mdy-slash')).toBe('01/03/2014')
    expect(formatGameDate(played, 'dmy-slash')).toBe('03/01/2014')
    expect(formatGameDate(played, 'iso')).toBe('2014-01-03')
  })

  it('writes the month as a word in the page’s language when words are chosen', () => {
    // The tests run in English, which is British: day, month, year.
    expect(formatGameDate(played, 'words')).toBe('3 Jan 2014')
  })

  it('asks the browser when the format is automatic', () => {
    const browser = new Intl.DateTimeFormat(navigator.languages, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
    expect(formatGameDate(played, 'auto')).toBe(browser.format(new Date(played)))
  })

  it('is an em dash for a game with no date, and for nonsense', () => {
    expect(formatGameDate(null, 'iso')).toBe('—')
    expect(formatGameDate('not a date', 'iso')).toBe('—')
  })
})

describe('formatResult', () => {
  it('uses the typographic glyphs the design sets', () => {
    expect(formatResult('1-0')).toBe('1–0')
    expect(formatResult('1/2-1/2')).toBe('½–½')
    expect(formatResult(null)).toBe('—')
  })
})

describe('formatTimeControl', () => {
  it('turns the stored seconds into the minutes every chess site shows', () => {
    expect(formatTimeControl({ time_control: '300', speed: 'blitz', source: 'chesscom' })).toBe(
      '5',
    )
    expect(formatTimeControl({ time_control: '600+0', speed: 'rapid', source: 'lichess' })).toBe(
      '10+0',
    )
    expect(formatTimeControl({ time_control: '180+2', speed: 'blitz', source: 'lichess' })).toBe(
      '3+2',
    )
  })

  it('marks an OTB game and falls back to the speed with no clock', () => {
    expect(formatTimeControl({ time_control: '5400+30', speed: null, source: 'manual' })).toBe(
      'OTB 90+30',
    )
    expect(
      formatTimeControl({ time_control: null, speed: 'correspondence', source: 'lichess' }),
    ).toBe('Corr.')
    expect(formatTimeControl({ time_control: null, speed: null, source: 'pgn' })).toBe('—')
  })

  it('passes an unparseable clock through rather than mangling it', () => {
    expect(formatTimeControl({ time_control: '40/7200:1800', speed: null, source: 'pgn' })).toBe(
      '40/7200:1800',
    )
  })
})

describe('the analysis columns', () => {
  const analysed = {
    id: 1,
    source: 'lichess',
    analyzed: true,
    requested: false,
    eval_curve: [],
    worst_moments: [
      { ply: 63, win_loss: 58.31, classification: 'blunder' },
      { ply: 55, win_loss: 51.89, classification: 'blunder' },
    ],
  } as unknown as GameCard

  it('reads the worst drop off the first worst moment', () => {
    expect(worstDrop(analysed)).toBe(58.31)
    expect(formatDrop(worstDrop(analysed))).toBe('−58%')
  })

  it('has no drop at all for a game nothing has looked at', () => {
    const raw = { ...analysed, analyzed: false, worst_moments: [] } as GameCard
    expect(worstDrop(raw)).toBeNull()
    expect(formatDrop(null)).toBe('—')
    expect(analysisOf(raw)).toBeNull()
  })

  it('draws the run chip from the two flags the card carries', () => {
    expect(analysisOf(analysed)).toEqual({ requested: false })
    expect(analysisOf({ ...analysed, requested: true })).toEqual({ requested: true })
  })

  it('aggregates the flags into one chip per class, worst first', () => {
    expect(flagCounts(analysed)).toEqual([{ glyph: 'blunder', count: 2 }])
    const mixed = {
      ...analysed,
      worst_moments: [
        { ply: 63, classification: 'inaccuracy' },
        { ply: 12, classification: 'blunder' },
        { ply: 30, classification: 'inaccuracy' },
      ],
    } as unknown as GameCard
    expect(flagCounts(mixed)).toEqual([
      { glyph: 'blunder', count: 1 },
      { glyph: 'inaccuracy', count: 2 },
    ])
  })

  it('has no flags for a game nothing has flagged', () => {
    expect(flagCounts({ ...analysed, worst_moments: [] } as GameCard)).toEqual([])
    expect(
      flagCounts({ ...analysed, worst_moments: [{ ply: 1, classification: 'good' }] } as unknown as GameCard),
    ).toEqual([])
  })

  it('colours a drop by severity', () => {
    expect(dropTone(58)).toBe('text-blunder')
    expect(dropTone(20)).toBe('text-mistake')
    expect(dropTone(9)).toBe('text-inaccuracy')
    // A small drop is routine, not good news: it reads as ordinary text, not green.
    expect(dropTone(2)).toBe('text-soft')
    expect(dropTone(null)).toBe('text-dim-2')
  })
})

describe('the small cells', () => {
  it('counts whole moves, rounding a half move up', () => {
    expect(moveCount(77)).toBe('39')
    expect(moveCount(56)).toBe('28')
    expect(moveCount(null)).toBe('—')
  })

  it('colours the result from the owner’s side', () => {
    expect(outcomeTone('win')).toBe('text-good')
    expect(outcomeTone('loss')).toBe('text-blunder')
    expect(outcomeTone('draw')).toBe('text-soft')
    expect(outcomeTone(null)).toBe('text-dim')
  })
})

describe('formatPoints', () => {
  it('writes a score the way a crosstable does', () => {
    expect(formatPoints(5)).toBe('5')
    expect(formatPoints(5.5)).toBe('5½')
    expect(formatPoints(0.5)).toBe('½')
    expect(formatPoints(0)).toBe('0')
    expect(formatPoints(1234.5)).toBe('1,234½')
  })
})
