import { describe, expect, it } from 'vitest'

import type { ExplorerMove, ExplorerResponse, GameSummary } from '@/lib/api/types'

import {
  averageDrop,
  bookReason,
  commonOpening,
  dropTone,
  formatAvgDrop,
  moveNote,
  scorePercent,
  scoreTone,
  splitOf,
  worstContinuation,
} from './stats'

function move(over: Partial<ExplorerMove> & { uci: string }): ExplorerMove {
  return { san: over.uci, games: 1, ...over } as ExplorerMove
}

describe('splitOf', () => {
  it('turns counts into percentages that fill the bar', () => {
    const split = splitOf({ games: 4, wins: 2, draws: 1, losses: 1 })
    expect(split.winPercent + split.drawPercent + split.lossPercent).toBeCloseTo(100)
    expect(split.winPercent).toBe(50)
  })

  it('is an empty bar rather than a division by zero', () => {
    const split = splitOf({})
    expect(split).toMatchObject({ winPercent: 0, drawPercent: 0, lossPercent: 0, games: 0 })
  })
})

describe('the score column', () => {
  it('reads the backend’s 0..1 score as a percentage', () => {
    expect(scorePercent(0.5192)).toBe(51.9)
    expect(scorePercent(null)).toBeNull()
  })

  it('is green above 55, red below 45', () => {
    expect(scoreTone(0.7)).toBe('text-good')
    expect(scoreTone(0.278)).toBe('text-blunder')
    expect(scoreTone(0.5)).toBe('text-body')
    expect(scoreTone(undefined)).toBe('text-dim-2')
  })
})

describe('the average-drop column', () => {
  it('shows win percentage given away, with the typographic minus', () => {
    expect(formatAvgDrop(4.23)).toBe('−4.2%')
    expect(formatAvgDrop(0)).toBe('0.0%')
    expect(formatAvgDrop(null)).toBe('—')
  })

  it('colours by how much was given away', () => {
    expect(dropTone(12)).toBe('text-blunder')
    expect(dropTone(6)).toBe('text-mistake')
    expect(dropTone(3)).toBe('text-inaccuracy')
    expect(dropTone(0.4)).toBe('text-soft')
  })

  it('weights the position’s average by how often each move was actually evaluated', () => {
    const moves = [
      move({ uci: 'e2e4', avg_win_loss: 1, evaluated: 9, games: 9 }),
      move({ uci: 'd2d4', avg_win_loss: 11, evaluated: 1, games: 1 }),
    ]
    expect(averageDrop(moves)).toBe(2)
  })

  it('has no average when nothing has been analysed', () => {
    expect(averageDrop([move({ uci: 'e2e4', evaluated: 0 })])).toBeNull()
  })
})

describe('worstContinuation', () => {
  it('ignores a move played too rarely to mean anything', () => {
    const moves = [
      move({ uci: 'e7e5', avg_win_loss: 3, games: 20 }),
      move({ uci: 'c7c5', avg_win_loss: 40, games: 1 }),
      move({ uci: 'e7e6', avg_win_loss: 9, games: 6 }),
    ]
    expect(worstContinuation(moves)?.uci).toBe('e7e6')
  })

  it('is null when nothing has an eval', () => {
    expect(worstContinuation([move({ uci: 'e7e5', games: 9 })])).toBeNull()
  })

  it('names no worst move when the whole line is accurate', () => {
    expect(
      worstContinuation([
        move({ uci: 'e7e5', avg_win_loss: 0, games: 9 }),
        move({ uci: 'c7c5', avg_win_loss: 0.3, games: 4 }),
      ]),
    ).toBeNull()
  })
})

describe('moveNote', () => {
  const tree = {
    moves: [],
    main_line: [{ uci: 'e7e5', san: 'e5', ply: 0, games: 5 }],
    book_depth: 0,
    leaves_book_with: { uci: 'e7e5', san: 'e5', ply: 0, games: 1 },
    path: [],
    totals: {},
  } as unknown as ExplorerResponse

  it('names the main line first', () => {
    expect(moveNote(move({ uci: 'e7e5', games: 5 }), tree)).toBe('main line')
  })

  it('flags the blunders behind a move', () => {
    expect(moveNote(move({ uci: 'g8f6', games: 8, blunders: 2 }), tree)).toBe(
      '2 blunders from here',
    )
  })

  it('is honest about a thin sample', () => {
    expect(moveNote(move({ uci: 'd7d5', games: 1 }), tree)).toBe('played once')
    expect(moveNote(move({ uci: 'c7c6', games: 3 }), tree)).toBe('3 games, thin sample')
  })

  it('says when nothing has looked at a move', () => {
    expect(moveNote(move({ uci: 'b7b6', games: 9, evaluated: 0 }), tree)).toBe('not analysed')
    expect(moveNote(move({ uci: 'b7b6', games: 9, evaluated: 9 }), tree)).toBeNull()
  })
})

describe('bookReason', () => {
  it('says what the service’s reason means', () => {
    expect(bookReason('novelty')).toContain('only played the next move once')
    expect(bookReason('no games')).toContain('never reached')
    expect(bookReason('something new')).toBe('something new')
  })
})

describe('commonOpening', () => {
  function occurrence(opening: string | null, eco: string | null) {
    return { game: { opening, eco } as GameSummary }
  }

  it('picks the opening most of the games are filed under', () => {
    expect(
      commonOpening([
        occurrence('Sicilian, Alapin', 'B22'),
        occurrence('Sicilian, Alapin', 'B22'),
        occurrence('French, Tarrasch', 'C07'),
      ]),
    ).toEqual({ name: 'Sicilian, Alapin', eco: 'B22' })
  })

  it('is null when no game names an opening', () => {
    expect(commonOpening([occurrence(null, null)])).toBeNull()
    expect(commonOpening([])).toBeNull()
  })
})
