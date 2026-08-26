import { describe, expect, it } from 'vitest'

import type { GameSummary, LiveState } from '@/lib/api/types'

import {
  boardArrows,
  boardSquares,
  describeSession,
  isVariation,
  orientationFor,
  plyLabel,
} from './live'

const idle: LiveState = {
  active: false,
  moves: [],
  arrows: [],
  squares: [],
  viewer_count: 0,
}

function session(overrides: Partial<LiveState> = {}): LiveState {
  return {
    ...idle,
    active: true,
    game_id: 7,
    ply: 24,
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    turn: 'white',
    last_move: 'e2e4',
    updated_at: '2026-08-26T00:50:19Z',
    ...overrides,
  }
}

const game: GameSummary = {
  id: 7,
  source: 'lichess',
  color: 'black',
  white: 'kn1ghtmare',
  black: 'phib',
}

describe('board marks', () => {
  it('passes the coach’s brushes through — they are chessground’s own names', () => {
    const state = session({
      arrows: [
        { from: 'e2', to: 'e4', color: 'blue' },
        { from: 'd7', to: 'd5', color: 'red' },
      ],
      squares: [{ square: 'f7', color: 'yellow' }],
    })
    expect(boardArrows(state)).toEqual([
      { from: 'e2', to: 'e4', color: 'blue' },
      { from: 'd7', to: 'd5', color: 'red' },
    ])
    expect(boardSquares(state)).toEqual([{ square: 'f7', color: 'yellow' }])
  })

  it('falls back to a brush that exists when a colour is unknown or missing', () => {
    const state = session({
      arrows: [{ from: 'e2', to: 'e4', color: 'chartreuse' }],
      squares: [{ square: 'f7', color: '' }],
    })
    expect(boardArrows(state)[0]!.color).toBe('green')
    expect(boardSquares(state)[0]!.color).toBe('yellow')
  })

  it('has nothing to draw with no session', () => {
    expect(boardArrows(undefined)).toEqual([])
    expect(boardSquares(idle)).toEqual([])
  })
})

describe('orientationFor', () => {
  it('faces the board the way the owner played it', () => {
    expect(orientationFor(game, false)).toBe('black')
    expect(orientationFor({ ...game, color: 'white' }, false)).toBe('white')
  })

  it('defaults to White for an ad-hoc position', () => {
    expect(orientationFor(undefined, false)).toBe('white')
  })

  it('honours the flip over both', () => {
    expect(orientationFor(game, true)).toBe('white')
    expect(orientationFor(undefined, true)).toBe('black')
  })
})

describe('isVariation', () => {
  it('is a variation once a move is played past the stored line', () => {
    expect(isVariation(session())).toBe(false)
    expect(isVariation(session({ moves: ['e2e4'] }))).toBe(true)
  })

  it('is never a variation without a game to depart from', () => {
    expect(isVariation(session({ game_id: null, moves: ['e2e4'] }))).toBe(false)
  })
})

describe('describeSession', () => {
  it('names the players and the ply', () => {
    expect(describeSession(session(), game)).toBe('kn1ghtmare — phib · ply 24')
  })

  it('says how far the board has left the game', () => {
    expect(describeSession(session({ moves: ['e2e4', 'e7e5'] }), game)).toBe(
      'kn1ghtmare — phib · ply 24 + 2 played',
    )
  })

  it('falls back to the game id before the game has loaded', () => {
    expect(describeSession(session(), undefined)).toBe('game 7 · ply 24')
  })

  it('describes an ad-hoc position and an empty board', () => {
    expect(describeSession(session({ game_id: null, ply: null }), undefined)).toBe(
      'Ad-hoc position',
    )
    expect(describeSession(idle, undefined)).toBe('Nothing on the board')
    expect(describeSession(undefined, undefined)).toBe('Nothing on the board')
  })
})

describe('plyLabel', () => {
  it('numbers a ply the way the move list does', () => {
    expect(plyLabel(0)).toBe('1.')
    expect(plyLabel(1)).toBe('1…')
    expect(plyLabel(24)).toBe('13.')
  })
})
