/**
 * Design 2a, the rating panel — a filled teal area over `/stats/profile`.
 *
 * The profile carries one rating series per platform and speed, each a list of points
 * taken from the games themselves, so the window is applied here rather than by the API.
 */
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { useProfile } from '@/lib/api/queries'
import type { RatingSeries } from '@/lib/api/types'
import { rem, scaleMargin, scalePx } from '@/lib/ui/scale'

import {
  DEFAULT_WINDOWS,
  WINDOW_LABELS,
  anchorOf,
  shortDate,
  windowProse,
  windowRange,
  type WindowKey,
} from '@/routes/stats/kit/analytics'
import { Bar, EmptyBlock, ErrorBlock, Segmented } from '@/routes/stats/kit/states'
import { cn } from '@/lib/utils'
import { useState } from 'react'

const CHART: ChartConfig = {
  rating: { label: 'Rating', color: 'var(--bb-accent)' },
}

function seriesId(series: RatingSeries): string {
  return `${series.platform}:${series.speed}`
}

function seriesLabel(series: RatingSeries, manyPlatforms: boolean): string {
  const speed = series.speed.charAt(0).toUpperCase() + series.speed.slice(1)
  return manyPlatforms ? `${speed} · ${series.platform}` : speed
}

export function RatingCard() {
  const profile = useProfile()
  const [windowKey, setWindowKey] = useState<WindowKey>('90d')
  const [chosenSeries, setChosenSeries] = useState<string | null>(null)

  const all = profile.data?.ratings ?? []
  const playable = all.filter((series) => series.points.length > 0)
  const ranked = [...playable].sort((a, b) => b.games - a.games)
  const series = ranked.find((entry) => seriesId(entry) === chosenSeries) ?? ranked[0]
  const manyPlatforms = new Set(playable.map((entry) => entry.platform)).size > 1

  // The window ends at the newest rated game rather than at the clock, so an archive that
  // stops in 2016 still has a readable "last 90 days" (see `anchorOf`). Nothing here feeds
  // a query key — the points are in hand and the cut is made in this render — so no memo.
  const lastPoint = series?.points[series.points.length - 1]?.at ?? null
  const anchor = anchorOf(lastPoint)
  const range = windowRange(windowKey, anchor)

  // The profile stamps points as `+00:00` and `windowRange` as `Z`, so the cut is made on
  // parsed time rather than on the strings.
  const cutoff = range.since ? Date.parse(range.since) : null
  const points = (series?.points ?? [])
    .filter((point) => cutoff === null || Date.parse(point.at) >= cutoff)
    .map((point) => ({ at: point.at, rating: point.rating }))

  const first = points[0]
  const last = points[points.length - 1]
  const move = first && last ? last.rating - first.rating : null

  return (
    <section className="flex flex-none flex-col gap-[0.6875rem] rounded-xl border border-line bg-panel p-3.5">
      <header className="flex items-end gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[0.6875rem] text-soft">
            {series ? `${seriesLabel(series, manyPlatforms)} rating` : 'Rating'}
          </span>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[1.625rem] font-semibold tracking-[-0.02em] tabular text-ink">
              {last?.rating ?? series?.current ?? '—'}
            </span>
            {move !== null && move !== 0 ? (
              <span
                className={cn('font-mono text-xs tabular', move > 0 ? 'text-good' : 'text-blunder')}
              >
                {move > 0 ? `+${move}` : `−${Math.abs(move)}`}
              </span>
            ) : null}
            <span className="text-[0.6875rem] text-dim-2">{windowProse(windowKey, anchor)}</span>
          </div>
        </div>
        <div className="flex-1" />
        {series && ranked.length > 1 ? (
          <Segmented
            label="Rating series"
            value={seriesId(series)}
            onChange={setChosenSeries}
            options={ranked.map((entry) => ({
              value: seriesId(entry),
              label: seriesLabel(entry, manyPlatforms),
              title: `${entry.games} games`,
            }))}
          />
        ) : null}
        <Segmented
          label="Rating window"
          value={windowKey}
          onChange={setWindowKey}
          options={DEFAULT_WINDOWS.map((key) => ({
            value: key,
            label: WINDOW_LABELS[key],
          }))}
        />
      </header>

      {profile.isPending ? (
        <div data-testid="loading">
          <Bar className="h-[10.625rem] w-full rounded-lg" />
        </div>
      ) : profile.isError ? (
        <ErrorBlock
          error={profile.error}
          onRetry={() => void profile.refetch()}
          className="h-[10.625rem] flex-none"
        />
      ) : points.length < 2 ? (
        <EmptyBlock className="h-[10.625rem] flex-none">
          {playable.length === 0
            ? 'No rated games yet, so there is no rating to plot.'
            : `Only ${points.length} rated game in ${windowProse(windowKey, anchor)}. Widen the window.`}
        </EmptyBlock>
      ) : (
        <ChartContainer config={CHART} className="aspect-auto h-[10.625rem] w-full">
          <AreaChart data={points} margin={scaleMargin({ top: 6, right: 6, bottom: 0, left: -10 })}>
            <CartesianGrid vertical={false} stroke="var(--bb-hairline)" />
            <XAxis
              dataKey="at"
              tickLine={false}
              axisLine={{ stroke: 'var(--bb-edge)' }}
              tickMargin={scalePx(7)}
              minTickGap={scalePx(44)}
              tickFormatter={shortDate}
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
              labelFormatter={(label) => shortDate(String(label))}
              content={<ChartTooltipContent />}
            />
            <Area
              type="monotone"
              dataKey="rating"
              stroke="var(--color-rating)"
              strokeWidth={scalePx(1.8)}
              fill="var(--color-rating)"
              fillOpacity={0.09}
              dot={false}
              activeDot={{ r: scalePx(3.5), strokeWidth: scalePx(2), stroke: 'var(--bb-panel)' }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ChartContainer>
      )}
    </section>
  )
}
