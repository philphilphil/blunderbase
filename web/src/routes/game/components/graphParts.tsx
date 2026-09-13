import { usePlotArea, useXAxisScale, useYAxisScale } from 'recharts'

import type { Classification, Color } from '@/lib/api/types'
import { GLYPHS, glyphFor } from '@/lib/chess/classification'
import type { EvalGraphMarks } from '@/lib/ui/evalGraphPrefs'
import { scalePx } from '@/lib/ui/scale'

import { barLayout, sideOf } from '../gameModel'
import { EDGE_BLACK, EDGE_WHITE, FILL_BLACK, FILL_WHITE, GRAPH_BG } from './graphTokens'

/**
 * What the eval curve and the move-time plot draw the same way, in one place so the two
 * tabs of the graph pane are one instrument: a column per ply standing on an axis and
 * reaching toward a side, White's up and Black's down, and the blunder and mistake marks
 * on top of it. Which quantity a column measures is the caller's — the win percentage on
 * one tab, the seconds a move took on the other — and nothing here knows.
 */

/** The design marks — and its legend explains — only these two. */
type MarkedGlyph = 'blunder' | 'mistake'

/** The classification as a mark on the plot, or nothing for the plies that carry none. */
function markFor(classification: Classification | null): MarkedGlyph | null {
  const glyph = glyphFor(classification)
  return glyph === 'blunder' || glyph === 'mistake' ? glyph : null
}

/** One ply on either plot: where it stands on the x scale, how far from the axis, whose. */
export interface PlotPoint {
  ply: number
  value: number
  classification: Classification | null
}

/**
 * One column per ply, standing on `axis` and reaching up in White's tone or down in
 * Black's — up being a value above the axis.
 *
 * It exists because the filled curve asks the reader to remember a convention — which of
 * three greys is the ground, and which half of the axis belongs to whom — while a column
 * says it by pointing. Every ply also becomes its own object, which is the honest picture
 * of what the data is: the engine's verdict after each move, or the seconds that move
 * took, not a continuous quantity.
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
export function PlotBars({
  points,
  axis,
  domain,
  testId,
}: {
  points: PlotPoint[]
  axis: number
  domain: [number, number]
  testId: string
}) {
  const plot = usePlotArea()
  const xScale = useXAxisScale()
  const yScale = useYAxisScale()
  if (!plot || !xScale || !yScale) return null

  const baseline = yScale(axis)
  if (baseline === undefined) return null

  const { width, rim } = barLayout(plot.width, domain[1] - domain[0] + 1)

  return (
    <g data-testid={testId}>
      {points.map((point) => {
        const x = xScale(point.ply)
        const y = yScale(point.value)
        if (x === undefined || y === undefined) return null
        const white = point.value >= axis
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
export function PlotMarks({
  points,
  axis,
  side: only,
  marks,
  testId,
}: {
  points: PlotPoint[]
  axis: number
  side: Color | null
  marks: EvalGraphMarks
  testId: string
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
    <g data-testid={testId}>
      {points.map((point) => {
        const glyph = markFor(point.classification)
        if (!glyph) return null
        if (only && sideOf(point.ply) !== only) return null
        const x = xScale(point.ply)
        const y = yScale(point.value)
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
        // Outside the fill — up when the column stands above the axis, down when below —
        // unless that is where the plot ends, in which case it hangs the other way.
        let top = point.value >= axis ? y - stem - height : y + stem
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
