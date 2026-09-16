import { Chess } from 'chessops/chess'
import { parseFen } from 'chessops/fen'
import { describe, expect, it } from 'vitest'

import type { PracticeOpponents } from '@/lib/api/types'

import {
  MAIA_CHOICE,
  canTakeBack,
  policyFor,
  practicePhase,
  practiceResult,
  preferredOpponent,
  sampleMove,
  takeBackLength,
  type PracticeGame,
} from './practice'

function board(fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'): Chess {
  return Chess.fromSetup(parseFen(fen).unwrap()).unwrap()
}

function game(over: Partial<PracticeGame> = {}): PracticeGame {
  return {
    side: 'white',
    opponent: { kind: 'engine', engineId: 1, name: 'sf', elo: 1500, movetimeMs: 1000 },
    base: 0,
    from: 0,
    reveal: false,
    ...over,
  }
}

describe('practicePhase', () => {
  it('is the reader’s move on their side’s turn and the computer’s on the other', () => {
    expect(practicePhase(game(), board(), [], 0)).toBe('yours')
    expect(practicePhase(game(), board(), ['e2e4'], 1)).toBe('thinking')
    expect(practicePhase(game({ side: 'black' }), board(), [], 0)).toBe('thinking')
  })

  it('asks nothing while the board is stepped back into the line', () => {
    expect(practicePhase(game(), board(), ['e2e4', 'e7e5'], 1)).toBe('reviewing')
  })

  it('is over at a mate', () => {
    const fool = ['f2f3', 'e7e5', 'g2g4', 'd8h4']
    expect(practicePhase(game(), board(), fool, 4)).toBe('over')
  })
})

describe('practiceResult', () => {
  it('names the winner of a mate from the reader’s side of it', () => {
    expect(practiceResult(board(), ['f2f3', 'e7e5', 'g2g4', 'd8h4'])).toEqual({
      kind: 'checkmate',
      winner: 'black',
    })
  })

  it('calls a stalemate, bare kings and a threefold repetition draws', () => {
    expect(practiceResult(board('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'), [])).toEqual({
      kind: 'stalemate',
    })
    expect(practiceResult(board('7k/8/6K1/8/8/8/8/8 w - - 0 1'), [])).toEqual({
      kind: 'insufficient',
    })
    const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8']
    expect(practiceResult(board(), shuffle.slice(0, 7))).toBeNull()
    expect(practiceResult(board(), shuffle)).toEqual({ kind: 'repetition' })
  })

  it('goes on while the game does', () => {
    expect(practiceResult(board(), ['e2e4', 'e7e5'])).toBeNull()
  })
})

describe('takeBackLength', () => {
  it('takes back the reply and the move it answered, with the reader to move', () => {
    expect(takeBackLength(game(), board(), ['e2e4', 'e7e5'])).toBe(0)
  })

  it('takes back only the reader’s own move while the computer is still thinking', () => {
    expect(takeBackLength(game(), board(), ['e2e4', 'e7e5', 'g1f3'])).toBe(2)
  })

  it('never takes back past where practice began', () => {
    const later = game({ from: 2 })
    expect(takeBackLength(later, board(), ['e2e4', 'e7e5', 'g1f3', 'b8c6'])).toBe(2)
    expect(takeBackLength(later, board(), ['e2e4', 'e7e5'])).toBe(2)
    expect(canTakeBack(later, ['e2e4', 'e7e5'])).toBe(false)
    expect(canTakeBack(later, ['e2e4', 'e7e5', 'g1f3'])).toBe(true)
  })
})

describe('sampleMove', () => {
  const policy = [
    { uci: 'e2e4', rank: 1, p: 0.6 },
    { uci: 'd2d4', rank: 2, p: 0.3 },
    { uci: 'g1f3', rank: 3, p: 0.1 },
  ]

  it('draws by the share of humans who play each move', () => {
    expect(sampleMove(policy, () => 0)).toBe('e2e4')
    expect(sampleMove(policy, () => 0.59)).toBe('e2e4')
    expect(sampleMove(policy, () => 0.61)).toBe('d2d4')
    expect(sampleMove(policy, () => 0.95)).toBe('g1f3')
  })

  it('weights by rank where the build publishes no probability', () => {
    const unpublished = policy.map(({ uci, rank }) => ({ uci, rank }))
    // 1 : 1/2 : 1/3 — the first move takes six elevenths of the draw.
    expect(sampleMove(unpublished, () => 0.5)).toBe('e2e4')
    expect(sampleMove(unpublished, () => 0.6)).toBe('d2d4')
    expect(sampleMove(unpublished, () => 0.99)).toBe('g1f3')
  })

  it('has nothing to play from an empty policy', () => {
    expect(sampleMove([], () => 0.5)).toBeNull()
  })
})

describe('policyFor', () => {
  it('reads the level asked for, and the top-level answer where it is not keyed', () => {
    const answer = {
      elo: 1500,
      policy: [{ uci: 'e2e4' }],
      levels: { '1900': { elo: 1900, policy: [{ uci: 'd2d4' }] } },
    }
    expect(policyFor(answer, 1900)).toEqual([{ uci: 'd2d4' }])
    expect(policyFor(answer, 1100)).toEqual([{ uci: 'e2e4' }])
    expect(policyFor(answer, null)).toEqual([{ uci: 'e2e4' }])
  })
})

describe('preferredOpponent', () => {
  const opponents: PracticeOpponents = {
    engines: [
      { engine_id: 1, name: 'away', runner_id: 3, available: false, reason: 'gone', strength: null },
      { engine_id: 2, name: 'sf', runner_id: null, available: true, reason: null, strength: null },
    ],
    default_engine_id: 1,
    maia: { available: true, reason: null },
    movetime_ms: { default: 1000, min: 100, max: 10000 },
  }

  it('opens on Maia where it can answer', () => {
    expect(preferredOpponent(opponents)).toBe(MAIA_CHOICE)
  })

  it('falls back to an engine that can answer, not the role’s engine that cannot', () => {
    expect(preferredOpponent({ ...opponents, maia: { available: false, reason: 'no' } })).toBe(2)
    expect(preferredOpponent(undefined)).toBeNull()
  })
})
