import { useMemo } from 'react'
import { Area, AreaChart, ReferenceLine, XAxis, YAxis } from 'recharts'

import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import { GLYPHS, glyphFor, type Glyph } from '@/lib/chess/classification'
import { cn } from '@/lib/utils'
import { rem, scaleMargin, scalePx } from '@/lib/ui/scale'

import { curveTicks, plyLabel, type CurvePoint } from '../gameModel'

const AXIS = 50
const CURVE = 'var(--bb-text-2)'
/** The design's flat area fill, not a gradient. */
const FILL = 'color-mix(in srgb, var(--bb-text-2) 16%, transparent)'
const GRAPH_BG = 'var(--bb-graph-bg)'
/** The design marks — and its legend explains — only these two. */
const MARKED: readonly Glyph[] = ['blunder', 'mistake']

const CONFIG: ChartConfig = { win: { label: 'White', color: CURVE } }

interface DotProps {
  cx?: number
  cy?: number
  payload?: CurvePoint
}

/**
 * The filled eval area chart from design 1a: White's win percentage against ply, filled to
 * the midline so advantage reads as area above the axis, blunders and mistakes marked
 * where they happened, and a dashed teal cursor on the ply the board is showing.
 *
 * Kept deliberately short — it is a shape to glance at, not a chart to read numbers off,
 * and the height it used to take belongs to the board above it. Clicking anywhere on the
 * plot still jumps the board to that ply.
 */
export function EvalGraph({
  points,
  plyCount,
  cursor,
  onSelectPly,
  className,
}: {
  points: CurvePoint[]
  plyCount: number
  /** The ply last played; `-1` for the starting position. */
  cursor: number
  onSelectPly: (ply: number) => void
  className?: string
}) {
  const ticks = useMemo(() => curveTicks(plyCount), [plyCount])
  const domain = useMemo<[number, number]>(
    () => [points[0]?.ply ?? -1, Math.max(points[points.length - 1]?.ply ?? 0, plyCount - 1)],
    [points, plyCount],
  )

  return (
    <div
      className={cn(
        'flex max-h-[6.5rem] min-h-0 flex-col gap-[0.21875rem] rounded-lg border border-line bg-panel px-2 pb-[0.28125rem] pt-[0.34375rem]',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-[0.6875rem] font-medium text-soft">Evaluation</span>
        <span className="font-mono text-[0.625rem] text-faint">white advantage above axis</span>
        <div className="flex-1" />
        <Marker color={GLYPHS.blunder.color} label="blunder" />
        <Marker color={GLYPHS.mistake.color} label="mistake" />
      </div>

      {points.length === 0 ? (
        <div className="flex min-h-[2.875rem] flex-1 items-center justify-center rounded-md border border-dashed border-edge-strong bg-graph-bg text-center text-[0.6875rem] text-dim">
          No evaluations yet — run an analysis pass to draw the curve.
        </div>
      ) : (
        <ChartContainer
          config={CONFIG}
          className="min-h-[2.875rem] w-full flex-1 aspect-auto rounded-md bg-graph-bg [&_.recharts-surface]:cursor-crosshair"
        >
          <AreaChart
            data={points}
            margin={scaleMargin({ top: 4, right: 0, bottom: 2, left: 0 })}
            onClick={(state: { activeLabel?: string | number }) => {
              const label = Number(state?.activeLabel)
              if (Number.isFinite(label)) onSelectPly(label)
            }}
          >
            <XAxis
              dataKey="ply"
              type="number"
              domain={domain}
              ticks={ticks}
              tick={{ fill: 'var(--bb-graph-tick)', fontSize: rem(9) }}
              tickFormatter={(ply: number) => String(Math.floor(ply / 2) + 1)}
              tickLine={false}
              axisLine={false}
              height={scalePx(11)}
              tickMargin={scalePx(1)}
              interval={0}
            />
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

            <Area
              type="linear"
              dataKey="win"
              baseValue={AXIS}
              stroke={CURVE}
              strokeWidth={scalePx(1.6)}
              strokeLinejoin="round"
              fill={FILL}
              isAnimationActive={false}
              activeDot={{ r: scalePx(3), fill: 'var(--bb-accent)', stroke: GRAPH_BG, strokeWidth: scalePx(1.5) }}
              dot={(props: DotProps) => <ClassificationDot {...props} />}
            />
          </AreaChart>
        </ChartContainer>
      )}
    </div>
  )
}

/** A blunder or mistake mark — the two the legend names. Every other ply draws nothing. */
function ClassificationDot({ cx, cy, payload }: DotProps) {
  const glyph = glyphFor(payload?.classification)
  const key = `dot-${payload?.ply ?? 'x'}`
  if (!glyph || !MARKED.includes(glyph) || cx === undefined || cy === undefined) {
    return <g key={key} />
  }
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
