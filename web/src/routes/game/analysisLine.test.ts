import { describe, expect, it } from 'vitest'

import type { MoveRow } from '@/lib/api/types'

import { buildAnalysisLine, lineStartingWith, withBoardMove } from './analysisLine'
import { buildGameLine } from './gameModel'

function move(ply: number, san: string, uci: string): MoveRow {
  return { ply, move_number: Math.floor(ply / 2) + 1, san, uci }
}

/** 1.e4 d5 2.exd5 Qxd5 — the game every other test in this folder is about. */
const line = buildGameLine([
  move(0, 'e4', 'e2e4'),
  move(1, 'd5', 'd7d5'),
  move(2, 'exd5', 'e4d5'),
  move(3, 'Qxd5', 'd8d5'),
])

describe('buildAnalysisLine', () => {
  it('is the game position itself while nothing has been played off it', () => {
    const analysis = buildAnalysisLine(line, 1, [])
    expect(analysis?.moves).toEqual([])
    expect(analysis?.position.fen).toBe(line.positions[1].fen)
    expect(analysis?.ply).toBe(1)
    expect(analysis?.lastMove).toBeNull()
    // It still carries the legal moves, which is what lets the board accept the first drag.
    expect(analysis?.dests.get('d7')).toContain('d5')
  })

  it('replays a branch off the game and numbers it from there', () => {
    const analysis = buildAnalysisLine(line, 1, ['c7c6', 'd2d4'])
    expect(analysis?.sans).toEqual(['c6', 'd4'])
    expect(analysis?.ply).toBe(3)
    expect(analysis?.lastMove).toBe('d2d4')
    expect(analysis?.position.turn).toBe('black')
    expect(analysis?.position.fen).not.toBe(line.positions[1].fen)
  })

  it('stops at a move the position rejects rather than throwing', () => {
    const analysis = buildAnalysisLine(line, 1, ['c7c6', 'e2e4', 'g8f6'])
    expect(analysis?.sans).toEqual(['c6'])
    expect(analysis?.moves).toEqual(['c7c6'])
  })

  it('keeps the whole line but stops the board at the cursor', () => {
    const analysis = buildAnalysisLine(line, 1, ['c7c6', 'd2d4', 'g8f6'], 1)
    // The line is kept whole — that is what there is left to walk into.
    expect(analysis?.sans).toEqual(['c6', 'd4', 'Nf6'])
    expect(analysis?.cursor).toBe(1)
    // …while everything the board reads is taken one move in.
    expect(analysis?.ply).toBe(2)
    expect(analysis?.lastMove).toBe('c7c6')
    expect(analysis?.position.turn).toBe('white')
    expect(analysis?.dests.get('d2')).toContain('d4')
  })

  it('is the position it branched from at cursor 0, with the line still there', () => {
    const analysis = buildAnalysisLine(line, 1, ['c7c6', 'd2d4'], 0)
    expect(analysis?.moves).toEqual(['c7c6', 'd2d4'])
    expect(analysis?.cursor).toBe(0)
    expect(analysis?.position.fen).toBe(line.positions[1].fen)
    expect(analysis?.ply).toBe(1)
    expect(analysis?.lastMove).toBeNull()
  })

  it('clamps the cursor to the moves that actually replayed', () => {
    // The tail is illegal here, so a cursor asking for it lands on the last real position
    // rather than past the end of the line.
    const past = buildAnalysisLine(line, 1, ['c7c6', 'e2e4'], 2)
    expect(past?.moves).toEqual(['c7c6'])
    expect(past?.cursor).toBe(1)
    expect(past?.ply).toBe(2)

    expect(buildAnalysisLine(line, 1, ['c7c6'], -3)?.cursor).toBe(0)
  })

  it('never mutates the replayed game it branches from', () => {
    const before = line.positions[1].fen
    buildAnalysisLine(line, 1, ['c7c6', 'd2d4'])
    expect(buildAnalysisLine(line, 1, [])?.position.fen).toBe(before)
  })

  it('has no position to offer past the end of a half-replayed game', () => {
    expect(buildAnalysisLine(line, 99, [])).toBeNull()
  })
})

describe('withBoardMove', () => {
  it('appends a legal board move to the line', () => {
    const analysis = buildAnalysisLine(line, 1, [])!
    expect(withBoardMove(analysis, 'c7', 'c6')).toEqual(['c7c6'])
  })

  it('truncates the line at the cursor before appending', () => {
    // Standing after 1…c6, with 2.d4 still ahead in the line: dragging a piece is a new
    // continuation from here, so what the line said next goes.
    const analysis = buildAnalysisLine(line, 1, ['c7c6', 'd2d4'], 1)!
    expect(withBoardMove(analysis, 'g1', 'f3')).toEqual(['c7c6', 'g1f3'])
  })

  it('refuses a move the position does not allow', () => {
    const analysis = buildAnalysisLine(line, 1, [])!
    expect(withBoardMove(analysis, 'c7', 'c4')).toBeNull()
    expect(withBoardMove(analysis, 'zz', 'c6')).toBeNull()
  })

  it('promotes a pawn reaching the last rank to a queen', () => {
    // 1.e4 d5 2.exd5 Nf6 3.d6 Nc6 4.dxc7 Nb4 — White's pawn is on c7, next to the queen.
    const analysis = buildAnalysisLine(
      buildGameLine([
        move(0, 'e4', 'e2e4'),
        move(1, 'd5', 'd7d5'),
        move(2, 'exd5', 'e4d5'),
        move(3, 'Nf6', 'g8f6'),
        move(4, 'd6', 'd5d6'),
        move(5, 'Nc6', 'b8c6'),
        move(6, 'dxc7', 'd6c7'),
        move(7, 'Nb4', 'c6b4'),
      ]),
      8,
      [],
    )!
    expect(analysis.moves).toHaveLength(0)
    expect(withBoardMove(analysis, 'c7', 'd8')).toEqual(['c7d8q'])
  })
})

describe('lineStartingWith', () => {
  const PVS = [
    ['c7c6', 'd2d4', 'd7d5'],
    ['e7e5', 'g1f3'],
  ]

  it('gives back the whole line a dragged move begins', () => {
    // Dragging the engine's own move is entering the engine's line: the drag has to hand
    // back the tail as well, or the board keeps the move and loses the variation.
    expect(lineStartingWith(PVS, 'c7c6')).toEqual(['c7c6', 'd2d4', 'd7d5'])
    expect(lineStartingWith(PVS, 'e7e5')).toEqual(['e7e5', 'g1f3'])
  })

  it('ignores the promotion suffix, and empty lines', () => {
    expect(lineStartingWith([['c7c8q']], 'c7c8')).toEqual(['c7c8q'])
    expect(lineStartingWith([[], ['c7c6']], 'c7c6')).toEqual(['c7c6'])
  })

  it('is null for a move no line offers — a move of the reader’s own', () => {
    expect(lineStartingWith(PVS, 'g8f6')).toBeNull()
    expect(lineStartingWith([], 'c7c6')).toBeNull()
  })
})
