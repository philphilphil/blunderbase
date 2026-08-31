import { Fragment, useMemo, useRef, useState } from 'react'
import { Area, AreaChart, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts'

import { SideDot } from '@/components/badges/SideDot'
import type { Color } from '@/lib/api/types'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import { GLYPHS, glyphFor, type Glyph } from '@/lib/chess/classification'
import { formatScore } from '@/lib/chess/evaluation'
import { useWheelStep } from '@/lib/board/wheelStep'
import { cn } from '@/lib/utils'
import { scaleMargin, scalePx } from '@/lib/ui/scale'

import {
  plyLabel,
  type CurvePoint,
  type GameAnalysisSummary,
  type PlayerAnalysisSummary,
} from '../gameModel'

const AXIS = 50
const CURVE = 'var(--bb-text-2)'
/**
 * Flat fills, one per side, in the side tokens so the areas stay white-above / black-below
 * in both themes. White is mixed harder because the light theme's graph background is
 * itself nearly white.
 */
const FILL_WHITE = 'color-mix(in srgb, var(--bb-side-white) 55%, transparent)'
const FILL_BLACK = 'color-mix(in srgb, var(--bb-side-black) 85%, transparent)'
const GRAPH_BG = 'var(--bb-graph-bg)'
/** The design marks — and its legend explains — only these two. */
const MARKED: readonly Glyph[] = ['blunder', 'mistake']

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

interface DotProps {
  cx?: number
  cy?: number
  payload?: SeriesPoint
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
 * The filled eval area chart from design 1a: White's win percentage against ply, filled to
 * the midline, blunders and mistakes marked where they happened, and a dashed teal cursor
 * on the ply the board is showing.
 *
 * Who is ahead is said by colour, not by a caption: the area above the axis is filled in
 * the white side tone and the area below in the black one, with a side dot pinned to each
 * edge of the plot as the key. A mark is a plain disc in the severity colour: whose
 * blunder it was is already told by the direction the curve jumps, so the dot does not
 * repeat it. "Only mine" hides the opponent's marks for going over one's own game.
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
        'grid min-h-0 gap-x-2.5 gap-y-[0.21875rem] rounded-lg border border-line bg-panel px-2 pb-[0.28125rem] pt-[0.34375rem]',
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
                  outline would run flat along it. The third series draws the curve and marks. */}
              <Area type="linear" dataKey="above" baseValue={AXIS} stroke="none" fill={FILL_WHITE} isAnimationActive={false} dot={false} activeDot={false} />
              <Area type="linear" dataKey="below" baseValue={AXIS} stroke="none" fill={FILL_BLACK} isAnimationActive={false} dot={false} activeDot={false} />
              <Area
                type="linear"
                dataKey="win"
                baseValue={AXIS}
                stroke={CURVE}
                strokeWidth={scalePx(1.6)}
                strokeLinejoin="round"
                fill="none"
                isAnimationActive={false}
                activeDot={false}
                dot={(props: DotProps) => <ClassificationDot {...props} side={markedSide} />}
              />
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
const TALLY_GLYPHS: readonly { field: 'blunder' | 'mistake' | 'inaccuracy'; plural: string }[] = [
  { field: 'blunder', plural: 'blunders' },
  { field: 'mistake', plural: 'mistakes' },
  { field: 'inaccuracy', plural: 'inaccuracies' },
]

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
      aria-label={`${name}: ${TALLY_GLYPHS.map(({ field, plural }) => quantity(row[field], plural)).join(', ')}, ${acplProse}`}
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
        {TALLY_GLYPHS.map(({ field, plural }) => (
          <Fragment key={field}>
            <span
              title={quantity(row[field], plural)}
              className={cn(
                'text-right font-mono font-semibold tabular',
                row[field] === 0 ? 'text-faint' : GLYPHS[field].textClass,
              )}
            >
              {row[field]}
            </span>
            <span
              className={cn(
                'font-mono font-bold',
                row[field] === 0 ? 'text-faint-2' : cn(GLYPHS[field].textClass, 'opacity-75'),
              )}
            >
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
 * A blunder or mistake mark — the two the legend names; every other ply draws nothing, and
 * so does the opponent's when `side` narrows the marks to one player.
 */
/*
 * No `<title>` on the mark: the curve's own hover readout already names the move, its glyph
 * and its eval, and a native SVG tooltip on top of it would be a second box saying less, on
 * its own delay, in the browser's font. The dot is the mark; the readout is the words.
 */
function ClassificationDot({ cx, cy, payload, side: only }: DotProps & { side: Color | null }) {
  const glyph = glyphFor(payload?.classification)
  const key = `dot-${payload?.ply ?? 'x'}`
  if (!glyph || !MARKED.includes(glyph) || cx === undefined || cy === undefined) {
    return <g key={key} />
  }
  if (only && mover(payload!.ply) !== only) return <g key={key} />
  return (
    <circle
      key={key}
      cx={cx}
      cy={cy}
      r={scalePx(3)}
      fill={GLYPHS[glyph].color}
      stroke={GRAPH_BG}
      strokeWidth={scalePx(1.5)}
    />
  )
}
