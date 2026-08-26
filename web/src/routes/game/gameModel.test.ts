import { describe, expect, it } from 'vitest'

import type { MomentResponse, MoveRow } from '@/lib/api/types'

import {
  buildGameLine,
  collapsedThroughMove,
  curveTicks,
  engineLines,
  evalAtCursor,
  evalCurve,
  formatResult,
  formatVariation,
  maiaLevels,
  nextFlaggedPly,
  pairMoves,
  plyLabel,
  preferredLevel,
  previousFlaggedPly,
  recurringMistake,
  sameMove,
  sanVariation,
  scoreAfter,
  scoreBefore,
  sideOf,
  whiteWinAfter,
} from './gameModel'

/** A move row shaped the way `/games/{id}` sends one. */
function move(ply: number, san: string, uci: string, extra: Partial<MoveRow> = {}): MoveRow {
  return { ply, move_number: Math.floor(ply / 2) + 1, san, uci, ...extra }
}

const OPENING = [
  move(0, 'e4', 'e2e4'),
  move(1, 'd5', 'd7d5'),
  move(2, 'exd5', 'e4d5'),
  move(3, 'Qxd5', 'd8d5'),
]

describe('ply arithmetic', () => {
  it('reads ply 0 as White’s first move', () => {
    expect(sideOf(0)).toBe('white')
    expect(sideOf(1)).toBe('black')
    expect(plyLabel(46)).toBe('24.')
    expect(plyLabel(47)).toBe('24…')
  })
})

describe('buildGameLine', () => {
  it('replays the game into one position per ply', () => {
    const line = buildGameLine(OPENING)
    expect(line.playable).toBe(4)
    expect(line.positions).toHaveLength(5)
    expect(line.positions[0].fen).toContain('rnbqkbnr/pppppppp')
    expect(line.positions[1].turn).toBe('black')
    expect(line.positions[4].turn).toBe('white')
  })

  it('stops at a move the position rejects instead of throwing', () => {
    const line = buildGameLine([move(0, 'e4', 'e2e4'), move(1, '??', 'a1a8')])
    expect(line.playable).toBe(1)
    expect(line.positions).toHaveLength(2)
  })

  it('replays castling written as a king move', () => {
    const castle = [
      move(0, 'e4', 'e2e4'),
      move(1, 'e5', 'e7e5'),
      move(2, 'Nf3', 'g1f3'),
      move(3, 'Nc6', 'b8c6'),
      move(4, 'Bc4', 'f1c4'),
      move(5, 'Bc5', 'f8c5'),
      move(6, 'O-O', 'e1g1'),
    ]
    expect(buildGameLine(castle).playable).toBe(7)
  })
})

describe('sanVariation / formatVariation', () => {
  it('turns a UCI principal variation into numbered SAN', () => {
    const line = buildGameLine(OPENING)
    const sans = sanVariation(line, 0, ['e2e4', 'e7e5', 'g1f3'])
    expect(sans).toEqual(['e4', 'e5', 'Nf3'])
    expect(formatVariation(0, sans)).toBe('1.e4 e5 2.Nf3')
  })

  it('numbers a line that starts on Black’s move with an ellipsis', () => {
    expect(formatVariation(47, ['Rfe8', 'b3', 'h6'])).toBe('24…Rfe8 25.b3 h6')
  })

  it('stops at the first move the position rejects', () => {
    const line = buildGameLine(OPENING)
    expect(sanVariation(line, 0, ['e2e4', 'a1a8', 'g1f3'])).toEqual(['e4'])
  })
})

describe('point of view', () => {
  // The backend stores a move's evals in the mover's frame; every eval shown is White's.
  const black = move(1, 'd5', 'd7d5', {
    eval_before_cp: -40,
    eval_after_cp: -69,
    win_before: 46.32,
    win_after: 43.68,
  })

  it('flips a Black move’s score into White’s frame', () => {
    expect(scoreBefore(black)).toEqual({ cp: 40, mate: undefined })
    expect(scoreAfter(black)).toEqual({ cp: 69, mate: undefined })
    expect(whiteWinAfter(black)).toBeCloseTo(56.32, 5)
  })

  it('leaves a White move’s score alone', () => {
    const white = move(0, 'e4', 'e2e4', { eval_before_cp: 45, eval_after_cp: 40 })
    expect(scoreBefore(white)).toEqual({ cp: 45, mate: undefined })
    expect(scoreAfter(white)).toEqual({ cp: 40, mate: undefined })
  })

  it('reads the board’s eval from the move played, then from the move to come', () => {
    const moves = [move(0, 'e4', 'e2e4', { eval_after_cp: 40 }), black]
    expect(evalAtCursor(moves, 0).score).toEqual({ cp: 40, mate: undefined })
    // Nothing played yet: fall back to what move 1 was played from.
    expect(evalAtCursor([black], -1).score).toEqual({ cp: 40, mate: undefined })
    expect(evalAtCursor([], -1).score).toBeNull()
  })
})

describe('evalCurve', () => {
  it('starts at the pre-game evaluation and marks only flagged plies', () => {
    const moves = [
      move(0, 'e4', 'e2e4', { win_before: 54, win_after: 53 }),
      move(1, 'd5', 'd7d5', { win_after: 44, classification: 'blunder' }),
      move(2, 'exd5', 'e4d5', { win_after: 57, classification: 'best' }),
    ]
    const curve = evalCurve(moves)
    expect(curve.map((point) => point.ply)).toEqual([-1, 0, 1, 2])
    expect(curve[0].win).toBe(54)
    expect(curve[2].win).toBe(56) // Black's 44 seen from White
    expect(curve[2].classification).toBe('blunder')
    expect(curve[3].classification).toBeNull()
  })

  it('drops plies with no evaluation at all', () => {
    expect(evalCurve(OPENING)).toEqual([])
  })

  it('puts axis ticks on move boundaries', () => {
    expect(curveTicks(48)).toEqual([0, 10, 20, 30, 40, 46])
  })
})

describe('pairMoves', () => {
  it('pairs plies into the two-cell rows of the design’s table', () => {
    const pairs = pairMoves(OPENING)
    expect(pairs).toHaveLength(2)
    expect(pairs[0]).toMatchObject({ moveNumber: 1 })
    expect(pairs[0].white?.san).toBe('e4')
    expect(pairs[0].black?.san).toBe('d5')
  })

  it('leaves the black cell empty when the game ends on a White move', () => {
    const pairs = pairMoves(OPENING.slice(0, 3))
    expect(pairs[1].white?.san).toBe('exd5')
    expect(pairs[1].black).toBeUndefined()
  })
})

describe('flagged navigation', () => {
  const moves = [
    move(0, 'e4', 'e2e4'),
    move(1, 'd5', 'd7d5', { classification: 'inaccuracy' }),
    move(2, 'exd5', 'e4d5', { classification: 'best' }),
    move(3, 'Qxd5', 'd8d5', { classification: 'blunder' }),
  ]

  it('finds the next and the previous flagged ply', () => {
    expect(nextFlaggedPly(moves, -1)).toBe(1)
    expect(nextFlaggedPly(moves, 1)).toBe(3)
    expect(nextFlaggedPly(moves, 3)).toBeNull()
    expect(previousFlaggedPly(moves, 3)).toBe(1)
    expect(previousFlaggedPly(moves, 1)).toBeNull()
  })

  it('does not count a best move as flagged', () => {
    expect(nextFlaggedPly([moves[2]], -1)).toBeNull()
  })
})

describe('collapsedThroughMove', () => {
  /** Ply of the given side's move in a move number, 1-indexed move numbers. */
  const plyOf = (moveNumber: number, side: 'white' | 'black') =>
    (moveNumber - 1) * 2 + (side === 'white' ? 0 : 1)

  it('folds the opening up to two moves before the first flagged move', () => {
    const moves = [move(plyOf(21, 'black'), 'Qc7', 'd8c7', { classification: 'inaccuracy' })]
    expect(collapsedThroughMove(moves)).toBe(18)
  })

  it('collapses nothing when the trouble starts immediately', () => {
    const moves = [move(plyOf(3, 'white'), 'Nf3', 'g1f3', { classification: 'blunder' })]
    expect(collapsedThroughMove(moves)).toBeNull()
  })

  it('collapses nothing when there is nothing to say about the game', () => {
    expect(collapsedThroughMove(OPENING)).toBeNull()
  })

  it('lets an early note anchor the fold instead', () => {
    const moves = [move(plyOf(30, 'white'), 'Rd1', 'a1d1', { classification: 'blunder' })]
    expect(collapsedThroughMove(moves, [plyOf(12, 'white')])).toBe(9)
  })
})

describe('engineLines', () => {
  const line = buildGameLine(OPENING)
  const played = move(1, 'd5', 'd7d5', {
    uci: 'd7d5',
    classification: 'blunder',
    eval_after_cp: -69,
    best_lines: [
      { multipv: 1, cp: 40, mate: null, pv: ['c7c6', 'd2d4'] },
      { multipv: 2, cp: 41, mate: null, pv: ['e7e6', 'd2d4'] },
    ],
  })

  it('renders each multi-PV line as numbered SAN, White’s score unflipped', () => {
    const rows = engineLines(line, 1, played)
    expect(rows[0].score).toEqual({ cp: 40, mate: null })
    expect(rows[0].text).toBe('1…c6 2.d4')
    expect(rows[0].played).toBe(false)
  })

  it('appends the move actually played when the engine did not rank it', () => {
    const rows = engineLines(line, 1, played)
    expect(rows).toHaveLength(3)
    expect(rows[2]).toMatchObject({ played: true, text: '1…d5', classification: 'blunder' })
    expect(rows[2].score).toEqual({ cp: 69, mate: undefined })
    // The engine's own lines carry no verdict — only the move that was played does.
    expect(rows[0].classification).toBeNull()
  })

  it('marks the ranked line instead when the played move was the engine’s choice', () => {
    const best = move(1, 'c6', 'c7c6', {
      classification: 'best',
      best_lines: [{ multipv: 1, cp: 40, mate: null, pv: ['c7c6', 'd2d4'] }],
    })
    const rows = engineLines(line, 1, best)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ played: true, classification: 'best' })
  })

  it('has nothing to show for a ply with no analysis', () => {
    expect(engineLines(line, 0, undefined)).toEqual([])
    // A played move on its own is not an engine verdict, so it is not a row either.
    expect(engineLines(line, 0, move(0, 'e4', 'e2e4'))).toEqual([])
  })

  it('compares moves ignoring the promotion suffix', () => {
    expect(sameMove('e7e8q', 'e7e8')).toBe(true)
    expect(sameMove('e7e8q', 'd7d8q')).toBe(false)
  })
})

describe('maiaLevels', () => {
  const policy = {
    '1500': [
      { uci: 'f6e4', san: 'Nxe4', rank: 1, p: 0.41 },
      { uci: 'f8e8', san: 'Rfe8', rank: 2, p: 0.22 },
    ],
    '1700': [{ uci: 'f8e8', san: 'Rfe8', rank: 1, p: 0.35 }],
  }

  it('reads the stored policy into rating bands, lowest first', () => {
    const levels = maiaLevels(policy)
    expect(levels.map((level) => level.rating)).toEqual(['1500', '1700'])
    expect(levels[0].moves[0]).toEqual({ uci: 'f6e4', san: 'Nxe4', rank: 1, probability: 0.41 })
  })

  it('ignores a policy that is not shaped like one', () => {
    expect(maiaLevels(null)).toEqual([])
    expect(maiaLevels({ '1500': 'nonsense' } as never)).toEqual([])
  })

  it('picks the band closest to the rating the game was played at', () => {
    const levels = maiaLevels(policy)
    expect(preferredLevel(levels, 1650)?.rating).toBe('1700')
    expect(preferredLevel(levels, 1400)?.rating).toBe('1500')
    expect(preferredLevel([], 1500)).toBeNull()
  })
})

describe('recurringMistake', () => {
  const moment = (gameId: number, piece: string, phase: string, winLoss: number) =>
    ({ game: { id: gameId, source: 'lichess' }, ply: 10, piece, phase, win_loss: winLoss }) as MomentResponse

  it('counts blunders of the same piece in the same phase across the window', () => {
    const found = recurringMistake(
      [
        moment(14, 'knight', 'middlegame', 31),
        moment(9, 'knight', 'middlegame', 22),
        moment(3, 'knight', 'middlegame', 40),
        moment(2, 'queen', 'endgame', 55),
      ],
      14,
      30,
    )
    expect(found).toMatchObject({ piece: 'knight', phase: 'middlegame', count: 3, ordinal: '3rd' })
  })

  it('says nothing when the mistake has not recurred', () => {
    expect(recurringMistake([moment(14, 'rook', 'endgame', 31)], 14, 30)).toBeNull()
  })

  it('says nothing when this game has no blunder in the window', () => {
    expect(recurringMistake([moment(9, 'knight', 'middlegame', 22)], 14, 30)).toBeNull()
  })
})

describe('formatResult', () => {
  it('sets results the way the design does', () => {
    expect(formatResult('1-0')).toBe('1–0')
    expect(formatResult('0-1')).toBe('0–1')
    expect(formatResult('1/2-1/2')).toBe('½–½')
    expect(formatResult('*')).toBe('·')
  })
})
