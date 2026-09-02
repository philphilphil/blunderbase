import type { DrawShape } from '@lichess-org/chessground/draw'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import type { GameRunSummary, MoveRow, RunResponse } from '@/lib/api/types'
import { resetBoardArrowPrefs, setBoardArrowPrefs } from '@/lib/board/arrowPrefs'

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
    arrows?: { from: string; to: string; color?: string; played?: boolean }[]
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
        .map(
          (arrow) =>
            `${arrow.from}${arrow.to}:${arrow.color ?? 'accent'}${arrow.played ? ':played' : ''}`,
        )
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
  const onRequestQuick = vi.fn()
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
        quickRun={null}
        deepRun={null}
        activeRun={null}
        progress={null}
        pending={false}
        error={null}
        onRequestQuick={onRequestQuick}
        onRequestDeep={onRequestDeep}
        {...props}
      />
    </TooltipProvider>,
  )
  return { onSeek, onRequestQuick, onRequestDeep, ...view }
}

const DEEP_RUN: GameRunSummary = {
  id: 9,
  tier: 'deep',
  status: 'done',
  multipv: 3,
  finished_at: '2026-08-20T12:00:00Z',
}

// The arrow preferences are a module-level store over localStorage, so a test that
// switches one off must not leak it into the next.
afterEach(() => {
  resetBoardArrowPrefs()
})

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
  it('draws the engine’s move here and the move the game played, in their own colours', () => {
    renderPanel()
    // 1…c6 is what the engine would play here; 1…d5 is what this game played from here.
    // Both are claims about *this* position, which is why both are arrows.
    expect(arrows()).toEqual(['c7c6:accent', 'd7d5:played'])
    // No disc under either arrowhead: an arrow points at a square by itself. The only
    // square marks left are the flagged move's own two, in its classification's colour.
    expect(screen.getByTestId('board').getAttribute('data-squares')).toBe(
      'd7:bb-blunder d5:bb-blunder',
    )
  })

  it('says nothing about the engine where no run has looked at the position', () => {
    renderPanel({ engineBest: null })
    expect(arrows()).toEqual(['d7d5:played'])
    renderPanel({ engineBest: null, upcoming: undefined })
    expect(screen.getAllByTestId('board')[1]!.getAttribute('data-arrows')).toBe('')
  })

  it('draws only what the arrow preferences ask for', () => {
    setBoardArrowPrefs({ played: false })
    renderPanel({ maia: MAIA })
    expect(arrows()).toEqual(['c7c6:accent', 'd7d5:maia'])

    setBoardArrowPrefs({ engine: false, maia: false, played: true })
    renderPanel({ maia: MAIA })
    expect(screen.getAllByTestId('board')[1]!.getAttribute('data-arrows')).toBe('d7d5:played')
  })

  it('lets the reader draw their own arrows on the game board', () => {
    // The one drawable surface in the app; `MiniBoard` and the rest keep the default.
    renderPanel()
    expect(screen.getByTestId('board')).toHaveAttribute('data-drawable', 'true')
  })

  it('folds two claims about one move into one arrow, marked with what it also was', () => {
    // Maia's move here is the move the game played, so one arrow in Maia's colour carries
    // the played dot rather than a second arrow being drawn underneath the first.
    const { rerender } = renderPanel({ maia: MAIA })
    expect(arrows()).toEqual(['c7c6:accent', 'd7d5:maia:played'])

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
          quickRun={null}
          deepRun={null}
          activeRun={null}
          progress={null}
          pending={false}
          error={null}
          onRequestQuick={vi.fn()}
          onRequestDeep={vi.fn()}
        />
      </TooltipProvider>,
    )
    // All three now name 1…d5: one teal arrow, marked as the move that was played.
    expect(arrows()).toEqual(['d7d5:accent:played'])
  })

  it('keeps the hints toggle in charge of the standing arrows', () => {
    renderPanel({ hints: false, maia: MAIA })
    expect(arrows()).toEqual([])
  })

  it('previews a hovered line in the pale brush, hints or no hints', () => {
    renderPanel({ hoverMove: 'g8f6' })
    expect(arrows()).toEqual(['c7c6:accent', 'd7d5:played', 'g8f6:paleAccent'])

    // A preview is an answer to what the reader is doing now, so it survives hints being off.
    renderPanel({ hints: false, hoverMove: 'g8f6' })
    expect(screen.getAllByTestId('board')[1]!.getAttribute('data-arrows')).toBe(
      'g8f6:paleAccent',
    )
  })

  it('does not draw the hovered line twice when it is the engine’s own move', () => {
    renderPanel({ hoverMove: 'c7c6' })
    expect(arrows()).toEqual(['c7c6:accent', 'd7d5:played'])
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
    expect(arrows()).toEqual(['c7c6:accent', 'd7d5:maia:played'])
    expect(board().getAttribute('data-squares')).toBe('d7:bb-blunder d5:bb-blunder')
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

/**
 * The two jumps `j`/`shift+J` make, drawn as buttons for the phone. The suite runs with
 * `css: false`, so `md:hidden` hides nothing here and both are always queryable — that they
 * are *only* shown below `md` is asserted as the class it is.
 */
describe('BoardPanel flagged jumps', () => {
  it('seeks the position the flagged move was made from, either way', () => {
    const { onSeek } = renderPanel({ cursor: 4, nextFlagged: 8, previousFlagged: 0 })

    fireEvent.click(screen.getByRole('button', { name: 'Next flagged move' }))
    expect(onSeek).toHaveBeenLastCalledWith(8)
    fireEvent.click(screen.getByRole('button', { name: 'Previous flagged move' }))
    expect(onSeek).toHaveBeenLastCalledWith(0)
  })

  it('is disabled where there is no flagged move that way', () => {
    const { onSeek } = renderPanel({ nextFlagged: null, previousFlagged: null })
    const next = screen.getByRole('button', { name: 'Next flagged move' })

    expect(next).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Previous flagged move' })).toBeDisabled()
    fireEvent.click(next)
    expect(onSeek).not.toHaveBeenCalled()
  })

})

const QUICK_RUN: GameRunSummary = {
  id: 5,
  tier: 'quick',
  status: 'done',
  multipv: 1,
  finished_at: '2026-08-19T12:00:00Z',
}

const ACTIVE_QUICK_RUN: RunResponse = {
  id: 12,
  tier: 'quick',
  status: 'running',
  multipv: 1,
  priority: 0,
  attempts: 0,
  created_at: '2026-08-20T12:00:00Z',
}

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
      activeRun: ACTIVE_RUN,
      progress: { done: 27, total: 50 },
    })
    // `54%` replaces the idle label while the run is live.
    const button = screen.getByRole('button', { name: '54%' })
    expect(button).toBeDisabled()
  })

  it('stays disabled without a percent when no progress frame has arrived yet', () => {
    renderPanel({ activeRun: ACTIVE_RUN })
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

describe('BoardPanel quick-analysis button', () => {
  it('is idle beside Deep when neither has ever finished', () => {
    const { onRequestQuick } = renderPanel()
    const button = screen.getByRole('button', { name: 'Quick' })
    expect(button).toBeEnabled()

    fireEvent.click(button)
    expect(onRequestQuick).toHaveBeenCalledTimes(1)
  })

  it('disappears once the game has a completed deep run', () => {
    renderPanel({ deepRun: DEEP_RUN, quickRun: QUICK_RUN })
    expect(screen.queryByRole('button', { name: /Quick/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Deep' })).toBeInTheDocument()
  })

  it('disables both buttons while either tier is running, spinning only the matching one', () => {
    renderPanel({ activeRun: ACTIVE_QUICK_RUN, progress: { done: 10, total: 40 } })
    const quick = screen.getByRole('button', { name: '25%' })
    const deep = screen.getByRole('button', { name: 'Deep' })
    expect(quick).toBeDisabled()
    expect(deep).toBeDisabled()
  })

  it('shows a done state once a quick run has finished, and stays clickable to re-run', () => {
    const { onRequestQuick } = renderPanel({ quickRun: QUICK_RUN })
    const button = screen.getByRole('button', { name: 'Quick' })
    expect(button).toBeEnabled()
    expect(button.className).toContain('accent-teal')

    fireEvent.click(button)
    expect(onRequestQuick).toHaveBeenCalledTimes(1)
  })
})
