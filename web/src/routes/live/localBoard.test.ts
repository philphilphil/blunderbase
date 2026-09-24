import { describe, expect, it } from 'vitest'

import type { LiveState } from '@/lib/api/types'

import {
  applyLocal,
  boardDests,
  detectInput,
  dragToUci,
  EMPTY_BOARD,
  START_FEN,
  stepAction,
  type BoardAction,
} from './localBoard'

const FRENCH = 'rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'
const ITALIAN = '[Event "Casual"]\n\n1. e4 e5 2. Nf3 (2. f4 exf4) 2... Nc6 3. Bc4 {the Italian} 1-0\n'

function run(...actions: BoardAction[]): LiveState {
  return actions.reduce(applyLocal, EMPTY_BOARD)
}

const load = (pgn: string): BoardAction => ({ kind: 'load', input: { pgn } })
const play = (...ucis: string[]): BoardAction => ({ kind: 'play', ucis })
const goto = (ply: number, cursor = 0): BoardAction => ({ kind: 'goto', ply, cursor })

describe('detectInput', () => {
  it('reads one line with a placement as a FEN, with or without its counters', () => {
    expect(detectInput(`  ${FRENCH}\n`)).toEqual({ fen: FRENCH })
    expect(detectInput('8/8/8/8/8/8/8/K1k5 w')).toEqual({ fen: '8/8/8/8/8/8/8/K1k5 w' })
  })

  it('offers everything else as a PGN, and nothing as nothing', () => {
    expect(detectInput('1. e4 e5')).toEqual({ pgn: '1. e4 e5' })
    expect(detectInput(ITALIAN)).toEqual({ pgn: ITALIAN.trim() })
    expect(detectInput('   ')).toBeNull()
  })
})

describe('applyLocal, as services/live.py answers it', () => {
  it('starts a new board on the initial array with no mainline', () => {
    const state = run({ kind: 'new' })
    expect(state.fen).toBe(START_FEN)
    expect(state.ply).toBeNull()
    expect(state.active).toBe(true)
  })

  it('loads a PGN’s mainline and stands at its end', () => {
    const state = run(load(ITALIAN))
    expect(state.line_positions?.slice(1).map((p) => p.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'])
    expect(state.ply).toBe(5)
    expect(state.last_move).toBe('f1c4')
    expect(state.moves).toEqual([])
  })

  it('starts a PGN where its FEN header says', () => {
    const state = run(load(`[SetUp "1"]\n[FEN "${FRENCH}"]\n\n2. d4 d5 *`))
    expect(state.line_positions?.[0]?.fen).toBe(FRENCH)
    expect(state.ply).toBe(2)
  })

  it('refuses a PGN with an illegal move, a FEN that is no position, and an empty PGN', () => {
    expect(() => run(load('1. e4 e5 2. Ke3 *'))).toThrow()
    expect(() => run({ kind: 'load', input: { fen: 'not/a/fen/at/all/x/y/z' } })).toThrow()
    expect(() => run(load('*'))).toThrow()
  })

  it('starts a board on the first move played on an empty one', () => {
    const state = run(play('e2e4'))
    expect(state.moves).toEqual(['e2e4'])
    expect(state.cursor).toBe(1)
  })

  it('plays a batch whole or not at all', () => {
    const start = run({ kind: 'new' })
    expect(() => applyLocal(start, play('e2e4', 'e7e5', 'e1e3'))).toThrow()
    const state = applyLocal(start, play('e2e4', 'e7e5', 'g1f3'))
    expect(state.move_sans).toEqual(['e4', 'e5', 'Nf3'])
  })

  it('stays on the mainline when its own next move is played', () => {
    const state = run(load(ITALIAN), goto(2), play('g1f3'))
    expect(state.ply).toBe(3)
    expect(state.moves).toEqual([])
  })

  it('keeps a branch while the board steps away along the mainline', () => {
    const branched = run(load(ITALIAN), goto(2), play('f2f4', 'e5f4'))
    expect(branched.base).toBe(2)
    expect(branched.move_sans).toEqual(['f4', 'exf4'])

    const away = applyLocal(branched, goto(5))
    expect(away.moves).toEqual(['f2f4', 'e5f4'])
    expect(away.cursor).toBe(0)

    const inside = applyLocal(away, goto(2, 1))
    expect(inside.last_move).toBe('f2f4')
  })

  it('steps into the branch on its own next move, and cuts it on another', () => {
    const line = run({ kind: 'new' }, play('e2e4', 'e7e5', 'g1f3'), goto(0, 1))
    expect(applyLocal(line, play('e7e5')).moves).toHaveLength(3)
    expect(applyLocal(line, play('c7c5')).moves).toEqual(['e2e4', 'c7c5'])
  })

  it('refuses a step off the line', () => {
    const state = run(load(ITALIAN))
    for (const [ply, cursor] of [[6, 0], [-1, 0], [2, 1], [0, -1]] as const) {
      expect(() => applyLocal(state, goto(ply, cursor))).toThrow()
    }
  })
})

describe('stepAction', () => {
  it('walks the mainline and ends at both ends', () => {
    const end = run(load(ITALIAN))
    expect(stepAction(end, 1)).toBeNull()
    expect(stepAction(end, -1)).toEqual(goto(4))
    expect(stepAction(applyLocal(end, goto(0)), -1)).toBeNull()
  })

  it('walks the branch, back onto the mainline at its base', () => {
    const inBranch = run({ kind: 'new' }, play('e2e4', 'e7e5'))
    expect(stepAction(inBranch, -1)).toEqual(goto(0, 1))
    const first = applyLocal(inBranch, goto(0, 1))
    expect(stepAction(first, -1)).toEqual(goto(0, 0))
    // A bare position has no mainline: forward from its start is into the branch.
    expect(stepAction(applyLocal(first, goto(0, 0)), 1)).toEqual(goto(0, 1))
  })

  it('does nothing on an empty board', () => {
    expect(stepAction(EMPTY_BOARD, 1)).toBeNull()
  })
})

describe('board helpers', () => {
  it('knows the legal destinations, and none for no position', () => {
    expect(boardDests(START_FEN).get('e2')).toEqual(['e3', 'e4'])
    expect(boardDests(null).size).toBe(0)
  })

  it('promotes a dragged pawn to a queen, and nothing else', () => {
    const promoting = '8/4P3/8/8/8/8/8/K1k5 w - - 0 1'
    expect(dragToUci(promoting, 'e7', 'e8')).toBe('e7e8q')
    expect(dragToUci(START_FEN, 'e2', 'e4')).toBe('e2e4')
  })
})
