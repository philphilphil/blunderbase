import { useMemo, useState } from 'react'
import { Area, AreaChart, ReferenceLine, XAxis, YAxis } from 'recharts'

import { SideDot } from '@/components/badges/SideDot'
import type { Color } from '@/lib/api/types'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import { GLYPHS, glyphFor, type Glyph } from '@/lib/chess/classification'
import { cn } from '@/lib/utils'
import { scaleMargin, scalePx } from '@/lib/ui/scale'

import { plyLabel, type CurvePoint } from '../gameModel'

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
        out.push({ ply, win: AXIS, san: null, classification: null, above: AXIS, below: AXIS })
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
 * Kept deliberately short — it is a shape to glance at, not a chart to read numbers off,
 * and the height it used to take belongs to the board above it. Clicking anywhere on the
 * plot still jumps the board to that ply.
 */
export function EvalGraph({
  points,
  plyCount,
  cursor,
  ownerSide,
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
  // "Only mine" hides the opponent's marks. Off by default: the whole game is the usual
  // view, the filter is for going over one's own mistakes.
  const [onlyMine, setOnlyMine] = useState(false)
  const markedSide = onlyMine && ownerSide ? ownerSide : null

  return (
    <div
      className={cn(
        'flex max-h-[6.5rem] min-h-0 flex-col gap-[0.21875rem] rounded-lg border border-line bg-panel px-2 pb-[0.28125rem] pt-[0.34375rem]',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-[0.6875rem] font-medium text-soft">Evaluation</span>
        <div className="flex-1" />
        {/*
          The key to the dots, dropped below `md`. It buys no height — this box is a fixed
          height and the header eats into the *plot*, not out of the pane — but that is
          exactly why it is worth dropping on a phone, where the plot is 8.5rem and every
          row of it counts. It is redundant there anyway: the flagged-moments list directly
          under the curve names each of these marks with its own badge.
        */}
        <span className="flex items-center gap-2 max-md:hidden">
          <Marker color={GLYPHS.blunder.color} label="blunder" />
          <Marker color={GLYPHS.mistake.color} label="mistake" />
        </span>
        {ownerSide ? (
          <label className="ml-1 inline-flex cursor-pointer select-none items-center gap-1 text-[0.625rem] text-dim">
            <input
              type="checkbox"
              checked={onlyMine}
              onChange={(e) => setOnlyMine(e.target.checked)}
              className="size-2.5 accent-accent"
            />
            only mine
          </label>
        ) : null}
      </div>

      {points.length === 0 ? (
        <div className="flex min-h-[2.875rem] flex-1 items-center justify-center rounded-md border border-dashed border-edge-strong bg-graph-bg text-center text-[0.6875rem] text-dim">
          No evaluations yet — run an analysis pass to draw the curve.
        </div>
      ) : (
        <div className="relative min-h-[2.875rem] min-w-0 flex-1">
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
 * A blunder or mistake mark — the two the legend names; every other ply draws nothing, and
 * so does the opponent's when `side` narrows the marks to one player.
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
    >
      <title>{`${plyLabel(payload!.ply)}${payload!.san ?? ''} — ${GLYPHS[glyph].label}`}</title>
    </circle>
  )
}

function Marker({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[0.625rem] text-dim">
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  )
}
