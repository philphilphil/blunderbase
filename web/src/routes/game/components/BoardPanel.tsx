import type { Api } from '@lichess-org/chessground/api'
import type { DrawShape } from '@lichess-org/chessground/draw'
import { Check, ChevronLeft, ChevronRight, Flag, Loader2, StickyNote, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'

import { SideDot } from '@/components/badges/SideDot'
import { Board, type BoardArrow, type BoardSquare } from '@/components/board/Board'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { Color, GameRunSummary, GameSummary, MoveRow, RunResponse } from '@/lib/api/types'
import { glyphFor } from '@/lib/chess/classification'
import { formatScore, type Score } from '@/lib/chess/evaluation'
import { materialBalance, type CapturedRole, type MaterialBalance } from '@/lib/chess/material'
import { useWheelStep } from '@/lib/board/wheelStep'
import { cn } from '@/lib/utils'

import type { AnalysisLine } from '../analysisLine'
import { sameMove, type MaiaLevel, type PlyPosition, type Side } from '../gameModel'
import type { RunProgress } from '../useAnalysisRequest'
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
  /**
   * The game, for the two player rows flanking the board — names, ratings and which side the
   * owner had. Only that; everything else about the game is the header's business.
   *
   * Optional, and the rows are simply left out without it: below `md` `MobileGameView` names
   * both players in its own header, and the panel is also rendered in tests and by the
   * explorer's stand-in without a game behind it.
   */
  game?: GameSummary | null
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
   * The same jump `j`/`shift+J` make, and drawn as buttons at every width: getting to the
   * blunder is what the page is opened for, and a keybinding with no affordance is a
   * feature only the person who wrote it knows about.
   */
  nextFlagged?: number | null
  previousFlagged?: number | null
  /**
   * One move forwards or back from wherever the board stands. Inside an analysis line that
   * is a step along the line rather than along the game, which the page decides — the wheel
   * only says which way. Without it, a step is a plain seek.
   */
  onStep?: (delta: number) => void
  /** The newest finished quick run over this game, if there is one — hidden once `deepRun`
   * is set, since a quick pass adds nothing once the game has a completed deep one. */
  quickRun: GameRunSummary | null
  /** The newest finished deep run over this game, if there is one. */
  deepRun: GameRunSummary | null
  /** A run over this game that is queued or running right now, either tier. */
  activeRun: RunResponse | null
  /** Live ply counts from `analysis.progress`, while a run is working. */
  progress: RunProgress | null
  pending: boolean
  error: Error | null
  onRequestQuick: () => void
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

/** Whose move it is in a FEN, straight off its second field. */
function turnOf(fen: string): Side {
  return fen.split(/\s+/)[1] === 'b' ? 'black' : 'white'
}

/**
 * The board column, whole: a player row, the eval bar and the board with its overlays, the
 * other player row, and the transport toolbar. Nothing that is not about the board lives
 * here — the eval curve, the notes and the engine panels are all in the right column, and
 * that emptiness is what pays for the board's size (see the budget below).
 *
 * Square marks follow design 1c — the flagged move's two squares outlined in its
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
  game,
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
  quickRun,
  deepRun,
  activeRun,
  progress,
  pending,
  error,
  onRequestQuick,
  onRequestDeep,
  onNote,
  noting,
  className,
}: BoardPanelProps) {
  // Both analysis buttons disable together — only one run is ever live over a game — but
  // the spinner belongs to whichever button matches it. An unknown tier (a request just
  // sent, before the run list catches up; a fill run that is neither) falls back to Deep
  // rather than lighting neither button — and so does a quick-tier run while the Quick
  // button is hidden behind a finished deep pass (a Maia fill, mostly), for the same
  // reason: a spinner on a button that is not there spins for nobody.
  const analysisBusy = activeRun !== null || pending
  const spinningTier: 'quick' | 'deep' =
    activeRun?.tier === 'quick' && deepRun == null ? 'quick' : 'deep'

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

  // Wheeling over the board steps the game. The gesture is `useWheelStep`'s, shared with the
  // eval curve, so the two surfaces on this page answer a wheel identically.
  const column = useRef<HTMLDivElement>(null)
  useWheelStep(column, { cursor, onSeek, onStep })

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

  // The material on the board rather than the material in the game — the previewed or
  // analysed position included. The player rows count pieces the reader can see; a row that
  // reported the game's position while the board showed another one would be describing
  // squares that are not on screen, which is the one thing a piece count must never do.
  const boardFen = previewing ? previewFen : shown.fen
  const material = useMemo(() => materialBalance(boardFen), [boardFen])

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
    <div
      ref={column}
      // The panel is the width of the board it is about, not the width of the column it
      // stands in — `min(100%, 100vh - 11.3125rem)` is the board's own cap below with the
      // 1.5rem the eval bar and its gap take added back to every term. So the
      // player rows end where the board ends and the transport row's `flex-1` spacer parks
      // the ply readout and the score chip against the board's right edge, instead of
      // stranding them at the far side of a column that is wider than the board. (Which
      // means these two numbers move whenever the budget below does. Below `md` there is no
      // width here at all: the column is the board's width already.) `GameHeaderBar` is
      // outside this panel and still spans the column, exactly as the design draws it.
      className={cn(
        'flex flex-col gap-2 md:w-[min(100%,calc(100vh-11.3125rem))]',
        className,
      )}
    >
      {/*
        The players flank the board, ordered by `orientation`: the reader's own side is the
        one at the bottom of the board, so it is the one on the bottom row, and the row a
        player is on always agrees with the half of the board their pieces start on.
      */}
      <PlayerRow side={orientation === 'white' ? 'black' : 'white'} game={game} material={material} />

      {/*
        The board column takes the page's spare width now (`GamePage`), and the board is
        square: every rem of width is a rem of height, and unchecked it would push the
        player row and the transport row off the bottom of the window. So the board is
        capped against the viewport, the way `/live` caps its own.

        The eval curve and the note composer live in the right column, and the game header
        is now a bar across the whole workspace rather than a line inside this column — so
        it costs the board its own height and no gap besides. What is left standing above and
        below the board, in the `rem` everything here is written in:

           2.625   the titlebar (`AppShell`/`TopBar`)
           2.6875  the `GameHeaderBar` bar at its declared `h-[2.625rem]` plus its bottom
                   rule — one line, fixed, so this number cannot drift when somebody adds a
                   fact to it
           1.25    the board column's `py-2.5`, both ends
           3       the two player rows flanking the board, `h-6` each
           1.5     this panel's three `gap-2`s: player → board row → player → transport
           1.75    the transport row: `text-xs` buttons at `py-[0.3125rem]`, plus their border
          -------
          12.8125  which is `calc(100vh-12.8125rem)`

        The cap is on the `Board` element, which is the grid the rank column and the file
        row live in: its height is its width less 0.125rem (a 0.875rem rail and a 0.375rem
        gap come off the squares horizontally, a 0.375rem gap and a ~0.75rem file row go on
        vertically), so the capped board is a hair *shorter* than the room reserved for it.
        Worked through at the design's own window — 1160 physical pixels tall, where 1rem is
        19.2 — the chrome is 246px, the cap is 914px, and the board draws 911.6 tall, which
        leaves the same 2.4px to spare the old budget did. The gain over that budget is the
        header's gap and the column's tighter padding.

        There is deliberately no ceiling on top of that. One was tried — 48rem, on the
        reasoning that ~115px squares are as large as a board wants to be — and it was the
        wrong call: it binds on a tall display rather than a short one, so the owner's own
        window sat at the cap with a stripe of dead space under the transport row, which is
        exactly the complaint this whole rebuild set out to answer. The board is bounded by
        the two things that are actually true about it — the width the column can give it
        and the height left after the chrome — and by nothing else.

        The eval bar is not part of the cap: it is `flex-none` at `w-3.5` beside a
        `gap-2.5`, so the flex row hands the board what is left of the column after those
        1.5rem and the bar can never be crowded out. The row is `justify-start`, not
        centred: the whole layout is the board flush left with everything else to the right
        of it, and a capped board that drifted into the middle of a wide column would break
        the one alignment the design is built on. Below `md` it centres instead, where the
        board is the only thing in the column and has nothing to line up with.
      */}
      <div className="flex items-start justify-start gap-2.5 max-md:justify-center">
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
          //   2.625  the titlebar (`AppShell`/`TopBar`)
          //   2.75   the phone header: players over result/ply/opening
          //   1      this panel's `max-md:py-2`, both ends
          //   0.5    its one `gap-2`, board row → transport — the player rows are
          //          `max-md:hidden` and a hidden flex child eats neither row nor gap,
          //          which is why this sum is untouched by them
          //   4.2    the transport row, which wraps to two lines at 375px: the transport
          //          and flagged groups on the first, the four toggles and the score chip
          //          on the second, over a `max-md:gap-1.5` row gap
          //   2.5    the tab strip
          //   9      the floor left for the tab pane itself — about five move rows
          //   -----
          //   22.75  which is `calc(100dvh-22.75rem)`
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
            'min-w-0 max-w-[min(100%,calc(100vh-12.8125rem))] flex-1 max-md:max-w-[min(100%,calc(100dvh-22.75rem))]',
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

      <PlayerRow side={orientation} game={game} material={material} />

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

        The row wraps at *every* width now, and every child is `flex-none`. A desktop board
        column can be narrower than this row wants — the column yields its width to the moves
        column's floor on a window that is tall for how wide it is — and a shrinking row spent
        that shortfall by squeezing the four transport arrows into a sliver, which is the one
        thing here that has to stay hittable. Wrapping, the row spends it on a second line
        instead; and a column narrow enough to wrap is by definition one where the board is
        limited by width rather than by the height budget, so the line it takes is height the
        board was not going to use. Nothing wraps at a width that fits, so no ordinary window
        sees any of this.
      */}
      <div className="flex flex-wrap items-center gap-2 max-md:gap-1.5">
        <div className="flex flex-none overflow-hidden rounded-md border border-edge bg-elevated">
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
          The flagged-move jumps, as their own group beside the transport, at every width.
          They used to be `md:hidden` — drawn for the phone, which has no keys to press,
          and left to `j`/`shift+J` on the desktop. That was a keybinding with no affordance:
          getting to the blunder is what the page is opened for, and the only way to find out
          the jump existed was to read the shortcut sheet. Stepping ⏭ twenty times to reach
          it is not a review on a mouse either.

          A group of its own rather than two more cells in the transport group: that group's
          dividers are drawn by the cell *before* each boundary, so the two sets stay
          separately bounded and the transport group's last divider is its own business.
        */}
        <div className="flex flex-none overflow-hidden rounded-md border border-edge bg-elevated">
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
          className="flex-none rounded-md border border-edge bg-elevated px-2.5 py-[0.3125rem] text-xs text-soft hover:text-ink max-md:py-1.5"
        >
          ⇅ Flip
        </button>

        <button
          type="button"
          onClick={() => onHintsChange(!hints)}
          aria-pressed={hints}
          title="Engine and Maia marks on the board"
          className={cn(
            'flex-none rounded-md border px-2.5 py-[0.3125rem] text-xs max-md:py-1.5',
            hints
              ? 'border-accent-teal/30 bg-accent-teal/10 text-accent-teal'
              : 'border-edge bg-elevated text-dim hover:text-ink',
          )}
        >
          Hints
        </button>

        {deepRun == null ? (
          <AnalysisTierButton
            label="Quick"
            finishedRun={quickRun}
            busy={analysisBusy}
            spinning={analysisBusy && spinningTier === 'quick'}
            activeRun={activeRun}
            progress={progress}
            error={error}
            onRequest={onRequestQuick}
          />
        ) : null}
        <AnalysisTierButton
          label="Deep"
          finishedRun={deepRun}
          busy={analysisBusy}
          spinning={analysisBusy && spinningTier === 'deep'}
          activeRun={activeRun}
          progress={progress}
          error={error}
          onRequest={onRequestDeep}
        />

        {onNote ? (
          <button
            type="button"
            onClick={onNote}
            aria-pressed={noting}
            title="Write a note about this position"
            className={cn(
              'flex flex-none items-center gap-1 rounded-md border px-2.5 py-[0.3125rem] text-xs max-md:py-1.5',
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
            className="flex flex-none items-center gap-1 rounded-md border border-brilliant/30 bg-brilliant/10 px-2.5 py-[0.3125rem] text-xs text-brilliant max-md:py-1.5"
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
        {/* One group, so a row that has to wrap never leaves the score chip stranded on a
            line of its own: the two readouts are read together and they move together. */}
        <div className="flex flex-none items-center gap-2 max-md:hidden">
          <span className="font-mono text-[0.6875rem] tabular whitespace-nowrap text-dim">
            {inLine && analysis
              ? `analysis +${analysis.cursor}`
              : `ply ${cursor + 1} / ${plyCount}`}
          </span>
          <span className="rounded-sm border border-edge bg-chip-info px-1.5 py-0.5 font-mono text-[0.6875rem] tabular text-ink">
            {formatScore(score)}
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * A captured man, as a glyph, keyed by the side that *took* it: White's captures are black
 * men and are drawn as the black figurines, Black's as the white ones. `materialBalance`
 * hands back roles — a lib utility has no business choosing characters — so the mapping
 * lives here, which is also where a later switch to real piece sprites would happen.
 */
const CAPTURED_GLYPH: Record<Color, Record<CapturedRole, string>> = {
  white: { queen: '♛', rook: '♜', bishop: '♝', knight: '♞', pawn: '♟' },
  black: { queen: '♕', rook: '♖', bishop: '♗', knight: '♘', pawn: '♙' },
}

/**
 * One of the two slim rows flanking the board: side dot, name, rating, the men this player
 * has taken and by how much they are ahead.
 *
 * It is the smallest thing that can carry the players, and deliberately so — it was three
 * lines in the header until tonight, and the board's height budget names its `h-6` by
 * number. So: one line, no wrapping, the name the only part that gives way.
 *
 * The material is here rather than beside the eval bar because it answers a different
 * question. The bar says who is winning; `♟ −3` says why — and it says it against the
 * player it belongs to, so there is nothing to work out about whose number it is.
 *
 * Hidden below `md`: `MobileGameView` names both players in its own pinned header, and the
 * phone's board budget has no room to say it twice.
 */
function PlayerRow({
  side,
  game,
  material,
}: {
  side: Color
  game: GameSummary | null | undefined
  material: MaterialBalance
}) {
  if (!game) return null

  const name = side === 'white' ? game.white : game.black
  const rating = side === 'white' ? game.white_rating : game.black_rating
  // `materialBalance` states each side's own surplus and its own signed advantage, so the
  // two rows read `♗ +3` and `−3` rather than the same number twice with the reader doing
  // the flip. Equal takings have already cancelled there: only the surplus is drawn.
  const { captured, advantage } = side === 'white' ? material.white : material.black
  const owner = game.color === side

  return (
    // `pl-6` is the eval bar's `w-3.5` plus the board row's `gap-2.5`: the dot lines up with
    // the board's left edge, not with the bar's, so the two rows and the squares share one
    // margin. `h-6` is the budgeted height and `flex-none` keeps it that.
    <div
      data-testid="player-row"
      data-side={side}
      className="flex h-6 flex-none items-center gap-2 pl-6 max-md:hidden"
    >
      <SideDot side={side} size="sm" />
      <span
        className={cn('min-w-0 truncate text-[0.75rem]', owner ? 'font-medium text-ink' : 'text-soft')}
      >
        {name ?? 'unknown'}
      </span>
      <span className="flex-none font-mono text-[0.6875rem] tabular text-dim">{rating ?? '—'}</span>
      {captured.length > 0 ? (
        <span
          aria-hidden
          className="flex-none text-[0.8125rem] leading-none tracking-tighter text-dim-3"
        >
          {captured.map((role) => CAPTURED_GLYPH[side][role]).join('')}
        </span>
      ) : null}
      {advantage !== 0 ? (
        <span
          className={cn(
            'flex-none font-mono text-[0.6875rem] tabular',
            advantage > 0 ? 'text-soft' : 'text-faint',
          )}
          title={advantage > 0 ? `Up ${advantage} in material` : `Down ${-advantage} in material`}
        >
          {advantage > 0 ? `+${advantage}` : `−${-advantage}`}
        </span>
      ) : null}
    </div>
  )
}

/**
 * One of the two analysis triggers in the transport row — labelled "Quick" or "Deep",
 * writing `POST /analysis { game_id, tier }` for its own tier (the label lowercased is the
 * tier). Idle by default, tinted once a run of its own tier has finished (still clickable —
 * "re-analysis is always a new run"). Both buttons disable together while any run over the
 * game is queued or running (`BoardPanel` computes that), but only the one `spinning` shows
 * the spinner and progress readout — the other stays a plain disabled label, so the reader
 * is never told two runs are in flight when there is only one.
 *
 * The mutation error is shared across tiers (there is one request state, not two), so a
 * refusal tints both buttons red rather than trying to guess which one it was about.
 */
function AnalysisTierButton({
  label,
  finishedRun,
  busy,
  spinning,
  activeRun,
  progress,
  error,
  onRequest,
}: {
  label: 'Quick' | 'Deep'
  finishedRun: GameRunSummary | null
  busy: boolean
  spinning: boolean
  activeRun: RunResponse | null
  progress: RunProgress | null
  error: Error | null
  onRequest: () => void
}) {
  const percent =
    spinning && progress && progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : null

  const buttonLabel = spinning ? (
    <>
      <Loader2 className="size-3 animate-spin" aria-hidden />
      {percent !== null ? `${percent}%` : label}
    </>
  ) : finishedRun ? (
    <>
      <Check className="size-3" aria-hidden />
      {label}
    </>
  ) : (
    label
  )

  const tooltip = spinning
    ? `${activeRun?.status === 'running' ? 'Analysing' : 'Queued'}${activeRun ? ` · ${activeRun.tier}` : ''}`
    : error
      ? error.message
      : finishedRun
        ? `${label} analysis complete — click to re-run`
        : `Queue a ${label.toLowerCase()} analysis pass over this game`

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={busy}
          onClick={onRequest}
          className={cn(
            'flex flex-none items-center gap-1 rounded-md border px-2.5 py-[0.3125rem] text-xs disabled:cursor-default max-md:py-1.5',
            error && !busy
              ? 'border-blunder/30 bg-blunder/5 text-blunder'
              : finishedRun
                ? 'border-accent-teal/30 bg-accent-teal/10 text-accent-teal'
                : 'border-edge bg-elevated text-soft hover:text-ink',
          )}
        >
          {buttonLabel}
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
