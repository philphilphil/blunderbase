import { describe, expect, it } from 'vitest'

import type { NoteResponse } from '@/lib/api/types'

import {
  countNotes,
  gameLabel,
  groupNotes,
  lineText,
  noteHref,
  oneLine,
  notePlyLabel,
  scopeOf,
} from './grouping'

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

  it('sends a note with no game to the notes screen, on itself', () => {
    expect(noteHref(note({ id: 9, fen: '8/8/8/8/8/8/8/K6k w - - 0 1' }))).toBe('/notes?note=9')
    expect(noteHref(note({ id: 10 }))).toBe('/notes?note=10')
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

describe('groupNotes', () => {
  const notes = [
    note({ id: 1, game_id: 10, ply: 40, updated_at: '2026-08-02T10:00:00Z' }),
    note({ id: 2, game_id: 10, ply: 12, updated_at: '2026-08-01T10:00:00Z' }),
    note({ id: 3, game_id: 10, updated_at: '2026-07-30T10:00:00Z' }),
    note({ id: 4, game_id: 11, ply: 3, updated_at: '2026-08-05T10:00:00Z' }),
    note({ id: 5, fen: '8/8/8/8/8/8/8/K6k w - - 0 1', updated_at: '2026-08-06T10:00:00Z' }),
    note({ id: 6, updated_at: '2026-08-07T10:00:00Z' }),
  ]

  it('groups by game, newest-written game first, and puts the loose notes last', () => {
    const groups = groupNotes(notes)
    expect(groups.map((group) => group.key)).toEqual(['game:11', 'game:10', 'loose'])
    expect(countNotes(groups)).toBe(notes.length)
  })

  it('orders a game in ply order, with the note about the whole game first', () => {
    const [, game10] = groupNotes(notes)
    expect(game10!.notes.map((one) => one.id)).toEqual([3, 2, 1])
  })

  it('orders the loose group newest first', () => {
    const groups = groupNotes(notes)
    expect(groups.at(-1)!.notes.map((one) => one.id)).toEqual([6, 5])
  })

  it('labels a group from the game summary the note carries', () => {
    const groups = groupNotes([
      note({
        id: 1,
        game_id: 3,
        game: { id: 3, white: 'phib', black: 'maia', result: '1-0', date: '2026-08-22' },
      }),
    ])
    expect(groups[0]!.title).toBe('phib vs maia')
    expect(groups[0]!.subtitle).toBe('1–0 · 2026-08-22')
    expect(groups[0]!.href).toBe('/games/3')
  })

  it('has no groups at all for no notes', () => {
    expect(groupNotes([])).toEqual([])
    expect(countNotes([])).toBe(0)
  })
})
