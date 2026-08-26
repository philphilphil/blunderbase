/**
 * Design 2d, "Blunders by game phase" — three labelled meters over `/stats/blunders_by_phase`.
 *
 * The share is the share of *blunders*, not of moves: the question the card answers is
 * where they happen, and the blunder rate underneath it is what says whether that is
 * because more moves are played there.
 */
import { useStats } from '@/lib/api/queries'
import type { GameFilters, StatsBucket } from '@/lib/api/types'

import { Async, LoadingRows, MeterRow, StatCard } from '../kit/states'
import { asPercent, buckets, numOr, total } from '../kit/analytics'

/** The backend's `phase_of`: ply < 24 is the opening, and thin material is an endgame. */
const PHASES: { key: string; label: string; sub: string }[] = [
  { key: 'opening', label: 'Opening', sub: 'moves 1–12' },
  { key: 'middlegame', label: 'Middlegame', sub: 'moves 13+' },
  { key: 'endgame', label: 'Endgame', sub: 'thin material' },
]

/** Largest share reads as the problem, second as the runner-up, the rest stay quiet. */
const RANK_COLORS = ['var(--bb-blunder)', 'var(--bb-mistake)', 'var(--bb-faint-2)']

function sentence(rows: { label: string; blunders: number; share: number }[], all: number): string {
  if (all === 0)
    return 'No blunders in this window. Either you were careful or nothing has been analysed.'
  const worst = rows[0]
  if (!worst || worst.blunders === 0)
    return 'Every blunder in this window fell outside the three phases.'
  return `${worst.share.toFixed(0)}% of them happen in the ${worst.label.toLowerCase()}, where the position stops explaining itself.`
}

export function BlundersByPhaseCard({
  filters,
  className,
}: {
  filters: GameFilters
  className?: string
}) {
  const query = useStats('blunders_by_phase', filters)
  const found = buckets(query.data)
  const overall = total(query.data)
  const all = numOr(overall, 'blunder')

  const rows = PHASES.map(({ key, label, sub }) => {
    const bucket = found.find((entry: StatsBucket) => entry.key === key)
    const blunders = numOr(bucket, 'blunder')
    return {
      key,
      label,
      sub,
      blunders,
      moves: numOr(bucket, 'moves'),
      rate: asPercent(numOr(bucket, 'blunder_rate')) ?? 0,
      share: all > 0 ? (blunders / all) * 100 : 0,
    }
  })
  const ranked = [...rows].sort((a, b) => b.blunders - a.blunders)
  const colorOf = (key: string) =>
    RANK_COLORS[
      Math.min(
        ranked.findIndex((row) => row.key === key),
        RANK_COLORS.length - 1,
      )
    ]

  return (
    <StatCard
      compact
      className={className}
      title="Blunders by game phase"
      aside={
        <span className="font-mono text-[0.625rem] tabular text-dim-2">
          {all.toLocaleString()} blunder{all === 1 ? '' : 's'}
        </span>
      }
      footer={query.data ? sentence(ranked, all) : undefined}
    >
      <Async
        query={query}
        loading={<LoadingRows compact rows={3} className="justify-start" />}
        empty={numOr(overall, 'moves') === 0}
        emptyMessage="No analysed moves in this window. Run an analysis pass and the phases fill in."
      >
        <div className="flex flex-1 flex-col justify-start gap-2">
          {rows.map((row) => (
            <MeterRow
              compact
              key={row.key}
              label={row.label}
              sub={row.sub}
              value={row.blunders.toLocaleString()}
              share={row.share}
              color={colorOf(row.key)}
              emphasis={ranked[0]?.key === row.key && row.blunders > 0}
              title={`${row.blunders} blunders in ${row.moves.toLocaleString()} moves — ${row.rate.toFixed(1)}% of them`}
            />
          ))}
        </div>
      </Async>
    </StatCard>
  )
}
