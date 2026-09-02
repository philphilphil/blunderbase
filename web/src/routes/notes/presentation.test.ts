import { describe, expect, it } from 'vitest'

import type { NoteResponse } from '@/lib/api/types'

import {
  ageBuckets,
  explorerHref,
  gameHref,
  gameLabel,
  lineText,
  noteHref,
  oneLine,
  notePlyLabel,
  originLabel,
  reachLabel,
  scopeOf,
} from './presentation'

function note(over: Partial<NoteResponse> & { id: number }): NoteResponse {
  return {
    text: 'a note',
    tags: [],
    created_at: '2026-08-01T10:00:00Z',
    updated_at: '2026-08-01T10:00:00Z',
    ...over,
  } as NoteResponse
}

describe('scopeOf', () => {
  it('names the anchors a note has, a pinned variation first', () => {
    expect(scopeOf(note({ id: 1, game_id: 3, line_id: 8, ply: 12 }))).toBe('line')
    expect(scopeOf(note({ id: 2, game_id: 3, ply: 12 }))).toBe('game')
    expect(scopeOf(note({ id: 3, fen: '8/8/8/8/8/8/8/K6k w - - 0 1' }))).toBe('position')
    expect(scopeOf(note({ id: 4, position_id: 55 }))).toBe('position')
    expect(scopeOf(note({ id: 5 }))).toBe('free')
  })
})

describe('notePlyLabel', () => {
  it('reads a half-move count as the move it comes after', () => {
    expect(notePlyLabel(0)).toBe('start')
    expect(notePlyLabel(1)).toBe('1.')
    expect(notePlyLabel(2)).toBe('1…')
    expect(notePlyLabel(25)).toBe('13.')
    expect(notePlyLabel(null)).toBeNull()
    expect(notePlyLabel(undefined)).toBeNull()
  })
})

describe('lineText', () => {
  it('numbers a variation from the ply it branches off', () => {
    expect(lineText({ base_ply: 0, sans: ['e4', 'c5', 'Nf3'], moves: [] })).toBe('1. e4 c5 2. Nf3')
  })

  it("opens with an ellipsis when the first move is Black's", () => {
    expect(lineText({ base_ply: 25, sans: ['Nd7', 'Bg5'], moves: [] })).toBe('13… Nd7 14. Bg5')
  })

  it('falls back to UCI when the backend could not replay the line', () => {
    expect(lineText({ base_ply: 0, sans: [], moves: ['e2e4', 'c7c5'] })).toBe('1. e2e4 c7c5')
  })
})

describe('noteHref', () => {
  it('opens the game at the ply, and at the line when it pinned one', () => {
    expect(noteHref(note({ id: 1, game_id: 42, ply: 25 }))).toBe('/games/42?ply=25')
    expect(noteHref(note({ id: 2, game_id: 42, ply: 25, line_id: 8 }))).toBe(
      '/games/42?ply=25&line=8',
    )
    // Ply 0 is the starting position, which is where a game opens anyway.
    expect(noteHref(note({ id: 3, game_id: 42, ply: 0 }))).toBe('/games/42')
    expect(noteHref(note({ id: 4, game_id: 42 }))).toBe('/games/42')
  })

  it('opens a note about a position in the explorer, rooted at that position', () => {
    expect(noteHref(note({ id: 9, fen: '8/8/8/8/8/8/8/K6k w - - 0 1' }))).toBe(
      `/explorer?fen=${encodeURIComponent('8/8/8/8/8/8/8/K6k w - - 0 1')}`,
    )
  })

  it('leaves a note anchored to nothing on itself, because there is nowhere to go', () => {
    expect(noteHref(note({ id: 10 }))).toBe('/notes?note=10')
  })
})

describe('where a note came from', () => {
  const move = { ply: 25, move_number: 13, color: 'white' as const, san: 'Bg5', label: '13. Bg5' }

  it('links the game and the explorer separately, because a note has both', () => {
    const one = note({ id: 1, game_id: 42, ply: 25, fen: 'K6k w - -', move })
    expect(gameHref(one)).toBe('/games/42?ply=25')
    expect(explorerHref(one.fen)).toBe(`/explorer?fen=${encodeURIComponent('K6k w - -')}`)
    // A loose note has neither, which is what keeps the row off it entirely.
    expect(gameHref(note({ id: 2 }))).toBeNull()
    expect(explorerHref(null)).toBeNull()
  })

  it('names the move the server spelled, and falls back to the ply alone', () => {
    expect(originLabel(note({ id: 1, game_id: 42, ply: 25, move }))).toBe('13. Bg5')
    expect(originLabel(note({ id: 2, game_id: 42, ply: 25 }))).toBe('13.')
    expect(originLabel(note({ id: 3, game_id: 42 }))).toBeNull()
  })

  it('counts the owner and the model games apart, and says nothing about neither', () => {
    expect(reachLabel(note({ id: 1, position_games: 4 }))).toBe('In 4 of your games')
    expect(reachLabel(note({ id: 2, position_games: 1 }))).toBe('In 1 game of yours')
    expect(reachLabel(note({ id: 3, position_games: 4, position_reference_games: 2 }))).toBe(
      'In 4 of your games and 2 model games',
    )
    expect(reachLabel(note({ id: 4, position_reference_games: 1 }))).toBe('In 1 model game')
    expect(reachLabel(note({ id: 5 }))).toBeNull()
  })
})

describe('gameLabel and oneLine', () => {
  it('names a game by its players, or by its id when it has none', () => {
    expect(gameLabel({ id: 1, white: 'phib', black: 'maia' }, 1)).toBe('phib vs maia')
    expect(gameLabel({ id: 1, white: 'phib' }, 1)).toBe('phib vs ?')
    expect(gameLabel({ id: 1 }, 1)).toBe('Game #1')
    expect(gameLabel(null, 7)).toBe('Game #7')
  })

  it('takes the first line of a note and caps it', () => {
    expect(oneLine(note({ id: 1, text: 'first line\nsecond line' }))).toBe('first line')
    expect(oneLine(note({ id: 2, text: 'abcdef' }), 4)).toBe('abc…')
    expect(oneLine(note({ id: 3, text: '   ' }))).toBe('note')
  })
})

describe('ageBuckets', () => {
  // A Wednesday, so "this week" reaches back into the previous month and the calendar
  // buckets under it have something to be distinguished from.
  const NOW = Date.parse('2026-09-02T14:00:00Z')

  const notes = [
    note({ id: 1, created_at: '2026-09-02T09:00:00Z' }),
    note({ id: 2, created_at: '2026-09-02T08:00:00Z' }),
    note({ id: 3, created_at: '2026-08-31T10:00:00Z' }),
    note({ id: 4, created_at: '2026-08-20T10:00:00Z' }),
    note({ id: 5, created_at: '2026-08-02T10:00:00Z' }),
    note({ id: 6, created_at: '2026-07-11T10:00:00Z' }),
  ]

  it('cuts the list into today, this week, and then calendar months', () => {
    const buckets = ageBuckets(notes, NOW)
    expect(buckets.map((bucket) => bucket.label)).toEqual([
      'Today',
      'This week',
      'August 2026',
      'July 2026',
    ])
    expect(buckets.map((bucket) => bucket.notes.map((one) => one.id))).toEqual([
      [1, 2],
      [3],
      [4, 5],
      [6],
    ])
  })

  it('never re-sorts, and never reopens a bucket it has closed', () => {
    // The API answers newest first; a rule that disagreed with the order under it would be
    // worse than no rule, so an out-of-order note starts a second bucket of its own rather
    // than jumping back into the first.
    const buckets = ageBuckets(
      [
        note({ id: 1, created_at: '2026-08-20T10:00:00Z' }),
        note({ id: 2, created_at: '2026-07-11T10:00:00Z' }),
        note({ id: 3, created_at: '2026-08-19T10:00:00Z' }),
      ],
      NOW,
    )
    expect(buckets.map((bucket) => [bucket.label, bucket.notes.map((one) => one.id)])).toEqual([
      ['August 2026', [1]],
      ['July 2026', [2]],
      ['August 2026', [3]],
    ])
  })

  it('reads a note earlier this month but outside the week as its own rule', () => {
    const buckets = ageBuckets([note({ id: 1, created_at: '2026-09-01T10:00:00Z' })], NOW)
    expect(buckets.map((bucket) => bucket.label)).toEqual(['This week'])
    const older = ageBuckets([note({ id: 2, created_at: '2026-09-14T10:00:00Z' })], Date.parse('2026-09-25T14:00:00Z'))
    expect(older.map((bucket) => bucket.label)).toEqual(['Earlier this month'])
  })

  it('has no buckets at all for no notes', () => {
    expect(ageBuckets([], NOW)).toEqual([])
  })
})
