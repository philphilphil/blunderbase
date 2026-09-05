/**
 * Performance by time of day, over `/stats/performance_by_hour`.
 *
 * The service buckets on the hour plus a `tz_offset` option, but `/stats/{dimension}`
 * forwards only the game filters — no dimension options reach it — so the hours are UTC
 * and the axis says so. Every hour is drawn, including the ones with no games, because a
 * day with holes in it is not a day.
 */
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts'

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import type { StatsBucket } from '@/lib/api/types'
import { rem, scaleMargin, scalePx } from '@/lib/ui/scale'

import { Async, LoadingChart, LegendSwatch, StatCard, type StatsQuery } from '../kit/states'
import { asPercent, buckets, numOr } from '../kit/analytics'

const CHART: ChartConfig = {
  games: { label: <Trans>Games</Trans>, color: 'var(--bb-faint-2)' },
  blundersPerGame: { label: <Trans>Blunders / game</Trans>, color: 'var(--bb-accent)' },
}

const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'))

interface Row {
  hour: string
  games: number
  blundersPerGame: number | null
  score: number
  analyzed: number
}

/** A descriptor rather than a sentence, so the card resolves it in the reader's language. */
function sentence(rows: Row[]): MessageDescriptor | undefined {
  const scored = rows.filter((row) => row.analyzed >= 2 && row.blundersPerGame !== null)
  if (scored.length < 2) return undefined
  const worst = scored.reduce((a, b) =>
    (b.blundersPerGame ?? 0) > (a.blundersPerGame ?? 0) ? b : a,
  )
  const best = scored.reduce((a, b) =>
    (b.blundersPerGame ?? 0) < (a.blundersPerGame ?? 0) ? b : a,
  )
  if (worst.hour === best.hour) return undefined
  // Named locals: the identifier is what a translator sees as the placeholder.
  const loosest = worst.hour
  const tightest = best.hour
  const loosestRate = (worst.blundersPerGame ?? 0).toFixed(1)
  const tightestRate = (best.blundersPerGame ?? 0).toFixed(1)
  return msg`You are at your loosest around ${loosest}:00 UTC (${loosestRate} blunders a game) and at your tightest around ${tightest}:00 (${tightestRate}).`
}

export function TimeOfDayCard({ query }: { query: StatsQuery }) {
  const { i18n, t } = useLingui()
  const found = buckets(query.data)
  const rows: Row[] = HOURS.map((hour) => {
    const bucket = found.find((entry: StatsBucket) => entry.key.padStart(2, '0') === hour)
    const analyzed = numOr(bucket, 'analyzed_games')
    return {
      hour,
      games: numOr(bucket, 'games'),
      blundersPerGame: analyzed > 0 ? numOr(bucket, 'blunders_per_game') : null,
      score: asPercent(numOr(bucket, 'score')) ?? 0,
      analyzed,
    }
  })

  const said = query.data ? sentence(rows) : undefined

  return (
    <StatCard
      title={t`Performance by time of day`}
      aside={
        <div className="flex items-center gap-3">
          <LegendSwatch color="var(--bb-faint-2)">
            <Trans>games</Trans>
          </LegendSwatch>
          <LegendSwatch color="var(--bb-accent)">
            <Trans>blunders/game</Trans>
          </LegendSwatch>
        </div>
      }
      footer={
        <>
          {said ? i18n._(said) : null}
          <span className="block font-mono text-[0.625rem] tabular text-faint">
            <Trans>hour of day, UTC — the API cannot take a timezone offset yet</Trans>
          </span>
        </>
      }
    >
      <Async
        query={query}
        loading={<LoadingChart />}
        empty={found.length === 0}
        emptyMessage={<Trans>No games with a timestamp in this window.</Trans>}
      >
        <ChartContainer config={CHART} className="aspect-auto h-full min-h-0 w-full">
          <ComposedChart data={rows} margin={scaleMargin({ top: 4, right: 4, bottom: 0, left: -24 })}>
            <CartesianGrid vertical={false} stroke="var(--bb-hairline)" />
            <XAxis
              dataKey="hour"
              tickLine={false}
              axisLine={{ stroke: 'var(--bb-edge)' }}
              tickMargin={scalePx(7)}
              interval={3}
              tick={{
                fontSize: rem(9.5),
                fill: 'var(--bb-dim-2)',
                fontFamily: 'var(--font-mono)',
              }}
            />
            <YAxis
              yAxisId="games"
              tickLine={false}
              axisLine={false}
              width={scalePx(40)}
              allowDecimals={false}
              tick={{
                fontSize: rem(10),
                fill: 'var(--bb-dim-2)',
                fontFamily: 'var(--font-mono)',
              }}
            />
            <YAxis yAxisId="rate" orientation="right" hide />
            <ChartTooltip
              cursor={{ fill: 'var(--bb-raised)' }}
              labelFormatter={(label) => {
                const hour = String(label)
                return t`${hour}:00 UTC`
              }}
              content={<ChartTooltipContent />}
            />
            <Bar
              yAxisId="games"
              dataKey="games"
              fill="var(--color-games)"
              radius={[scalePx(3), scalePx(3), 0, 0]}
              isAnimationActive={false}
            />
            <Line
              yAxisId="rate"
              type="monotone"
              dataKey="blundersPerGame"
              stroke="var(--color-blundersPerGame)"
              strokeWidth={scalePx(1.8)}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          </ComposedChart>
        </ChartContainer>
      </Async>
    </StatCard>
  )
}
