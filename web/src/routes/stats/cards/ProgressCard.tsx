/**
 * Design 2d, "Progress" — the trend over `/stats/rating_trend`.
 *
 * The design draws ACPL as a filled teal line and blunders-per-game as a dashed grey one.
 * This backend has no ACPL, so the filled series is blunders per 100 owner moves — the
 * rate that is comparable across months of different lengths — and the dashed series is
 * the average rating the month was played at, on its own axis.
 *
 * `rating_trend` buckets monthly and nothing else: the service takes a `bucket` option but
 * `/stats/{dimension}` forwards only the game filters, so there is no period control here.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import { Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts'

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import type { StatsBucket } from '@/lib/api/types'
import { rem, scaleMargin, scalePx } from '@/lib/ui/scale'

import { Async, LegendSwatch, LoadingChart, StatCard, type StatsQuery } from '../kit/states'
import { asPercent, buckets, num, numOr, periodLabel } from '../kit/analytics'

const CHART: ChartConfig = {
  blunderRate: { label: <Trans>Blunders / 100 moves</Trans>, color: 'var(--bb-accent)' },
  rating: { label: <Trans>Average rating</Trans>, color: 'var(--bb-faint)' },
}

interface Row {
  key: string
  label: string
  blunderRate: number
  rating: number | null
  score: number
  games: number
}

/** The design's footer: three "then → now" pairs under the chart. */
function ThenNow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[0.65625rem] text-dim-2">{label}</span>
      <span className="font-mono text-[0.8125rem] tabular text-ink">{value}</span>
    </div>
  )
}

export function ProgressCard({ query }: { query: StatsQuery }) {
  const { t } = useLingui()
  const rows: Row[] = buckets(query.data).map((bucket: StatsBucket) => ({
    key: bucket.key,
    label: periodLabel(bucket.key),
    blunderRate: Number(numOr(bucket, 'blunders_per_100_moves').toFixed(2)),
    rating: num(bucket, 'avg_rating'),
    score: asPercent(numOr(bucket, 'score')) ?? 0,
    games: numOr(bucket, 'games'),
  }))

  const first = rows[0]
  const last = rows[rows.length - 1]
  const span = rows.length > 1
  // Named here rather than in the sentence, because the identifier is the placeholder a
  // translator sees. Guarded because an empty window has no last row to read.
  const month = last?.label ?? ''

  return (
    <StatCard
      title={t`Progress`}
      aside={
        <div className="flex items-center gap-3">
          <LegendSwatch color="var(--bb-accent)">
            <Trans>blunders/100</Trans>
          </LegendSwatch>
          <LegendSwatch color="var(--bb-faint)" dashed>
            <Trans>rating</Trans>
          </LegendSwatch>
          {span ? (
            <span className="font-mono text-[0.65625rem] tabular text-dim-2">
              {first.label} → {last.label}
            </span>
          ) : null}
        </div>
      }
      footer={
        span ? (
          <span className="flex gap-5 max-md:flex-wrap max-md:gap-x-5 max-md:gap-y-1.5">
            <ThenNow
              label={t`Blunders / 100 moves`}
              value={`${first.blunderRate.toFixed(1)} → ${last.blunderRate.toFixed(1)}`}
            />
            <ThenNow
              label={t`Score`}
              value={`${first.score.toFixed(0)}% → ${last.score.toFixed(0)}%`}
            />
            <ThenNow
              label={t`Rating`}
              value={
                first.rating === null || last.rating === null
                  ? '—'
                  : `${Math.round(first.rating)} → ${Math.round(last.rating)}`
              }
            />
          </span>
        ) : undefined
      }
    >
      <Async
        query={query}
        loading={<LoadingChart />}
        empty={rows.length === 0}
        emptyMessage={<Trans>No games in this window, so there is no trend to draw.</Trans>}
      >
        {rows.length === 1 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-1.5 text-center">
            <span className="font-mono text-[1.375rem] font-semibold tabular text-ink">
              {last.blunderRate.toFixed(1)}
            </span>
            <span className="text-[0.71875rem] text-dim-2">
              <Trans>blunders per 100 moves in {month} — one month is not a trend yet</Trans>
            </span>
          </div>
        ) : (
          <ChartContainer config={CHART} className="aspect-auto h-full min-h-0 w-full">
            <ComposedChart data={rows} margin={scaleMargin({ top: 6, right: 4, bottom: 0, left: -24 })}>
              <CartesianGrid vertical={false} stroke="var(--bb-hairline)" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={{ stroke: 'var(--bb-edge)' }}
                tickMargin={scalePx(7)}
                minTickGap={scalePx(18)}
                tick={{
                  fontSize: rem(9.5),
                  fill: 'var(--bb-dim-2)',
                  fontFamily: 'var(--font-mono)',
                }}
              />
              <YAxis
                yAxisId="rate"
                tickLine={false}
                axisLine={false}
                width={scalePx(40)}
                tick={{
                  fontSize: rem(10),
                  fill: 'var(--bb-dim-2)',
                  fontFamily: 'var(--font-mono)',
                }}
              />
              <YAxis
                yAxisId="rating"
                orientation="right"
                domain={['dataMin - 40', 'dataMax + 40']}
                hide
              />
              <ChartTooltip
                cursor={{ stroke: 'var(--bb-edge)' }}
                content={<ChartTooltipContent />}
              />
              <Area
                yAxisId="rate"
                type="monotone"
                dataKey="blunderRate"
                stroke="var(--color-blunderRate)"
                strokeWidth={scalePx(1.8)}
                fill="var(--color-blunderRate)"
                fillOpacity={0.08}
                dot={false}
                activeDot={{ r: scalePx(3), strokeWidth: scalePx(2), stroke: 'var(--bb-panel)' }}
                isAnimationActive={false}
              />
              <Line
                yAxisId="rating"
                type="monotone"
                dataKey="rating"
                stroke="var(--color-rating)"
                strokeWidth={scalePx(1.5)}
                strokeDasharray="3 3"
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            </ComposedChart>
          </ChartContainer>
        )}
      </Async>
    </StatCard>
  )
}
