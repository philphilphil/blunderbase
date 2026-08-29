/**
 * Design 2d, "Performance by time control" — the table over `/stats/performance_by_speed`.
 *
 * The design's last two columns are aggregate ACPL and accuracy. Neither exists in this
 * stats endpoint: the game page can derive one game's ACPL from its move evaluations, but
 * no service aggregates it across a bucket or computes accuracy. So the columns are the
 * two the data does support — blunders per game and the
 * average rating the bucket was played at — rather than an invented number.
 */
import { useStats } from '@/lib/api/queries'
import { SPEEDS, type GameFilters, type StatsBucket } from '@/lib/api/types'
import { cn } from '@/lib/utils'

import { Async, LoadingRows, StatCard } from '../kit/states'
import { asPercent, buckets, numOr } from '../kit/analytics'

const SPEED_LABELS: Record<string, string> = {
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
  classical: 'Classical',
  correspondence: 'Corr.',
  unknown: 'Unknown',
}

/** Fastest first, the way the design lists them; anything unrecognised falls to the end. */
function speedRank(key: string): number {
  const index = (SPEEDS as readonly string[]).indexOf(key)
  return index === -1 ? SPEEDS.length : index
}

function scoreTone(score: number): string {
  if (score >= 52) return 'text-good'
  if (score < 45) return 'text-blunder'
  return 'text-body'
}

function blunderTone(perGame: number): string {
  if (perGame <= 1) return 'text-good'
  if (perGame <= 2) return 'text-mistake'
  return 'text-blunder'
}

interface Row {
  key: string
  label: string
  games: number
  wins: number
  draws: number
  losses: number
  score: number
  blundersPerGame: number
  rating: number | null
  analyzed: number
}

function sentence(rows: Row[]): string | undefined {
  const scored = rows.filter((row) => row.analyzed > 0)
  if (scored.length < 2) return undefined
  const fast = scored[0]
  const slow = scored[scored.length - 1]
  const gap = fast.blundersPerGame - slow.blundersPerGame
  if (Math.abs(gap) < 0.15) return 'The clock barely changes how many pieces you give away.'
  return gap > 0
    ? `${fast.label} costs you ${gap.toFixed(1)} more blunders a game than ${slow.label.toLowerCase()}. Time is the cheapest thing you can buy.`
    : `You blunder ${Math.abs(gap).toFixed(1)} more per game at ${slow.label.toLowerCase()} than at ${fast.label.toLowerCase()}, which is the opposite of the usual excuse.`
}

export function TimeControlCard({ filters }: { filters: GameFilters }) {
  const query = useStats('performance_by_speed', filters)
  const rows: Row[] = buckets(query.data)
    .map((bucket: StatsBucket) => ({
      key: bucket.key,
      label: SPEED_LABELS[bucket.key] ?? bucket.key,
      games: numOr(bucket, 'games'),
      wins: numOr(bucket, 'wins'),
      draws: numOr(bucket, 'draws'),
      losses: numOr(bucket, 'losses'),
      score: asPercent(numOr(bucket, 'score')) ?? 0,
      blundersPerGame: numOr(bucket, 'blunders_per_game'),
      rating: numOr(bucket, 'avg_rating'),
      analyzed: numOr(bucket, 'analyzed_games'),
    }))
    .sort((a, b) => speedRank(a.key) - speedRank(b.key))

  const busiest = rows.reduce<Row | null>(
    (best, row) => (best === null || row.games > best.games ? row : best),
    null,
  )

  return (
    <StatCard
      compact
      title="Performance by time control"
      aside={<span className="font-mono text-[0.625rem] tabular text-dim-2">score · blunders</span>}
      footer={query.data ? sentence(rows) : undefined}
    >
      <Async
        query={query}
        loading={<LoadingRows compact rows={4} />}
        empty={rows.length === 0}
        emptyMessage="No games in this window. Import a few, or widen the window."
      >
        {/* Six numeric columns are ~22rem at their narrowest, so below `md` this one table
            scrolls sideways inside itself rather than reflowing. Stacking a row would put
            "Blitz" over "1,284" over "48.2" over "1.4" over "1612" and lose the only thing
            the table is for — reading one speed against another down a column. */}
        <div className="flex min-h-0 flex-1 flex-col max-md:overflow-x-auto">
          <div className="flex h-[1.125rem] flex-none items-center gap-2.5 border-b border-hairline text-[0.5625rem] tracking-[0.06em] text-dim-2 uppercase max-md:min-w-[22rem]">
            <span className="w-[4.75rem] flex-none">Control</span>
            <span className="w-11 flex-none text-right">Games</span>
            <span className="flex-1">Score</span>
            <span className="w-12 flex-none text-right">Score%</span>
            <span className="w-12 flex-none text-right">Bl/g</span>
            <span className="w-11 flex-none text-right">Rating</span>
          </div>
          <div className="flex flex-1 flex-col justify-start pt-0.5 font-mono text-[0.6875rem] tabular max-md:min-w-[22rem]">
            {rows.map((row) => {
              const played = Math.max(1, row.wins + row.draws + row.losses)
              const highlight = busiest?.key === row.key && rows.length > 1
              return (
                <div
                  key={row.key}
                  className={cn(
                    'flex h-[1.25rem] items-center gap-2.5 rounded-[0.25rem] px-0.5',
                    highlight
                      ? 'bg-accent-teal/6 shadow-[inset_0_0_0_0.0625rem_color-mix(in_srgb,var(--bb-accent)_22%,transparent)]'
                      : 'hover:bg-elevated-2',
                  )}
                >
                  <span
                    className={cn(
                      'w-[4.75rem] flex-none truncate',
                      highlight ? 'text-bright' : 'text-body',
                    )}
                  >
                    {row.label}
                  </span>
                  <span
                    className={cn(
                      'w-11 flex-none text-right',
                      highlight ? 'text-body' : 'text-soft',
                    )}
                  >
                    {row.games}
                  </span>
                  <span
                    className="flex h-[0.3125rem] flex-1 overflow-hidden rounded-full"
                    title={`${row.wins}W · ${row.draws}D · ${row.losses}L`}
                  >
                    <span className="bg-good" style={{ width: `${(row.wins / played) * 100}%` }} />
                    <span
                      className="bg-faint"
                      style={{ width: `${(row.draws / played) * 100}%` }}
                    />
                    <span
                      className="bg-blunder"
                      style={{ width: `${(row.losses / played) * 100}%` }}
                    />
                  </span>
                  <span className={cn('w-12 flex-none text-right', scoreTone(row.score))}>
                    {row.score.toFixed(1)}
                  </span>
                  <span
                    className={cn(
                      'w-12 flex-none text-right',
                      row.analyzed > 0 ? blunderTone(row.blundersPerGame) : 'text-faint',
                    )}
                  >
                    {row.analyzed > 0 ? row.blundersPerGame.toFixed(1) : '—'}
                  </span>
                  <span className="w-11 flex-none text-right text-body">
                    {row.rating === null ? '—' : Math.round(row.rating)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </Async>
    </StatCard>
  )
}
