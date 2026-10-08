/**
 * The rating panel — one small chart per time control, over `/stats/profile`.
 *
 * The profile carries one rating series per platform *and* speed. Overlaying blitz on
 * classical says nothing (the scales are different populations), while overlaying Lichess
 * blitz on Chess.com blitz is exactly the comparison worth having — so the speeds are
 * separate charts and the platforms share each chart's axes, one line each.
 *
 * The charts sit two to a row. Stacked one under another at the full width of the main
 * column, each was a wide, flat strip — a rating curve squashed to 120 pixels tall — and
 * three speeds pushed everything under them off the screen. Two up, each chart is taller
 * and closer to the shape a rating history reads in, and from two speeds up the panel is
 * shorter for it.
 * Below `lg` the column is too narrow for two, and they stack again.
 *
 * The points are taken from the games themselves, so the window is applied here rather
 * than by the API, and it is anchored on the newest rated game across every series so all
 * the charts are cut at the same instant.
 */
import type { I18n, MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { useState } from 'react'

import { SpeedPicker } from '@/components/filters/SpeedPicker'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { SectionHead } from '@/components/shell/Section'
import { Segmented } from '@/components/ui/segmented'
import { useProfile } from '@/lib/api/queries'
import { SPEEDS, type Platform, type RatingSeries } from '@/lib/api/types'
import { useDateFormat } from '@/lib/i18n/dateFormat'
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
import { Bar, EmptyBlock, ErrorBlock, LegendSwatch } from '@/routes/stats/kit/states'

/** The charts, two to a row (see the doc comment); the loading bars take the same grid. */
const GRID = 'grid grid-cols-2 gap-x-6 gap-y-5 max-lg:grid-cols-1'

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

/**
 * The five speeds the profile can carry. A speed the backend starts reporting that is not
 * in here still gets a heading — its own name, capitalised — rather than nothing.
 */
const SPEED_LABELS: Record<string, MessageDescriptor> = {
  bullet: msg`Bullet`,
  blitz: msg`Blitz`,
  rapid: msg`Rapid`,
  classical: msg`Classical`,
  correspondence: msg`Correspondence`,
}

function speedLabel(speed: string, i18n: I18n): string {
  const label = SPEED_LABELS[speed]
  return label ? i18n._(label) : speed.charAt(0).toUpperCase() + speed.slice(1)
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
    <span className={cn('font-mono text-label tabular', move > 0 ? 'text-good' : 'text-blunder')}>
      {move > 0 ? `+${move}` : `−${Math.abs(move)}`}
    </span>
  )
}

function SpeedGraph({
  chart,
  tick,
  className,
}: {
  chart: SpeedChart
  /** The axis formatter the window calls for: days inside a quarter, months beyond it. */
  tick: (value: string) => string
  className?: string
}) {
  const { i18n } = useLingui()
  const dateFormat = useDateFormat()
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {/* A heading under the section's "Rating": each chart is a region of its own, and
            a screen reader can jump between them. */}
        <h3 className="text-data font-semibold text-ink">{speedLabel(chart.speed, i18n)}</h3>
        <div className="flex-1" />
        {chart.lines.map((line) => (
          <LegendSwatch key={line.platform} color={PLATFORM_COLOR[line.platform]}>
            {PLATFORM_LABEL[line.platform]}
            <span className="font-mono text-value tabular text-ink">{line.last}</span>
            {line.move !== null && line.move !== 0 ? <Move move={line.move} /> : null}
          </LegendSwatch>
        ))}
      </div>

      <ChartContainer config={CHART} className="aspect-auto h-[9.5rem] w-full">
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
              fontSize: rem(10),
              fill: 'var(--bb-dim)',
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
              fill: 'var(--bb-dim)',
              fontFamily: 'var(--font-mono)',
            }}
          />
          <ChartTooltip
            cursor={{ stroke: 'var(--bb-edge)' }}
            labelFormatter={(label) => fullDate(String(label), dateFormat)}
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

/**
 * Which speeds get a chart, remembered per browser: the app's one Speed picker ("Speed:
 * All", "Speed: Blitz, Rapid"), the same control Stats and the Explorer filter by, because
 * one concept drawn two ways had to be learnt twice. It had been a bare "speeds" button with
 * no chevron, which read as a command rather than a value.
 *
 * It lists every speed that *would* chart (`allCharts`) rather than only the visible ones,
 * so a hidden speed stays reachable to turn back on. The picker hands back the whole new
 * set; what is stored is what is hidden, so each speed whose membership moved is flipped,
 * and a hidden speed with nothing in this window (not listed) stays hidden.
 *
 * The list runs bullet to correspondence, as on Stats and the Explorer, not in the charts'
 * order (most games first): a checklist is looked up, not ranked. Each row carries its
 * game count, which is what the chart order was saying. The panel hangs from the picker's
 * right edge, since opened rightwards it covered Recent games.
 */
function SpeedsPicker({ allCharts, hidden }: { allCharts: SpeedChart[]; hidden: Set<string> }) {
  const { i18n } = useLingui()
  const rank = (speed: string) => {
    const at = (SPEEDS as readonly string[]).indexOf(speed)
    return at === -1 ? SPEEDS.length : at
  }
  const speeds = allCharts.map((chart) => chart.speed).sort((a, b) => rank(a) - rank(b))
  const shown = speeds.filter((speed) => !hidden.has(speed))
  const labels = Object.fromEntries(speeds.map((speed) => [speed, speedLabel(speed, i18n)]))
  const counts = Object.fromEntries(allCharts.map((chart) => [chart.speed, chart.games]))
  return (
    <SpeedPicker
      speeds={speeds}
      value={shown}
      labels={labels}
      counts={counts}
      align="end"
      onChange={(next) => {
        for (const speed of speeds) {
          if (next.includes(speed) === hidden.has(speed)) toggleHiddenSpeed(speed)
        }
      }}
    />
  )
}

export function RatingCard() {
  const { t } = useLingui()
  const dateFormat = useDateFormat()
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
  // Named, because it is what the empty state interpolates and the placeholder a
  // translator sees is the identifier: "the last 90 days", "the 30 days to 07.12.2016".
  const period = windowProse(windowKey, dateFormat, anchor)

  // The profile stamps points as `+00:00` and `windowRange` as `Z`, so the cut is made on
  // parsed time rather than on the strings.
  const cutoff = range.since ? Date.parse(range.since) : null
  const allCharts = buildCharts(playable, cutoff)
  const charts = allCharts.filter((chart) => !hidden.has(chart.speed))

  return (
    <section className="flex flex-none flex-col gap-3">
      {/* The window segment and the Speed picker are 240px of control between them, which
          is most of a phone's width — below `md` they wrap under the title rather than
          squeezing it. The window is one value of four, so it is the one segmented
          control; the speeds are a set, so they are a picker over a checklist. */}
      <SectionHead
        title={t`Rating`}
        detail={period}
        // `max-md:relative`: on a phone the Speed picker's panel spans the head rather than
        // hanging off the picker's edge (`FilterPopover`).
        className="max-md:relative max-md:flex-wrap max-md:gap-y-2"
        end={
          <>
            <Segmented
              label={t`Rating window`}
              value={windowKey}
              onChange={setWindowKey}
              options={DEFAULT_WINDOWS.map((key) => ({
                value: key,
                label: WINDOW_LABELS[key],
              }))}
            />
            <SpeedsPicker allCharts={allCharts} hidden={hidden} />
          </>
        }
      />

      {profile.isPending ? (
        <div data-testid="loading" className={GRID}>
          <Bar className="h-[9.5rem] w-full rounded-md" />
          <Bar className="h-[9.5rem] w-full rounded-md" />
        </div>
      ) : profile.isError ? (
        <ErrorBlock
          error={profile.error}
          onRetry={() => void profile.refetch()}
          className="h-[10.625rem] flex-none"
        />
      ) : allCharts.length === 0 ? (
        <EmptyBlock className="h-[10.625rem] flex-none">
          {playable.length === 0 ? (
            <Trans>No rated games yet, so there is no rating to plot.</Trans>
          ) : (
            <Trans>Not enough rated games in {period}. Widen the window.</Trans>
          )}
        </EmptyBlock>
      ) : charts.length === 0 ? (
        <EmptyBlock className="h-[10.625rem] flex-none">
          <Trans>Every speed is hidden. Turn one back on under Speed.</Trans>
        </EmptyBlock>
      ) : (
        <div className={GRID}>
          {charts.map((chart, index) => (
            <SpeedGraph
              key={chart.speed}
              chart={chart}
              // Only a lone chart takes the whole row. The last of an odd number keeps its
              // half: a full-width chart at this height is the wide, flat strip the 2-up
              // grid exists to avoid, and a gap beside it costs less than that.
              className={
                charts.length === 1 && index === 0 ? 'col-span-full' : undefined
              }
              // A quarter reads in days; a year or the whole archive reads in months.
              tick={
                windowKey === '30d' || windowKey === '90d'
                  ? (value) => shortDate(value, dateFormat)
                  : monthYear
              }
            />
          ))}
        </div>
      )}
    </section>
  )
}
