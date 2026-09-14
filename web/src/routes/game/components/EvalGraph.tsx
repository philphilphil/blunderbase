import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react'
import { Area, AreaChart, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts'

import { SideDot } from '@/components/badges/SideDot'
import type { Color } from '@/lib/api/types'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import { GLYPHS } from '@/lib/chess/classification'
import { formatScore } from '@/lib/chess/evaluation'
import { useWheelStep } from '@/lib/board/wheelStep'
import { cn } from '@/lib/utils'
import { useEvalGraphPrefs } from '@/lib/ui/evalGraphPrefs'
import { scaleMargin, scalePx } from '@/lib/ui/scale'

import {
  plyLabel,
  type CurvePoint,
  type GameAnalysisSummary,
  type MoveTimePoint,
  type PlayerAnalysisSummary,
} from '../gameModel'
import { PlotBars, PlotMarks, type PlotPoint } from './graphParts'
import { FILL_BLACK, FILL_WHITE } from './graphTokens'
import { MoveTimePlot, TimeTallies } from './MoveTimeGraph'
import { TAB, TAB_ON, TAB_ROW } from './paneTabs'

const AXIS = 50
const CURVE = 'var(--bb-text-2)'

const CONFIG: ChartConfig = { win: { label: <Trans>White</Trans>, color: CURVE } }

/** The pane's two readings of the game against ply: who was ahead, and who was thinking. */
export type GraphTab = 'eval' | 'time'

/**
 * A curve point split into the half above and the half below the axis, so each half can
 * carry its own fill. Points where the curve crosses the axis are synthesised (fractional
 * ply, no move) so the clamped halves meet exactly on the line instead of cutting the
 * corner.
 */
interface SeriesPoint extends CurvePoint {
  above: number
  below: number
}

function splitSeries(points: CurvePoint[]): SeriesPoint[] {
  const out: SeriesPoint[] = []
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (i > 0) {
      const q = points[i - 1]
      if ((q.win - AXIS) * (p.win - AXIS) < 0) {
        const t = (AXIS - q.win) / (p.win - q.win)
        const ply = q.ply + t * (p.ply - q.ply)
        // Synthesised, so it stands for no move and carries no score: the hover readout
        // skips it rather than naming a move that was never played.
        out.push({
          ply,
          win: AXIS,
          san: null,
          score: null,
          classification: null,
          above: AXIS,
          below: AXIS,
        })
      }
    }
    out.push({ ...p, above: Math.max(p.win, AXIS), below: Math.min(p.win, AXIS) })
  }
  return out
}

/**
 * White's win percentage against ply, drawn either as a column per move or as the filled
 * curve from design 1a, with blunders and mistakes marked where they happened and a dashed
 * teal cursor on the ply the board is showing.
 *
 * Who is ahead is said by colour, not by a caption: White's tone stands above the 50 %
 * axis and Black's below it, with a side dot pinned to each edge of the plot as the key.
 * Which of the two shapes draws that is a per-browser preference (`lib/ui/evalGraphPrefs`,
 * set from the gear under the board) and nothing else in here changes with it — the same
 * data, scales, hover readout, cursor and marks either way. Bars are the default because a
 * column that starts on the axis and reaches toward a side names that side by pointing at
 * it, where the filled curve leaves over half the plot as a third grey belonging to nobody
 * and asks the reader to hold the convention in their head.
 *
 * A mark is the move table's `??` or `?` (`PlotMarks`), a plain disc, or nothing, as the
 * same preference says. Whose it was is already told by the direction the curve jumps, so
 * the mark does not repeat it; "only mine" hides the opponent's marks for going over one's
 * own game.
 *
 * The accuracy tallies ride on the header line as two per-player clusters (`PlayerTally`)
 * rather than in a grid down the plot's flank, which is what gives the curve the card's
 * full width. Clicking anywhere on the plot still jumps the board to that ply.
 *
 * It carries no height of its own any more: it fills whatever the row it sits in gives it
 * — a track-spanning row of the right column on the desktop, a fixed box on the phone —
 * with only a small floor under the plot so it can never collapse to a line.
 *
 * Given `time`, the pane has a second tab, Move time: the same plies as columns of seconds
 * (`MoveTimePlot`), with the clock's own tallies in the accuracy tallies' place. Two
 * readings of one game against one x scale, so the cursor and a click land on the same
 * ply on either — and the marks stay on both, because whether a blunder came after a long
 * think or in a hurry is the question the second tab is for. The tab is the pane's own
 * state: nothing else on the page changes with it. A game with no clocks has no tab row.
 */
export function EvalGraph({
  points,
  plyCount,
  cursor,
  ownerSide,
  analysisSummary,
  playerNames,
  onSelectPly,
  scrub = false,
  time,
  tab: controlledTab,
  onTabChange,
  className,
}: {
  /**
   * Which reading is up, when the page holds it — the game view does, so `V` and `T` can
   * switch it from the keyboard. Left out, the pane keeps its own.
   */
  tab?: GraphTab
  onTabChange?: (tab: GraphTab) => void
  points: CurvePoint[]
  plyCount: number
  /**
   * The clock's reading of the same game (`moveTimes`), or nothing for a game played
   * without one. Empty points are the same as nothing: the tab is not offered.
   */
  time?: { points: MoveTimePoint[]; increment: number; flagged: Color | null } | null
  /** The ply last played; `-1` for the starting position. */
  cursor: number
  /** The side the owner played; `null` for a game no account claims a side of. */
  ownerSide: Color | null
  /** Lichess-style totals and ACPL for both players, shown on the header line. */
  analysisSummary?: GameAnalysisSummary | null
  /**
   * Both players' names, for the header tallies. Optional: without them the clusters fall
   * back to You/Opponent, or to White/Black in a game no account claims a side of.
   */
  playerNames?: Partial<Record<Color, string | null>>
  onSelectPly: (ply: number) => void
  /**
   * Follow a finger dragged across the plot, not just a tap. Off by default, and only the
   * phone layout turns it on: a mouse already gets this for free — the click handler below
   * reads the position recharts tracked on hover — and a touchscreen laptop that started
   * scrubbing the desktop curve would be a behaviour change nobody asked for.
   */
  scrub?: boolean
  className?: string
}) {
  const domain = useMemo<[number, number]>(
    () => [points[0]?.ply ?? -1, Math.max(points[points.length - 1]?.ply ?? 0, plyCount - 1)],
    [points, plyCount],
  )
  const series = useMemo(() => splitSeries(points), [points])
  // The columns and the marks read one shape off the curve: the ply, how far from the
  // axis, and what the move was filed as.
  const plotPoints = useMemo<PlotPoint[]>(
    () => points.map((p) => ({ ply: p.ply, value: p.win, classification: p.classification })),
    [points],
  )
  // The shape this browser reads the balance in. Bars unless the reader asked for the
  // curve; the split series is computed either way because it is what the tooltip and the
  // marks index against, and it costs one pass over a list the length of a game.
  const prefs = useEvalGraphPrefs()
  const bars = prefs.style === 'bars'
  // Start focused on the owner's mistakes; the checkbox can still reveal both players'
  // markers without changing the two-player tallies on the header line.
  const [onlyMine, setOnlyMine] = useState(true)
  const markedSide = onlyMine && ownerSide ? ownerSide : null
  // Which reading is up. Only offered where the clock has something to say. Switching it
  // changes nothing outside this pane, but the game view holds it anyway so a key can.
  const timed = (time?.points.length ?? 0) > 0
  const [ownTab, setOwnTab] = useState<GraphTab>('eval')
  const tab = controlledTab ?? ownTab
  const setTab = (next: GraphTab) => (onTabChange ? onTabChange(next) : setOwnTab(next))
  const onTime = timed && tab === 'time'
  const { t } = useLingui()

  // Wheeling over the curve walks the game, exactly as wheeling over the board does — same
  // hook, so the same flick moves the same distance whichever of the two the pointer is over.
  // The curve is a map of the game line, so a step here is a plain seek: `onStep`'s business
  // is analysis branches, and there are none on this plot.
  const plot = useRef<HTMLDivElement>(null)
  useWheelStep(plot, { cursor, onSeek: onSelectPly })

  return (
    <section
      className={cn(
        // A pane, not a card: the workspace bounds it with rules (`GamePage` draws the one
        // above it), and like every other pane on the screen it is a chrome strip over a
        // body. The strip is the tab row the move table and the notes track wear — the
        // same 35 design pixels, the same pushed-up surface for the tab that is on — so
        // switching between the two readings of the game is the gesture the reader already
        // knows from the panes above.
        'flex min-h-0 flex-col bg-surface',
        className,
      )}
    >
      <div role="tablist" aria-label={t`Graph`} className={TAB_ROW}>
        <GraphTabs tab={tab} timed={timed} onTabChange={setTab} />
        <span className="flex-1" />
        {ownerSide ? (
          <label className="inline-flex cursor-pointer select-none items-center gap-1 text-[0.625rem] text-dim">
            <input
              type="checkbox"
              checked={onlyMine}
              onChange={(e) => setOnlyMine(e.target.checked)}
              className="size-2.5 accent-accent"
            />
            <Trans>only mine</Trans>
          </label>
        ) : null}
      </div>

      <div
        className={cn(
          'grid min-h-0 flex-1 gap-x-3 gap-y-[0.21875rem] px-3 pt-1.5 pb-1.5',
          // Wide enough, the tallies stand to the left in one column — a player per row —
          // and the plot takes the whole height beside them. Narrow, there is no room for
          // a rail without halving the chart, so the two stack instead. One element either
          // way: it is placed, not duplicated.
          'grid-cols-1 grid-rows-[auto_minmax(0,1fr)]',
          '[grid-template-areas:"tallies"_"plot"]',
          'md:grid-cols-[auto_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)]',
          'md:[grid-template-areas:"tallies_plot"]',
        )}
      >
      {onTime && time ? (
        <TimeTallies
          points={time.points}
          flagged={time.flagged}
          ownerSide={ownerSide}
          playerNames={playerNames}
        />
      ) : analysisSummary ? (
        <PlayerTallies
          summary={analysisSummary}
          ownerSide={ownerSide}
          playerNames={playerNames}
        />
      ) : null}

      {onTime && time ? (
        <div
          ref={plot}
          data-testid="move-time-plot"
          className="relative min-h-[2.875rem] min-w-0 [grid-area:plot]"
        >
          <MoveTimePlot
            points={time.points}
            increment={time.increment}
            plyCount={plyCount}
            cursor={cursor}
            side={markedSide}
            marks={prefs.marks}
            onSelectPly={onSelectPly}
            scrub={scrub}
          />
        </div>
      ) : points.length === 0 ? (
        <div className="flex min-h-[2.875rem] min-w-0 items-center justify-center rounded-md border border-dashed border-edge-strong bg-graph-bg text-center text-[0.6875rem] text-dim [grid-area:plot]">
          <Trans>No evaluations yet — run an analysis pass to draw the curve.</Trans>
        </div>
      ) : (
        <div
          ref={plot}
          data-testid="evaluation-plot"
          className="relative min-h-[2.875rem] min-w-0 [grid-area:plot]"
        >
          {/* The key to the fills: white's half is the top, black's the bottom. Pinned outside
              the chart so recharts never re-layouts around them. */}
          <SideDot side="white" size="sm" className="pointer-events-none absolute left-1 top-1 z-10" />
          <SideDot side="black" size="sm" className="pointer-events-none absolute bottom-1 left-1 z-10" />
          <ChartContainer
            config={CONFIG}
            className="h-full w-full aspect-auto rounded-md bg-graph-bg [&_.recharts-surface]:cursor-crosshair"
          >
            <AreaChart
              data={series}
              margin={scaleMargin({ top: 4, right: 0, bottom: 2, left: 0 })}
              onClick={(state: { activeLabel?: string | number }) => {
                const label = Number(state?.activeLabel)
                // A synthesised axis crossing has a fractional ply; land on the nearest move.
                if (Number.isFinite(label)) onSelectPly(Math.round(label))
              }}
              // Dragging along the curve walks the game under the finger. recharts hands the
              // same state to both, so a tap (which ends in a click) and a drag land on the
              // ply the same way.
              onTouchMove={
                scrub
                  ? (state: { activeLabel?: string | number }) => {
                      const label = Number(state?.activeLabel)
                      if (Number.isFinite(label)) onSelectPly(Math.round(label))
                    }
                  : undefined
              }
            >
              {/* Hidden, not gone: the numeric ply scale is what click-to-seek and the
                  cursor line position against. The move numbers it used to print said
                  nothing the move table doesn't, and their row goes to the plot. */}
              {/* `cursor` off: the dashed line marking where the board stands is already on
                  the plot, and a second vertical line following the pointer would read as a
                  second claim about where the reader is. */}
              <Tooltip
                content={<CurveReadout />}
                cursor={false}
                isAnimationActive={false}
                allowEscapeViewBox={{ x: false, y: true }}
                offset={12}
                wrapperStyle={{ outline: 'none', zIndex: 20 }}
              />
              <XAxis dataKey="ply" type="number" domain={domain} hide />
              <YAxis type="number" domain={[0, 100]} hide />

              <ReferenceLine y={75} stroke="var(--bb-graph-grid)" strokeWidth={1} />
              <ReferenceLine y={25} stroke="var(--bb-graph-grid)" strokeWidth={1} />
              {/* Between the quarter lines and the axis on purpose: the columns cover the
                  grid the way the fills do, and the axis they stand on stays on top. */}
              {bars ? (
                <PlotBars points={plotPoints} axis={AXIS} domain={domain} testId="evaluation-bars" />
              ) : null}
              <ReferenceLine y={AXIS} stroke="var(--bb-graph-axis)" strokeWidth={1} />
              {cursor >= -1 ? (
                <ReferenceLine
                  x={cursor}
                  stroke="var(--bb-accent)"
                  strokeWidth={1}
                  strokeDasharray="2 3"
                  ifOverflow="extendDomain"
                />
              ) : null}

              {/* The two half-fills carry no stroke of their own: clamped to the axis, their
                  outline would run flat along it. The third draws the curve — and in bars
                  mode is kept, stripped of stroke and fill, purely as what the hover readout
                  reads its payload from. */}
              {bars ? null : (
                <Area type="linear" dataKey="above" baseValue={AXIS} stroke="none" fill={FILL_WHITE} isAnimationActive={false} dot={false} activeDot={false} />
              )}
              {bars ? null : (
                <Area type="linear" dataKey="below" baseValue={AXIS} stroke="none" fill={FILL_BLACK} isAnimationActive={false} dot={false} activeDot={false} />
              )}
              <Area
                type="linear"
                dataKey="win"
                baseValue={AXIS}
                stroke={bars ? 'none' : CURVE}
                strokeWidth={scalePx(1.6)}
                strokeLinejoin="round"
                fill="none"
                isAnimationActive={false}
                activeDot={false}
                dot={false}
              />
              {/* Last, so a mark is never under a fill or a column. */}
              <PlotMarks
                points={plotPoints}
                axis={AXIS}
                side={markedSide}
                marks={prefs.marks}
                testId="evaluation-marks"
              />
            </AreaChart>
          </ChartContainer>
        </div>
      )}
      </div>
    </section>
  )
}

/**
 * Evaluation | Move time, as the tabs of the pane's strip — `NotesTrack`'s Notes | Book
 * exactly, and for the same reason: one way of switching a pane's reading across the
 * screen. A game with no clocks has the one tab, drawn selected, which is the strip's own
 * title for the pane; a label in some other type would be the one strip that did not
 * match the row of them.
 */
function GraphTabs({
  tab,
  timed,
  onTabChange,
}: {
  tab: GraphTab
  /** Whether the clock has anything to show; off, Move time is not offered at all. */
  timed: boolean
  onTabChange: (tab: GraphTab) => void
}) {
  const tabs: { tab: GraphTab; label: ReactNode }[] = [
    { tab: 'eval', label: <Trans>Evaluation</Trans> },
    ...(timed ? [{ tab: 'time' as const, label: <Trans>Move time</Trans> }] : []),
  ]
  return (
    <>
      {tabs.map(({ tab: which, label }) => {
        const selected = tab === which || !timed
        return (
          <button
            key={which}
            type="button"
            role="tab"
            aria-selected={selected}
            data-testid={`graph-tab-${which}`}
            onClick={() => onTabChange(which)}
            className={cn(TAB, selected && TAB_ON)}
          >
            {label}
          </button>
        )
      })}
    </>
  )
}

/**
 * The three counts a tally prints, worst first, each as `count` + the glyph the move table
 * already uses for it. The glyphs are what make two whole players fit on one header line;
 * the words they stand for are spelled out in the group's accessible name.
 */
type TallyField = 'blunder' | 'mistake' | 'inaccuracy'

/**
 * The count and the word for it, as one message per severity.
 *
 * Deliberately not a plural rule: the tally reads "1 mistakes" today, and these strings are
 * a translation pass over the screen rather than a rewording of it. A translator whose
 * language needs the count to pick the noun's form has the count in the message.
 */
const TALLY_QUANTITIES: Record<TallyField, (count: number) => MessageDescriptor> = {
  blunder: (count) => msg`${count} blunders`,
  mistake: (count) => msg`${count} mistakes`,
  inaccuracy: (count) => msg`${count} inaccuracies`,
}

/** Spoken worst-first; visual row-major order produces the two requested columns. */
const TALLY_A11Y: readonly TallyField[] = ['blunder', 'mistake', 'inaccuracy']
const TALLY_LAYOUT: readonly TallyField[] = ['blunder', 'inaccuracy', 'mistake']

/**
 * What the pointer is over: which move, and what the engine made of the position after it.
 *
 * Only ever one line — this is a readout, not a panel. The curve already says roughly where
 * the game stood; the number is the thing a pointer is asking for, and the move number is
 * what makes it findable in the table beside it, which is where the move itself and its
 * verdict are read — the mark is already on the plot under the pointer. Synthesised axis
 * crossings carry no move and are skipped rather than drawn as an empty box.
 */
function CurveReadout({ payload }: { payload?: { payload?: SeriesPoint }[] }) {
  const point = payload?.[0]?.payload
  if (!point || !Number.isInteger(point.ply)) return null
  return (
    <div className="pointer-events-none rounded-md border border-edge-strong bg-elevated px-2 py-1 text-[0.65625rem] whitespace-nowrap shadow-[0_0.25rem_0.75rem_var(--bb-shadow)]">
      <span className="font-mono tabular text-dim">
        {point.ply < 0 ? (
          <Trans comment="Stands in for a move number at the starting position">start</Trans>
        ) : (
          plyLabel(point.ply)
        )}
      </span>{' '}
      <span className="font-mono tabular text-body-3">{formatScore(point.score)}</span>
    </div>
  )
}

/** White first, always: it is the half of the curve above the axis, and the dots say so. */
const TALLY_SIDES: readonly Color[] = ['white', 'black']

/**
 * Both players' tallies, side by side on the header line.
 *
 * They stay two-player whatever "only mine" is set to — that checkbox hides the opponent's
 * *marks* on the plot, not the arithmetic of the game, and a count that changed with it
 * would be read as a different game rather than a different filter.
 */
function PlayerTallies({
  summary,
  ownerSide,
  playerNames,
}: {
  summary: GameAnalysisSummary
  ownerSide: Color | null
  playerNames?: Partial<Record<Color, string | null>>
}) {
  const { i18n } = useLingui()

  return (
    <div
      data-testid="player-summaries"
      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 [grid-area:tallies] md:flex-col md:flex-nowrap md:items-stretch md:justify-center md:gap-2.5"
    >
      {TALLY_SIDES.map((side) => (
        <PlayerTally
          key={side}
          side={side}
          name={playerNames?.[side] || i18n._(tallyName(side, ownerSide))}
          row={summary[side]}
        />
      ))}
    </div>
  )
}

const SIDE_NAMES: Record<Color, MessageDescriptor> = {
  white: msg`White`,
  black: msg`Black`,
}

/** Who a player is to the owner, for the game that names nobody. */
function tallyName(side: Color, ownerSide: Color | null): MessageDescriptor {
  if (!ownerSide) return SIDE_NAMES[side]
  return side === ownerSide ? msg`You` : msg`Opp.`
}

/**
 * One player's accuracy cluster: side dot · name · `5?? 2? 5?!` · ACPL, on a quiet ground.
 *
 * The side dot is doing two jobs. It is the same mark the board's player rows carry, so a
 * name and a dot identify the same person in both places; and it says which half of the
 * curve is theirs — white fills above the axis, black below — so nobody has to work out
 * whose number is whose. That is the whole reason for two labelled groups: an earlier
 * version printed "5 vs 2" three times in a row and could not be read at a glance.
 */
function PlayerTally({
  side,
  name,
  row,
}: {
  side: Color
  name: string
  row: PlayerAnalysisSummary
}) {
  const { t, i18n } = useLingui()
  const quantity = (field: TallyField) => i18n._(TALLY_QUANTITIES[field](row[field]))
  const acpl = row.acpl
  const acplProse =
    acpl === null ? t`average centipawn loss unavailable` : t`${acpl} average centipawn loss`
  const counts = TALLY_A11Y.map(quantity).join(', ')

  return (
    <div
      role="group"
      aria-label={t`${name}: ${counts}, ${acplProse}`}
      className="flex min-w-0 flex-col items-center gap-[0.15625rem] text-[0.65625rem]"
    >
      <span className="flex min-w-0 max-w-full items-center gap-1.5">
        <SideDot side={side} size="sm" />
        <span className="min-w-0 truncate text-body-3">{name}</span>
      </span>
      {/*
        Lichess's shape, in this app's vocabulary: a count and what it counts, the counts in
        a column of their own so they line up under each other and the eye can compare two
        players down the page. What Lichess spells out in words is a glyph here — the same
        `??`/`?`/`?!` the move table uses, which is shorter than the word and already the
        thing the reader has been clicking on all game. ACPL keeps its four letters: it is
        the one figure with no mark of its own, and it is already the compact form.
      */}
      <span className="grid grid-cols-[auto_1fr_auto_1fr] items-baseline gap-x-[0.3125rem] gap-y-[0.09375rem]">
        {TALLY_LAYOUT.map((field) => (
          <Fragment key={field}>
            {/*
              A zero keeps the severity's own colour. It used to grey out, on the theory
              that nothing happened and nothing should be shouted about — but the three
              counts are read as one row, and a greyed cell breaks the colour key the eye
              is using to tell `??` from `?!` at a glance. What says "none" is the digit.
            */}
            <span
              title={quantity(field)}
              className={cn('text-right font-mono font-semibold tabular', GLYPHS[field].textClass)}
            >
              {row[field]}
            </span>
            <span className={cn('font-mono font-bold opacity-75', GLYPHS[field].textClass)}>
              {GLYPHS[field].glyph}
            </span>
          </Fragment>
        ))}
        <span className="text-right font-mono tabular text-body-3">{row.acpl ?? '—'}</span>
        <span title={t`Average centipawn loss`} className="font-mono text-dim">
          <Trans comment="Abbreviation of “average centipawn loss”, beside the number itself">
            ACPL
          </Trans>
        </span>
      </span>
    </div>
  )
}

