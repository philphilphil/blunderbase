import { Fragment, useMemo, useRef, useState } from 'react'
import {
  Area,
  AreaChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
  usePlotArea,
  useXAxisScale,
  useYAxisScale,
} from 'recharts'

import { SideDot } from '@/components/badges/SideDot'
import type { Color } from '@/lib/api/types'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import { GLYPHS, glyphFor } from '@/lib/chess/classification'
import { formatScore } from '@/lib/chess/evaluation'
import { useWheelStep } from '@/lib/board/wheelStep'
import { cn } from '@/lib/utils'
import { useEvalGraphPrefs, type EvalGraphMarks } from '@/lib/ui/evalGraphPrefs'
import { scaleMargin, scalePx } from '@/lib/ui/scale'

import {
  barLayout,
  plyLabel,
  type CurvePoint,
  type GameAnalysisSummary,
  type PlayerAnalysisSummary,
} from '../gameModel'

const AXIS = 50
const CURVE = 'var(--bb-text-2)'
/**
 * Flat, opaque fills, one per side: white above the axis and black below it, read against
 * the mid-grey plot ground (`--bb-graph-bg`) — lichess's treatment, and the reason that
 * ground is its own token rather than the pane's surface.
 *
 * They used to be mixed down to 55 % / 85 % against a background that was nearly the same
 * value as the fill in each theme, which left both halves as tints of the ground and the
 * curve doing all the work. Solid, the side that is winning is legible at a glance from
 * across the desk, which is the whole job of this chart.
 */
const FILL_WHITE = 'var(--bb-side-white)'
const FILL_BLACK = 'var(--bb-side-black)'
/** Only the bars wear these: a rim is what keeps a black column from reading as a hole. */
const EDGE_WHITE = 'var(--bb-side-white-edge)'
const EDGE_BLACK = 'var(--bb-side-black-edge)'
const GRAPH_BG = 'var(--bb-graph-bg)'
/** The design marks — and its legend explains — only these two. */
type MarkedGlyph = 'blunder' | 'mistake'

/** The classification as a mark on the plot, or nothing for the plies that carry none. */
function markFor(classification: CurvePoint['classification']): MarkedGlyph | null {
  const glyph = glyphFor(classification)
  return glyph === 'blunder' || glyph === 'mistake' ? glyph : null
}

const CONFIG: ChartConfig = { win: { label: 'White', color: CURVE } }

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

/** Even plies are White's moves — `plyLabel` prints them as `N.`, odd ones as `N…`. */
function mover(ply: number): 'white' | 'black' {
  return ply % 2 === 0 ? 'white' : 'black'
}

/**
 * The default shape: one column per ply, standing on the 50 % axis and reaching up in
 * White's tone or down in Black's.
 *
 * It exists because the filled curve asks the reader to remember a convention — which of
 * three greys is the ground, and which half of the axis belongs to whom — while a column
 * says it by pointing. Every ply also becomes its own object, which is the honest picture
 * of what the data is: the engine's verdict after each move, not a continuous quantity.
 *
 * Drawn by hand off the chart's own scales rather than through `<Bar>`, because recharts
 * sizes bars from a *category* axis and this one is numeric (ply is a number so that
 * click-to-seek and the cursor line can position against it). `usePlotArea` and the two
 * scale hooks are recharts 3's supported way in — the same coordinates the areas use, so
 * the marks on top land on the bar tips without a second calculation.
 *
 * How wide a column is drawn at all is `barLayout`, in the model beside the curve it is
 * drawn from: it is the one part of this with a rule rather than a shape, and a rule is
 * worth a test.
 */
function PlyBars({ points, domain }: { points: CurvePoint[]; domain: [number, number] }) {
  const plot = usePlotArea()
  const xScale = useXAxisScale()
  const yScale = useYAxisScale()
  if (!plot || !xScale || !yScale) return null

  const baseline = yScale(AXIS)
  if (baseline === undefined) return null

  const { width, rim } = barLayout(plot.width, domain[1] - domain[0] + 1)

  return (
    <g data-testid="evaluation-bars">
      {points.map((point) => {
        const x = xScale(point.ply)
        const y = yScale(point.win)
        if (x === undefined || y === undefined) return null
        const white = point.win >= AXIS
        return (
          <rect
            key={point.ply}
            x={x - width / 2}
            y={Math.min(y, baseline)}
            width={width}
            height={Math.max(1, Math.abs(y - baseline))}
            rx={width >= 3 ? 1 : 0}
            fill={white ? FILL_WHITE : FILL_BLACK}
            stroke={rim ? (white ? EDGE_WHITE : EDGE_BLACK) : undefined}
            strokeWidth={rim ? 0.75 : undefined}
          />
        )
      })}
    </g>
  )
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
 * A mark is the move table's `??` or `?` (`CurveMarks`), a plain disc, or nothing, as the
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
  className,
}: {
  points: CurvePoint[]
  plyCount: number
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
  // The shape this browser reads the balance in. Bars unless the reader asked for the
  // curve; the split series is computed either way because it is what the tooltip and the
  // marks index against, and it costs one pass over a list the length of a game.
  const prefs = useEvalGraphPrefs()
  const bars = prefs.style === 'bars'
  // Start focused on the owner's mistakes; the checkbox can still reveal both players'
  // markers without changing the two-player tallies on the header line.
  const [onlyMine, setOnlyMine] = useState(true)
  const markedSide = onlyMine && ownerSide ? ownerSide : null

  // Wheeling over the curve walks the game, exactly as wheeling over the board does — same
  // hook, so the same flick moves the same distance whichever of the two the pointer is over.
  // The curve is a map of the game line, so a step here is a plain seek: `onStep`'s business
  // is analysis branches, and there are none on this plot.
  const plot = useRef<HTMLDivElement>(null)
  useWheelStep(plot, { cursor, onSeek: onSelectPly })

  return (
    <div
      className={cn(
        // A pane, not a card: the workspace bounds it with rules (`GamePage` draws the one
        // above it) and it carries the padding the card's border used to imply. The plot,
        // the tallies, the "only mine" control and every scrubbing gesture are untouched —
        // only the frame around them changed.
        'grid min-h-0 gap-x-3 gap-y-[0.21875rem] bg-surface px-3 pt-2 pb-1.5',
        // Wide enough, everything that is not the curve stands to its left in one column —
        // the title and its checkbox, then a player per row — and the plot takes the whole
        // height beside them. The title deliberately does NOT span: a full-width header row
        // pushes the tallies down a line and costs the chart that line twice over, which is
        // the opposite of what this card is short of.
        //
        // Narrow, there is no room for a rail without halving the chart, so the three parts
        // stack instead. One element either way: it is placed, not duplicated.
        'grid-cols-1 grid-rows-[auto_auto_minmax(0,1fr)]',
        '[grid-template-areas:"head"_"tallies"_"plot"]',
        'md:grid-cols-[auto_minmax(0,1fr)] md:grid-rows-[auto_minmax(0,1fr)]',
        'md:[grid-template-areas:"head_plot"_"tallies_plot"]',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 [grid-area:head]">
        <span className="flex items-center gap-2">
          <span className="text-[0.6875rem] font-medium text-soft">Evaluation</span>
          {ownerSide ? (
            <label className="inline-flex cursor-pointer select-none items-center gap-1 text-[0.625rem] text-dim">
              <input
                type="checkbox"
                checked={onlyMine}
                onChange={(e) => setOnlyMine(e.target.checked)}
                className="size-2.5 accent-accent"
              />
              only mine
            </label>
          ) : null}
        </span>
      </div>

      {analysisSummary ? (
        <PlayerTallies
          summary={analysisSummary}
          ownerSide={ownerSide}
          playerNames={playerNames}
        />
      ) : null}

      {points.length === 0 ? (
        <div className="flex min-h-[2.875rem] min-w-0 items-center justify-center rounded-md border border-dashed border-edge-strong bg-graph-bg text-center text-[0.6875rem] text-dim [grid-area:plot]">
          No evaluations yet — run an analysis pass to draw the curve.
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
              {bars ? <PlyBars points={points} domain={domain} /> : null}
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
              <CurveMarks points={points} side={markedSide} marks={prefs.marks} />
            </AreaChart>
          </ChartContainer>
        </div>
      )}
    </div>
  )
}

/**
 * The three counts a tally prints, worst first, each as `count` + the glyph the move table
 * already uses for it. The glyphs are what make two whole players fit on one header line;
 * the words they stand for are spelled out in the group's accessible name.
 */
type TallyField = 'blunder' | 'mistake' | 'inaccuracy'

const TALLY_PLURALS: Record<TallyField, string> = {
  blunder: 'blunders',
  mistake: 'mistakes',
  inaccuracy: 'inaccuracies',
}

/** Spoken worst-first; visual row-major order produces the two requested columns. */
const TALLY_A11Y: readonly TallyField[] = ['blunder', 'mistake', 'inaccuracy']
const TALLY_LAYOUT: readonly TallyField[] = ['blunder', 'inaccuracy', 'mistake']

/**
 * What the pointer is over: the move, and what the engine made of the position after it.
 *
 * Only ever one line — this is a readout, not a panel. The curve already says roughly where
 * the game stood; the number is the thing a pointer is asking for, and the move label is what
 * makes it findable in the table beside it. Synthesised axis crossings carry no move and are
 * skipped rather than drawn as an empty box.
 */
function CurveReadout({ payload }: { payload?: { payload?: SeriesPoint }[] }) {
  const point = payload?.[0]?.payload
  if (!point || !Number.isInteger(point.ply)) return null
  const mark = glyphFor(point.classification)
  const glyph = mark ? GLYPHS[mark] : null
  return (
    <div className="pointer-events-none rounded-md border border-edge-strong bg-elevated px-2 py-1 text-[0.65625rem] whitespace-nowrap shadow-[0_0.25rem_0.75rem_var(--bb-shadow)]">
      <span className="font-mono tabular text-dim">{plyLabel(point.ply)}</span>{' '}
      <span className={cn('font-mono', glyph ? glyph.textClass : 'text-ink')}>
        {point.san ?? 'start'}
        {glyph ? <span className="ml-[0.125rem] font-bold opacity-75">{glyph.glyph}</span> : null}
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
  return (
    <div
      data-testid="player-summaries"
      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 [grid-area:tallies] md:flex-col md:flex-nowrap md:items-stretch md:justify-center md:gap-2.5"
    >
      {TALLY_SIDES.map((side) => (
        <PlayerTally
          key={side}
          side={side}
          name={tallyName(side, ownerSide, playerNames?.[side])}
          row={summary[side]}
        />
      ))}
    </div>
  )
}

/** The player's own name when the game carries one, else who they are to the owner. */
function tallyName(side: Color, ownerSide: Color | null, name: string | null | undefined): string {
  if (name) return name
  if (!ownerSide) return side === 'white' ? 'White' : 'Black'
  return side === ownerSide ? 'You' : 'Opp.'
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
  const quantity = (count: number, plural: string) => `${count} ${plural}`
  const acplProse =
    row.acpl === null ? 'average centipawn loss unavailable' : `${row.acpl} average centipawn loss`

  return (
    <div
      role="group"
      aria-label={`${name}: ${TALLY_A11Y.map((field) => quantity(row[field], TALLY_PLURALS[field])).join(', ')}, ${acplProse}`}
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
              title={quantity(row[field], TALLY_PLURALS[field])}
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
        <span title="Average centipawn loss" className="font-mono text-dim">
          ACPL
        </span>
      </span>
    </div>
  )
}

/**
 * The ink a filled mark carries its glyph in. Only the two marked severities need one, and
 * both are the token the rest of the app uses for text on that colour — the pair flips with
 * the theme, because in light mode the fill is the dark half of the pair.
 */
const MARK_INK: Record<MarkedGlyph, string> = {
  blunder: 'var(--bb-blunder-ink)',
  mistake: 'var(--bb-mistake-ink)',
}

/**
 * Blunders and mistakes where they happened — the two the legend names; every other ply
 * draws nothing, and so does the opponent's when `side` narrows the marks to one player.
 *
 * The default mark is the move table's own `??` and `?` on a small filled tab, which is the
 * whole argument for it: a disc says *that* something happened here and leaves the severity
 * to a colour the reader has to have learnt, where the glyph says which it was in the
 * vocabulary they have been clicking on all game. It is louder, so all three settings are
 * offered — the tab, the plain disc, or a bare plot where a blunder is still visible as the
 * jump that produced it.
 *
 * Drawn as a layer off the chart's scales rather than as the curve's `dot`, because a tab
 * has to know where the walls are: it hangs outside the bar, away from the axis, and flips
 * to the inside when the plot's edge is nearer than the tab is tall. A dot renderer is
 * handed one point and no room to ask.
 *
 * No `<title>` on either shape: the plot's own hover readout already names the move, its
 * glyph and its eval, and a native SVG tooltip on top of that would be a second box saying
 * less, on its own delay, in the browser's font.
 */
function CurveMarks({
  points,
  side: only,
  marks,
}: {
  points: CurvePoint[]
  side: Color | null
  marks: EvalGraphMarks
}) {
  const plot = usePlotArea()
  const xScale = useXAxisScale()
  const yScale = useYAxisScale()
  if (!plot || !xScale || !yScale) return null

  const height = scalePx(11)
  const stem = scalePx(3)
  const floor = plot.y + plot.height
  if (marks === 'none') return null

  return (
    <g data-testid="evaluation-marks">
      {points.map((point) => {
        const glyph = markFor(point.classification)
        if (!glyph) return null
        if (only && mover(point.ply) !== only) return null
        const x = xScale(point.ply)
        const y = yScale(point.win)
        if (x === undefined || y === undefined) return null
        const colour = GLYPHS[glyph].color

        if (marks === 'dots') {
          return (
            <circle
              key={point.ply}
              cx={x}
              cy={y}
              r={scalePx(3)}
              fill={colour}
              stroke={GRAPH_BG}
              strokeWidth={scalePx(1.5)}
            />
          )
        }

        const label = GLYPHS[glyph].glyph
        const width = scalePx(label.length > 1 ? 15 : 11)
        // Outside the fill — up when White is ahead, down when Black is — unless that is
        // where the plot ends, in which case it hangs the other way.
        let top = point.win >= AXIS ? y - stem - height : y + stem
        if (top < plot.y) top = y + stem
        if (top + height > floor) top = y - stem - height
        top = Math.min(Math.max(top, plot.y), floor - height)
        // The tab stays whole at the ends of the game; the stem keeps the true ply.
        const cx = Math.min(Math.max(x, plot.x + width / 2), plot.x + plot.width - width / 2)
        return (
          <g key={point.ply}>
            <line
              x1={x}
              y1={y}
              x2={x}
              y2={top > y ? top : top + height}
              stroke={colour}
              strokeWidth={scalePx(1.2)}
            />
            <rect
              x={cx - width / 2}
              y={top}
              width={width}
              height={height}
              rx={scalePx(3)}
              fill={colour}
            />
            <text
              x={cx}
              y={top + height / 2}
              textAnchor="middle"
              dominantBaseline="central"
              className="font-mono font-bold"
              fontSize={scalePx(8.5)}
              fill={MARK_INK[glyph]}
            >
              {label}
            </text>
          </g>
        )
      })}
    </g>
  )
}
