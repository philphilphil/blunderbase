import type { Api } from '@lichess-org/chessground/api'
import { Check, Loader2, StickyNote, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'

import { Board, type BoardArrow, type BoardSquare } from '@/components/board/Board'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { GameRunSummary, MoveRow, RunResponse } from '@/lib/api/types'
import { glyphFor } from '@/lib/chess/classification'
import { formatScore, type Score } from '@/lib/chess/evaluation'
import { cn } from '@/lib/utils'

import type { AnalysisLine } from '../analysisLine'
import { sameMove, type MaiaLevel, type PlyPosition, type Side } from '../gameModel'
import type { RunProgress } from '../useDeepAnalysis'
import { EvalBar } from './EvalBar'

export interface BoardPanelProps {
  /** The game position the cursor is on. */
  position: PlyPosition
  /**
   * The analysis board's own line, when the reader has played off the game. It carries the
   * position to show and the legal moves chessground needs to accept the next drag; an
   * empty line (or none) means the board is still on the game.
   */
  analysis?: AnalysisLine | null
  /** A move dragged on the board — how a line is started or extended. */
  onPlayMove?: (orig: string, dest: string) => void
  /** Back to the game line. Only offered while there is a line to leave. */
  onExitAnalysis?: () => void
  orientation: Side
  /** The move that produced this position, for the last-move highlight. */
  lastMove: MoveRow | undefined
  /** The move about to be played — what Maia and the flags describe. */
  upcoming: MoveRow | undefined
  /**
   * The engine's own move in the position on the board, in UCI: the first move of the top
   * stored line. Null where nothing has analysed this position — the board then says
   * nothing rather than pointing at a move no engine ever recommended.
   */
  engineBest: string | null
  /** A line being hovered in one of the engine panels, previewed as its own arrow. */
  hoverMove?: string | null
  maia: MaiaLevel | null
  win: number | null
  score: Score | null
  /** `-1` for the starting position. */
  cursor: number
  plyCount: number
  hints: boolean
  onHintsChange: (hints: boolean) => void
  onFlip: () => void
  onSeek: (cursor: number) => void
  /**
   * One move forwards or back from wherever the board stands. Inside an analysis line that
   * is a step along the line rather than along the game, which the page decides — the wheel
   * only says which way. Without it, a step is a plain seek.
   */
  onStep?: (delta: number) => void
  /** The newest finished deep run over this game, if there is one. */
  deepRun: GameRunSummary | null
  /** A run over this game that is queued or running right now. */
  deepActiveRun: RunResponse | null
  /** Live ply counts from `analysis.progress`, while a run is working. */
  deepProgress: RunProgress | null
  deepPending: boolean
  deepError: Error | null
  onRequestDeep: () => void
  /**
   * Write a note about the position on the board. The transport row is where it belongs: a
   * note is about *this* position, and this is the row that says which position that is.
   */
  onNote?: () => void
  /** Whether the composer is open, so the button reads as the toggle it is. */
  noting?: boolean
  className?: string
}

/**
 * Wheel travel — in CSS pixels, whatever the device reports in — that counts as one move.
 * Tuned per-tick rather than per-notch: a mouse's discrete wheel tick is ~15px of deltaY,
 * so one tick alone crosses this and steps once. A trackpad's stream of small deltas is
 * added up to the same threshold and then reset, so one flick is one move rather than ten.
 */
const WHEEL_STEP = 10

/**
 * The board column's middle band: eval bar, board with its overlays, and the transport
 * toolbar. Square marks follow design 1c — the flagged move's two squares outlined in its
 * own colour, the engine's target and Maia's target as a teal and a purple mark.
 *
 * The arrows are about the position on the board, never about the move that happens next:
 * an arrow means "this is what the engine would play here". Maia's arrow is the same claim
 * for a human of the owner's rating, and is left out when the two agree.
 */
export function BoardPanel({
  position,
  analysis,
  onPlayMove,
  onExitAnalysis,
  orientation,
  lastMove,
  upcoming,
  engineBest,
  hoverMove,
  maia,
  win,
  score,
  cursor,
  plyCount,
  hints,
  onHintsChange,
  onFlip,
  onSeek,
  onStep,
  deepRun,
  deepActiveRun,
  deepProgress,
  deepPending,
  deepError,
  onRequestDeep,
  onNote,
  noting,
  className,
}: BoardPanelProps) {
  const squares = useMemo<BoardSquare[]>(() => {
    const marks = new Map<string, string>()
    if (hints) {
      const maiaTop = maia?.moves[0]?.uci
      if (maiaTop) marks.set(maiaTop.slice(2, 4), 'bb-maia')
      if (engineBest) marks.set(engineBest.slice(2, 4), 'bb-engine')
    }
    const glyph = glyphFor(upcoming?.classification)
    if (glyph && upcoming?.uci && glyph !== 'best' && glyph !== 'brilliant') {
      marks.set(upcoming.uci.slice(0, 2), `bb-${glyph}`)
      marks.set(upcoming.uci.slice(2, 4), `bb-${glyph}`)
    }
    return [...marks].map(([square, className]) => ({ square, className }))
  }, [engineBest, hints, maia, upcoming])

  const arrows = useMemo<BoardArrow[]>(() => {
    const drawn: BoardArrow[] = []
    if (hints) {
      if (engineBest) {
        drawn.push({ from: engineBest.slice(0, 2), to: engineBest.slice(2, 4), color: 'accent' })
      }
      const maiaTop = maia?.moves[0]?.uci
      if (maiaTop && !(engineBest && sameMove(maiaTop, engineBest))) {
        drawn.push({ from: maiaTop.slice(0, 2), to: maiaTop.slice(2, 4), color: 'paleMaia' })
      }
    }
    // The hover preview is an answer to something the reader is doing right now, so it is
    // drawn whether or not the standing hints are on — but never twice over its own arrow.
    if (hoverMove && !(hints && engineBest && sameMove(hoverMove, engineBest))) {
      drawn.push({ from: hoverMove.slice(0, 2), to: hoverMove.slice(2, 4), color: 'paleAccent' })
    }
    return drawn
  }, [engineBest, hints, hoverMove, maia])

  // Wheeling over the board steps the game: down is forwards, the way a move list reads.
  // The listener is attached by hand because React's `onWheel` is passive, and a passive
  // listener cannot stop the page from scrolling underneath the gesture.
  const column = useRef<HTMLDivElement>(null)
  // The listener is bound once, so the current cursor lives behind a ref (as in `Board`).
  const seeking = useRef({ cursor, onSeek, onStep })
  useEffect(() => {
    seeking.current = { cursor, onSeek, onStep }
  })
  const travel = useRef(0)

  useEffect(() => {
    const node = column.current
    if (!node) return
    function onWheel(event: WheelEvent) {
      // A pinch-zoom is a wheel event too, and is not a request for the next move.
      if (event.ctrlKey) return
      event.preventDefault()
      // `deltaMode` is lines or pages on some browsers; both become rough pixels.
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1
      const delta = event.deltaY * scale
      if (delta === 0) return
      // Turning round mid-gesture starts its own count rather than paying off the old one.
      if (delta > 0 !== travel.current > 0) travel.current = 0
      travel.current += delta
      if (Math.abs(travel.current) < WHEEL_STEP) return
      const step = travel.current > 0 ? 1 : -1
      travel.current = 0
      const { onStep: stepBy, onSeek: seek, cursor: at } = seeking.current
      if (stepBy) stepBy(step)
      else seek(at + step)
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [])

  // Off the game line the board shows the analysis line's own position, and its last move
  // is the one the reader just played rather than the game's. At the head of a line — walked
  // all the way back — the two are the same position, and the game's own last-move highlight
  // is the better one to keep, so only the moves actually on the board count as exploring.
  // The line itself is still there, which is what the exit affordance is about.
  const inLine = (analysis?.moves.length ?? 0) > 0
  const exploring = (analysis?.cursor ?? 0) > 0
  const shown = exploring && analysis ? analysis.position : position

  // chessground needs the legal destinations to accept a drag, and `Board` has no prop for
  // them — it publishes its `Api` for exactly this (the explorer does the same). `set`
  // deep-merges, so what is written here survives the wrapper's own calls.
  const boardApi = useRef<Api | null>(null)
  useEffect(() => {
    boardApi.current?.set({
      movable: { free: false, showDests: true, dests: analysis?.dests },
    })
  }, [analysis])

  return (
    <div ref={column} className={cn('flex flex-col gap-3.5', className)}>
      {/*
        The board column takes the page's spare width now (`GamePage`), and the board is
        square: every rem of width is a rem of height, and unchecked it would push the
        transport row and the eval curve off the bottom of the window. So the board is
        capped against the viewport, the way `/live` caps its own.

        What stands above and below it, in the `rem` everything here is written in:

          2.875  the titlebar (`AppShell`/`TopBar`)
          2.25   the board column's `py-[1.125rem]`, both ends
          1.75   its two `gap-3.5`s — header→panel, panel→curve
          4      the `GameHeaderBar`: three stacked lines over `gap-[0.3125rem]`, and on
                 the right a tier chip over two mono lines, which is the taller of the two
          0.875  this panel's own `gap-3.5`, board row → transport row
          1.75   the transport row: `text-xs` buttons at `py-[0.3125rem]`, plus their border
          6.5    the eval curve at its `max-h-[6.5rem]` — reserved in full, not at its
                 ~4.5rem floor, so a grown board never squeezes the graph down to it
          7      the note composer at its `h-[6rem]`, plus the `gap-3.5` before the curve
          -----
          27     which is `calc(100vh-20rem)`

        The cap is on the `Board` element, which is the grid the rank column and the file
        row live in: its height is its width less 0.125rem (a 0.875rem rail and a 0.375rem
        gap come off the squares horizontally, a 0.375rem gap and a ~0.75rem file row go on
        vertically), so the capped board is a hair *shorter* than the room reserved for it.
        Worked through at a short window — 900 physical pixels, where 1rem is 19.2 — the cap
        is 516px, the board draws 513.6 tall, and 384px of chrome above and below it leaves
        2.4px to spare: header, board, transport row and the full-height curve all fit.

        The eval bar is not part of the cap: it is `flex-none` at `w-3.5` beside a
        `gap-2.5`, so the flex row hands the board what is left of the column after those
        1.5rem and the bar can never be crowded out. `justify-center` is what a capped board
        is for — once the board stops growing the leftover width is split either side, so
        the pair sits in the middle of a wide column instead of hugging its left edge, while
        the transport row under it (and the header and curve outside this panel) still span
        the column entire.
      */}
      <div className="flex items-start justify-center gap-2.5">
        <EvalBar win={win} score={score} className="self-stretch" />
        {/* Nothing floats over the squares: Maia's prediction is a panel of its own, under
            the engine lines, and only its target square is marked here. */}
        <Board
          ref={boardApi}
          fen={shown.fen}
          orientation={orientation}
          lastMove={exploring && analysis ? analysis.lastMove : (lastMove?.uci ?? null)}
          squares={squares}
          arrows={arrows}
          turnColor={shown.turn}
          check={shown.check ? shown.turn : false}
          coordinates="edge"
          // The game board doubles as the analysis board: a piece dragged from any
          // position branches off the game rather than being refused.
          viewOnly={!onPlayMove}
          onMove={onPlayMove}
          className="min-w-0 max-w-[min(100%,calc(100vh-20rem))] flex-1"
        />
      </div>

      <div className="flex items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-edge bg-elevated">
          <TransportButton label="First" disabled={cursor < 0} onClick={() => onSeek(-1)}>
            ⏮
          </TransportButton>
          <TransportButton label="Previous" disabled={cursor < 0} onClick={() => onSeek(cursor - 1)}>
            ◀
          </TransportButton>
          <TransportButton
            label="Next"
            disabled={cursor >= plyCount - 1}
            onClick={() => onSeek(cursor + 1)}
          >
            ▶
          </TransportButton>
          <TransportButton
            label="Last"
            last
            disabled={cursor >= plyCount - 1}
            onClick={() => onSeek(plyCount - 1)}
          >
            ⏭
          </TransportButton>
        </div>

        <button
          type="button"
          onClick={onFlip}
          className="rounded-md border border-edge bg-elevated px-2.5 py-[0.3125rem] text-xs text-soft hover:text-ink"
        >
          ⇅ Flip
        </button>

        <button
          type="button"
          onClick={() => onHintsChange(!hints)}
          aria-pressed={hints}
          title="Engine and Maia marks on the board"
          className={cn(
            'rounded-md border px-2.5 py-[0.3125rem] text-xs',
            hints
              ? 'border-accent-teal/30 bg-accent-teal/10 text-accent-teal'
              : 'border-edge bg-elevated text-dim hover:text-ink',
          )}
        >
          Hints
        </button>

        <DeepButton
          deepRun={deepRun}
          activeRun={deepActiveRun}
          progress={deepProgress}
          pending={deepPending}
          error={deepError}
          onRequest={onRequestDeep}
        />

        {onNote ? (
          <button
            type="button"
            onClick={onNote}
            aria-pressed={noting}
            title="Write a note about this position"
            className={cn(
              'flex items-center gap-1 rounded-md border px-2.5 py-[0.3125rem] text-xs',
              noting
                ? 'border-accent-teal/30 bg-accent-teal/10 text-accent-teal'
                : 'border-edge bg-elevated text-soft hover:text-ink',
            )}
          >
            <StickyNote className="size-3" aria-hidden />
            Note
          </button>
        ) : null}

        {inLine && onExitAnalysis ? (
          <button
            type="button"
            onClick={onExitAnalysis}
            title="Leave the analysis line and go back to the game"
            className="flex items-center gap-1 rounded-md border border-brilliant/30 bg-brilliant/10 px-2.5 py-[0.3125rem] text-xs text-brilliant"
          >
            <Undo2 className="size-3" aria-hidden />
            Back to game
          </button>
        ) : null}

        <div className="flex-1" />
        <span className="font-mono text-[0.6875rem] tabular text-dim">
          {inLine && analysis
            ? `analysis +${analysis.cursor}`
            : `ply ${cursor + 1} / ${plyCount}`}
        </span>
        <span className="rounded-sm border border-edge bg-chip-info px-1.5 py-0.5 font-mono text-[0.6875rem] tabular text-ink">
          {formatScore(score)}
        </span>
      </div>
    </div>
  )
}

/**
 * The deep-analysis trigger: the only place in the game view that writes
 * `POST /analysis { game_id, tier: "deep" }`. Idle by default, tinted once a deep run has
 * finished (still clickable — "re-analysis is always a new run"), and disabled with a
 * progress readout while one is queued or running, whichever tier it is.
 */
function DeepButton({
  deepRun,
  activeRun,
  progress,
  pending,
  error,
  onRequest,
}: {
  deepRun: GameRunSummary | null
  activeRun: RunResponse | null
  progress: RunProgress | null
  pending: boolean
  error: Error | null
  onRequest: () => void
}) {
  const busy = activeRun !== null || pending
  const percent =
    progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : null

  const label = busy ? (
    <>
      <Loader2 className="size-3 animate-spin" aria-hidden />
      {percent !== null ? `${percent}%` : 'Deep'}
    </>
  ) : deepRun ? (
    <>
      <Check className="size-3" aria-hidden />
      Deep
    </>
  ) : (
    'Deep'
  )

  const tooltip = busy
    ? `${activeRun?.status === 'running' ? 'Analysing' : 'Queued'}${activeRun ? ` · ${activeRun.tier}` : ''}`
    : error
      ? error.message
      : deepRun
        ? 'Deep analysis complete — click to re-run'
        : 'Queue a deep analysis pass over this game'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={busy}
          onClick={onRequest}
          className={cn(
            'flex items-center gap-1 rounded-md border px-2.5 py-[0.3125rem] text-xs disabled:cursor-default',
            error && !busy
              ? 'border-blunder/30 bg-blunder/5 text-blunder'
              : deepRun
                ? 'border-accent-teal/30 bg-accent-teal/10 text-accent-teal'
                : 'border-edge bg-elevated text-soft hover:text-ink',
          )}
        >
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}

function TransportButton({
  children,
  label,
  disabled,
  last,
  onClick,
}: {
  children: string
  label: string
  disabled?: boolean
  last?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'px-2.5 py-[0.3125rem] text-xs text-soft hover:bg-selected hover:text-ink disabled:cursor-default disabled:text-faint-2 disabled:hover:bg-transparent',
        !last && 'border-r border-edge',
      )}
    >
      {children}
    </button>
  )
}
