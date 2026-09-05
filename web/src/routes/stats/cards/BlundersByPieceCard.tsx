/**
 * Blunders by the piece that moved, over `/stats/blunders_by_piece`.
 *
 * The design has no piece card, so it borrows the phase card's shell and draws the
 * distribution as a Recharts bar chart in the same palette: the piece you lose the most
 * eval with is painted blunder red, the rest stay in the neutral ramp.
 */
import type { MessageDescriptor } from '@lingui/core'
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
import { asPercent, buckets, numOr, total } from '../kit/analytics'

/** The backend's `PIECES`, in the order a chess player expects to read them. */
const PIECES: { key: string; label: MessageDescriptor }[] = [
  { key: 'pawn', label: msg`Pawn` },
  { key: 'knight', label: msg`Knight` },
  { key: 'bishop', label: msg`Bishop` },
  { key: 'rook', label: msg`Rook` },
  { key: 'queen', label: msg`Queen` },
  { key: 'king', label: msg`King` },
]

/**
 * The pieces as words inside a sentence. A second table rather than the label lowercased:
 * lowercasing a translated noun is an English habit ("springer" is wrong in German).
 */
const PIECE_WORDS: Record<string, MessageDescriptor> = {
  pawn: msg`pawn`,
  knight: msg`knight`,
  bishop: msg`bishop`,
  rook: msg`rook`,
  queen: msg`queen`,
  king: msg`king`,
}

const CHART: ChartConfig = {
  blunders: { label: <Trans>Blunders</Trans>, color: 'var(--bb-blunder)' },
}

export function BlundersByPieceCard({ query }: { query: StatsQuery }) {
  const { i18n, t } = useLingui()
  const found = buckets(query.data)
  const overall = total(query.data)
  const all = numOr(overall, 'blunder')

  const rows = PIECES.map(({ key, label }) => {
    const bucket = found.find((entry: StatsBucket) => entry.key === key)
    return {
      key,
      piece: i18n._(label),
      blunders: numOr(bucket, 'blunder'),
      moves: numOr(bucket, 'moves'),
      rate: asPercent(numOr(bucket, 'blunder_rate')) ?? 0,
    }
  })
  const worst = rows.reduce((best, row) => (row.blunders > best.blunders ? row : best), rows[0])

  // Named locals rather than expressions in the template: the identifier is what a
  // translator sees as the placeholder.
  const piece = i18n._(PIECE_WORDS[worst.key])
  const blunders = worst.blunders
  const rate = worst.rate.toFixed(1)
  const moves = worst.moves.toLocaleString()
  const sentence =
    all === 0
      ? t`Nothing to blame on any one piece in this window.`
      : t`The ${piece} costs you most: ${blunders} of ${all}, ${rate}% of the ${moves} times you moved it.`

  return (
    <StatCard
      title={t`Blunders by piece`}
      aside={
        <span className="font-mono text-[0.65625rem] tabular text-dim-2">
          <Trans>count · rate</Trans>
        </span>
      }
      footer={query.data ? sentence : undefined}
    >
      <Async
        query={query}
        loading={<LoadingChart />}
        empty={numOr(overall, 'moves') === 0}
        emptyMessage={
          <Trans>No analysed moves in this window, so nothing has a piece attached to it yet.</Trans>
        }
      >
        <ChartContainer config={CHART} className="aspect-auto h-full min-h-0 w-full">
          <BarChart
            data={rows}
            margin={scaleMargin({ top: 4, right: 4, bottom: 0, left: -22 })}
            barCategoryGap="28%"
          >
            <CartesianGrid vertical={false} stroke="var(--bb-hairline)" />
            <XAxis
              dataKey="piece"
              tickLine={false}
              axisLine={{ stroke: 'var(--bb-edge)' }}
              tickMargin={scalePx(7)}
              tick={{ fontSize: rem(10), fill: 'var(--bb-dim-2)' }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={scalePx(44)}
              allowDecimals={false}
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
                    const count = String(value)
                    const share = row ? row.rate.toFixed(1) : '—'
                    const played = row?.moves.toLocaleString() ?? '—'
                    return t`${count} · ${share}% of ${played}`
                  }}
                />
              }
            />
            <Bar dataKey="blunders" radius={[scalePx(4), scalePx(4), 0, 0]} isAnimationActive={false}>
              {rows.map((row) => (
                <Cell
                  key={row.piece}
                  fill={
                    row.piece === worst.piece && row.blunders > 0
                      ? 'var(--bb-blunder)'
                      : 'var(--bb-faint-2)'
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      </Async>
    </StatCard>
  )
}
