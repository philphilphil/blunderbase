import { describe, expect, it } from 'vitest'

import {
  cachedReplay,
  LINE_PREVIEW_DEFAULTS,
  peekCaption,
  peekFen,
  previewCaption,
  previewFen,
  previewLastMove,
  previewShapes,
  replayLine,
  type LinePreviewPrefs,
  type PreviewState,
} from './linePreview'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
/** After 1.e4 c5 2.Nf3 — Black to move. */
const SICILIAN = 'rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2'
/** Both sides may castle either way, and nothing is in the way. */
const CASTLING = 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1'
/** After 1.e4 d5 2.e5 f5 — White may take on f6 in passing. */
const EN_PASSANT = 'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3'
/** A lone pawn one step from the eighth rank. */
const PROMOTION = '8/4P3/8/8/8/8/8/k3K3 w - - 0 1'

/** 1.e4 e5 2.Nf3 Nc6 3.Nxe5 — four quiet moves and a capture. */
const OPENING = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f3e5']

function prefs(patch: Partial<LinePreviewPrefs> = {}): LinePreviewPrefs {
  return { ...LINE_PREVIEW_DEFAULTS, ...patch }
}

const row: PreviewState = { line: 'live:1', ply: null }
const at = (ply: number): PreviewState => ({ line: 'live:1', ply })

describe('replayLine', () => {
  it('keeps a position per ply, starting with the one it was handed', () => {
    const replay = replayLine(START, ['e2e4', 'e7e5'])
    expect(replay.fens).toHaveLength(3)
    expect(replay.fens[0]).toBe(START)
    expect(replay.moves.map((move) => move.san)).toEqual(['e4', 'e5'])
    expect(replay.moves[0]).toMatchObject({
      uci: 'e2e4',
      from: 'e2',
      to: 'e4',
      role: 'pawn',
      color: 'white',
    })
    expect(replay.moves[1].color).toBe('black')
  })

  it('stops at the first move the position rejects', () => {
    // 1…d6 is legal; the bishop cannot go to h6 from c1 with pawns in the way.
    const replay = replayLine(SICILIAN, ['d7d6', 'c1h6', 'd2d4'])
    expect(replay.moves.map((move) => move.san)).toEqual(['d6'])
    expect(replay.fens).toHaveLength(2)
  })

  it('stops at a move that is not UCI at all', () => {
    expect(replayLine(START, ['e2e4', 'wat']).moves.map((move) => move.san)).toEqual(['e4'])
  })

  it('records what was taken, and where', () => {
    const replay = replayLine(START, OPENING)
    expect(replay.moves[4].san).toBe('Nxe5')
    expect(replay.moves[4].captured).toEqual({ square: 'e5', role: 'pawn', color: 'black' })
    expect(replay.moves[0].captured).toBeUndefined()
  })

  it('gives the king its real trip on a castling move, and the rook its own', () => {
    const replay = replayLine(CASTLING, ['e1c1', 'e8g8'])
    expect(replay.moves[0]).toMatchObject({
      san: 'O-O-O',
      from: 'e1',
      to: 'c1',
      role: 'king',
      rook: { from: 'a1', to: 'd1' },
    })
    expect(replay.moves[1]).toMatchObject({
      san: 'O-O',
      to: 'g8',
      rook: { from: 'h8', to: 'f8' },
    })
  })

  it('reads castling written as the king taking its own rook the same way', () => {
    const replay = replayLine(CASTLING, ['e1h1'])
    expect(replay.moves[0]).toMatchObject({ san: 'O-O', to: 'g1', rook: { from: 'h1', to: 'f1' } })
  })

  it('marks an en passant capture on the square the pawn actually stood on', () => {
    const replay = replayLine(EN_PASSANT, ['e5f6'])
    expect(replay.moves[0].san).toBe('exf6')
    expect(replay.moves[0].to).toBe('f6')
    expect(replay.moves[0].captured).toEqual({ square: 'f5', role: 'pawn', color: 'black' })
  })

  it('keeps a promotion as the pawn that moved, and promotes it in the position', () => {
    const replay = replayLine(PROMOTION, ['e7e8q'])
    expect(replay.moves[0]).toMatchObject({ uci: 'e7e8q', san: 'e8=Q', role: 'pawn', to: 'e8' })
    expect(replay.fens[1].startsWith('4Q3/')).toBe(true)
  })

  it('degrades to the position it was handed rather than throwing on a FEN it cannot read', () => {
    expect(replayLine('not a position at all', ['e2e4'])).toEqual({
      fens: ['not a position at all'],
      moves: [],
    })
    // Parses as a FEN but is not a legal chess position — two kings short.
    expect(replayLine('8/8/8/8/8/8/8/8 w - - 0 1', ['e2e4']).moves).toEqual([])
  })

  it('caps a runaway variation at forty plies', () => {
    const shuffle = Array.from({ length: 60 }, (_, i) =>
      i % 4 === 0 ? 'g1f3' : i % 4 === 1 ? 'g8f6' : i % 4 === 2 ? 'f3g1' : 'f6g8',
    )
    expect(replayLine(START, shuffle).moves).toHaveLength(40)
  })
})

describe('cachedReplay', () => {
  it('hands back the same replay for the same position and line', () => {
    const first = cachedReplay(START, ['e2e4', 'e7e5'])
    expect(cachedReplay(START, ['e2e4', 'e7e5'])).toBe(first)
    expect(cachedReplay(START, ['e2e4'])).not.toBe(first)
  })

  it('drops the oldest rather than growing while an engine rewrites its lines', () => {
    const first = cachedReplay(START, ['e2e4', 'depth-0'])
    for (let i = 1; i < 200; i++) cachedReplay(START, ['e2e4', `depth-${i}`])
    expect(cachedReplay(START, ['e2e4', 'depth-0'])).not.toBe(first)
    expect(cachedReplay(START, ['e2e4', 'depth-199'])).toBe(
      cachedReplay(START, ['e2e4', 'depth-199']),
    )
  })
})

describe('previewShapes', () => {
  const replay = replayLine(START, OPENING)

  it('draws nothing for a line it could not replay', () => {
    expect(previewShapes(replayLine('nonsense', ['e2e4']), prefs(), row, 0)).toEqual([])
  })

  it('draws nothing when the row preview is off', () => {
    expect(previewShapes(replay, prefs({ row: 'off' }), row, 0)).toEqual([])
  })

  it('draws one arrow per ply up to the depth cap, deepest first', () => {
    const shapes = previewShapes(replay, prefs({ row: 'arrows', depth: 3 }), row, 0)
    expect(shapes).toHaveLength(3)
    // Deepest first so the plies nearest the position paint on top.
    expect(shapes.map((shape) => shape.dest)).toEqual(['f3', 'e5', 'e4'])
  })

  it('never draws more arrows than the line has moves', () => {
    const shapes = previewShapes(replay, prefs({ row: 'arrows', depth: 18 }), row, 0)
    expect(shapes).toHaveLength(OPENING.length)
  })

  it('colours the arrows by the side to move, and fades them with depth', () => {
    const shapes = previewShapes(replay, prefs({ row: 'arrows', depth: 4 }), row, 0)
    // Deepest first: 4.Nc6 (Black), 3.Nf3 (White), 2.e5 (Black), 1.e4 (White).
    expect(shapes.map((shape) => shape.brush)).toEqual([
      'previewBlack4',
      'previewWhite3',
      'previewBlack2',
      'previewWhite1',
    ])
    expect(shapes.map((shape) => shape.modifiers?.lineWidth)).toEqual([7, 8, 9, 10])
  })

  it('uses White’s brush for both sides when the colouring is off', () => {
    const shapes = previewShapes(replay, prefs({ row: 'arrows', depth: 2, bySide: false }), row, 0)
    expect(shapes.map((shape) => shape.brush)).toEqual(['previewWhite3', 'previewWhite1'])
  })

  it('keeps every arrow at full strength when the fade is off', () => {
    const shapes = previewShapes(replay, prefs({ row: 'arrows', depth: 3, fade: false }), row, 0)
    expect(shapes.map((shape) => shape.brush)).toEqual([
      'previewWhite1',
      'previewBlack1',
      'previewWhite1',
    ])
    expect(shapes.every((shape) => shape.modifiers?.lineWidth === 10)).toBe(true)
  })

  it('numbers the badges the way the move list numbers a variation', () => {
    const white = previewShapes(replay, prefs({ row: 'arrows', depth: 3 }), row, 46)
    expect(white.map((shape) => shape.label?.text)).toEqual(['25.', '24…', '24.'])
    const black = previewShapes(replay, prefs({ row: 'arrows', depth: 3 }), row, 47)
    expect(black.map((shape) => shape.label?.text)).toEqual(['25…', '25.', '24…'])
  })

  it('numbers the badges by ply within the line when asked to', () => {
    const shapes = previewShapes(replay, prefs({ row: 'arrows', depth: 3, labels: 'ply' }), row, 47)
    expect(shapes.map((shape) => shape.label?.text)).toEqual(['3', '2', '1'])
  })

  it('leaves the badges off when they are switched off', () => {
    const shapes = previewShapes(replay, prefs({ row: 'arrows', depth: 2, badges: false }), row, 0)
    expect(shapes.every((shape) => shape.label === undefined)).toBe(true)
  })

  it('shows the plan as ghosts, trails and a cross where something was taken', () => {
    const shapes = previewShapes(replay, prefs({ row: 'overlay', depth: 5 }), row, 0)
    const crosses = shapes.filter((shape) => shape.customSvg)
    const trails = shapes.filter((shape) => shape.brush === 'previewGhost')
    const ghosts = shapes.filter((shape) => shape.piece)
    // Nxe5 takes the pawn that walked to e5, so that piece has no plan left to draw.
    expect(crosses.map((shape) => shape.orig)).toEqual(['e5'])
    // e4, Nc6, and the knight's two hops g1-f3-e5.
    expect(trails).toHaveLength(4)
    expect(ghosts.map((shape) => shape.orig).sort()).toEqual(['c6', 'e4', 'e5'])
    expect(ghosts.find((shape) => shape.orig === 'e5')?.piece).toEqual({
      role: 'knight',
      color: 'white',
      scale: 0.8,
    })
  })

  it('ends the overlay at the depth cap', () => {
    const shapes = previewShapes(replay, prefs({ row: 'overlay', depth: 2 }), row, 0)
    expect(shapes.filter((shape) => shape.piece).map((shape) => shape.orig)).toEqual(['e4', 'e5'])
    expect(shapes.filter((shape) => shape.customSvg)).toHaveLength(0)
  })

  it('shows a promoted pawn as the piece it became', () => {
    const promoted = replayLine(PROMOTION, ['e7e8q'])
    const shapes = previewShapes(promoted, prefs({ row: 'overlay' }), row, 0)
    expect(shapes.find((shape) => shape.piece)?.piece).toEqual({
      role: 'queen',
      color: 'white',
      scale: 0.8,
    })
  })

  it('leads a playthrough with one arrow for the move about to be played', () => {
    const shapes = previewShapes(replay, prefs({ row: 'play' }), at(2), 0)
    expect(shapes).toHaveLength(1)
    expect(shapes[0]).toMatchObject({ orig: 'g1', dest: 'f3' })
  })

  it('leads a playthrough with nothing at the end of the line, or when asked not to', () => {
    expect(previewShapes(replay, prefs({ row: 'play' }), at(OPENING.length), 0)).toEqual([])
    const quiet = prefs({ row: 'play', play: { ...LINE_PREVIEW_DEFAULTS.play, ahead: false } })
    expect(previewShapes(replay, quiet, at(2), 0)).toEqual([])
  })

  it('draws the look-ahead when a ply is pointed at, whatever the row mode is', () => {
    for (const mode of ['arrows', 'overlay', 'off'] as const) {
      const shapes = previewShapes(replay, prefs({ row: mode, lookahead: 2 }), at(2), 0)
      // The row's own shapes describe a position that is no longer on the board.
      expect(shapes.map((shape) => shape.dest)).toEqual(['c6', 'f3'])
    }
  })

  it('clamps the look-ahead to what is left of the line', () => {
    const shapes = previewShapes(replay, prefs({ lookahead: 4 }), at(OPENING.length - 1), 0)
    expect(shapes).toHaveLength(1)
    expect(previewShapes(replay, prefs({ lookahead: 4 }), at(OPENING.length), 0)).toEqual([])
  })

  it('draws no look-ahead when it is turned down to zero', () => {
    expect(previewShapes(replay, prefs({ lookahead: 0 }), at(2), 0)).toEqual([])
  })

  it('gives peek the single first-move arrow the board has always had', () => {
    expect(previewShapes(replay, prefs({ row: 'peek' }), row, 0)).toHaveLength(1)
    // Even with a ply pointed at: peek scrubs its own popover, never the main board.
    const shapes = previewShapes(replay, prefs({ row: 'peek' }), at(3), 0)
    expect(shapes).toHaveLength(1)
    expect(shapes[0]).toMatchObject({ orig: 'e2', dest: 'e4' })
  })

  it('survives a ply that has run off either end of the line', () => {
    expect(previewShapes(replay, prefs(), at(99), 0)).toEqual([])
    expect(previewShapes(replay, prefs({ lookahead: 1 }), at(-4), 0)).toHaveLength(1)
  })
})

describe('previewFen', () => {
  const replay = replayLine(START, OPENING)

  it('puts the board on the position after the ply that is pointed at', () => {
    expect(previewFen(replay, prefs(), at(2))).toBe(replay.fens[2])
    expect(previewLastMove(replay, prefs(), at(2))).toEqual(['e7', 'e5'])
    expect(previewCaption(replay, prefs(), at(2), 0)).toBe('after 1…e5')
  })

  it('keeps the real position when the row is hovered but no ply is', () => {
    expect(previewFen(replay, prefs(), row)).toBeNull()
    expect(previewLastMove(replay, prefs(), row)).toBeNull()
    expect(previewCaption(replay, prefs(), row, 0)).toBeNull()
  })

  it('keeps the real position at the start of the line, where nothing has been played', () => {
    expect(previewFen(replay, prefs(), at(0))).toBeNull()
    expect(previewCaption(replay, prefs(), at(0), 0)).toBeNull()
  })

  it('never moves the main board for peek', () => {
    expect(previewFen(replay, prefs({ row: 'peek' }), at(2))).toBeNull()
    expect(previewLastMove(replay, prefs({ row: 'peek' }), at(2))).toBeNull()
    expect(previewCaption(replay, prefs({ row: 'peek' }), at(2), 0)).toBeNull()
  })

  it('clamps a ply past the end of the line to the line’s last position', () => {
    expect(previewFen(replay, prefs(), at(99))).toBe(replay.fens[OPENING.length])
  })

  it('numbers the caption from the ply the line starts on', () => {
    expect(previewCaption(replay, prefs(), at(1), 47)).toBe('after 24…e4')
    expect(previewCaption(replay, prefs(), at(2), 47)).toBe('after 25.e5')
  })
})

describe('peekFen', () => {
  const replay = replayLine(START, OPENING)

  it('shows the depth-capped end of the line when no ply is pointed at', () => {
    expect(peekFen(replay, prefs({ row: 'peek', depth: 3 }), row)).toBe(replay.fens[3])
    expect(peekCaption(replay, prefs({ row: 'peek', depth: 3 }), row, 0)).toBe('after 2.Nf3')
  })

  it('follows the ply that is pointed at instead', () => {
    expect(peekFen(replay, prefs({ row: 'peek', depth: 3 }), at(1))).toBe(replay.fens[1])
    expect(peekCaption(replay, prefs({ row: 'peek' }), at(1), 0)).toBe('after 1.e4')
  })

  it('gives nothing at all in any other row mode', () => {
    expect(peekFen(replay, prefs({ row: 'arrows' }), row)).toBeNull()
    expect(peekCaption(replay, prefs({ row: 'arrows' }), row, 0)).toBeNull()
  })

  it('stands on the starting position, uncaptioned, at ply zero', () => {
    expect(peekFen(replay, prefs({ row: 'peek' }), at(0))).toBe(replay.fens[0])
    expect(peekCaption(replay, prefs({ row: 'peek' }), at(0), 0)).toBeNull()
  })
})
