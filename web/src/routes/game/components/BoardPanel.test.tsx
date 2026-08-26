import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { MoveRow } from '@/lib/api/types'

import type { MaiaLevel, PlyPosition } from '../gameModel'
import { BoardPanel } from './BoardPanel'

// chessground needs a laid-out box to draw a shape, which jsdom will not give it. What this
// panel is responsible for is the arrow list, so the board is stood in for by its props.
vi.mock('@/components/board/Board', () => ({
  Board: ({
    arrows,
    squares,
  }: {
    arrows?: { from: string; to: string; color?: string }[]
    squares?: { square: string; className?: string }[]
  }) => (
    <div
      data-testid="board"
      data-arrows={(arrows ?? [])
        .map((arrow) => `${arrow.from}${arrow.to}:${arrow.color ?? 'accent'}`)
        .join(' ')}
      data-squares={(squares ?? [])
        .map((square) => `${square.square}:${square.className ?? ''}`)
        .join(' ')}
    />
  ),
}))

/** After 1.e4 — Black to move, the position the blunder 1…d5 was played from. */
const AFTER_E4: PlyPosition = {
  fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
  turn: 'black',
  check: false,
}

const BLUNDER: MoveRow = {
  ply: 1,
  move_number: 1,
  san: 'd5',
  uci: 'd7d5',
  classification: 'blunder',
  best_move_uci: 'c7c6',
}

const MAIA: MaiaLevel = {
  rating: '1500',
  moves: [{ uci: 'd7d5', san: 'd5', rank: 1, probability: 0.62 }],
}

function arrows(): string[] {
  const value = screen.getByTestId('board').getAttribute('data-arrows') ?? ''
  return value ? value.split(' ') : []
}

function renderPanel(props: Partial<Parameters<typeof BoardPanel>[0]> = {}) {
  const onSeek = vi.fn()
  const view = render(
    <BoardPanel
      position={AFTER_E4}
      orientation="white"
      lastMove={undefined}
      upcoming={BLUNDER}
      engineBest="c7c6"
      maia={null}
      win={46}
      score={{ cp: 40 }}
      cursor={0}
      plyCount={4}
      hints
      onHintsChange={vi.fn()}
      onFlip={vi.fn()}
      onSeek={onSeek}
      {...props}
    />,
  )
  return { onSeek, ...view }
}

describe('BoardPanel arrows', () => {
  it('points at the engine’s move here, not at the move about to be played', () => {
    renderPanel()
    // 1…c6 is what the engine would play; 1…d5 is what happens next and is not an arrow.
    expect(arrows()).toEqual(['c7c6:accent'])
    expect(screen.getByTestId('board').getAttribute('data-squares')).toContain('c6:bb-engine')
  })

  it('draws nothing where no run has looked at the position', () => {
    renderPanel({ engineBest: null })
    expect(arrows()).toEqual([])
  })

  it('adds Maia’s prediction, and leaves it out when it is the engine’s move too', () => {
    const { rerender } = renderPanel({ maia: MAIA })
    expect(arrows()).toEqual(['c7c6:accent', 'd7d5:paleMaia'])

    rerender(
      <BoardPanel
        position={AFTER_E4}
        orientation="white"
        lastMove={undefined}
        upcoming={BLUNDER}
        engineBest="d7d5"
        maia={MAIA}
        win={46}
        score={{ cp: 40 }}
        cursor={0}
        plyCount={4}
        hints
        onHintsChange={vi.fn()}
        onFlip={vi.fn()}
        onSeek={vi.fn()}
      />,
    )
    expect(arrows()).toEqual(['d7d5:accent'])
  })

  it('keeps the hints toggle in charge of the standing arrows', () => {
    renderPanel({ hints: false, maia: MAIA })
    expect(arrows()).toEqual([])
  })

  it('previews a hovered line in the pale brush, hints or no hints', () => {
    renderPanel({ hoverMove: 'g8f6' })
    expect(arrows()).toEqual(['c7c6:accent', 'g8f6:paleAccent'])

    // A preview is an answer to what the reader is doing now, so it survives hints being off.
    renderPanel({ hints: false, hoverMove: 'g8f6' })
    expect(screen.getAllByTestId('board')[1]!.getAttribute('data-arrows')).toBe(
      'g8f6:paleAccent',
    )
  })

  it('does not draw the hovered line twice when it is the engine’s own move', () => {
    renderPanel({ hoverMove: 'c7c6' })
    expect(arrows()).toEqual(['c7c6:accent'])
  })
})

describe('BoardPanel wheel', () => {
  it('steps forwards on a wheel down and back on a wheel up', () => {
    const { onSeek } = renderPanel({ cursor: 1 })
    const board = screen.getByTestId('board')

    // The page must not scroll under the gesture, so the event is cancelled.
    expect(fireEvent.wheel(board, { deltaY: 120 })).toBe(false)
    expect(onSeek).toHaveBeenLastCalledWith(2)

    fireEvent.wheel(board, { deltaY: -120 })
    expect(onSeek).toHaveBeenLastCalledWith(0)
    expect(onSeek).toHaveBeenCalledTimes(2)
  })

  it('adds a trackpad’s small deltas up rather than skipping a gesture’s worth of moves', () => {
    const { onSeek } = renderPanel({ cursor: 1 })
    const board = screen.getByTestId('board')

    for (let event = 0; event < 7; event += 1) fireEvent.wheel(board, { deltaY: 8 })
    expect(onSeek).not.toHaveBeenCalled()
    fireEvent.wheel(board, { deltaY: 8 })
    expect(onSeek).toHaveBeenCalledTimes(1)
    expect(onSeek).toHaveBeenCalledWith(2)

    // One flick is one move: a single huge delta does not fly through the game.
    fireEvent.wheel(board, { deltaY: 900 })
    expect(onSeek).toHaveBeenCalledTimes(2)
    expect(onSeek).toHaveBeenLastCalledWith(2)
  })

  it('leaves a pinch-zoom alone', () => {
    const { onSeek } = renderPanel({ cursor: 1 })
    expect(fireEvent.wheel(screen.getByTestId('board'), { deltaY: 120, ctrlKey: true })).toBe(
      true,
    )
    expect(onSeek).not.toHaveBeenCalled()
  })
})
