/**
 * Blunders by the piece that moved, over `/stats/blunders_by_piece`.
 *
 * The design has no piece card, so it borrows the phase card's shell and draws the
 * distribution as a Recharts bar chart in the same palette: the piece you lose the most
 * eval with is painted blunder red, the rest stay in the neutral ramp.
 */
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from 'recharts'

import { useStats } from '@/lib/api/queries'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import type { GameFilters, StatsBucket } from '@/lib/api/types'
import { rem, scaleMargin, scalePx } from '@/lib/ui/scale'

import { Async, LoadingChart, StatCard } from '../kit/states'
import { asPercent, buckets, numOr, total } from '../kit/analytics'

/** The backend's `PIECES`, in the order a chess player expects to read them. */
const PIECES: { key: string; label: string }[] = [
  { key: 'pawn', label: 'Pawn' },
  { key: 'knight', label: 'Knight' },
  { key: 'bishop', label: 'Bishop' },
  { key: 'rook', label: 'Rook' },
  { key: 'queen', label: 'Queen' },
  { key: 'king', label: 'King' },
]

const CHART: ChartConfig = {
  blunders: { label: 'Blunders', color: 'var(--bb-blunder)' },
}

export function BlundersByPieceCard({ filters }: { filters: GameFilters }) {
  const query = useStats('blunders_by_piece', filters)
  const found = buckets(query.data)
  const overall = total(query.data)
  const all = numOr(overall, 'blunder')

  const rows = PIECES.map(({ key, label }) => {
    const bucket = found.find((entry: StatsBucket) => entry.key === key)
    return {
      piece: label,
      blunders: numOr(bucket, 'blunder'),
      moves: numOr(bucket, 'moves'),
      rate: asPercent(numOr(bucket, 'blunder_rate')) ?? 0,
    }
  })
  const worst = rows.reduce((best, row) => (row.blunders > best.blunders ? row : best), rows[0])

  return (
    <StatCard
      title="Blunders by piece"
      aside={<span className="font-mono text-[0.65625rem] tabular text-dim-2">count · rate</span>}
      footer={
        query.data
          ? all === 0
            ? 'Nothing to blame on any one piece in this window.'
            : `The ${worst.piece.toLowerCase()} costs you most: ${worst.blunders} of ${all}, ${worst.rate.toFixed(1)}% of the ${worst.moves.toLocaleString()} times you moved it.`
          : undefined
      }
    >
      <Async
        query={query}
        loading={<LoadingChart />}
        empty={numOr(overall, 'moves') === 0}
        emptyMessage="No analysed moves in this window, so nothing has a piece attached to it yet."
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
                    return `${String(value)} · ${row ? row.rate.toFixed(1) : '—'}% of ${row?.moves.toLocaleString() ?? '—'}`
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
