/**
 * Design 2d, "Eval loss by clock remaining" — over `/stats/time_trouble_loss`.
 *
 * The backend measures loss in win percentage rather than centipawns, so the bars are the
 * average win percentage a move gave away in each clock band. Moves whose game carried no
 * clock times land in an `unknown` bucket, which is reported under the chart rather than
 * drawn as if it were a band.
 */
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from 'recharts'

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { useStats } from '@/lib/api/queries'
import type { GameFilters, StatsBucket } from '@/lib/api/types'
import { rem, scaleMargin, scalePx } from '@/lib/ui/scale'

import { Async, LoadingChart, StatCard } from '../kit/states'
import { buckets, numOr } from '../kit/analytics'

/** `<10s` / `<30s` / `<60s` / `>=60s`, as `stats._time_trouble_loss` spells its keys. */
function bandLabel(key: string): string {
  if (key.startsWith('>=')) return `${key.slice(2)}+`
  if (key.startsWith('<')) return `under ${key.slice(1)}`
  return key
}

/** Calm at leisure, red in the scramble — the design's ramp, read right to left. */
const BAND_COLORS = [
  'var(--bb-blunder)',
  'var(--bb-mistake)',
  'var(--bb-inaccuracy)',
  'var(--bb-faint)',
  'var(--bb-faint-2)',
]

const CHART: ChartConfig = {
  loss: { label: 'Win % given away', color: 'var(--bb-mistake)' },
}

function sentence(rows: { label: string; loss: number }[]): string | undefined {
  if (rows.length < 2) return undefined
  const tightest = rows[0]
  const calmest = rows[rows.length - 1]
  if (calmest.loss <= 0) return undefined
  const ratio = tightest.loss / calmest.loss
  if (ratio < 1.2) return 'The clock is not what is costing you anything here.'
  return `With ${tightest.label} on the clock you give away ${ratio.toFixed(1)}× what you give away at leisure. No surprise, but it is now numbered.`
}

export function ClockPressureCard({ filters }: { filters: GameFilters }) {
  const query = useStats('time_trouble_loss', filters)
  const all = buckets(query.data)
  const unknown = all.find((bucket: StatsBucket) => bucket.key === 'unknown')
  const rows = all
    .filter((bucket: StatsBucket) => bucket.key !== 'unknown')
    .map((bucket: StatsBucket) => ({
      key: bucket.key,
      label: bandLabel(bucket.key),
      loss: Number(numOr(bucket, 'avg_win_loss').toFixed(2)),
      moves: numOr(bucket, 'moves'),
      blunders: numOr(bucket, 'blunder'),
    }))

  const unknownMoves = numOr(unknown, 'moves')

  return (
    <StatCard
      title="Eval loss by clock remaining"
      aside={
        <span className="font-mono text-[0.65625rem] tabular text-dim-2">avg win % given away</span>
      }
      footer={
        <>
          {query.data ? sentence(rows) : null}
          {unknownMoves > 0 && rows.length > 0 ? (
            <span className="block font-mono text-[0.625rem] tabular text-faint">
              {unknownMoves.toLocaleString()} moves have no clock and are left out
            </span>
          ) : null}
        </>
      }
    >
      <Async
        query={query}
        loading={<LoadingChart />}
        empty={rows.length === 0}
        emptyMessage={
          unknownMoves > 0
            ? `None of the ${unknownMoves.toLocaleString()} analysed moves in this window carry clock times, so there is no time trouble to measure. Lichess and Chess.com exports include them; a plain PGN often does not.`
            : 'No analysed moves in this window.'
        }
      >
        <ChartContainer config={CHART} className="aspect-auto h-full min-h-0 w-full">
          <BarChart
            data={rows}
            margin={scaleMargin({ top: 4, right: 4, bottom: 0, left: -22 })}
            barCategoryGap="26%"
          >
            <CartesianGrid vertical={false} stroke="var(--bb-hairline)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: 'var(--bb-edge)' }}
              tickMargin={scalePx(7)}
              tick={{
                fontSize: rem(10),
                fill: 'var(--bb-dim-2)',
                fontFamily: 'var(--font-mono)',
              }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={scalePx(44)}
              unit="%"
              tick={{
                fontSize: rem(10),
                fill: 'var(--bb-dim-2)',
                fontFamily: 'var(--font-mono)',
              }}
            />
            <ChartTooltip
              cursor={{ fill: 'var(--bb-raised)' }}
              content={
                <ChartTooltipContent
                  formatter={(value, _name, item) => {
                    const row = item.payload as (typeof rows)[number] | undefined
                    return `${String(value)}% over ${row?.moves.toLocaleString() ?? '—'} moves`
                  }}
                />
              }
            />
            <Bar dataKey="loss" radius={[scalePx(4), scalePx(4), 0, 0]} isAnimationActive={false}>
              {rows.map((row, index) => (
                <Cell key={row.key} fill={BAND_COLORS[Math.min(index, BAND_COLORS.length - 1)]} />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      </Async>
    </StatCard>
  )
}
