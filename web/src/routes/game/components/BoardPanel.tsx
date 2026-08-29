import type { Api } from '@lichess-org/chessground/api'
import type { DrawShape } from '@lichess-org/chessground/draw'
import { Check, ChevronLeft, ChevronRight, Flag, Loader2, StickyNote, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'

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
  /**
   * The engine-line preview (`lib/board/useLinePreview.ts`), which the page owns because it
   * is read in one panel and drawn here.
   *
   * A `previewFen` is a position the game does not contain — a line scrubbed to one of its
   * moves, or played out on the board — so while there is one, everything the panel says
   * about the *real* position is a claim about a position the board has stepped off, and is
   * left out. The eval bar, the score chip and the transport row are not: they describe the
   * position the reader is still on, which is the one they will be back on in a moment.
   */
  previewFen?: string | null
  previewShapes?: DrawShape[]
  previewLastMove?: [string, string] | null
  previewCaption?: string | null
  previewDim?: boolean
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
   * The cursor the next (and previous) flagged move is made *from* — one ply before the
   * mistake, which is the position worth reading — or null where there is none that way.
   * The same jump `j`/`shift+J` make; they are only drawn as buttons below `md`, where
   * there is no keyboard to press and the flagged moves are the reason the page is open.
   */
  nextFlagged?: number | null
  previousFlagged?: number | null
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

/** Whose move it is in a FEN, straight off its second field. */
function turnOf(fen: string): Side {
  return fen.split(/\s+/)[1] === 'b' ? 'black' : 'white'
}

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
  previewFen,
  previewShapes,
  previewLastMove,
  previewCaption,
  previewDim,
  maia,
  win,
  score,
  cursor,
  plyCount,
  hints,
  onHintsChange,
  onFlip,
  onSeek,
  nextFlagged,
  previousFlagged,
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

  // A previewed position is not on the board's own line at all — it is a line being read,
  // not one being walked — so the board is that position, unannotated: no marks, no engine
  // or Maia arrow, nothing draggable. The preview's own shapes are all that is drawn on it.
  const previewing = previewFen != null

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
    <div ref={column} className={cn('flex flex-col gap-3.5 max-md:gap-2', className)}>
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
        {/* The bar mirrors the board: the side at the bottom of one is at the bottom of the
            other, so the reader's own side always grows towards them. */}
        <EvalBar win={win} score={score} orientation={orientation} className="self-stretch" />
        {/* Nothing floats over the squares: Maia's prediction is a panel of its own, under
            the engine lines, and only its target square is marked here. */}
        <Board
          ref={boardApi}
          fen={previewing ? previewFen : shown.fen}
          orientation={orientation}
          lastMove={
            previewing
              ? previewLastMove
              : exploring && analysis
                ? analysis.lastMove
                : (lastMove?.uci ?? null)
          }
          squares={previewing ? undefined : squares}
          arrows={previewing ? undefined : arrows}
          shapes={previewShapes}
          // Nothing has evaluated the transient position, so nothing is said about it: its
          // own turn field, and no check.
          turnColor={previewing ? turnOf(previewFen) : shown.turn}
          check={previewing ? false : shown.check ? shown.turn : false}
          coordinates="edge"
          // The game board doubles as the analysis board: a piece dragged from any
          // position branches off the game rather than being refused. Not from a preview,
          // though — the branch does not contain that position, so the drag would land
          // nowhere. `viewOnly` stays as it is: chessground cannot be reconfigured with it
          // and would rebuild the whole board on every hover.
          viewOnly={!onPlayMove}
          // The one surface a reader thinks *at*: a right-drag is their own arrow, in the
          // design's brushes, on top of whatever the engine is saying. Constant, so the
          // board is never rebuilt for it (chessground reads it only at creation), and dead
          // anyway on the preview boards, which are view-only.
          drawable
          onMove={previewing ? undefined : onPlayMove}
          // Below `md` the board sits in `MobileGameView`'s pinned head, over a tab pane
          // that has to keep a usable height of its own, so it is capped again — against a
          // different sum. What stands above and below it there, at the app's 120 % scale:
          //
          //   2.875  the titlebar (`AppShell`/`TopBar`)
          //   2.75   the phone header: players over result/ply/opening
          //   1      this panel's `max-md:py-2`, both ends
          //   0.5    its `max-md:gap-2`, board row → transport
          //   4.2    the transport row, which wraps to two lines at 375px: the transport
          //          and flagged groups on the first, the four toggles and the score chip
          //          on the second, over a `max-md:gap-1.5` row gap
          //   2.5    the tab strip
          //   9      the floor left for the tab pane itself — about five move rows
          //   -----
          //   23     which is `calc(100dvh-23rem)`
          //
          // `dvh`, not `vh`: on iOS `vh` is the height with the address bar *hidden*, so a
          // `vh` cap over-feeds the board and eats the pane the moment the bar is showing.
          //
          // No `env(safe-area-inset-*)` in that sum, deliberately. It would have to go
          // inside the `calc`, where Tailwind's operator normalisation is not something to
          // bet an identifier full of hyphens on — and it would buy nothing: the cap only
          // binds on a short phone (at 812 the board is already full width and the `100%`
          // wins), and short phones are the un-notched ones whose insets are zero.
          className={cn(
            'min-w-0 max-w-[min(100%,calc(100vh-20rem))] flex-1 max-md:max-w-[min(100%,calc(100dvh-23rem))]',
            previewDim && 'bb-preview-dim',
          )}
        >
          {previewCaption ? (
            // A scrubbed board must never be mistaken for the game, and the caption is the
            // only thing on screen that says so — over the squares, where the eye already is.
            <span className="bb-chip pointer-events-none absolute right-1.5 top-1.5 px-1.5 py-px font-mono text-[0.625rem] text-soft">
              {previewCaption}
            </span>
          ) : null}
        </Board>
      </div>

      {/*
        Below `md` this row wraps onto exactly two lines, and the split is designed rather
        than left to chance. At 375px the transport and flagged groups come to about 296 of
        the 356 available, so they take the first line together — the thumb line, directly
        under the board — and Flip is the first thing that cannot follow them. The four
        toggles and the score chip come to about 341 and make the second. The `flex-1`
        spacer is dropped there: in a wrapping row it is a forced line break.

        Two lines is what `BoardPanel`'s `100dvh` cap budgets for. "Back to game" appears
        only while a line is being walked and can push it to three; the pane below is
        `flex-1 min-h-0` and gives up the height, which is the right way round.
      */}
      <div className="flex items-center gap-2 max-md:flex-wrap max-md:gap-1.5">
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

        {/*
          The flagged-move jumps, as their own group beside the transport: on a desktop they
          are `j` and `shift+J` and this row stays exactly as it was, but a phone has no keys
          to press, and getting to the blunder is what the page is opened for — tapping ⏭
          twenty times to reach it is not a review.

          A group of its own rather than two more cells in the transport group: that group's
          dividers are drawn by the cell *before* each boundary, so a cell that exists only
          under `md` would leave the desktop row's last divider hanging.
        */}
        <div className="flex overflow-hidden rounded-md border border-edge bg-elevated md:hidden">
          <TransportButton
            label="Previous flagged move"
            disabled={previousFlagged == null}
            onClick={() => previousFlagged != null && onSeek(previousFlagged)}
          >
            <span className="flex items-center">
              <ChevronLeft className="size-3.5" aria-hidden />
              <Flag className="size-3" aria-hidden />
            </span>
          </TransportButton>
          <TransportButton
            label="Next flagged move"
            last
            disabled={nextFlagged == null}
            onClick={() => nextFlagged != null && onSeek(nextFlagged)}
          >
            <span className="flex items-center">
              <Flag className="size-3" aria-hidden />
              <ChevronRight className="size-3.5" aria-hidden />
            </span>
          </TransportButton>
        </div>

        <button
          type="button"
          onClick={onFlip}
          className="rounded-md border border-edge bg-elevated px-2.5 py-[0.3125rem] text-xs text-soft hover:text-ink max-md:py-1.5"
        >
          ⇅ Flip
        </button>

        <button
          type="button"
          onClick={() => onHintsChange(!hints)}
          aria-pressed={hints}
          title="Engine and Maia marks on the board"
          className={cn(
            'rounded-md border px-2.5 py-[0.3125rem] text-xs max-md:py-1.5',
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
              'flex items-center gap-1 rounded-md border px-2.5 py-[0.3125rem] text-xs max-md:py-1.5',
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
            className="flex items-center gap-1 rounded-md border border-brilliant/30 bg-brilliant/10 px-2.5 py-[0.3125rem] text-xs text-brilliant max-md:py-1.5"
          >
            <Undo2 className="size-3" aria-hidden />
            Back to game
          </button>
        ) : null}

        <div className="flex-1 max-md:hidden" />
        {/*
          Both readouts go below `md`, and `MobileGameView`'s header carries both instead —
          `+0.32 · 1-0 · ply 34/91` on a line it was drawing anyway. Kept here they wrapped
          onto a third line of their own, which spent a third of a `rem` of pinned height on
          two small pieces of text and took it straight out of the tab pane underneath.
        */}
        <span className="font-mono text-[0.6875rem] tabular text-dim max-md:hidden">
          {inLine && analysis
            ? `analysis +${analysis.cursor}`
            : `ply ${cursor + 1} / ${plyCount}`}
        </span>
        <span className="rounded-sm border border-edge bg-chip-info px-1.5 py-0.5 font-mono text-[0.6875rem] tabular text-ink max-md:hidden">
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
            'flex items-center gap-1 rounded-md border px-2.5 py-[0.3125rem] text-xs disabled:cursor-default max-md:py-1.5',
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

/**
 * One cell of a transport group. The divider between two cells is drawn by the cell before
 * it, which is what `last` turns off — so a group's cells all have to exist at the same
 * breakpoints as each other (see the flagged pair, which is a group of its own for exactly
 * that reason). Below `md` the cell grows into a thumb-sized target; it is the same button.
 */
function TransportButton({
  children,
  label,
  disabled,
  last,
  onClick,
}: {
  children: ReactNode
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
        'px-2.5 py-[0.3125rem] text-xs text-soft hover:bg-selected hover:text-ink disabled:cursor-default disabled:text-faint-2 disabled:hover:bg-transparent max-md:px-3 max-md:py-1.5 max-md:text-sm',
        !last && 'border-r border-edge',
      )}
    >
      {children}
    </button>
  )
}
