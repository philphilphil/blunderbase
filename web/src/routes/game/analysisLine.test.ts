import { describe, expect, it } from 'vitest'

import type { MoveRow } from '@/lib/api/types'

import { buildAnalysisLine, withBoardMove } from './analysisLine'
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
