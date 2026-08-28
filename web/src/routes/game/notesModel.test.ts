import { describe, expect, it } from 'vitest'

import type { LineResponse, MoveRow } from '@/lib/api/types'

import type { GameNote } from './gameModel'
import {
  noteAnchor,
  noteAtTarget,
  noteCount,
  noteRows,
  noteTarget,
  notedLineIndices,
  notedMoveIndices,
  targetKey,
  type NoteTarget,
} from './notesModel'

function move(ply: number, san: string, uci: string): MoveRow {
  return { ply, move_number: Math.floor(ply / 2) + 1, san, uci }
}

/** 1.e4 d5 2.exd5 Qxd5 */
const MOVES: MoveRow[] = [
  move(0, 'e4', 'e2e4'),
  move(1, 'd5', 'd7d5'),
  move(2, 'exd5', 'e4d5'),
  move(3, 'Qxd5', 'd8d5'),
]

function note(over: Partial<GameNote> = {}): GameNote {
  const at = '2026-08-01T10:00:00Z'
  return {
    id: 1,
    text: 'a note',
    tags: [],
    game_id: 14,
    created_at: at,
    updated_at: at,
    ...over,
  }
}

const LINE: LineResponse = {
  id: 7,
  game_id: 14,
  base_ply: 1,
  moves: ['c7c6', 'd2d4'],
  sans: ['c6', 'd4'],
  created_at: '2026-08-01T09:00:00Z',
  updated_at: '2026-08-01T09:00:00Z',
}

describe('noteCount', () => {
  it('reads a half-move count off a note, and nothing off one that names no position', () => {
    expect(noteCount(note({ ply: 0 }))).toBe(0)
    expect(noteCount(note({ ply: 3 }))).toBe(3)
    expect(noteCount(note({ ply: null }))).toBeNull()
    expect(noteCount(note())).toBeNull()
  })
})

describe('noteAnchor', () => {
  it('anchors a note with a ply to the mainline position of that count', () => {
    expect(noteAnchor(note({ ply: 2 }), [])).toEqual({ kind: 'mainline', count: 2 })
  })

  it('anchors a note with no ply to nothing at all', () => {
    expect(noteAnchor(note(), [])).toEqual({ kind: 'loose' })
  })

  it('turns a line note’s count into moves into that line', () => {
    // The line branches after 1.e4, so a note at count 2 is one move into it.
    expect(noteAnchor(note({ ply: 2, line_id: 7 }), [LINE])).toEqual({
      kind: 'line',
      lineId: 7,
      base: 1,
      index: 1,
    })
  })

  it('anchors a note on the branch position itself at index 0', () => {
    expect(noteAnchor(note({ ply: 1, line_id: 7 }), [LINE])).toMatchObject({ index: 0 })
  })

  it('falls back to the mainline where the line it names is no longer kept', () => {
    expect(noteAnchor(note({ ply: 2, line_id: 7 }), [])).toEqual({ kind: 'mainline', count: 2 })
  })
})

describe('noteRows', () => {
  it('says which move a note is about, one behind its count', () => {
    const [row] = noteRows([note({ ply: 2 })], [], MOVES)
    // Count 2 is the position after 1.e4 d5, which 1…d5 produced.
    expect(row?.context).toBe('1…d5')
  })

  it('calls a note on the starting position what it is', () => {
    const [row] = noteRows([note({ ply: 0 })], [], MOVES)
    expect(row?.context).toBe('start')
  })

  it('takes a line note’s SAN off the line rather than off the game', () => {
    const [row] = noteRows([note({ ply: 3, line_id: 7 })], [LINE], MOVES)
    expect(row).toMatchObject({ onLine: true, context: '2.d4' })
  })

  it('reads the game’s own notes in ply order, and the variations’ after them', () => {
    const rows = noteRows(
      [
        note({ id: 1, ply: 3, line_id: 7 }),
        note({ id: 2, ply: 3 }),
        note({ id: 3, ply: 1 }),
        note({ id: 4 }),
      ],
      [LINE],
      MOVES,
    )
    expect(rows.map((row) => row.note.id)).toEqual([3, 2, 4, 1])
  })

  it('puts the newer of two notes on the same position first', () => {
    const rows = noteRows(
      [
        note({ id: 1, ply: 2, created_at: '2026-08-01T10:00:00Z' }),
        note({ id: 2, ply: 2, created_at: '2026-08-02T10:00:00Z' }),
      ],
      [],
      MOVES,
    )
    expect(rows.map((row) => row.note.id)).toEqual([2, 1])
  })

  it('carries the source through, so a note the coach wrote can say so', () => {
    const [row] = noteRows([note({ ply: 1, source: 'mcp' })], [], MOVES)
    expect(row?.source).toBe('mcp')
  })
})

describe('notedMoveIndices', () => {
  it('marks the move that produced each noted position', () => {
    const marks = notedMoveIndices([note({ id: 1, ply: 2 }), note({ id: 2, ply: 4 })], [])
    expect([...marks].sort()).toEqual([1, 3])
  })

  it('marks nothing for the starting position, for a loose note, or for a line note', () => {
    const marks = notedMoveIndices(
      [note({ id: 1, ply: 0 }), note({ id: 2 }), note({ id: 3, ply: 2, line_id: 7 })],
      [LINE],
    )
    expect(marks.size).toBe(0)
  })
})

describe('notedLineIndices', () => {
  it('marks the line move that produced each noted position', () => {
    const marks = notedLineIndices([
      { ...LINE, notes: [note({ id: 1, ply: 3, line_id: 7 })] },
    ])
    expect([...(marks.get(7) ?? [])]).toEqual([1])
  })

  it('marks nothing on the branch position, which no line move produced', () => {
    const marks = notedLineIndices([{ ...LINE, notes: [note({ id: 1, ply: 1, line_id: 7 })] }])
    expect(marks.has(7)).toBe(false)
  })
})

describe('noteTarget', () => {
  const base = { gameId: 14, moves: MOVES, fen: 'fen-on-the-board' }

  it('attaches to the mainline position the board is on', () => {
    const target = noteTarget({ ...base, boardIndex: 2, branch: null })
    expect(target).toMatchObject({
      kind: 'mainline',
      gameId: 14,
      ply: 2,
      fen: 'fen-on-the-board',
      line: null,
      label: '1…d5',
    })
  })

  it('names the starting position rather than a move that does not exist', () => {
    const target = noteTarget({ ...base, boardIndex: 0, branch: null })
    expect(target).toMatchObject({ ply: 0, label: 'the starting position' })
  })

  it('pins the whole walk when the board is off the game line', () => {
    const target = noteTarget({
      ...base,
      boardIndex: 1,
      branch: { base: 1, moves: ['c7c6', 'd2d4'], sans: ['c6', 'd4'], cursor: 1 },
    })
    expect(target).toMatchObject({
      kind: 'line',
      // One move into a line off ply 1 is count 2.
      ply: 2,
      // The whole line, not the part walked so far: the tail is still the reader's.
      line: { game_id: 14, base_ply: 1, moves: ['c7c6', 'd2d4'] },
      label: '1…c6 (variation)',
    })
  })

  it('treats a line walked back to its head as the mainline position it branched from', () => {
    const target = noteTarget({
      ...base,
      boardIndex: 1,
      branch: { base: 1, moves: ['c7c6'], sans: ['c6'], cursor: 0 },
    })
    expect(target).toMatchObject({ kind: 'mainline', ply: 1, line: null })
  })

  it('hands over a copy of the line, not the branch’s own array', () => {
    const moves = ['c7c6']
    const target = noteTarget({
      ...base,
      boardIndex: 1,
      branch: { base: 1, moves, sans: ['c6'], cursor: 1 },
    })
    expect(target.line?.moves).not.toBe(moves)
    expect(target.line?.moves).toEqual(moves)
  })
})

describe('targetKey', () => {
  const at = (over: Partial<NoteTarget> = {}): NoteTarget => ({
    kind: 'mainline',
    gameId: 14,
    ply: 2,
    fen: 'fen',
    line: null,
    label: '1…d5',
    ...over,
  })

  it('is the same string for the same anchor, whatever the label says', () => {
    expect(targetKey(at())).toBe(targetKey(at({ label: 'something else', fen: 'other' })))
  })

  it('changes with the position, the game and the line being walked', () => {
    const base = targetKey(at())
    expect(targetKey(at({ ply: 3 }))).not.toBe(base)
    expect(targetKey(at({ gameId: 15 }))).not.toBe(base)
    const walk = at({
      kind: 'line',
      line: { game_id: 14, base_ply: 1, moves: ['c7c6', 'd2d4'] },
    })
    expect(targetKey(walk)).not.toBe(base)
    // A step deeper into the same variation is a different position, so a different key.
    expect(targetKey({ ...walk, ply: 3 })).not.toBe(targetKey(walk))
  })
})

describe('noteAtTarget', () => {
  const mainline = (ply: number): NoteTarget => ({
    kind: 'mainline',
    gameId: 14,
    ply,
    fen: 'fen',
    line: null,
    label: `ply ${ply}`,
  })
  const onLine = (ply: number): NoteTarget => ({
    kind: 'line',
    gameId: 14,
    ply,
    fen: 'fen',
    line: { game_id: 14, base_ply: 1, moves: ['c7c6', 'd2d4'] },
    label: '1…c6 (variation)',
  })

  it('finds the note on the mainline position the board is standing on', () => {
    const here = note({ id: 3, ply: 2, text: 'the recapture' })
    const found = noteAtTarget({
      target: mainline(2),
      notes: [note({ id: 1, ply: 1 }), here, note({ id: 4, ply: 3 })],
      lines: [],
    })
    expect(found?.id).toBe(3)
  })

  it('finds the note on the starting position, which is a count of zero and not nothing', () => {
    const found = noteAtTarget({ target: mainline(0), notes: [note({ id: 2, ply: 0 })], lines: [] })
    expect(found?.id).toBe(2)
  })

  it('finds nothing on a position nobody has written about', () => {
    const notes = [note({ id: 1, ply: 1 }), note({ id: 2, ply: 3 })]
    expect(noteAtTarget({ target: mainline(2), notes, lines: [] })).toBeNull()
  })

  it('matches a line note by the line it is pinned to and the count inside it', () => {
    // Line 7 runs off ply 1, so its second move is count 3.
    const inside = note({ id: 5, ply: 3, line_id: 7 })
    const found = noteAtTarget({
      target: onLine(3),
      notes: [inside],
      lines: [LINE],
      lineId: 7,
    })
    expect(found?.id).toBe(5)
  })

  it('will not take a note off another line, or off a line the board is not in', () => {
    const inside = note({ id: 5, ply: 3, line_id: 7 })
    // The same count, but the board is standing in a different kept line.
    expect(
      noteAtTarget({ target: onLine(3), notes: [inside], lines: [LINE], lineId: 9 }),
    ).toBeNull()
    // A walk nobody has pinned yet is no line at all, so it can carry no note.
    expect(noteAtTarget({ target: onLine(3), notes: [inside], lines: [LINE] })).toBeNull()
  })

  it('keeps the game line and a variation apart at the same half-move count', () => {
    const onMain = note({ id: 6, ply: 3 })
    const inLine = note({ id: 7, ply: 3, line_id: 7 })
    expect(
      noteAtTarget({ target: mainline(3), notes: [onMain, inLine], lines: [LINE], lineId: 7 })?.id,
    ).toBe(6)
    expect(
      noteAtTarget({ target: onLine(3), notes: [onMain, inLine], lines: [LINE], lineId: 7 })?.id,
    ).toBe(7)
  })

  it('never offers to rewrite a note that came in on a position another game reached', () => {
    // What `game_notes` attaches as `scope: position`: another game's note, with the ply
    // this game happened to reach the position at.
    const elsewhere = note({ id: 8, ply: 2, game_id: 99, scope: 'position' })
    const loose = note({ id: 9, ply: 2, game_id: null, scope: 'position' })
    expect(noteAtTarget({ target: mainline(2), notes: [elsewhere, loose], lines: [] })).toBeNull()
  })

  it('never offers a note belonging to another game, whatever its scope says', () => {
    const other = note({ id: 10, ply: 2, game_id: 99 })
    expect(noteAtTarget({ target: mainline(2), notes: [other], lines: [] })).toBeNull()
  })

  it('takes a note the game payload sent, which names a scope and no game id at all', () => {
    // The shape `game_notes` actually returns: `scope`, `ply`, and no `game_id` — the note
    // came back under this game, which is what says it is this game's.
    const own = note({ id: 14, ply: 2, game_id: null, scope: 'game' })
    expect(noteAtTarget({ target: mainline(2), notes: [own], lines: [] })?.id).toBe(14)
  })

  it('takes the newest of two notes on one position, as the Notes tab lists them', () => {
    const older = note({ id: 11, ply: 2, created_at: '2026-08-01T10:00:00Z' })
    const newer = note({ id: 12, ply: 2, created_at: '2026-08-02T10:00:00Z' })
    expect(noteAtTarget({ target: mainline(2), notes: [older, newer], lines: [] })?.id).toBe(12)
    expect(noteAtTarget({ target: mainline(2), notes: [newer, older], lines: [] })?.id).toBe(12)
  })

  it('takes the note the reader named instead, where they named one', () => {
    const older = note({ id: 11, ply: 2, created_at: '2026-08-01T10:00:00Z' })
    const newer = note({ id: 12, ply: 2, created_at: '2026-08-02T10:00:00Z' })
    const found = noteAtTarget({
      target: mainline(2),
      notes: [older, newer],
      lines: [],
      preferId: 11,
    })
    expect(found?.id).toBe(11)
  })

  it('ignores a named note that is not on this position, rather than jumping to it', () => {
    const here = note({ id: 11, ply: 2 })
    const away = note({ id: 12, ply: 3 })
    const found = noteAtTarget({
      target: mainline(2),
      notes: [here, away],
      lines: [],
      preferId: 12,
    })
    expect(found?.id).toBe(11)
  })

  it('reads a note whose line nobody keeps any more as the mainline count it names', () => {
    // `noteAnchor` falls back to the count when the line is gone; the composer follows it,
    // so the note is still editable from the game line rather than being unreachable.
    const orphan = note({ id: 13, ply: 3, line_id: 7 })
    expect(noteAtTarget({ target: mainline(3), notes: [orphan], lines: [] })?.id).toBe(13)
  })
})
