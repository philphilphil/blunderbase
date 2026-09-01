/**
 * The rating panel — one small chart per time control, over `/stats/profile`.
 *
 * The profile carries one rating series per platform *and* speed. Overlaying blitz on
 * classical says nothing (the scales are different populations), while overlaying Lichess
 * blitz on Chess.com blitz is exactly the comparison worth having — so the speeds are
 * stacked as separate charts and the platforms share each chart's axes, one line each.
 *
 * The points are taken from the games themselves, so the window is applied here rather
 * than by the API, and it is anchored on the newest rated game across every series so all
 * the charts are cut at the same instant.
 */
import { Check } from 'lucide-react'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { useEffect, useRef, useState } from 'react'

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { SectionHead } from '@/components/shell/Section'
import { useProfile } from '@/lib/api/queries'
import type { Platform, RatingSeries } from '@/lib/api/types'
import { rem, scaleMargin, scalePx } from '@/lib/ui/scale'
import { cn } from '@/lib/utils'

import { toggleHiddenSpeed, useHiddenSpeeds } from './ratingSpeeds'
import {
  DEFAULT_WINDOWS,
  WINDOW_LABELS,
  anchorOf,
  fullDate,
  monthYear,
  shortDate,
  windowProse,
  windowRange,
  type WindowKey,
} from '@/routes/stats/kit/analytics'
import { Bar, EmptyBlock, ErrorBlock, LegendSwatch, Segmented } from '@/routes/stats/kit/states'

/** Drawn in this order, so the platform colours never move between charts. */
const PLATFORMS: Platform[] = ['lichess', 'chesscom', 'fics', 'otb']

const PLATFORM_COLOR: Record<Platform, string> = {
  lichess: 'var(--chart-1)',
  chesscom: 'var(--chart-2)',
  fics: 'var(--chart-4)',
  otb: 'var(--chart-3)',
}

const PLATFORM_LABEL: Record<Platform, string> = {
  lichess: 'Lichess',
  chesscom: 'Chess.com',
  fics: 'FICS',
  otb: 'OTB',
}

/** One entry per platform, so `--color-lichess` and the tooltip labels come for free. */
const CHART: ChartConfig = Object.fromEntries(
  PLATFORMS.map((platform) => [
    platform,
    { label: PLATFORM_LABEL[platform], color: PLATFORM_COLOR[platform] },
  ]),
)

interface PlatformLine {
  platform: Platform
  /** Points inside the window — one is a dot, two or more are a line. */
  count: number
  last: number
  /** The move across the window, or null when there is nothing to compare against. */
  move: number | null
}

interface SpeedChart {
  speed: string
  /** Total rated games behind the chart, which is how the charts are ordered. */
  games: number
  rows: Record<string, string | number>[]
  lines: PlatformLine[]
}

function speedLabel(speed: string): string {
  return speed.charAt(0).toUpperCase() + speed.slice(1)
}

/**
 * The series grouped into one chart per speed, each row a timestamp carrying whichever
 * platforms played at it. A speed with fewer than two points in the window is dropped —
 * there is no shape to read in a single game.
 */
function buildCharts(all: RatingSeries[], cutoff: number | null): SpeedChart[] {
  const bySpeed = new Map<string, RatingSeries[]>()
  for (const series of all) {
    if (series.points.length === 0) continue
    const group = bySpeed.get(series.speed)
    if (group) group.push(series)
    else bySpeed.set(series.speed, [series])
  }

  const charts: SpeedChart[] = []
  for (const [speed, group] of bySpeed) {
    const rows = new Map<string, Record<string, string | number>>()
    const lines: PlatformLine[] = []
    let games = 0

    for (const platform of PLATFORMS) {
      const mine = group.filter((series) => series.platform === platform)
      const points = mine
        .flatMap((series) => series.points)
        .filter((point) => cutoff === null || Date.parse(point.at) >= cutoff)
        .sort((left, right) => Date.parse(left.at) - Date.parse(right.at))
      if (points.length === 0) continue

      for (const point of points) {
        const row = rows.get(point.at) ?? { at: point.at }
        row[platform] = point.rating
        rows.set(point.at, row)
      }

      const first = points[0]!
      const last = points[points.length - 1]!
      lines.push({
        platform,
        count: points.length,
        last: last.rating,
        move: points.length > 1 ? last.rating - first.rating : null,
      })
      games += mine.reduce((sum, series) => sum + series.games, 0)
    }

    const ordered = [...rows.values()].sort(
      (left, right) => Date.parse(String(left.at)) - Date.parse(String(right.at)),
    )
    if (ordered.length < 2) continue
    charts.push({ speed, games, rows: ordered, lines })
  }

  return charts.sort((left, right) => right.games - left.games)
}

/** The newest rated game anywhere in the profile — what every window is anchored on. */
function newestPoint(all: RatingSeries[]): string | null {
  let newest: string | null = null
  for (const series of all) {
    const at = series.points[series.points.length - 1]?.at
    if (!at) continue
    if (newest === null || Date.parse(at) > Date.parse(newest)) newest = at
  }
  return newest
}

function Move({ move }: { move: number }) {
  return (
    <span className={cn('font-mono tabular', move > 0 ? 'text-good' : 'text-blunder')}>
      {move > 0 ? `+${move}` : `−${Math.abs(move)}`}
    </span>
  )
}

function SpeedGraph({
  chart,
  tick,
}: {
  chart: SpeedChart
  /** The axis formatter the window calls for: days inside a quarter, months beyond it. */
  tick: (value: string) => string
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[0.6875rem] font-medium text-soft">{speedLabel(chart.speed)}</span>
        <div className="flex-1" />
        {chart.lines.map((line) => (
          <LegendSwatch key={line.platform} color={PLATFORM_COLOR[line.platform]}>
            {PLATFORM_LABEL[line.platform]}
            <span className="font-mono tabular text-soft">{line.last}</span>
            {line.move !== null && line.move !== 0 ? <Move move={line.move} /> : null}
          </LegendSwatch>
        ))}
      </div>

      <ChartContainer config={CHART} className="aspect-auto h-[7.5rem] w-full">
        {/* The right margin is the width of half a date label: the panel has no card padding
            to spill the last tick into any more, so the plot has to keep that room itself or
            "Sept 2026" is cut off by the section's edge. */}
        <LineChart data={chart.rows} margin={scaleMargin({ top: 6, right: 26, bottom: 0, left: -10 })}>
          <CartesianGrid vertical={false} stroke="var(--bb-hairline)" />
          <XAxis
            dataKey="at"
            tickLine={false}
            axisLine={{ stroke: 'var(--bb-edge)' }}
            tickMargin={scalePx(7)}
            minTickGap={scalePx(44)}
            tickFormatter={tick}
            tick={{
              fontSize: rem(9.5),
              fill: 'var(--bb-dim-2)',
              fontFamily: 'var(--font-mono)',
            }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={scalePx(48)}
            domain={['dataMin - 25', 'dataMax + 25']}
            tick={{
              fontSize: rem(10),
              fill: 'var(--bb-dim-2)',
              fontFamily: 'var(--font-mono)',
            }}
          />
          <ChartTooltip
            cursor={{ stroke: 'var(--bb-edge)' }}
            labelFormatter={(label) => fullDate(String(label))}
            content={<ChartTooltipContent />}
          />
          {chart.lines.map((line) => (
            <Line
              key={line.platform}
              type="monotone"
              dataKey={line.platform}
              name={PLATFORM_LABEL[line.platform]}
              stroke={`var(--color-${line.platform})`}
              strokeWidth={scalePx(1.8)}
              // A platform that played once in the window has no line, only a point.
              dot={line.count === 1 ? { r: scalePx(2.5) } : false}
              // The halo is the ground the chart stands on, which is the page canvas now
              // that the panel has no card of its own.
              activeDot={{ r: scalePx(3.5), strokeWidth: scalePx(2), stroke: 'var(--bb-surface)' }}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ChartContainer>
    </div>
  )
}

/** The checked/unchecked square in front of a speed row — teal-filled when shown. */
function CheckboxGlyph({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-3.5 flex-none items-center justify-center rounded-sm border',
        checked
          ? 'border-accent-teal/40 bg-accent-teal/15 text-accent-teal'
          : 'border-edge text-transparent',
      )}
    >
      <Check className="size-2.5" strokeWidth={3} />
    </span>
  )
}

/**
 * Which speeds get a chart, remembered per browser. Lists every speed that *would* chart
 * (`allCharts`) rather than only the visible ones, so a hidden speed stays reachable to
 * turn back on.
 */
function SpeedsMenu({
  charts,
  allCharts,
  hidden,
}: {
  charts: SpeedChart[]
  allCharts: SpeedChart[]
  hidden: Set<string>
}) {
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={container} className="relative flex-none">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="flex items-center gap-1 rounded-md border border-edge px-1.5 py-0.5 text-[0.6875rem] text-soft transition-colors hover:border-edge-hover hover:text-ink"
      >
        speeds
        {charts.length !== allCharts.length ? (
          <span className="font-mono tabular text-dim-2">
            {charts.length}/{allCharts.length}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Speeds"
          className="bb-card absolute right-0 top-[calc(100%+0.4375rem)] z-40 flex w-[10rem] flex-col gap-0.5 p-1 shadow-[0_0.75rem_2rem_var(--bb-shadow)]"
        >
          {allCharts.map((chart) => {
            const checked = !hidden.has(chart.speed)
            return (
              <button
                key={chart.speed}
                type="button"
                role="menuitemcheckbox"
                aria-checked={checked}
                aria-label={speedLabel(chart.speed)}
                onClick={() => toggleHiddenSpeed(chart.speed)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[0.6875rem] text-soft transition-colors hover:bg-raised hover:text-ink"
              >
                <CheckboxGlyph checked={checked} />
                <span className="flex-1 truncate">{speedLabel(chart.speed)}</span>
                <span className="font-mono tabular text-dim-2">{chart.games}</span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export function RatingCard() {
  const profile = useProfile()
  const [windowKey, setWindowKey] = useState<WindowKey>('all')
  const hidden = useHiddenSpeeds()

  const all = profile.data?.ratings ?? []
  const playable = all.filter((series) => series.points.length > 0)

  // The window ends at the newest rated game rather than at the clock, so an archive that
  // stops in 2016 still has a readable "last 90 days" (see `anchorOf`). Nothing here feeds
  // a query key — the points are in hand and the cut is made in this render — so no memo.
  const anchor = anchorOf(newestPoint(playable))
  const range = windowRange(windowKey, anchor)

  // The profile stamps points as `+00:00` and `windowRange` as `Z`, so the cut is made on
  // parsed time rather than on the strings.
  const cutoff = range.since ? Date.parse(range.since) : null
  const allCharts = buildCharts(playable, cutoff)
  const charts = allCharts.filter((chart) => !hidden.has(chart.speed))

  return (
    <section className="flex flex-none flex-col gap-3">
      {/* The window buttons and the speeds menu are 240px of control between them, which is
          most of a phone's width — below `md` they wrap under the title rather than
          squeezing it. */}
      <SectionHead
        title="Rating"
        detail={windowProse(windowKey, anchor)}
        className="max-md:flex-wrap max-md:gap-y-2"
        end={
          <>
            <Segmented
              label="Rating window"
              value={windowKey}
              onChange={setWindowKey}
              options={DEFAULT_WINDOWS.map((key) => ({
                value: key,
                label: WINDOW_LABELS[key],
              }))}
            />
            <SpeedsMenu charts={charts} allCharts={allCharts} hidden={hidden} />
          </>
        }
      />

      {profile.isPending ? (
        <div data-testid="loading" className="flex flex-col gap-3">
          <Bar className="h-[7.5rem] w-full rounded-lg" />
          <Bar className="h-[7.5rem] w-full rounded-lg" />
        </div>
      ) : profile.isError ? (
        <ErrorBlock
          error={profile.error}
          onRetry={() => void profile.refetch()}
          className="h-[10.625rem] flex-none"
        />
      ) : allCharts.length === 0 ? (
        <EmptyBlock className="h-[10.625rem] flex-none">
          {playable.length === 0
            ? 'No rated games yet, so there is no rating to plot.'
            : `Not enough rated games in ${windowProse(windowKey, anchor)}. Widen the window.`}
        </EmptyBlock>
      ) : charts.length === 0 ? (
        <EmptyBlock className="h-[10.625rem] flex-none">
          Every speed is hidden. Pick one in the speeds menu.
        </EmptyBlock>
      ) : (
        <div className="flex flex-col gap-3.5">
          {charts.map((chart) => (
            <SpeedGraph
              key={chart.speed}
              chart={chart}
              // A quarter reads in days; a year or the whole archive reads in months.
              tick={windowKey === '30d' || windowKey === '90d' ? shortDate : monthYear}
            />
          ))}
        </div>
      )}
    </section>
  )
}
