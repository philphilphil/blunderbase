/**
 * Performance by time of day, over `/stats/performance_by_hour`.
 *
 * The service buckets on the hour plus a `tz_offset` option, but `/stats/{dimension}`
 * forwards only the game filters — no dimension options reach it — so the hours are UTC
 * and the axis says so. Every hour is drawn, including the ones with no games, because a
 * day with holes in it is not a day.
 */
import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts'

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { useStats } from '@/lib/api/queries'
import type { GameFilters, StatsBucket } from '@/lib/api/types'
import { rem, scaleMargin, scalePx } from '@/lib/ui/scale'

import { Async, LoadingChart, LegendSwatch, StatCard } from '../kit/states'
import { asPercent, buckets, numOr } from '../kit/analytics'

const CHART: ChartConfig = {
  games: { label: 'Games', color: 'var(--bb-faint-2)' },
  blundersPerGame: { label: 'Blunders / game', color: 'var(--bb-accent)' },
}

const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'))

interface Row {
  hour: string
  games: number
  blundersPerGame: number | null
  score: number
  analyzed: number
}

function sentence(rows: Row[]): string | undefined {
  const scored = rows.filter((row) => row.analyzed >= 2 && row.blundersPerGame !== null)
  if (scored.length < 2) return undefined
  const worst = scored.reduce((a, b) =>
    (b.blundersPerGame ?? 0) > (a.blundersPerGame ?? 0) ? b : a,
  )
  const best = scored.reduce((a, b) =>
    (b.blundersPerGame ?? 0) < (a.blundersPerGame ?? 0) ? b : a,
  )
  if (worst.hour === best.hour) return undefined
  return `You are at your loosest around ${worst.hour}:00 UTC (${(worst.blundersPerGame ?? 0).toFixed(1)} blunders a game) and at your tightest around ${best.hour}:00 (${(best.blundersPerGame ?? 0).toFixed(1)}).`
}

export function TimeOfDayCard({ filters }: { filters: GameFilters }) {
  const query = useStats('performance_by_hour', filters)
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

  return (
    <StatCard
      title="Performance by time of day"
      aside={
        <div className="flex items-center gap-3">
          <LegendSwatch color="var(--bb-faint-2)">games</LegendSwatch>
          <LegendSwatch color="var(--bb-accent)">blunders/game</LegendSwatch>
        </div>
      }
      footer={
        <>
          {query.data ? sentence(rows) : null}
          <span className="block font-mono text-[0.625rem] tabular text-faint">
            hour of day, UTC — the API cannot take a timezone offset yet
          </span>
        </>
      }
    >
      <Async
        query={query}
        loading={<LoadingChart />}
        empty={found.length === 0}
        emptyMessage="No games with a timestamp in this window."
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
              labelFormatter={(label) => `${String(label)}:00 UTC`}
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
