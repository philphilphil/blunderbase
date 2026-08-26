import { describe, expect, it } from 'vitest'

import type { GameSummary, MoveRow } from '@/lib/api/types'

import { buildPgn, pgnDate, pgnMovetext } from './pgn'

const GAME: GameSummary = {
  id: 14,
  source: 'lichess',
  played_at: '2016-12-07T12:28:49Z',
  color: 'white',
  result: '0-1',
  white: 'phib',
  black: 'lichess AI level 2',
  white_rating: 1500,
  eco: 'B01',
  opening: 'Scandinavian Defense',
  speed: 'rapid',
  rated: true,
  time_control: '600+0',
  variant: 'standard',
}

const MOVES: MoveRow[] = [
  { ply: 0, san: 'e4', uci: 'e2e4' },
  { ply: 1, san: 'd5', uci: 'd7d5' },
  { ply: 2, san: 'exd5', uci: 'e4d5' },
  { ply: 3, san: 'Qxd5', uci: 'd8d5' },
]

describe('pgnDate', () => {
  it('writes the played date in the export format', () => {
    expect(pgnDate('2016-12-07T12:28:49Z')).toMatch(/^2016\.12\.0[678]$/)
  })

  it('says it does not know rather than inventing one', () => {
    expect(pgnDate(null)).toBe('????.??.??')
    expect(pgnDate('not a date')).toBe('????.??.??')
  })
})

describe('pgnMovetext', () => {
  it('numbers whole moves and ends on the result', () => {
    expect(pgnMovetext(MOVES, '0-1')).toBe('1. e4 d5 2. exd5 Qxd5 0-1')
  })

  it('wraps at 80 columns', () => {
    const long: MoveRow[] = Array.from({ length: 60 }, (_, ply) => ({
      ply,
      san: ply % 2 === 0 ? 'Nf3' : 'Nf6',
      uci: 'g1f3',
    }))
    for (const line of pgnMovetext(long, '1/2-1/2').split('\n')) {
      expect(line.length).toBeLessThanOrEqual(80)
    }
  })

  it('skips a ply with no SAN rather than emitting a hole', () => {
    expect(pgnMovetext([{ ply: 0, san: 'e4', uci: 'e2e4' }, { ply: 1, uci: 'd7d5' }], '*')).toBe(
      '1. e4 *',
    )
  })
})

describe('buildPgn', () => {
  it('writes the roster the payload knows and the movetext after a blank line', () => {
    const pgn = buildPgn(GAME, MOVES)
    const [tags, movetext] = pgn.split('\n\n')
    expect(tags.split('\n')).toEqual([
      '[Event "Rated Rapid game"]',
      '[Site "lichess.org"]',
      expect.stringMatching(/^\[Date "2016\.12\.0[678]"\]$/),
      '[Round "?"]',
      '[White "phib"]',
      '[Black "lichess AI level 2"]',
      '[Result "0-1"]',
      '[WhiteElo "1500"]',
      '[ECO "B01"]',
      '[Opening "Scandinavian Defense"]',
      '[TimeControl "600+0"]',
    ])
    expect(movetext).toBe('1. e4 d5 2. exd5 Qxd5 0-1\n')
  })

  it('falls back to the standard unknowns and an unfinished result', () => {
    const pgn = buildPgn({ id: 1, source: 'pgn' }, [])
    expect(pgn).toContain('[Event "?"]')
    expect(pgn).toContain('[Site "?"]')
    expect(pgn).toContain('[Date "????.??.??"]')
    expect(pgn).toContain('[White "?"]')
    expect(pgn).toContain('[Result "*"]')
    expect(pgn.trimEnd().endsWith('*')).toBe(true)
  })

  it('escapes a quote in a player name and keeps a non-standard variant', () => {
    const pgn = buildPgn({ ...GAME, white: 'a "quoted" name', variant: 'chess960' }, MOVES)
    expect(pgn).toContain('[White "a \\"quoted\\" name"]')
    expect(pgn).toContain('[Variant "chess960"]')
  })
})
