import { ChevronDown, Columns3 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { LinePreviewRowChip, LinePreviewSettingsButton } from '@/components/analysis/LinePreviewSettings'
import { MiniBoard } from '@/components/board/MiniBoard'
import type { GameRunSummary } from '@/lib/api/types'
import {
  cachedReplay,
  peekCaption,
  peekFen,
  type LinePreviewPrefs,
} from '@/lib/board/linePreview'
import { useLinePreviewPrefs } from '@/lib/board/linePreviewPrefs'
import type { HoveredLine } from '@/lib/board/useLinePreview'
import { glyphStyle, isFlagged } from '@/lib/chess/classification'
import { formatNodes, formatScore, formatWinLoss } from '@/lib/chess/evaluation'
import { cn } from '@/lib/utils'

import {
  plyLabel,
  type EngineLineView,
  type HumanMoveView,
  type MaiaComparisonColumn,
  type MaiaLevelOption,
  type MaiaMove,
} from '../gameModel'

/** The human column's own colour — the purple `docs/design/README.md` gives Maia. */
const MAIA_HUE = 'var(--bb-brilliant)'

/**
 * A token colour at a fraction of its opacity. The colours are `var(--bb-…)` tokens, so the
 * design's `rgba(240,82,74,.06)` tints have to be mixed rather than written as a hex-alpha
 * suffix — and mixing keeps them right in both themes, where the token itself changes.
 */
function tint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`
}

/**
 * The id this panel gives one of its engine rows, and the only place it is built.
 *
 * A bare `multipv` is not an identity: the live-analysis panel at the foot of the same
 * column numbers its lines from 1 as well, and one `useLinePreview` serves both boxes. An
 * unqualified "line 1" would make the two the same row — hovering here would dim the tokens
 * there, and the hook could not tell the two lines apart in its cache key.
 */
function runLineId(multipv: number): string {
  return `run:${multipv}`
}

/**
 * Wheel travel that counts as one step along a line — `InfiniteAnalysisPanel`'s constant and
 * its accumulation, because the two boxes are the same gesture on the same page and a wheel
 * that stepped one at a different speed would read as two different wheels.
 */
const WHEEL_STEP = 10

/** Whether a wheel over a row has anywhere to step: only the modes that stand on a ply. */
function canStep(prefs: LinePreviewPrefs): boolean {
  return prefs.row === 'play' || prefs.row === 'peek' || prefs.scrub
}

export interface MaiaLiveState {
  /** The most likely continuation from here, both sides at the same level. */
  rollout: MaiaMove[]
  /** A query is in flight for the position on the board. */
  pending: boolean
}

export interface MaiaPanelProps {
  /** The level the human column speaks for — a stored band, or the live engine's own. */
  rating: string | null
  /** The human column, already crossed with the engine's verdicts (`humanMoves`). */
  human: HumanMoveView[]
  /**
   * Every level the reader may switch to here: what this position carries, plus the levels
   * the deployment is configured for but this run was never made at, which are offered
   * disabled rather than hidden (`maiaLevelOptions`). Fewer than two, and the header is the
   * plain label it always was — there is nothing to switch between.
   */
  levels?: MaiaLevelOption[]
  onSelectLevel?: (elo: number) => void
  /** The human column is every level side by side rather than the one that is selected. */
  compare?: boolean
  onCompareChange?: (next: boolean) => void
  /** One column per level, for the compare grid (`maiaComparison`). */
  comparison?: MaiaComparisonColumn[]
  /**
   * Whether the human column has anything to say. Off — the `hints` toggle, or a
   * deployment with no Maia to ask — the column keeps its place and its header but shows
   * nothing, so the box never changes shape; what the run found is not a hint and must not
   * vanish with them.
   */
  showHuman?: boolean
  /** The engine's ranking of the same position; empty off the game line. */
  engine: EngineLineView[]
  /** The run those lines came from, whose spend the engine column's header reports. */
  run?: GameRunSummary | null
  /** The ply the position sits at, for numbering a rollout. */
  ply: number
  /**
   * The position the engine lines were read from — only the peek board needs it, which
   * replays the hovered line from here. Without one the other preview modes still work:
   * they are drawn on the surface's own board, from the FEN it already has.
   */
  fen?: string | null
  /** Set while the board is off the game line: the panel is reading a live query. */
  live?: MaiaLiveState | null
  /**
   * Pointing at a row previews its move on the board; leaving clears it. Single moves only
   * — the human column, the compare grid and the rollout, where a pale arrow is the whole
   * answer. An engine row hands over its whole line through `onHoverLine` instead.
   */
  onHoverMove?: (uci: string | null) => void
  /**
   * The engine line being pointed at, for a surface that draws a whole-line preview. Given,
   * it *replaces* `onHoverMove` on the engine rows: firing both would leave the old pale
   * arrow drawn underneath the preview.
   */
  onHoverLine?: (state: HoveredLine | null) => void
  /** A wheel step along the previewed line: +1 forwards, -1 back. */
  onStepPreview?: (delta: number) => void
  /** The preview's effective line and ply, handed back so the tokens can show where it is. */
  previewLine?: string | null
  previewPly?: number | null
  /** Which way up the peek board is drawn — the surface's own board, not the engine's. */
  orientation?: 'white' | 'black'
  /**
   * Walk into a line from the position on the board: the *whole* line in UCI, and which of
   * its moves was clicked (0-based). The page puts the board just after that move and keeps
   * the rest of the line to step through, so a click is an entry point rather than a cut.
   */
  onPlayLine?: (ucis: string[], index: number) => void
  className?: string
}

/**
 * What humans play here, beside what the engine plays here.
 *
 * Neither column says much alone — "a 1700 plays Nf3, 41%" teaches nothing, and the engine
 * list is the same list every engine ever printed. Side by side they answer the two
 * questions the owner actually has: *was my blunder a normal human mistake* (the played
 * move, tinted with the verdict the engine gave it, beside how many people at my level walk
 * into it), and *what will a human actually do here* (the distribution, and the rollout of
 * the line two humans at this level would most likely play out).
 *
 * On the game line the human column is stored data, instant. Off it, the board is an
 * analysis board and the column is a live query — see `useLiveMaia`.
 *
 * The engine column is also the run's own box: which run is speaking, what it spent, and
 * its multi-PV lines for the position on the board, with the move actually played as the
 * last row, marked `played`, so a blunder reads as "these were the options, this happened".
 *
 * Compare mode is the third question, the one a single level cannot answer: *at which level
 * does this stop being the move people play*. Several levels' distributions only mean
 * anything against each other, so the grid takes the whole band while it is on and the
 * engine card stands down — the
 * engine's verdict is already in every column's colour, and five columns squeezed into a
 * quarter of the width would be five ellipses.
 *
 * The engine column's rows are previewed the way the live panel's are, and for the same
 * reasons (`InfiniteAnalysisPanel`): the **row** asks where the line goes, a **token** asks
 * what the position looks like after that one move, and the **wheel** walks that ply along
 * without the pointer having to hit each token. The panel only reports them; what any of
 * them draws is the surface's business.
 */
export function MaiaPanel({
  rating,
  human,
  levels = [],
  onSelectLevel,
  compare = false,
  onCompareChange,
  comparison = [],
  showHuman = true,
  engine,
  run,
  ply,
  fen,
  live,
  onHoverMove,
  onHoverLine,
  onStepPreview,
  previewLine,
  previewPly,
  orientation = 'white',
  onPlayLine,
  className,
}: MaiaPanelProps) {
  const rollout = live?.rollout ?? []
  const nodes = formatNodes(run?.nodes)
  const comparing = showHuman && compare && comparison.length > 1
  // The toggle stays offered while compare is on even with nothing to compare here, so a
  // position with one level is never a position the reader cannot get out of.
  const canCompare = onCompareChange !== undefined && (comparison.length > 1 || compare)

  const prefs = useLinePreviewPrefs()
  // Which engine row the pointer is in. The preview's own position comes back from the
  // surface, but the wheel and the peek board need to know where the pointer *is* right now.
  const [hovered, setHovered] = useState<string | null>(null)

  // Wheeling over the engine column steps the preview: down is forwards, as everywhere else.
  // Bound by hand and non-passive, the same way `InfiniteAnalysisPanel` binds it — a passive
  // listener cannot keep the page from scrolling out from under the gesture — and bound
  // once, so the live values sit behind a ref rather than in the listener's closure. This
  // column scrolls on its own, so the listener takes the wheel *only* while it is stepping.
  const linesRef = useRef<HTMLElement>(null)
  const stepping = useRef({ hovered, prefs, onStepPreview })
  useEffect(() => {
    stepping.current = { hovered, prefs, onStepPreview }
  })
  const travel = useRef(0)

  useEffect(() => {
    const node = linesRef.current
    if (!node) return
    function onWheel(event: WheelEvent) {
      // A pinch-zoom is a wheel event too, and is not a request for the next ply.
      if (event.ctrlKey) return
      const { hovered: row, prefs: current, onStepPreview: step } = stepping.current
      // Nothing to step: the column scrolls the way it always did.
      if (row === null || !step || !canStep(current)) return
      event.preventDefault()
      // `deltaMode` is lines or pages on some browsers; both become rough pixels.
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1
      const delta = event.deltaY * scale
      if (delta === 0) return
      // Turning round mid-gesture starts its own count rather than paying off the old one.
      if (delta > 0 !== travel.current > 0) travel.current = 0
      travel.current += delta
      if (Math.abs(travel.current) < WHEEL_STEP) return
      const direction = travel.current > 0 ? 1 : -1
      travel.current = 0
      step(direction)
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [comparing])

  // Peek is the panel's own drawing rather than the row's: the engine column scrolls, and a
  // scroll container clips whatever a row inside it positions outside itself. So the board
  // hangs off the panel, *below* it — this box sits at the top of the moves column, where
  // the room is downwards. The live panel at the foot of the same column draws upwards for
  // exactly the opposite reason.
  const peeked =
    onHoverLine && hovered !== null && prefs.row === 'peek' && fen
      ? (engine.find((line) => runLineId(line.multipv) === hovered) ?? null)
      : null
  const peekReplay = peeked && fen ? cachedReplay(fen, peeked.pv) : null
  const peekState = {
    line: hovered ?? '',
    ply: previewLine === hovered ? (previewPly ?? null) : null,
  }
  const peek = peekReplay ? peekFen(peekReplay, prefs, peekState) : null
  const peekLabel = peekReplay ? peekCaption(peekReplay, prefs, peekState, ply) : null

  return (
    <div
      className={cn(
        // TWO PANES DIVIDED BY A RULE, on the workspace's own canvas.
        //
        // They used to be two rounded cards floating on the column's ground with a gap
        // between them, which was the right answer while every panel on the screen was a
        // card. It is the wrong answer now: the screen is a matrix of panes bounded by
        // rules, and two cards floating inside one cell of it are the only things left that
        // do not belong to the grid. So the gap becomes a rule and the cards lose their
        // borders — the band's own bottom rule is `GamePage`'s.
        //
        // A quarter to Maia, three to the engine: Maia is single moves and a number, the
        // engine is whole variations, and an even split left the one half-empty while the
        // other wrapped. The quarter has a floor — a SAN, a percentage and a delta chip
        // side by side are about 9rem — so in a narrow column the engine's lines wrap a row
        // sooner rather than Maia's becoming ellipses. Below `md` a quarter of a phone is
        // 90 pixels, so the split is dropped and the two panes stack, Maia first, which is
        // the order they are read in on a desktop.
        //
        // No fixed height: the panes size to their content, and the grid stretches them to
        // the taller of the two so they still read as one band. The cap is a ceiling, not a
        // height — a five-line multi-PV with wrapping variations must not eat the move
        // table's room, and the pane that hits it scrolls. It comes off where the panes are
        // stacked, or it would be showing half of each.
        //
        // `relative` is for the peek board, which hangs off the bottom edge.
        'relative grid max-h-[18rem] min-w-0 flex-none bg-surface max-md:max-h-none',
        comparing
          ? 'grid-cols-1'
          : 'grid-cols-[minmax(9rem,1fr)_minmax(0,3fr)] max-md:grid-cols-1',
        className,
      )}
      data-testid="maia-panel"
    >
      {/*
        Each pane is a chrome title strip over a scrolling body, rather than one padded box
        with its heading as the first line inside it. The strip is the same 35 design pixels
        as the move table's and the notes track's tab rows directly below, so the four
        headings across the workspace sit on one line — which is what makes the panes read
        as one instrument rather than as four boxes that happen to be adjacent.
      */}
      <section className="flex min-w-0 flex-col overflow-hidden">
        <div className="bb-pane-title flex-nowrap">
          <span className="size-1.5 flex-none rounded-full bg-brilliant" />
          {/*
            The visible label is the level itself, with the picker laid over it: the
            header has room for one reading of who this column speaks for, and "Maia
            1700" is that reading whether or not it can be changed.
          */}
          <LevelLabel
            rating={rating}
            levels={comparing ? [] : levels}
            onSelectLevel={onSelectLevel}
          />
          <div className="flex-1" />
          {showHuman && live ? <LivePill pending={live.pending} /> : null}
          {canCompare && onCompareChange ? (
            <CompareToggle on={compare} onChange={onCompareChange} />
          ) : null}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-[0.4375rem] py-1.5">
          {/* Switched off, the column holds its place and says nothing at all. */}
          {!showHuman ? null : comparing ? (
            <CompareGrid columns={comparison} onHoverMove={onHoverMove} onPlayLine={onPlayLine} />
          ) : human.length === 0 ? (
            <p className="px-1 py-1 text-[0.6875rem] text-dim">
              {live?.pending ? 'Reading this position…' : '–'}
            </p>
          ) : (
            // Tight rather than spaced: each row's own background is a measurement, and
            // measurements you compare by eye belong on one stack with nothing between them.
            <div className="flex flex-col gap-0.5">
              {human.map((move) => (
                <HumanRow
                  key={move.uci}
                  move={move}
                  onHoverMove={onHoverMove}
                  onPlay={onPlayLine ? () => onPlayLine([move.uci], 0) : undefined}
                />
              ))}
            </div>
          )}

          {showHuman && live && rollout.length > 0 ? (
            <Rollout rollout={rollout} ply={ply} onPlayLine={onPlayLine} />
          ) : null}
        </div>
      </section>

      {comparing ? null : (
        // The wider pane, and the one thing in this column that genuinely wants width: its
        // variations wrap rather than truncate, which is what the three quarters buy. The
        // rule down its left edge is the division between the human column and the engine's;
        // it comes off where the two stack, since a vertical rule between stacked panes
        // divides nothing.
        <section
          ref={linesRef}
          data-testid="maia-engine-lines"
          className="flex min-w-0 flex-col overflow-hidden border-l border-edge-strong max-md:border-t max-md:border-l-0"
        >
          <div className="bb-pane-title">
            <span
              className={cn(
                'size-1.5 flex-none rounded-full',
                run ? 'bg-accent-teal' : 'bg-edge-strong',
              )}
            />
            <span className="truncate text-[0.6875rem] font-semibold tracking-[0.02em] text-ink">
              {run?.engine ?? 'No engine run'}
            </span>
            {/*
              The label is the column's category, paired with the human column's own —
              never the run's protocol kind, which lives on the engines page.
            */}
            <div className="flex-1" />
            {run?.depth ? (
              <span className="font-mono text-[0.625rem] tabular text-dim">d{run.depth}</span>
            ) : null}
            {nodes !== '—' ? (
              <span className="font-mono text-[0.625rem] tabular text-dim">{nodes} nodes</span>
            ) : null}
            {run?.multipv ? (
              <span className="rounded-sm border border-edge px-[0.3125rem] py-px font-mono text-[0.625rem] tabular text-dim">
                MPV {run.multipv}
              </span>
            ) : null}
            {/*
              Both preview controls, and only here: the cycler for what hovering a line does
              and the gear for the rest of it. The live panel used to carry a second copy of
              each — two places to change one preference — and since the rebuild this card
              has the width to hold the pair without crowding the engine name.
            */}
            {onHoverLine ? <LinePreviewRowChip /> : null}
            {onHoverLine ? <LinePreviewSettingsButton /> : null}
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[0.4375rem] py-1.5">
          {engine.length === 0 ? (
            <p className="px-1 py-1 text-[0.6875rem] text-dim">–</p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {engine.map((line) => {
                const id = runLineId(line.multipv)
                // The preview's ply counts for this row only where the preview is on this
                // row; on any other it stands nowhere, and the tokens say so by staying
                // plain.
                const at = previewLine === id ? (previewPly ?? null) : null
                return (
                  <EngineRow
                    key={`${line.multipv}-${line.firstUci ?? 'x'}`}
                    line={line}
                    ply={ply}
                    id={id}
                    previewPly={at}
                    scrub={prefs.scrub}
                    onHoverMove={onHoverMove}
                    onHoverLine={onHoverLine}
                    onHovered={(row, over) =>
                      setHovered((current) => (over ? row : current === row ? null : current))
                    }
                    onPlayLine={onPlayLine}
                  />
                )
              })}
            </div>
          )}
          </div>
        </section>
      )}
      {peek ? (
        // `pointer-events-none`, so walking along the tokens never lands on the popover and
        // takes the hover — the row's own state has to survive it.
        <div className="pointer-events-none absolute right-3 top-full z-20 mt-1 flex flex-col items-center gap-1 rounded-md border border-edge bg-elevated p-1.5 shadow-lg">
          <MiniBoard
            fen={peek}
            orientation={orientation}
            size="7.5rem"
            label="Peek at the line"
          />
          {peekLabel ? (
            <span className="font-mono text-[0.59375rem] text-dim">{peekLabel}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Who the column speaks for, and the switch that changes it.
 *
 * A native `select` laid over the label rather than beside it: the header is one line at
 * 11px with a live pill and a compare toggle already on it, and a second visible control
 * would take the label's room. The label is what is read; the select is what is clicked,
 * and it brings the platform's own keyboard handling, its scroll and its disabled options
 * with it. A level the position has no data for is offered and disabled — the fix is a
 * fresh pass, and hiding it would make a level the owner configured look impossible.
 */
function LevelLabel({
  rating,
  levels,
  onSelectLevel,
}: {
  rating: string | null
  levels: MaiaLevelOption[]
  onSelectLevel?: (elo: number) => void
}) {
  const label = rating ? `Maia ${rating}` : 'Maia'
  const pickable = levels.length > 1 && onSelectLevel !== undefined
  if (!pickable) {
    return (
      <span className="flex-none whitespace-nowrap text-[0.6875rem] font-semibold tracking-[0.02em] text-ink">
        {label}
      </span>
    )
  }
  return (
    // `flex-none` and no truncation: the label is four digits and a word, and it was the
    // one thing on this row that ellipsised ("Maia 20…") while the spacer beside it still
    // had room to give. What yields in a narrow column is the spacer, never the name.
    <span
      data-testid="maia-level-picker"
      className="relative inline-flex flex-none items-center gap-0.5 rounded-[0.1875rem] hover:bg-raised"
    >
      <span className="whitespace-nowrap text-[0.6875rem] font-semibold tracking-[0.02em] text-ink">
        {label}
      </span>
      <ChevronDown className="size-2.5 flex-none text-faint" aria-hidden />
      <select
        aria-label="Maia level"
        title="Which level the human column speaks for"
        value={rating ?? ''}
        onChange={(event) => onSelectLevel(Number(event.target.value))}
        className="absolute inset-0 w-full cursor-pointer appearance-none opacity-0"
      >
        {/* A live answer from a fixed-weights build names no level; the box still has to
            have the value it is showing, or the platform picks one nobody asked for. */}
        {rating === null ? <option value="">Maia</option> : null}
        {levels.map((option) => (
          <option key={option.elo} value={String(option.elo)} disabled={!option.available}>
            {option.available ? String(option.elo) : `${option.elo} — re-analyse to add`}
          </option>
        ))}
      </select>
    </span>
  )
}

/** One level, or all of them side by side. */
function CompareToggle({ on, onChange }: { on: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      data-testid="maia-compare-toggle"
      aria-pressed={on}
      title={on ? 'Read one level at a time' : 'Compare the levels side by side'}
      aria-label={on ? 'Read one level at a time' : 'Compare the levels side by side'}
      onClick={() => onChange(!on)}
      className={cn(
        'inline-flex flex-none items-center rounded-sm border px-1 py-px',
        on
          ? 'border-brilliant/40 bg-brilliant/12 text-brilliant'
          : 'border-edge text-dim hover:border-edge-hover hover:text-soft',
      )}
    >
      <Columns3 className="size-3" aria-hidden />
    </button>
  )
}

/**
 * Every level's reading of one position, one column each.
 *
 * The columns are the comparison, so they are equal-width and read across: the same move on
 * the same row of two columns is the same move at two levels, and a move that is top at
 * 1100 and absent at 2000 is the answer to "was this a normal mistake" without a sentence
 * having to say so.
 */
function CompareGrid({
  columns,
  onHoverMove,
  onPlayLine,
}: {
  columns: MaiaComparisonColumn[]
  onHoverMove?: (uci: string | null) => void
  onPlayLine?: (ucis: string[], index: number) => void
}) {
  return (
    <div
      data-testid="maia-compare"
      className="grid min-w-0 gap-x-3"
      style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
    >
      {columns.map((column, index) => (
        <CompareColumn
          key={column.rating ?? `unnamed-${index}`}
          column={column}
          onHoverMove={onHoverMove}
          onPlayLine={onPlayLine}
        />
      ))}
    </div>
  )
}

function CompareColumn({
  column,
  onHoverMove,
  onPlayLine,
}: {
  column: MaiaComparisonColumn
  onHoverMove?: (uci: string | null) => void
  onPlayLine?: (ucis: string[], index: number) => void
}) {
  const played = column.played
  const listed = played !== null && column.moves.some((move) => move.uci === played.uci)

  return (
    <div
      data-testid="maia-compare-column"
      data-rating={column.rating ?? ''}
      className="flex min-w-0 flex-col gap-0.5"
    >
      <span className="truncate border-b border-line pb-1 font-mono text-[0.625rem] font-semibold text-brilliant">
        {column.rating ?? 'Maia'}
      </span>
      {column.moves.length === 0 ? (
        <span className="py-1 font-mono text-[0.625rem] text-dim">–</span>
      ) : (
        column.moves.map((move) => (
          <CompareRow
            key={move.uci}
            move={move}
            onHoverMove={onHoverMove}
            onPlay={onPlayLine ? () => onPlayLine([move.uci], 0) : undefined}
          />
        ))
      )}
      {/* The played move is on every column whether or not the level ranked it: a level
          that puts it seventh is exactly the level worth reading. */}
      {played && !listed ? (
        <div data-testid="maia-compare-played" className="mt-0.5 border-t border-line pt-0.5">
          <CompareRow
            move={played}
            onHoverMove={onHoverMove}
            onPlay={onPlayLine ? () => onPlayLine([played.uci], 0) : undefined}
          />
        </div>
      ) : null}
    </div>
  )
}

/** One move of one compare column: its rank at this level, the SAN, its share. */
function CompareRow({
  move,
  onHoverMove,
  onPlay,
}: {
  move: HumanMoveView
  onHoverMove?: (uci: string | null) => void
  onPlay?: () => void
}) {
  const verdict = glyphStyle(move.classification)
  const hue = verdict?.color ?? MAIA_HUE

  return (
    <button
      type="button"
      data-testid={move.played ? 'maia-compare-played-row' : 'maia-compare-row'}
      disabled={!onPlay}
      onClick={onPlay}
      onMouseEnter={() => onHoverMove?.(move.uci)}
      onMouseLeave={() => onHoverMove?.(null)}
      title={`Play ${move.san} on the analysis board`}
      className={cn(
        'relative flex w-full items-baseline gap-1 overflow-hidden rounded-[0.1875rem] border-l-2 px-1 py-px text-left',
        move.played ? null : 'border-transparent',
        onPlay ? 'hover:bg-raised' : 'cursor-default',
      )}
      style={move.played ? { borderLeftColor: hue, background: tint(hue, 7) } : undefined}
    >
      <span className="relative w-3 flex-none font-mono text-[0.59375rem] tabular text-faint">
        {move.rank}
      </span>
      <span
        className={cn(
          'relative min-w-0 flex-1 truncate font-mono text-[0.625rem]',
          verdict ? verdict.textClass : 'text-soft',
        )}
      >
        {move.san}
      </span>
      <span className="relative flex-none font-mono text-[0.59375rem] tabular text-dim">
        {move.probability === null ? '—' : `${Math.round(move.probability * 100)}%`}
      </span>
    </button>
  )
}

/** The header affordance that says these numbers were computed just now, not stored. */
function LivePill({ pending }: { pending: boolean }) {
  return (
    <span
      data-testid="maia-live"
      className="inline-flex flex-none items-center gap-1 rounded-sm border border-brilliant/30 bg-brilliant/10 px-1.5 py-px font-mono text-[0.59375rem] text-brilliant"
    >
      <span
        className={cn('size-1 rounded-full bg-brilliant', pending && 'animate-pulse')}
        aria-hidden
      />
      live
    </span>
  )
}

/**
 * One human move: the move, how often it is played, and what it costs. Three cells and
 * nothing else — a played-percentage bar of its own, an explanatory sentence under the list
 * and a "human model" sub-label were all cut: at a quarter of the column the bar was eating
 * the width the SAN needed, and the two labels were saying what the purple dot and the
 * level in the header already say.
 *
 * The percentage is the ROW'S OWN BACKGROUND, running the full height behind all three
 * cells. That is what makes it affordable here: a fill costs no width, where a bar column
 * cost ~3rem of the 9rem this card has. A HARD stop and no fade — it is a measurement, and
 * two rows have to be comparable by eye, which a gradient tail makes impossible. The colour
 * is always Maia's own purple (`--bb-brilliant`, restated by `:root.light`, so 26% reads as
 * a mark rather than an artefact on either ground) and never the verdict's: the verdict is
 * the engine speaking and belongs to the SAN and the delta chip, while the fill is the one
 * quantity on this card that is Maia's alone.
 */
function HumanRow({
  move,
  onHoverMove,
  onPlay,
}: {
  move: HumanMoveView
  onHoverMove?: (uci: string | null) => void
  onPlay?: () => void
}) {
  const verdict = glyphStyle(move.classification)
  const hue = verdict?.color ?? MAIA_HUE
  const share = Math.min(100, Math.max(0, (move.probability ?? 0) * 100))
  const stop = `${share.toFixed(1)}%`

  return (
    <button
      type="button"
      data-testid={move.played ? 'maia-played-row' : 'maia-row'}
      disabled={!onPlay}
      onClick={onPlay}
      onMouseEnter={() => onHoverMove?.(move.uci)}
      onMouseLeave={() => onHoverMove?.(null)}
      title={`Play ${move.san} on the analysis board`}
      className={cn(
        'flex w-full items-baseline gap-2 rounded-[0.25rem] border-l-2 px-1.5 py-[0.1875rem] text-left',
        move.played ? null : 'border-transparent',
        // The fill is an inline background, and an inline background beats any
        // `hover:bg-*`, so the hover affordance is an inset ring instead — which also
        // leaves the measurement itself untouched by the pointer.
        onPlay ? 'hover:inset-ring-1 hover:inset-ring-edge-hover' : 'cursor-default',
      )}
      style={{
        background: `linear-gradient(to right, ${tint(MAIA_HUE, 26)} 0 ${stop}, transparent ${stop})`,
        ...(move.played ? { borderLeftColor: hue } : null),
      }}
    >
      <span
        className={cn(
          'min-w-0 flex-1 truncate font-mono text-[0.6875rem]',
          verdict ? verdict.textClass : 'text-soft',
        )}
      >
        {move.san}
      </span>
      {/* The card's only quantity now, so it carries the weight the loss chip used to. */}
      <span className="w-[1.75rem] flex-none text-right font-mono text-[0.6875rem] tabular text-ink">
        {move.probability === null ? '—' : `${Math.round(move.probability * 100)}%`}
      </span>
      <DeltaChip move={move} />
    </button>
  )
}

/**
 * What the move costs, in the engine's terms: a win-percentage delta, the `!` glyph where
 * the engine's own top line is the move being described, and a cell that keeps its width
 * and draws nothing where the engine never ranked it — deliberately blank rather than a
 * flattering or damning guess, and blank without collapsing, so the column stays a column.
 *
 * Below 0.05 points the number is noise, so the glyph stands in for it; that is the same
 * threshold the move list uses, which is why a `??` here and a `??` there agree.
 */
function DeltaChip({ move }: { move: HumanMoveView }) {
  const verdict = glyphStyle(move.classification)
  const best = move.classification === 'best'
  const loss = move.loss !== null && move.loss >= 0.05 ? formatWinLoss(move.loss) : null
  const shown = best ? (verdict?.glyph ?? '!') : loss

  return (
    <span
      className={cn(
        'w-[2.75rem] flex-none rounded-[0.1875rem] border px-1 py-px font-mono text-[0.59375rem] tabular',
        best ? 'text-center font-bold' : 'text-right',
        shown === null ? 'border-transparent' : verdict ? '' : 'border-line text-dim',
      )}
      style={
        shown === null || !verdict
          ? undefined
          : best
            ? {
                color: verdict.color,
                background: tint(verdict.color, 14),
                borderColor: 'transparent',
              }
            : { color: verdict.color, borderColor: tint(verdict.color, 30) }
      }
    >
      {shown ?? ''}
    </span>
  )
}

/**
 * One engine line: its eval, then the whole variation, wrapped. Clicking the Nth move puts
 * the analysis board just after it, with the rest of the line kept to walk through.
 *
 * A played move is only drawn in its own colour when the engine had something against it:
 * playing the top line is not a warning, and `best` is a compliment, so only the flagged
 * classifications tint the row.
 *
 * Hovering it reports the whole line where the surface draws one (`onHoverLine`) and the
 * single pale arrow where it does not (`onHoverMove`) — never both, or the arrow would sit
 * underneath the preview describing the same move twice.
 */
function EngineRow({
  line,
  ply,
  id,
  previewPly,
  scrub,
  onHoverMove,
  onHoverLine,
  onHovered,
  onPlayLine,
}: {
  line: EngineLineView
  ply: number
  /** This row's identity for the preview — namespaced, see `runLineId`. */
  id: string
  /** The ply the preview stands on within *this* line, or null when it is elsewhere. */
  previewPly: number | null
  /** Whether pointing at a token is worth reporting: something has to scrub to it. */
  scrub: boolean
  onHoverMove?: (uci: string | null) => void
  onHoverLine?: (state: HoveredLine | null) => void
  /** The pointer entering (`true`) or leaving this row, for the panel's peek board. */
  onHovered?: (id: string, over: boolean) => void
  onPlayLine?: (ucis: string[], index: number) => void
}) {
  const verdict = line.played && isFlagged(line.classification) ? glyphStyle(line.classification) : null
  // A row whose PV never replayed has no line to preview and no ply to point at — the
  // appended "played" row of a position the engine could not walk. It reports nothing
  // rather than an empty line, which the preview would have to degrade to nothing anyway.
  const previewing = onHoverLine && line.pv.length > 0 ? onHoverLine : null
  const scrubbing = previewing && scrub ? previewing : null

  return (
    <div
      data-testid={line.played ? 'engine-played-line' : undefined}
      onMouseEnter={() => {
        if (previewing) {
          onHovered?.(id, true)
          previewing({ line: id, ply: null, pv: line.pv })
          return
        }
        if (!onHoverLine) onHoverMove?.(line.firstUci)
      }}
      onMouseLeave={() => {
        if (previewing) {
          onHovered?.(id, false)
          previewing(null)
          return
        }
        if (!onHoverLine) onHoverMove?.(null)
      }}
      title={line.text || plyLabel(ply)}
      className={cn(
        'flex items-baseline gap-1.5 rounded-[0.25rem] px-1 py-[0.1875rem]',
        verdict ? null : 'hover:bg-raised',
      )}
      style={verdict ? { background: tint(verdict.color, 6) } : undefined}
    >
      <span
        className={cn(
          'min-w-[2.5rem] flex-none rounded-[0.1875rem] px-1 py-px text-right font-mono text-[0.625rem] tabular',
          verdict ? '' : line.multipv === 1 ? 'bg-cell-strong text-ink-2' : 'bg-cell text-body-3',
        )}
        style={verdict ? { background: tint(verdict.color, 13), color: verdict.color } : undefined}
      >
        {formatScore(line.score)}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1 gap-y-0.5">
        {line.sans.length === 0 ? (
          <span className="font-mono text-[0.6875rem] text-soft">—</span>
        ) : (
          line.sans.map((san, index) => {
            const k = index + 1
            return (
              <span key={`${index}-${san}`} className="inline-flex items-baseline gap-1">
                <PlyNumber ply={ply + index} first={index === 0} />
                <MoveButton
                  san={san}
                  ply={k}
                  className={cn(
                    // The verdict belongs to the move that was played, which is the first one.
                    index === 0 ? verdict?.textClass : undefined,
                    // Where the preview stands, and what it has already walked past — the
                    // live panel's own classes, so the two boxes look like one feature.
                    previewPly !== null && k === previewPly
                      ? 'bg-selected text-accent-teal'
                      : previewPly !== null && k < previewPly
                        ? 'text-faint-2'
                        : null,
                  )}
                  onHoverPly={
                    scrubbing
                      ? (at) => scrubbing({ line: id, ply: at, pv: line.pv })
                      : undefined
                  }
                  onPlay={onPlayLine ? () => onPlayLine(line.pv, index) : undefined}
                />
              </span>
            )
          })
        )}
      </div>
      {line.played ? (
        <span
          className={cn(
            'flex-none rounded-[0.1875rem] border px-1 py-px font-mono text-[0.59375rem]',
            verdict ? '' : 'border-edge text-dim',
          )}
          style={
            verdict ? { borderColor: tint(verdict.color, 35), color: verdict.color } : undefined
          }
        >
          played
        </span>
      ) : null}
    </div>
  )
}

/**
 * The rollout: what two humans at this level would most likely play from here. Clicking a
 * move puts the analysis board just after it and keeps the rest to walk, re-querying from
 * wherever the board stands — the line is a suggestion to walk into, not a verdict.
 */
function Rollout({
  rollout,
  ply,
  onPlayLine,
}: {
  rollout: MaiaMove[]
  ply: number
  onPlayLine?: (ucis: string[], index: number) => void
}) {
  return (
    <div
      data-testid="maia-rollout"
      className="flex flex-col gap-1 border-t border-line pt-[0.4375rem]"
    >
      <span className="font-mono text-[0.59375rem] uppercase tracking-[0.04em] text-faint">
        likely continuation
      </span>
      <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5">
        {rollout.map((move, index) => (
          <span key={`${index}-${move.uci}`} className="inline-flex items-baseline gap-1">
            <PlyNumber ply={ply + index} first={index === 0} />
            <MoveButton
              san={move.san}
              onPlay={
                onPlayLine
                  ? () => onPlayLine(rollout.map((step) => step.uci), index)
                  : undefined
              }
            />
            {move.probability === null ? null : (
              <span className="font-mono text-[0.59375rem] tabular text-faint">
                {Math.round(move.probability * 100)}%
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  )
}

/** `12.` for White; Black gets a number only where the line starts on it. */
function PlyNumber({ ply, first }: { ply: number; first: boolean }) {
  if (ply % 2 === 1 && !first) return null
  return (
    <span className="font-mono text-[0.59375rem] tabular text-faint">
      {Math.floor(ply / 2) + 1}
      {ply % 2 === 0 ? '.' : '…'}
    </span>
  )
}

/**
 * One move of a line. `ply` and `onHoverPly` are what make it a token a preview can point
 * at: the number beside it is punctuation between moves, so the ply has to be named on the
 * move itself. The rollout passes neither and is the plain move it always was.
 */
function MoveButton({
  san,
  ply,
  className,
  onHoverPly,
  onPlay,
}: {
  san: string
  /** 1-based ply within its own line. */
  ply?: number
  className?: string
  /** The ply under the pointer, or null on leaving it for the row it sits in. */
  onHoverPly?: (at: number | null) => void
  onPlay?: () => void
}) {
  const onMouseEnter = onHoverPly && ply !== undefined ? () => onHoverPly(ply) : undefined
  // Off a token and back into the row: the row's own state, not the row's `mouseleave`,
  // which only fires when the pointer leaves the row entirely.
  const onMouseLeave = onHoverPly ? () => onHoverPly(null) : undefined
  if (!onPlay) {
    return (
      <span
        data-ply={ply}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className={cn('font-mono text-[0.6875rem] text-soft', className)}
      >
        {san}
      </span>
    )
  }
  return (
    <button
      type="button"
      data-ply={ply}
      onClick={onPlay}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        'rounded-[0.1875rem] font-mono text-[0.6875rem] text-soft hover:text-ink hover:underline',
        className,
      )}
    >
      {san}
    </button>
  )
}
