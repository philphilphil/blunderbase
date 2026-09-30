import { Trans, useLingui } from '@lingui/react/macro'
import { Square, User } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { AnalyseButton, type AnalyseButtonProps } from '@/components/analysis/AnalyseButton'
import { LiveLinesChip, useLiveSetup } from '@/components/analysis/AnalysisControls'
import {
  LiveSearchLines,
  LiveSearchMeta,
  LiveSearchStatus,
} from '@/components/analysis/InfiniteAnalysisPanel'
import { LinePreviewRowChip } from '@/components/analysis/LinePreviewSettings'
import { MiniBoard } from '@/components/board/MiniBoard'
import { Readout } from '@/components/ui/badge'
import { PickerSelect, type PickerSelectOption } from '@/components/ui/native-select'
import { liveLineId, type StreamSessionApi } from '@/lib/analysis'
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
import { formatNodes, formatScore } from '@/lib/chess/evaluation'
import { useNotation } from '@/lib/chess/notationPrefs'
import { cn } from '@/lib/utils'

import {
  type EngineLineView,
  type HumanMoveView,
  type MaiaComparisonColumn,
  type MaiaLevelOption,
  type MaiaMove,
} from '../gameModel'
import { usePlyLabel, usePlyNumbering, usePlyOffset } from '../plyNumbering'
import { PANE_TOOL, STRIP_RULE } from './paneTabs'
import { PaneTab, PaneTabList } from './PaneTabList'

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
  /**
   * The same switch for the engine column, and the reason both exist. `hints` is one
   * gesture — "do not tell me the answer yet" — and an answer is an answer whichever
   * engine gives it, so the two columns go quiet together. They used to disagree: the
   * human column vanished with the hints and Stockfish's lines stayed, which read as a
   * bug in the toggle rather than as a rule about what a hint is.
   */
  showEngine?: boolean
  /** The engine's ranking of the same position; empty off the game line. */
  engine: EngineLineView[]
  /**
   * Whether those rows are the run's own line seen from further along it rather than its
   * reading of the position itself — see `GamePage`'s `alongLine`. The rows are the same
   * shape either way; what changes is what they are a claim about, and the header says so
   * rather than letting a walked line pass for a fresh search of this position.
   */
  alongLine?: boolean
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
  /**
   * The live search, when it shares the engine pane behind a Run | Live switch. The tab is
   * the page's state, not the panel's: the page moves it when the search is switched on or
   * off and when the board leaves the game line, and the panel only reports a click.
   */
  search?: EnginePaneSearch
  /**
   * The Analyse… button's state, drawn at the end of the title strip on the Run tab. Left
   * out where nothing can be queued — a model game nobody has added to the library.
   */
  analyse?: Omit<AnalyseButtonProps, 'variant'>
  className?: string
}

/** Which of the engine pane's two claims is showing: the stored run's, or the live search's. */
export type EnginePaneTab = 'run' | 'live'

export interface EnginePaneSearch {
  stream: StreamSessionApi
  tab: EnginePaneTab
  onTabChange: (tab: EnginePaneTab) => void
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
 * The engine column's rows are previewed the way the live search's are, and for the same
 * reasons (`LiveSearchLines`): the **row** asks where the line goes, a **token** asks
 * what the position looks like after that one move, and the **wheel** walks that ply along
 * without the pointer having to hit each token. The panel only reports them; what any of
 * them draws is the surface's business.
 *
 * With `search` given, the engine pane is two claims behind one switch, Run | Live: what
 * the stored pass concluded, and what a search is finding now. They used to be two boxes,
 * the run here and the search at the foot of the column, and a reader with the search on
 * had two lists of lines for one position four rows apart with only the board saying which
 * won. One pane, and the tab says which claim is on it; the Live tab is also the search's
 * start and stop (`EnginePaneTabs`), so everything right of the tabs belongs to the claim
 * on show and nothing on the strip is shared between the two. The search's two pickers
 * are the strip's own readings of them — the engine's name and the line-count chip, each
 * with its select laid over it, where the run's tab shows the run's name and its MPV.
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
  showEngine = true,
  engine,
  alongLine = false,
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
  search,
  analyse,
  className,
}: MaiaPanelProps) {
  const { t } = useLingui()
  const onLive = search?.tab === 'live'
  const rollout = live?.rollout ?? []
  const nodes = formatNodes(run?.nodes)
  const comparing = showHuman && compare && comparison.length > 1
  // The toggle stays offered while compare is on even with nothing to compare here, so a
  // position with one level is never a position the reader cannot get out of.
  const canCompare = onCompareChange !== undefined && (comparison.length > 1 || compare)

  const prefs = useLinePreviewPrefs()
  const notate = useNotation()
  // The live rows and the peek caption are shared components that number from ply 0 as
  // White's first move; a game set up from a position (Black to move, move 30) is shifted
  // by its offset, so they are handed the ply counted the way the move list counts it.
  const numberedPly = ply + usePlyOffset()
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
  // the room is downwards. The live rows are in the same scroll container, so their peek is
  // drawn here too (`LiveSearchLines` is told not to), found by the id they report.
  const peeked =
    onHoverLine && hovered !== null && prefs.row === 'peek' && fen
      ? onLive
        ? (search?.stream.snapshot?.lines.find((line) => liveLineId(line.multipv) === hovered) ??
          null)
        : (engine.find((line) => runLineId(line.multipv) === hovered) ?? null)
      : null
  const peekReplay = peeked && fen ? cachedReplay(fen, peeked.pv) : null
  const peekState = {
    line: hovered ?? '',
    ply: previewLine === hovered ? (previewPly ?? null) : null,
  }
  const peek = peekReplay ? peekFen(peekReplay, prefs, peekState) : null
  const peekLabel = peekReplay ? peekCaption(peekReplay, prefs, peekState, numberedPly, notate) : null

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
        // Under a quarter to Maia, the rest to the engine: Maia is single moves and a
        // number, the engine is whole variations, and an even split left the one half-empty
        // while the other wrapped. Maia's share has a floor — "Maia 1500 ⇅" on the strip, and
        // a SAN, a percentage and a delta chip in a row, are about 8.25rem (it was 9rem while
        // a compare toggle shared the strip) — so in a narrow column the engine's lines wrap
        // a row sooner rather than Maia's becoming ellipses. Below `md` a quarter of a phone is
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
          : 'grid-cols-[minmax(8.25rem,22%)_minmax(0,1fr)] max-md:grid-cols-1',
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
        {/* A container, because this column is usually at its floor: there the "live" word
            leaves and the pulsing dot inside the level picker says it instead, so the picker
            is never the thing pushed off. */}
        <div className="bb-pane-title @container flex-nowrap gap-1 px-1.5">
          {/*
            The visible label is the level itself, as a strip picker: the header has room
            for one reading of who this column speaks for, and "Maia 1700" is that reading
            whether or not it can be changed. Comparing every level is one more value of
            the same choice ("All levels, side by side"), not an unlabelled toggle beside it.
          */}
          <LevelLabel
            rating={rating}
            levels={levels}
            onSelectLevel={onSelectLevel}
            // The setting, not whether a grid is drawn: with compare on and one level here the
            // picker still says so, so the reader can see how to get back out of it.
            compare={showHuman && compare}
            onCompareChange={canCompare ? onCompareChange : undefined}
            pulse={showHuman && !!live?.pending}
          />
          <div className="flex-1" />
          {showHuman && live ? <LivePill pending={live.pending} /> : null}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-[0.4375rem] py-1.5">
          {/* Switched off, the column holds its place and says nothing at all. */}
          {!showHuman ? null : comparing ? (
            <CompareGrid columns={comparison} onHoverMove={onHoverMove} onPlayLine={onPlayLine} />
          ) : human.length === 0 ? (
            <p className="px-1 py-1 text-data text-dim">
              {live?.pending ? <Trans>Reading this position…</Trans> : '–'}
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
          {/* A container, so the readouts on the strip can give way by the strip's own
              width rather than the window's: this pane is narrow at widths where the screen
              is not, and it is the switch at the end that must survive (`LiveSearchMeta`). */}
          {/* The strip's order is the grammar's: tabs │ facts … │ tools (spec §3.3). The
              facts say what the pane is showing; the tools after the rule act on it. */}
          <div className="bb-pane-title @container gap-1 pr-2">
            {search ? (
              <>
                <EnginePaneTabs search={search} hasRun={!!run} />
                <span aria-hidden className={cn(STRIP_RULE, 'mx-1')} />
              </>
            ) : null}
            {onLive && search ? (
              // The name it draws is the engine picker, the way the Maia level is its own.
              <LiveSearchStatus stream={search.stream} dot={false} pick />
            ) : run && !run.engine ? null : (
              // A fact about the pane, not a heading competing with the tabs: the run's
              // engine in body, "No engine run" in the quieter soft. A run that names no
              // engine says nothing here rather than "No engine run" over its own lines.
              <span
                className={cn(
                  'min-w-0 shrink truncate text-label',
                  run ? 'text-body' : 'text-soft',
                )}
              >
                {run?.engine ?? t`No engine run`}
              </span>
            )}
            {/* The run's MPV, a flat readout: a fact of the run that cannot be changed here.
                It leaves a strip under 20rem (the pane at 1280), after the Arrows word, so
                the Analyse button at the end is never the thing pushed off. */}
            {!onLive && run?.multipv ? (
              <Readout num className="ml-1 flex-none @max-[20rem]:hidden">
                MPV {run.multipv}
              </Readout>
            ) : null}
            {/* The analysis board's own purple, the colour the score chip under the board
                takes while it is reading the same line: these rows are the tail of a line
                the run drew, not a new opinion about the position in front of you. A
                readout, so a borderless tint. */}
            {alongLine && !onLive ? (
              <span
                data-testid="maia-engine-along-line"
                title={t`The rest of the line this run gave, from where the board now stands`}
                className="flex-none rounded-sm bg-brilliant/10 px-[0.3125rem] py-px text-meta text-brilliant"
              >
                <Trans>along its line</Trans>
              </span>
            ) : null}
            {/* The spacer and the readouts are one element, and the only one on the strip
                that yields: it takes what is left and clips its own contents, so when the
                pane runs out of width the numbers go and the tools after them stay where a
                hand expects them. */}
            <div className="flex min-w-0 flex-1 items-center justify-end gap-2 overflow-hidden">
              {onLive && search ? (
                <LiveSearchMeta stream={search.stream} />
              ) : (
                <>
                  {/* The limit the run stopped each move at, whichever of the three it was:
                      a run from the Analyse dialog carries one, an import pass nodes. */}
                  {run?.depth ? <Readout num className="flex-none">d{run.depth}</Readout> : null}
                  {run?.seconds ? (
                    <Readout num className="flex-none">
                      <Trans>{run.seconds}s a move</Trans>
                    </Readout>
                  ) : null}
                  {nodes !== '—' ? (
                    <Readout num className="flex-none @max-[30rem]:hidden">
                      <Trans>{nodes} nodes</Trans>
                    </Readout>
                  ) : null}
                </>
              )}
            </div>
            {(onLive && search) || onHoverLine || (analyse && !onLive) ? (
              <span aria-hidden className={cn(STRIP_RULE, 'mx-1')} />
            ) : null}
            {/* The search's line count, on Live: a picker, since it can be changed. */}
            {onLive && search ? <LiveLinesChip stream={search.stream} /> : null}
            {/*
              What hovering a line does. The gear that held the rest of those settings is
              under the board (`components/board/BoardSettings`), where a reader actually
              meets it; this stays because it belongs to the rows right below it.
            */}
            {onHoverLine ? <LinePreviewRowChip compact={onLive || 'narrow'} /> : null}
            {/*
              The stored run's verb, on the Run tab only: on Live the readouts beside it are
              the search's, and a button there would seem to act on them.
            */}
            {analyse && !onLive ? <AnalyseButton {...analyse} variant="strip" /> : null}
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[0.4375rem] py-1.5">
          {onLive && search ? (
            <>
              <LiveSearchLines
                stream={search.stream}
                fen={fen ?? null}
                ply={numberedPly}
                orientation={orientation}
                onHoverMove={onHoverMove}
                onHoverLine={onHoverLine}
                // The wheel is this section's: its listener above covers the live rows as
                // well as the run's, and a second one on the rows would step twice.
                onStepPreview={undefined}
                onPlayLine={onPlayLine}
                previewLine={previewLine}
                previewPly={previewPly}
                peek={false}
                onHovered={(row, over) =>
                  setHovered((current) => (over ? row : current === row ? null : current))
                }
                // The Live tab starts the search; this is the way back in once it stopped.
                onStart={() => search.stream.setEnabled(true)}
              />
            </>
          ) : /* Switched off, the column holds its place and says nothing at all — the same
              rule the human column beside it follows. */
          !showEngine ? null : engine.length === 0 ? (
            <p className="px-1 py-1 text-data text-dim">–</p>
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
            label={t`Peek at the line`}
          />
          {peekLabel ? (
            <span className="font-mono text-meta text-dim">{peekLabel}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Run | Live, the engine pane's tabs: the same folder tabs as every other pane strip
 * (`PaneTabList`), sibling `role=tab` buttons with nothing else in the group.
 *
 * Each tab carries a dot only where the dot says something — the run's when there is a run
 * to go back to, the search's green pulse while it runs — so a reader on the Run tab can see
 * the search is still going without switching to it.
 *
 * Clicking Live starts the search when none is running (the host's `onTabChange`): a Live
 * pane with nothing in it but a Start button only ever asked for a second click. Stopping
 * is not a tab's job — that would make Run a stop, and the reader may want to read the
 * stored lines while the search keeps going — so while it runs a Stop tool stands beside
 * the tabs, reachable from either. The setup dialog for a missing engine rides here,
 * because this strip is where the search's controls are.
 */
function EnginePaneTabs({
  search,
  hasRun,
}: {
  search: EnginePaneSearch
  /** Whether a stored run speaks for this game: only then does the Run tab carry its dot. */
  hasRun: boolean
}) {
  const { t } = useLingui()
  const dialog = useLiveSetup(search.stream)
  const { phase, enabled } = search.stream
  // A status dot on a tab only where it says something: green (alive) while the search
  // runs, orange while it opens, red on an error; nothing while it is off. The run's dot
  // is the steady quiet one, and only when there is a run to go back to.
  const liveDot =
    phase === 'running'
      ? 'animate-pulse bg-good'
      : phase === 'opening'
        ? 'bg-mistake'
        : phase === 'error'
          ? 'bg-blunder'
          : null
  return (
    <>
      {dialog}
      <PaneTabList label={t`Engine`} className="-ml-2.5 flex-none">
        <PaneTab
          selected={search.tab === 'run'}
          onSelect={() => search.onTabChange('run')}
          data-testid="engine-pane-tab-run"
          // A notch tighter than a plain pane tab: this is the tightest strip on the screen.
          className="px-2"
        >
          {hasRun ? <span aria-hidden className="size-1.5 flex-none rounded-full bg-dim" /> : null}
          {t`Run`}
        </PaneTab>
        <PaneTab
          selected={search.tab === 'live'}
          onSelect={() => search.onTabChange('live')}
          data-testid="engine-pane-tab-live"
          title={t`What the engine finds in this position now`}
          className="px-2"
        >
          {liveDot ? (
            <span aria-hidden className={cn('size-1.5 flex-none rounded-full', liveDot)} />
          ) : null}
          {t`Live`}
        </PaneTab>
      </PaneTabList>
      {/*
        Stop sits beside the tabs, not in one, and is here from either tab while the search
        runs. Starting is the Live tab itself (and `E`), so an idle strip holds no ▷
        between the tabs and the facts.
      */}
      {enabled ? (
        <button
          type="button"
          // Named in full: the practice bar has a Stop of its own on the same screen.
          aria-label={t`Stop live analysis`}
          title={t`Stop live analysis (E)`}
          data-testid="engine-pane-live-stop"
          onClick={() => search.stream.setEnabled(false)}
          className={cn(PANE_TOOL, 'ml-0.5 self-center hover:text-blunder')}
        >
          <Square className="size-3" fill="currentColor" strokeWidth={0} aria-hidden />
        </button>
      ) : null}
    </>
  )
}

/**
 * The little figure after the level: this column is what PEOPLE play here.
 *
 * "Maia 1700" reads as an engine name to anyone who has not been told otherwise, and an
 * engine name at the head of a list of moves means "the best moves" everywhere else in
 * chess software — which is the opposite of what this column says. The figure is the
 * cheapest possible correction, in the column's own purple so it belongs to the heading
 * rather than looking like a control, and it carries the sentence in its title for anyone
 * who hovers it.
 */
function HumanMark() {
  const { t } = useLingui()
  return (
    <span
      role="img"
      aria-label={t`human moves`}
      title={t`What people at this level actually play here — not the engine’s best move`}
      className="inline-flex flex-none items-center"
    >
      <User className="size-2.5 text-brilliant" aria-hidden />
    </span>
  )
}

/** The level picker's value for "every level, side by side". */
const COMPARE = 'compare'

/**
 * Who the column speaks for, and the picker that changes it.
 *
 * A strip picker (docs/design/README.md, "Controls"): the level is a value picked from a
 * list, so it wears the picker's ⇅ and, in a strip of quiet text, no face until it is
 * pointed at or focused. The native `select` is laid over it, so it brings the platform's
 * own keyboard handling, its scroll and its disabled options with it. Maia's purple key dot
 * sits inside the face, the way a collection's colour sits inside its picker.
 *
 * Comparing is a value of the same choice ("All levels, side by side"), because "which
 * level" and "all of them" answer one question. It used to be a 26×18 bordered toggle
 * beside the label that nobody could name; folding it in gives the Maia column its width
 * back. A level the position has no data for is offered and disabled — the fix is a fresh
 * pass, and hiding it would make a level the owner configured look impossible.
 */
function LevelLabel({
  rating,
  levels,
  onSelectLevel,
  compare,
  onCompareChange,
  pulse,
}: {
  rating: string | null
  levels: MaiaLevelOption[]
  onSelectLevel?: (elo: number) => void
  /** The column shows every level side by side. */
  compare: boolean
  /** Given, the list offers "All levels, side by side". */
  onCompareChange?: (next: boolean) => void
  /** The dot pulses while a live read of the position is in flight. */
  pulse: boolean
}) {
  const { t } = useLingui()
  // "Maia" is the model's name and the number is its level, so the label is the same in
  // every language — nothing here is a word.
  const label = rating ? `Maia ${rating}` : 'Maia'
  const pickLevels = levels.length > 1 && onSelectLevel !== undefined
  const pickable = pickLevels || onCompareChange !== undefined
  const dot = (
    <span
      aria-hidden
      className={cn(
        'size-1.5 flex-none rounded-full bg-brilliant',
        pulse && '@max-[12rem]:animate-pulse',
      )}
    />
  )
  const shown = (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      {compare ? t`All levels` : label}
      <HumanMark />
    </span>
  )
  if (!pickable) {
    return (
      <span className="inline-flex flex-none items-center gap-1.5 px-1.5 text-label font-medium text-ink">
        {dot}
        {shown}
      </span>
    )
  }
  // A live answer from a fixed-weights build names no level; the box still has to have the
  // value it is showing, or the platform picks one nobody asked for.
  const options: PickerSelectOption<string>[] = rating === null ? [{ value: '', label: 'Maia' }] : []
  if (pickLevels) {
    for (const option of levels) {
      // Named, because the number is the placeholder a translator sees in the message.
      const elo = option.elo
      options.push({
        value: String(elo),
        label: option.available ? `Maia ${elo}` : t`${elo} — re-analyse to add`,
        disabled: !option.available,
      })
    }
  } else if (rating !== null) {
    options.push({ value: rating, label })
  }
  if (onCompareChange) options.push({ value: COMPARE, label: t`All levels, side by side` })
  return (
    // `flex-none` and no truncation: the label is four digits and a word, and it was the
    // one thing on this row that ellipsised ("Maia 20…") while the spacer beside it still
    // had room to give. What yields in a narrow column is the spacer, never the name.
    <PickerSelect
      testId="maia-level-picker"
      label={t`Maia level`}
      title={t`Which level the human column speaks for`}
      size="strip"
      hideLabel
      leading={dot}
      display={shown}
      value={compare ? COMPARE : (rating ?? '')}
      options={options}
      onChange={(next) => {
        if (next === COMPARE) {
          onCompareChange?.(true)
          return
        }
        if (compare) onCompareChange?.(false)
        if (next !== '' && onSelectLevel) onSelectLevel(Number(next))
      }}
      className="flex-none"
    />
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
      <span className="truncate border-b border-line pb-1 font-mono text-label font-semibold text-brilliant">
        {column.rating ?? 'Maia'}
      </span>
      {column.moves.length === 0 ? (
        <span className="py-1 font-mono text-data text-dim">–</span>
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
  const { t } = useLingui()
  const notate = useNotation()
  const verdict = glyphStyle(move.classification)
  const hue = verdict?.color ?? MAIA_HUE
  const san = notate(move.san)

  return (
    <button
      type="button"
      data-testid={move.played ? 'maia-compare-played-row' : 'maia-compare-row'}
      disabled={!onPlay}
      onClick={onPlay}
      onMouseEnter={() => onHoverMove?.(move.uci)}
      onMouseLeave={() => onHoverMove?.(null)}
      title={t`Play ${san} on the analysis board`}
      className={cn(
        'relative flex w-full items-baseline gap-1 overflow-hidden rounded-sm border-l-2 px-1 py-px text-left',
        move.played ? null : 'border-transparent',
        onPlay ? 'hover:bg-raised' : 'cursor-default',
      )}
      // The played mark is the neutral edge `HumanRow` uses (an accent edge reads as a
      // selected row); the verdict's hue stays in the faint tint behind it.
      style={
        move.played
          ? { borderLeftColor: 'var(--bb-muted)', background: tint(hue, 7) }
          : undefined
      }
    >
      <span className="relative w-3 flex-none font-mono text-meta text-dim-2">
        {move.rank}
      </span>
      <span
        className={cn(
          'relative min-w-0 flex-1 truncate font-mono text-data',
          verdict ? verdict.textClass : 'text-body',
        )}
      >
        {san}
      </span>
      <span className="relative flex-none font-mono text-meta text-dim">
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
      className="inline-flex flex-none items-center gap-1 rounded-sm bg-brilliant/10 px-1.5 py-px text-meta text-brilliant @max-[12rem]:hidden"
    >
      <span
        className={cn('size-1 rounded-full bg-brilliant', pending && 'animate-pulse')}
        aria-hidden
      />
      <Trans comment="Pill saying these numbers were computed just now, not read from the run">live</Trans>
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
  const { t } = useLingui()
  const notate = useNotation()
  const verdict = glyphStyle(move.classification)
  const flagged = isFlagged(move.classification)
  const share = Math.min(100, Math.max(0, (move.probability ?? 0) * 100))
  const stop = `${share.toFixed(1)}%`
  const san = notate(move.san)

  return (
    <button
      type="button"
      data-testid={move.played ? 'maia-played-row' : 'maia-row'}
      disabled={!onPlay}
      onClick={onPlay}
      onMouseEnter={() => onHoverMove?.(move.uci)}
      onMouseLeave={() => onHoverMove?.(null)}
      title={t`Play ${san} on the analysis board`}
      className={cn(
        'flex w-full items-baseline gap-2 rounded-md border-l-2 px-1.5 py-[0.1875rem] text-left',
        move.played ? null : 'border-transparent',
        // The fill is an inline background, and an inline background beats any
        // `hover:bg-*`, so the hover affordance is an inset ring instead — which also
        // leaves the measurement itself untouched by the pointer.
        onPlay ? 'hover:inset-ring-1 hover:inset-ring-edge-hover' : 'cursor-default',
      )}
      style={{
        background: `linear-gradient(to right, ${tint(MAIA_HUE, 26)} 0 ${stop}, transparent ${stop})`,
        // The played mark is a neutral edge. It had taken the verdict's hue, and for a best
        // move that hue is the accent: an accent bar on a tinted row is exactly the
        // selected-row mark, so the played move read as selected.
        ...(move.played ? { borderLeftColor: 'var(--bb-muted)' } : null),
      }}
    >
      <span
        className={cn(
          // A move nobody flagged is still the thing being read, so `body`, not `soft`. The
          // SAN takes a colour only for a flagged move (never the accent, which is a link
          // or a selection); a good verdict lives in the `!` chip, as in the move list.
          'min-w-0 flex-1 truncate font-mono text-data',
          verdict && flagged ? verdict.textClass : verdict ? 'text-ink' : 'text-body',
        )}
      >
        {san}
      </span>
      {/* The card's only quantity now, so it carries the weight the loss chip used to.
          2rem holds "100%" in the mono at this size. */}
      <span className="w-[2rem] flex-none text-right font-mono text-data text-ink">
        {move.probability === null ? '—' : `${Math.round(move.probability * 100)}%`}
      </span>
      <DeltaChip move={move} />
    </button>
  )
}

/**
 * The engine's verdict on the move, as the one glyph the move table already uses: `!` for
 * its own top line, `??`/`?`/`?!` for the three it flags, and nothing at all for an
 * ordinary move.
 *
 * IT USED TO BE THE WIN-PERCENTAGE DELTA — `−26.3%` — with the glyph standing in only for
 * the best move. That was a second quantity on a row whose whole subject is the *first*
 * one: how many people play this move. The two percentages sat side by side reading as a
 * pair, and the one that mattered was the human one; the engine's is already on the row
 * three ways over (the SAN's colour, the row's left edge, the engine column's own eval a
 * few pixels to the right), so what the number added was arithmetic to skip past.
 *
 * The glyph is drawn in a cell that shrink-wraps it inside a slot of fixed width. The slot
 * keeps the column a column — two rows' SANs and percentages have to line up under each
 * other — while the chip itself is only as wide as a `!`, which is what stops one
 * character from being painted across three-quarters of an inch of tint.
 */
function DeltaChip({ move }: { move: HumanMoveView }) {
  const verdict = glyphStyle(move.classification)
  const best = move.classification === 'best'

  return (
    <span className="flex w-[1.5rem] flex-none justify-end">
      {verdict ? (
        <span
          title={verdict.label}
          className={cn(
            'rounded-sm border px-[0.1875rem] py-px text-center font-mono text-label font-bold',
            best ? 'border-transparent' : '',
          )}
          style={
            best
              ? { color: verdict.color, background: tint(verdict.color, 14) }
              : { color: verdict.color, borderColor: tint(verdict.color, 30) }
          }
        >
          {verdict.glyph}
        </span>
      ) : null}
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
  const plyLabel = usePlyLabel()
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
        'flex items-baseline gap-1.5 rounded-md px-1 py-[0.1875rem]',
        verdict ? null : 'hover:bg-raised',
      )}
      style={verdict ? { background: tint(verdict.color, 6) } : undefined}
    >
      <span
        className={cn(
          'min-w-[3.25rem] flex-none rounded-sm px-1 py-px text-right font-mono text-label font-semibold tabular',
          verdict ? '' : line.multipv === 1 ? 'bg-cell-strong text-ink-2' : 'bg-cell text-body-3',
        )}
        style={verdict ? { background: tint(verdict.color, 13), color: verdict.color } : undefined}
      >
        {formatScore(line.score)}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1 gap-y-0.5">
        {line.sans.length === 0 ? (
          <span className="font-mono text-data text-dim">—</span>
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
                    // The top line is the one being read, so `ink`; the others `body`.
                    line.multipv === 1 ? 'text-ink' : 'text-body',
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
      {/* A readout, flat: it states a fact about the row, and a border made it read as a
          button. A flagged played move keeps its verdict's colour on the word. */}
      {line.played ? (
        <Readout
          className="flex-none"
          style={verdict ? { color: verdict.color } : undefined}
        >
          <Trans comment="Chip marking the engine row for the move the game actually played">played</Trans>
        </Readout>
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
      <span className="text-meta uppercase tracking-[.06em] text-dim-2">
        <Trans>likely continuation</Trans>
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
              <span className="font-mono text-meta text-dim-2">
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
  const numbering = usePlyNumbering()
  const white = numbering.side(ply) === 'white'
  if (!white && !first) return null
  return (
    <span className="font-mono text-meta text-dim-2">
      {numbering.moveNumber(ply)}
      {white ? '.' : '…'}
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
  const notate = useNotation()
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
        className={cn('font-mono text-data text-body', className)}
      >
        {notate(san)}
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
        'rounded-sm font-mono text-data text-body hover:text-ink hover:underline',
        className,
      )}
    >
      {notate(san)}
    </button>
  )
}
