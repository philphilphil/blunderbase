import type { DrawShape } from '@lichess-org/chessground/draw'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import type { GameRunSummary, MoveRow, RunResponse } from '@/lib/api/types'

import type { MaiaLevel, PlyPosition } from '../gameModel'
import { BoardPanel } from './BoardPanel'

// chessground needs a laid-out box to draw a shape, which jsdom will not give it. What this
// panel is responsible for is the arrow list, so the board is stood in for by its props.
vi.mock('@/components/board/Board', () => ({
  Board: ({
    arrows,
    squares,
    shapes,
    fen,
    className,
    drawable,
    children,
  }: {
    arrows?: { from: string; to: string; color?: string }[]
    squares?: { square: string; className?: string }[]
    shapes?: { orig: string; dest?: string }[]
    fen: string
    className?: string
    drawable?: boolean
    children?: ReactNode
  }) => (
    <div
      data-testid="board"
      data-fen={fen}
      data-class={className}
      data-drawable={String(!!drawable)}
      data-arrows={(arrows ?? [])
        .map((arrow) => `${arrow.from}${arrow.to}:${arrow.color ?? 'accent'}`)
        .join(' ')}
      data-squares={(squares ?? [])
        .map((square) => `${square.square}:${square.className ?? ''}`)
        .join(' ')}
      data-shapes={(shapes ?? []).map((shape) => `${shape.orig}${shape.dest ?? ''}`).join(' ')}
    >
      {children}
    </div>
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
  const onRequestDeep = vi.fn()
  const view = render(
    <TooltipProvider delayDuration={0}>
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
        deepRun={null}
        deepActiveRun={null}
        deepProgress={null}
        deepPending={false}
        deepError={null}
        onRequestDeep={onRequestDeep}
        {...props}
      />
    </TooltipProvider>,
  )
  return { onSeek, onRequestDeep, ...view }
}

const DEEP_RUN: GameRunSummary = {
  id: 9,
  tier: 'deep',
  status: 'done',
  multipv: 3,
  finished_at: '2026-08-20T12:00:00Z',
}

const ACTIVE_RUN: RunResponse = {
  id: 11,
  tier: 'deep',
  status: 'running',
  multipv: 3,
  priority: 0,
  attempts: 0,
  created_at: '2026-08-20T12:00:00Z',
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

  it('lets the reader draw their own arrows on the game board', () => {
    // The one drawable surface in the app; `MiniBoard` and the rest keep the default.
    renderPanel()
    expect(screen.getByTestId('board')).toHaveAttribute('data-drawable', 'true')
  })

  it('adds Maia’s prediction, and leaves it out when it is the engine’s move too', () => {
    const { rerender } = renderPanel({ maia: MAIA })
    expect(arrows()).toEqual(['c7c6:accent', 'd7d5:paleMaia'])

    rerender(
      <TooltipProvider delayDuration={0}>
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
          deepRun={null}
          deepActiveRun={null}
          deepProgress={null}
          deepPending={false}
          deepError={null}
          onRequestDeep={vi.fn()}
        />
      </TooltipProvider>,
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

    for (let event = 0; event < 3; event += 1) fireEvent.wheel(board, { deltaY: 3 })
    expect(onSeek).not.toHaveBeenCalled()
    fireEvent.wheel(board, { deltaY: 3 })
    expect(onSeek).toHaveBeenCalledTimes(1)
    expect(onSeek).toHaveBeenCalledWith(2)

    // One flick is one move: a single huge delta does not fly through the game.
    fireEvent.wheel(board, { deltaY: 900 })
    expect(onSeek).toHaveBeenCalledTimes(2)
    expect(onSeek).toHaveBeenLastCalledWith(2)
  })

  it('steps once per discrete wheel tick, tuned to a mouse’s ~15px-per-notch delta', () => {
    const { onSeek } = renderPanel({ cursor: 1 })
    const board = screen.getByTestId('board')

    fireEvent.wheel(board, { deltaY: 15 })
    fireEvent.wheel(board, { deltaY: 15 })
    fireEvent.wheel(board, { deltaY: 15 })
    expect(onSeek).toHaveBeenCalledTimes(3)
    expect(onSeek).toHaveBeenNthCalledWith(1, 2)
    expect(onSeek).toHaveBeenNthCalledWith(2, 2)
    expect(onSeek).toHaveBeenNthCalledWith(3, 2)
  })

  it('hands the step to the page where it has one, rather than seeking the game', () => {
    // Inside an analysis line a step is a step along the *line*, which only the page knows
    // how to take — the wheel says which way and nothing else.
    const onStep = vi.fn()
    const { onSeek } = renderPanel({ cursor: 1, onStep })
    const board = screen.getByTestId('board')

    fireEvent.wheel(board, { deltaY: 120 })
    expect(onStep).toHaveBeenLastCalledWith(1)
    fireEvent.wheel(board, { deltaY: -120 })
    expect(onStep).toHaveBeenLastCalledWith(-1)
    expect(onSeek).not.toHaveBeenCalled()
  })

  it('leaves a pinch-zoom alone', () => {
    const { onSeek } = renderPanel({ cursor: 1 })
    expect(fireEvent.wheel(screen.getByTestId('board'), { deltaY: 120, ctrlKey: true })).toBe(
      true,
    )
    expect(onSeek).not.toHaveBeenCalled()
  })
})

describe('BoardPanel line preview', () => {
  /** After 1.e4 c6 — a position the game does not contain, scrubbed out of an engine line. */
  const SCRUBBED = 'rnbqkbnr/pp1ppppp/2p5/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'
  const SHAPES: DrawShape[] = [{ orig: 'g8', dest: 'f6', brush: 'previewBlack1' }]

  function board() {
    return screen.getByTestId('board')
  }

  it('puts the previewed position on the board and drops the claims about the real one', () => {
    renderPanel({
      previewFen: SCRUBBED,
      previewLastMove: ['c7', 'c6'],
      previewShapes: SHAPES,
      maia: MAIA,
    })
    expect(board().getAttribute('data-fen')).toBe(SCRUBBED)
    // The engine's arrow, Maia's, and the blunder's marks are all about a position the
    // board has stepped off.
    expect(arrows()).toEqual([])
    expect(board().getAttribute('data-squares')).toBe('')
    expect(board().getAttribute('data-shapes')).toBe('g8f6')
  })

  it('leaves the standing hints alone when the preview only decorates the position', () => {
    renderPanel({ previewShapes: SHAPES, maia: MAIA })
    expect(board().getAttribute('data-fen')).toBe(AFTER_E4.fen)
    expect(arrows()).toEqual(['c7c6:accent', 'd7d5:paleMaia'])
    expect(board().getAttribute('data-squares')).toContain('c6:bb-engine')
    expect(board().getAttribute('data-shapes')).toBe('g8f6')
  })

  it('labels a scrubbed board so it is never mistaken for the game', () => {
    renderPanel({ previewFen: SCRUBBED, previewCaption: 'after 1…c6' })
    expect(screen.getByText('after 1…c6')).toBeInTheDocument()
  })

  it('steps the pieces back for the overlay’s ghosts', () => {
    renderPanel({ previewShapes: SHAPES, previewDim: true })
    expect(board().getAttribute('data-class')).toContain('bb-preview-dim')

    renderPanel({ previewShapes: SHAPES })
    expect(screen.getAllByTestId('board')[1]!.getAttribute('data-class')).not.toContain(
      'bb-preview-dim',
    )
  })
})

describe('BoardPanel deep-analysis button', () => {
  it('is idle when there is no run and none has ever finished', () => {
    const { onRequestDeep } = renderPanel()
    const button = screen.getByRole('button', { name: 'Deep' })
    expect(button).toBeEnabled()

    fireEvent.click(button)
    expect(onRequestDeep).toHaveBeenCalledTimes(1)
  })

  it('is disabled and shows progress while a run is queued or running', () => {
    renderPanel({
      deepActiveRun: ACTIVE_RUN,
      deepProgress: { done: 27, total: 50 },
    })
    // `54%` replaces the idle label while the run is live.
    const button = screen.getByRole('button', { name: '54%' })
    expect(button).toBeDisabled()
  })

  it('stays disabled without a percent when no progress frame has arrived yet', () => {
    renderPanel({ deepActiveRun: ACTIVE_RUN })
    const button = screen.getByRole('button', { name: 'Deep' })
    expect(button).toBeDisabled()
  })

  it('shows a done state once a deep run has finished, and stays clickable to re-run', () => {
    const { onRequestDeep } = renderPanel({ deepRun: DEEP_RUN })
    const button = screen.getByRole('button', { name: 'Deep' })
    expect(button).toBeEnabled()
    expect(button.className).toContain('accent-teal')

    fireEvent.click(button)
    expect(onRequestDeep).toHaveBeenCalledTimes(1)
  })
})
