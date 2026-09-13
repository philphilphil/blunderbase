import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { useMemo } from 'react'
import { Area, AreaChart, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts'

import { SideDot } from '@/components/badges/SideDot'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import type { Color } from '@/lib/api/types'
import type { EvalGraphMarks } from '@/lib/ui/evalGraphPrefs'
import { scaleMargin } from '@/lib/ui/scale'

import {
  formatRemaining,
  formatSeconds,
  moveTimeSummary,
  plyLabel,
  sideOf,
  thinkHeight,
  type MoveTimePoint,
  type MoveTimeSummary,
} from '../gameModel'
import { PlotBars, PlotMarks, type PlotPoint } from './graphParts'

const AXIS = 0
const CONFIG: ChartConfig = { value: { label: <Trans>Move time</Trans>, color: 'var(--bb-text-2)' } }

/** A move's think as the plot draws it: White's seconds up, Black's down, on the log scale. */
interface TimeSeriesPoint extends PlotPoint {
  seconds: number
}

/**
 * How long each move took, as a column per ply standing on a shared axis — White's up
 * and Black's down, the way the eval curve beside it says who is ahead, so the two tabs
 * of the pane read with one convention. The blunder and mistake marks stay on the
 * columns: the question this plot answers is whether a mistake came after a long think
 * or in a hurry, and a mark on a short column answers it at a glance.
 *
 * The increment, where the game has one, is drawn as a faint line on each side: a column
 * under it is a move that gained time, and a run of them is premoving.
 *
 * Symmetric about the axis on purpose, at the longest think either side took: a game where
 * one side thought and the other blitzed shows that as one tall half and one flat half,
 * which is the point, rather than as two plots each filling its own space.
 */
export function MoveTimePlot({
  points,
  increment,
  plyCount,
  cursor,
  side,
  marks,
  onSelectPly,
  scrub,
}: {
  points: MoveTimePoint[]
  /** Seconds added per move, for the reference lines; 0 draws none. */
  increment: number
  plyCount: number
  cursor: number
  /** Whose marks to draw; `null` for both players'. */
  side: Color | null
  marks: EvalGraphMarks
  onSelectPly: (ply: number) => void
  scrub: boolean
}) {
  const series = useMemo<TimeSeriesPoint[]>(
    () =>
      points.map((point) => {
        const height = thinkHeight(point.seconds)
        return {
          ply: point.ply,
          value: sideOf(point.ply) === 'white' ? height : -height,
          seconds: point.seconds,
          classification: point.classification,
        }
      }),
    [points],
  )
  // The same x scale as the eval curve, starting-position point included, so the cursor
  // line stands on the same ply on both tabs.
  const domain = useMemo<[number, number]>(
    () => [-1, Math.max(points[points.length - 1]?.ply ?? 0, plyCount - 1)],
    [points, plyCount],
  )
  // Symmetric about the axis at the longest think either side took, on the same scale
  // the columns are drawn on — so a game where one side thought and the other blitzed
  // shows as one tall half and one flat half, which is the point.
  const reach = useMemo(
    () => thinkHeight(Math.max(1, increment * 2, ...points.map((point) => point.seconds))),
    [increment, points],
  )
  const tick = thinkHeight(increment)

  return (
    <>
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
            if (Number.isFinite(label)) onSelectPly(Math.round(label))
          }}
          onTouchMove={
            scrub
              ? (state: { activeLabel?: string | number }) => {
                  const label = Number(state?.activeLabel)
                  if (Number.isFinite(label)) onSelectPly(Math.round(label))
                }
              : undefined
          }
        >
          <Tooltip
            content={<TimeReadout />}
            cursor={false}
            isAnimationActive={false}
            allowEscapeViewBox={{ x: false, y: true }}
            offset={12}
            wrapperStyle={{ outline: 'none', zIndex: 20 }}
          />
          <XAxis dataKey="ply" type="number" domain={domain} hide />
          <YAxis type="number" domain={[-reach, reach]} hide />

          {increment > 0 && tick < reach ? (
            <ReferenceLine y={tick} stroke="var(--bb-graph-grid)" strokeWidth={1} />
          ) : null}
          {increment > 0 && tick < reach ? (
            <ReferenceLine y={-tick} stroke="var(--bb-graph-grid)" strokeWidth={1} />
          ) : null}
          <PlotBars points={series} axis={AXIS} domain={domain} testId="move-time-bars" />
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
          {/* Stripped of stroke and fill: kept purely as what the hover readout reads its
              payload from, the way the eval curve's bars mode keeps its area. */}
          <Area
            type="linear"
            dataKey="value"
            baseValue={AXIS}
            stroke="none"
            fill="none"
            isAnimationActive={false}
            activeDot={false}
            dot={false}
          />
          <PlotMarks points={series} axis={AXIS} side={side} marks={marks} testId="move-time-marks" />
        </AreaChart>
      </ChartContainer>
    </>
  )
}

/**
 * What the pointer is over: which move, and how long it took. Nothing else — not the
 * move, not its verdict, not the clock: the move and its clock are in the table beside
 * the plot, the mark is already on the column under the pointer, and a readout that
 * repeated them would be a second table an inch from the first.
 */
function TimeReadout({ payload }: { payload?: { payload?: TimeSeriesPoint }[] }) {
  const point = payload?.[0]?.payload
  if (!point || !Number.isInteger(point.ply)) return null
  return (
    <div className="pointer-events-none rounded-md border border-edge-strong bg-elevated px-2 py-1 text-[0.65625rem] whitespace-nowrap shadow-[0_0.25rem_0.75rem_var(--bb-shadow)]">
      <span className="font-mono tabular text-dim">{plyLabel(point.ply)}</span>{' '}
      <span className="font-mono tabular text-body-3">{formatSeconds(point.seconds)}</span>
    </div>
  )
}

/** White first, always: it is the half of the plot above the axis, and the dots say so. */
const TALLY_SIDES: readonly Color[] = ['white', 'black']

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
 * Both players' clocks summed up, in the place the accuracy tallies take on the other tab
 * and in their shape: side dot · name, then three figures in a column. Average think,
 * the longest one, and what was left at the end — the three numbers that say how a game
 * was played against the clock.
 */
export function TimeTallies({
  points,
  flagged,
  ownerSide,
  playerNames,
}: {
  points: MoveTimePoint[]
  /** The side that lost on the clock, whose "left" is nothing rather than its last reading. */
  flagged: Color | null
  ownerSide: Color | null
  playerNames?: Partial<Record<Color, string | null>>
}) {
  const { i18n } = useLingui()
  return (
    <div
      data-testid="time-summaries"
      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 [grid-area:tallies] md:flex-col md:flex-nowrap md:items-stretch md:justify-center md:gap-2.5"
    >
      {TALLY_SIDES.map((side) => (
        <TimeTally
          key={side}
          side={side}
          name={playerNames?.[side] || i18n._(tallyName(side, ownerSide))}
          summary={moveTimeSummary(points, side, flagged)}
        />
      ))}
    </div>
  )
}

function TimeTally({
  side,
  name,
  summary,
}: {
  side: Color
  name: string
  summary: MoveTimeSummary | null
}) {
  const { t } = useLingui()
  const average = summary?.average != null ? formatSeconds(summary.average) : '—'
  const longest = summary?.longest ? formatSeconds(summary.longest.seconds) : '—'
  // A clock reading, in the clock's own format — `2:45`, never `165s` — because the move
  // table prints the same reading beside the last move.
  const remaining = summary?.remaining != null ? formatRemaining(summary.remaining) : '—'
  const longestAt = summary?.longest ? plyLabel(summary.longest.ply) : null
  return (
    <div
      role="group"
      aria-label={t`${name}: ${average} per move, longest ${longest}, ${remaining} left`}
      className="flex min-w-0 flex-col items-center gap-[0.15625rem] text-[0.65625rem]"
    >
      <span className="flex min-w-0 max-w-full items-center gap-1.5">
        <SideDot side={side} size="sm" />
        <span className="min-w-0 truncate text-body-3">{name}</span>
      </span>
      {/*
        The accuracy tally's own grid — two figure/label pairs to a row — so the two
        clusters have one silhouette whichever tab is up: average and longest think on the
        first line, what was left on the second.
      */}
      <span className="grid grid-cols-[auto_1fr_auto_1fr] items-baseline gap-x-[0.3125rem] gap-y-[0.09375rem]">
        <span className="text-right font-mono tabular text-body-3">{average}</span>
        <span title={t`Average time per move`} className="font-mono text-dim">
          <Trans comment="Label beside a player's average time per move">avg</Trans>
        </span>
        <span
          title={longestAt ? t`The longest think, on move ${longestAt}` : undefined}
          className="text-right font-mono tabular text-body-3"
        >
          {longest}
        </span>
        <span className="font-mono text-dim">
          <Trans comment="Label beside a player's longest think">max</Trans>
        </span>
        <span className="text-right font-mono tabular text-body-3">{remaining}</span>
        <span title={t`Time left at the end`} className="font-mono text-dim">
          <Trans comment="Label beside the time a player had left at the end">left</Trans>
        </span>
      </span>
    </div>
  )
}
