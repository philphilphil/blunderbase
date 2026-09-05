/**
 * Design 2d, "Eval loss by clock remaining" — over `/stats/time_trouble_loss`.
 *
 * The backend measures loss in win percentage rather than centipawns, so the bars are the
 * average win percentage a move gave away in each clock band. Moves whose game carried no
 * clock times land in an `unknown` bucket, which is reported under the chart rather than
 * drawn as if it were a band.
 */
import type { I18n, MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from 'recharts'

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import type { StatsBucket } from '@/lib/api/types'
import { rem, scaleMargin, scalePx } from '@/lib/ui/scale'

import { Async, LoadingChart, StatCard, type StatsQuery } from '../kit/states'
import { buckets, numOr } from '../kit/analytics'

/**
 * `<10s` / `<30s` / `<60s` / `>=60s`, as `stats._time_trouble_loss` spells its keys.
 *
 * Only the `<` band has a word in it, so only that one is a message; the others are a
 * duration and a sign, which read the same in every language.
 */
function bandLabel(key: string, i18n: I18n): string {
  if (key.startsWith('>=')) return `${key.slice(2)}+`
  if (key.startsWith('<')) {
    const seconds = key.slice(1)
    return i18n._(msg`under ${seconds}`)
  }
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
  loss: { label: <Trans>Win % given away</Trans>, color: 'var(--bb-mistake)' },
}

/** A descriptor rather than a sentence, so the card resolves it in the reader's language. */
function sentence(rows: { label: string; loss: number }[]): MessageDescriptor | undefined {
  if (rows.length < 2) return undefined
  const tightest = rows[0]
  const calmest = rows[rows.length - 1]
  if (calmest.loss <= 0) return undefined
  const ratio = tightest.loss / calmest.loss
  if (ratio < 1.2) return msg`The clock is not what is costing you anything here.`
  const band = tightest.label
  const factor = ratio.toFixed(1)
  return msg`With ${band} on the clock you give away ${factor}× what you give away at leisure. No surprise, but it is now numbered.`
}

export function ClockPressureCard({ query }: { query: StatsQuery }) {
  const { i18n, t } = useLingui()
  const all = buckets(query.data)
  const unknown = all.find((bucket: StatsBucket) => bucket.key === 'unknown')
  const rows = all
    .filter((bucket: StatsBucket) => bucket.key !== 'unknown')
    .map((bucket: StatsBucket) => ({
      key: bucket.key,
      label: bandLabel(bucket.key, i18n),
      loss: Number(numOr(bucket, 'avg_win_loss').toFixed(2)),
      moves: numOr(bucket, 'moves'),
      blunders: numOr(bucket, 'blunder'),
    }))

  const unknownMoves = numOr(unknown, 'moves')
  const unclocked = unknownMoves.toLocaleString()
  const said = query.data ? sentence(rows) : undefined

  return (
    <StatCard
      title={t`Eval loss by clock remaining`}
      aside={
        <span className="font-mono text-[0.65625rem] tabular text-dim-2">
          <Trans>avg win % given away</Trans>
        </span>
      }
      footer={
        <>
          {said ? i18n._(said) : null}
          {unknownMoves > 0 && rows.length > 0 ? (
            <span className="block font-mono text-[0.625rem] tabular text-faint">
              <Trans>{unclocked} moves have no clock and are left out</Trans>
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
          unknownMoves > 0 ? (
            <Trans>
              None of the {unclocked} analysed moves in this window carry clock times, so there is
              no time trouble to measure. Lichess and Chess.com exports include them; a plain PGN
              often does not.
            </Trans>
          ) : (
            <Trans>No analysed moves in this window.</Trans>
          )
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
                    const loss = String(value)
                    const moves = row?.moves.toLocaleString() ?? '—'
                    return t`${loss}% over ${moves} moves`
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
