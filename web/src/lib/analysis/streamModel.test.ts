import { describe, expect, it } from 'vitest'

import type { StreamSnapshotEvent } from '@/lib/events/types'

import { whiteWinPercent } from '@/lib/chess/evaluation'

import {
  formatNps,
  formatVariation,
  liveBest,
  liveScore,
  liveTop,
  sanLine,
  snapshotFrom,
  type StreamSnapshot,
} from './streamModel'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
/** After 1.e4 c5 2.Nf3 — Black to move, ply 3. */
const SICILIAN = 'rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2'

describe('sanLine', () => {
  it('replays a UCI variation from a mid-game position', () => {
    expect(sanLine(SICILIAN, ['d7d6', 'd2d4', 'c5d4', 'f3d4'])).toEqual([
      'd6',
      'd4',
      'cxd4',
      'Nxd4',
    ])
  })

  it('stops at the first move the position rejects', () => {
    // 1…d6 is legal; the bishop cannot go to h6 from c1 with pawns in the way.
    expect(sanLine(SICILIAN, ['d7d6', 'c1h6', 'd2d4'])).toEqual(['d6'])
  })

  it('stops at a move that is not UCI at all', () => {
    expect(sanLine(START, ['e2e4', 'wat'])).toEqual(['e4'])
  })

  it('honours the limit', () => {
    expect(sanLine(START, ['e2e4', 'e7e5', 'g1f3', 'b8c6'], 2)).toEqual(['e4', 'e5'])
  })

  it('gives nothing rather than throwing on a FEN it cannot read', () => {
    expect(sanLine('not a position at all', ['e2e4'])).toEqual([])
    // Parses as a FEN but is not a legal chess position — two kings short.
    expect(sanLine('8/8/8/8/8/8/8/8 w - - 0 1', ['e2e4'])).toEqual([])
  })
})

describe('formatVariation', () => {
  it('numbers a White variation from the ply it starts on', () => {
    expect(formatVariation(46, ['b3', 'Rfe8', 'a4'])).toBe('24.b3 Rfe8 25.a4')
  })

  it('marks a variation that starts on Black’s move with the ellipsis', () => {
    expect(formatVariation(47, ['Rfe8', 'b3', 'h6'])).toBe('24…Rfe8 25.b3 h6')
  })

  it('numbers from move 1 when the ply is unknown', () => {
    expect(formatVariation(null, ['e4', 'e5'])).toBe('1.e4 e5')
    expect(formatVariation(undefined, ['e4', 'e5'])).toBe('1.e4 e5')
  })
})

describe('snapshotFrom', () => {
  it('camel-cases a White-to-move frame and leaves its numbers alone', () => {
    const frame: StreamSnapshotEvent = {
      event: 'stream.snapshot',
      session_id: 'str_1',
      seq: 7,
      engine_id: 3,
      engine: 'sf-remote',
      runner_id: 2,
      fen: START,
      multipv: 2,
      depth: 24,
      nodes: 18_402_113,
      nps: 1_840_211,
      time_ms: 10_000,
      lines: [{ multipv: 1, cp: 34, mate: null, pv: ['e2e4'] }],
      at: '2026-08-26T10:00:10+00:00',
    }
    expect(snapshotFrom(frame)).toEqual({
      sessionId: 'str_1',
      seq: 7,
      engineId: 3,
      engine: 'sf-remote',
      runnerId: 2,
      fen: START,
      multipv: 2,
      depth: 24,
      nodes: 18_402_113,
      nps: 1_840_211,
      timeMs: 10_000,
      lines: [{ multipv: 1, cp: 34, mate: null, pv: ['e2e4'] }],
      at: '2026-08-26T10:00:10+00:00',
    })
  })

  it('flips a Black-to-move frame into White’s point of view', () => {
    // The wire is side-to-move relative (`adapters/infinite.py` povs every score); every
    // evaluation this app draws — `MaiaPanel`'s engine column included — is
    // White-relative, and two panels printing opposite signs for one position is the bug.
    const frame: StreamSnapshotEvent = {
      event: 'stream.snapshot',
      session_id: 'str_1',
      seq: 7,
      engine_id: 1,
      engine: 'stockfish',
      runner_id: null,
      fen: SICILIAN,
      multipv: 3,
      depth: 24,
      nodes: 1_000,
      nps: 500,
      time_ms: 1_000,
      lines: [
        // Black to move, a pawn to the good and a mate in five in the third line.
        { multipv: 1, cp: 100, mate: null, pv: ['d7d6'] },
        { multipv: 2, cp: null, mate: null, pv: ['b8c6'] },
        { multipv: 3, cp: null, mate: 5, pv: ['e7e6'] },
      ],
      at: '2026-08-26T10:00:10+00:00',
    }
    expect(snapshotFrom(frame).lines).toEqual([
      { multipv: 1, cp: -100, mate: null, pv: ['d7d6'] },
      { multipv: 2, cp: null, mate: null, pv: ['b8c6'] },
      { multipv: 3, cp: null, mate: -5, pv: ['e7e6'] },
    ])
  })
})

describe('liveBest', () => {
  function snapshot(overrides: Partial<StreamSnapshot> = {}): StreamSnapshot {
    return {
      sessionId: 's1',
      seq: 4,
      engineId: 1,
      engine: 'Stockfish 17',
      runnerId: null,
      fen: SICILIAN,
      multipv: 3,
      depth: 24,
      nodes: 1_000,
      nps: 500,
      timeMs: 1_000,
      lines: [
        { multipv: 2, cp: 21, mate: null, pv: ['b8c6', 'd2d4'] },
        { multipv: 1, cp: 34, mate: null, pv: ['d7d6', 'd2d4', 'c5d4'] },
        { multipv: 3, cp: null, mate: 5, pv: ['e7e6'] },
      ],
      at: '2026-08-26T10:00:10+00:00',
      ...overrides,
    }
  }

  it('takes the first move of the lowest multipv, whatever order the frame arrived in', () => {
    expect(liveBest(snapshot(), SICILIAN)).toBe('d7d6')
  })

  it('says nothing about a position the board is not on', () => {
    // The reader scrubbed on; the search has not reopened yet.
    expect(liveBest(snapshot(), START)).toBeNull()
  })

  it('says nothing without a snapshot, without a position, or without a variation', () => {
    expect(liveBest(null, SICILIAN)).toBeNull()
    expect(liveBest(snapshot(), null)).toBeNull()
    expect(liveBest(snapshot({ lines: [] }), SICILIAN)).toBeNull()
    const empty = snapshot({ lines: [{ multipv: 1, cp: 0, mate: null, pv: [] }] })
    expect(liveBest(empty, SICILIAN)).toBeNull()
  })

  it('skips an empty top line for the best line that does have a move', () => {
    const lines = [
      { multipv: 2, cp: 21, mate: null, pv: ['b8c6'] },
      { multipv: 1, cp: 34, mate: null, pv: [] },
    ]
    expect(liveBest(snapshot({ lines }), SICILIAN)).toBe('b8c6')
  })
})

describe('liveTop', () => {
  function snapshot(overrides: Partial<StreamSnapshot> = {}): StreamSnapshot {
    return {
      sessionId: 's1',
      seq: 4,
      engineId: 1,
      engine: 'Stockfish 17',
      runnerId: null,
      fen: SICILIAN,
      multipv: 3,
      depth: 24,
      nodes: 1_000,
      nps: 500,
      timeMs: 1_000,
      lines: [
        { multipv: 2, cp: 21, mate: null, pv: ['b8c6', 'd2d4'] },
        { multipv: 1, cp: 34, mate: null, pv: ['d7d6', 'd2d4', 'c5d4'] },
        { multipv: 3, cp: null, mate: 5, pv: ['e7e6'] },
      ],
      at: '2026-08-26T10:00:10+00:00',
      ...overrides,
    }
  }

  it('takes the lowest multipv, not the first line in the array', () => {
    expect(liveTop(snapshot(), SICILIAN)).toEqual({
      multipv: 1,
      cp: 34,
      mate: null,
      pv: ['d7d6', 'd2d4', 'c5d4'],
    })
  })

  it('gives nothing for a snapshot about another position', () => {
    // The reader scrubbed on; the search has not reopened yet.
    expect(liveTop(snapshot(), START)).toBeNull()
  })

  it('gives nothing without a snapshot or without a position', () => {
    expect(liveTop(null, SICILIAN)).toBeNull()
    expect(liveTop(snapshot(), null)).toBeNull()
  })
})

describe('liveScore', () => {
  it('reads the top line’s cp/mate as they stand, in White’s frame already', () => {
    // Black to move: `snapshotFrom` has already flipped these lines into White's frame, so
    // `liveScore` must not flip them a second time — that would silently put White-relative
    // numbers back into the engine's own (side-to-move) frame on every Black-to-move ply.
    const snapshot: StreamSnapshot = {
      sessionId: 's1',
      seq: 4,
      engineId: 1,
      engine: 'Stockfish 17',
      runnerId: null,
      fen: SICILIAN,
      multipv: 1,
      depth: 24,
      nodes: 1_000,
      nps: 500,
      timeMs: 1_000,
      // White-relative: Black is a pawn to the good here, so White's cp is negative.
      lines: [{ multipv: 1, cp: -100, mate: null, pv: ['d7d6'] }],
      at: '2026-08-26T10:00:10+00:00',
    }
    const score = liveScore(snapshot, SICILIAN)
    expect(score).toEqual({ cp: -100, mate: null })
    // White is worse off, so White's win percentage sits under 50 — the same sign the panel
    // prints for this line from `snapshotFrom`'s own White-relative `lines`.
    expect(whiteWinPercent(score!)).toBeLessThan(50)
  })

  it('gives nothing for a snapshot about another position, or with no line', () => {
    const snapshot: StreamSnapshot = {
      sessionId: 's1',
      seq: 4,
      engineId: 1,
      engine: 'Stockfish 17',
      runnerId: null,
      fen: SICILIAN,
      multipv: 1,
      depth: 24,
      nodes: 1_000,
      nps: 500,
      timeMs: 1_000,
      lines: [{ multipv: 1, cp: -100, mate: null, pv: ['d7d6'] }],
      at: '2026-08-26T10:00:10+00:00',
    }
    expect(liveScore(snapshot, START)).toBeNull()
    expect(liveScore(null, SICILIAN)).toBeNull()
    expect(liveScore({ ...snapshot, lines: [] }, SICILIAN)).toBeNull()
  })
})

describe('formatNps', () => {
  it('writes node rates in the units the node counts use', () => {
    expect(formatNps(1_840_211)).toBe('1.8M/s')
    expect(formatNps(4_500)).toBe('4.5k/s')
    expect(formatNps(120)).toBe('120/s')
    expect(formatNps(null)).toBe('—')
    expect(formatNps(undefined)).toBe('—')
  })
})
