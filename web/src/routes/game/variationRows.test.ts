import { describe, expect, it } from 'vitest'

import type { LineResponse, MoveRow } from '@/lib/api/types'

import { buildGameLine } from './gameModel'
import type { KeptVariation } from './sessionVariations'
import { variationRows } from './variationRows'

function move(ply: number, san: string, uci: string): MoveRow {
  return { ply, move_number: Math.floor(ply / 2) + 1, san, uci }
}

/** 1.e4 d5 2.exd5 Qxd5 — the same little game the page tests use. */
const MOVES: MoveRow[] = [
  move(0, 'e4', 'e2e4'),
  move(1, 'd5', 'd7d5'),
  move(2, 'exd5', 'e4d5'),
  move(3, 'Qxd5', 'd8d5'),
]

const LINE = buildGameLine(MOVES)

function pinned(over: Partial<LineResponse> = {}): LineResponse {
  const now = '2026-08-01T00:00:00Z'
  return {
    id: 7,
    game_id: 14,
    base_ply: 1,
    moves: ['c7c6'],
    sans: ['c6'],
    created_at: now,
    updated_at: now,
    ...over,
  }
}

function kept(id: number, base: number, moves: string[]): KeptVariation {
  return { id, base, moves }
}

describe('variationRows', () => {
  it('draws a pinned line the server holds even though this session never walked it', () => {
    const rows = variationRows({ line: LINE, persisted: [pinned()], kept: [], walked: null })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      keptId: null,
      lineId: 7,
      base: 1,
      sans: ['c6'],
      cursor: null,
      pinnedThrough: 1,
    })
  })

  it('replays a pinned line against this game rather than trusting its stored SAN', () => {
    // The line branches after 1.e4, so 1…c6 is Black's move whatever `sans` claims.
    const rows = variationRows({
      line: LINE,
      persisted: [pinned({ sans: ['nonsense'] })],
      kept: [],
      walked: null,
    })
    expect(rows[0]?.sans).toEqual(['c6'])
  })

  it('drops a pinned line the game can no longer replay', () => {
    const rows = variationRows({
      line: LINE,
      persisted: [pinned({ moves: ['a1a8'] })],
      kept: [],
      walked: null,
    })
    expect(rows).toEqual([])
  })

  it('folds a session line and the pinned line it duplicates into one row', () => {
    const rows = variationRows({
      line: LINE,
      persisted: [pinned()],
      kept: [kept(1, 1, ['c7c6'])],
      walked: null,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ keptId: 1, lineId: 7, pinnedThrough: 1, sans: ['c6'] })
  })

  it('draws the longer walk on a pinned row, and says how much of it is pinned', () => {
    const rows = variationRows({
      line: LINE,
      persisted: [pinned()],
      kept: [kept(1, 1, ['c7c6', 'd2d4'])],
      walked: null,
    })
    expect(rows).toHaveLength(1)
    // The reading is what is drawn; the pin still covers only its first move, which is what
    // lets the affordance offer to extend it rather than to undo it.
    expect(rows[0]).toMatchObject({ sans: ['c6', 'd4'], pinnedThrough: 1, keptId: 1, lineId: 7 })
  })

  it('keeps a session line off another position separate from the pinned one', () => {
    const rows = variationRows({
      line: LINE,
      persisted: [pinned()],
      kept: [kept(1, 0, ['d2d4'])],
      walked: null,
    })
    expect(rows.map((row) => [row.lineId, row.base, row.sans])).toEqual([
      [7, 1, ['c6']],
      [null, 0, ['d4']],
    ])
  })

  it('puts pinned lines ahead of the session’s own', () => {
    const rows = variationRows({
      line: LINE,
      persisted: [pinned({ id: 7, base_ply: 2, moves: ['g1f3'] })],
      kept: [kept(1, 1, ['c7c6'])],
      walked: null,
    })
    expect(rows.map((row) => row.lineId)).toEqual([7, null])
  })

  it('gives the walked line the row it belongs to rather than a second one', () => {
    const rows = variationRows({
      line: LINE,
      persisted: [pinned()],
      kept: [],
      walked: { base: 1, moves: ['c7c6'], sans: ['c6'], cursor: 1 },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ lineId: 7, cursor: 1, pinnedThrough: 1 })
  })

  it('keeps a walked line that diverges from the pinned one as its own row', () => {
    const rows = variationRows({
      line: LINE,
      persisted: [pinned()],
      kept: [],
      walked: { base: 1, moves: ['e7e5'], sans: ['e5'], cursor: 1 },
    })
    expect(rows.map((row) => [row.lineId, row.sans, row.cursor])).toEqual([
      [7, ['c6'], null],
      [null, ['e5'], 1],
    ])
  })

  it('claims the row of the session entry it is the same walk as, in that entry’s place', () => {
    const rows = variationRows({
      line: LINE,
      persisted: [],
      kept: [kept(1, 0, ['d2d4']), kept(2, 1, ['c7c6'])],
      // Walking further into the *first* line: it stays first.
      walked: { base: 0, moves: ['d2d4', 'd7d5'], sans: ['d4', 'd5'], cursor: 2 },
    })
    expect(rows.map((row) => [row.keptId, row.sans, row.cursor])).toEqual([
      [1, ['d4', 'd5'], 2],
      [2, ['c6'], null],
    ])
  })

  it('carries the pinned line’s note marks, as indices into the moves it draws', () => {
    const rows = variationRows({
      line: LINE,
      persisted: [pinned({ moves: ['c7c6', 'd2d4'] })],
      kept: [],
      walked: null,
      // A note after one move of the line marks that move, which is index 0.
      notedByLine: new Map([[7, new Set([0])]]),
    })
    expect(rows[0]?.noted).toEqual([0])
    expect(rows[0]?.sans).toEqual(['c6', 'd4'])
  })

  it('drops a note mark that falls past what the game can replay', () => {
    const rows = variationRows({
      line: LINE,
      persisted: [pinned()],
      kept: [],
      walked: null,
      notedByLine: new Map([[7, new Set([0, 4])]]),
    })
    expect(rows[0]?.noted).toEqual([0])
  })

  it('hands over the UCI the pin affordance would send, truncated to what replayed', () => {
    const rows = variationRows({
      line: LINE,
      persisted: [],
      kept: [kept(1, 1, ['c7c6', 'a1a8'])],
      walked: null,
    })
    expect(rows[0]?.moves).toEqual(['c7c6'])
  })
})
