/**
 * Design 2c's "Your results in this line" card: the win/draw/loss bar, the score, the
 * average win percentage given away from here and the continuation that costs the most.
 *
 * The bar and the score are every game through the position; the two accuracy readings
 * are the owner's own moves only, because that is what the service now counts. At a
 * position where the opponent is to move there are no owner moves to average, so
 * `averageDrop` is null and shows an em dash and `worstContinuation` has no candidate and
 * the "worst move here" corner drops out — right, since nothing on the card would be the
 * owner's play. Both are already null-safe; neither invents a zero.
 */
import { Skeleton } from '@/components/ui/skeleton'
import type { ExplorerResponse } from '@/lib/api/types'
import { cn } from '@/lib/utils'

import { plyLabel } from '../line'
import {
  averageDrop,
  dropTone,
  formatAvgDrop,
  scorePercent,
  scoreTone,
  splitOf,
  worstContinuation,
} from '../stats'
import { ScoreBar } from './ScoreBar'

export function LineSummary({
  tree,
  ply,
  loading,
}: {
  tree: ExplorerResponse | undefined
  ply: number
  loading: boolean
}) {
  if (loading || !tree) {
    return (
      <div className="flex flex-col gap-3 rounded-[0.5625rem] border border-line bg-panel p-3.5">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    )
  }

  const split = splitOf(tree.totals)
  const percent = scorePercent(tree.totals.score as number | null | undefined)
  const drop = averageDrop(tree.moves)
  const worst = worstContinuation(tree.moves)
  const endedHere = (tree.totals.ended_here as number | undefined) ?? 0

  return (
    <div className="flex flex-col gap-2.5 rounded-[0.5625rem] border border-line bg-panel p-3.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[0.75rem] font-semibold text-ink">Your results in this line</span>
        <div className="flex-1" />
        <span className="font-mono text-[0.6875rem] tabular text-dim">
          {split.games} {split.games === 1 ? 'game' : 'games'}
        </span>
      </div>

      {split.games === 0 ? (
        <p className="py-3 text-[0.78125rem] leading-relaxed text-dim">
          You have never had this position on the board. Walk back a move, or play a different
          continuation.
        </p>
      ) : (
        <>
          <ScoreBar split={split} height="0.5rem" />
          <div className="flex font-mono text-[0.6875rem] tabular text-soft-2">
            <span className="flex-1">{split.wins} W</span>
            <span className="flex-1 text-center">{split.draws} D</span>
            <span className="flex-1 text-right">{split.losses} L</span>
          </div>

          {/* Three stats and the worst move are wider than a phone; they wrap rather
              than push the card sideways. */}
          <div className="flex gap-5 border-t border-hairline pt-2.5 max-md:flex-wrap max-md:gap-x-4 max-md:gap-y-2.5">
            <Stat
              label="Score"
              value={percent === null ? '—' : `${percent.toFixed(1)}%`}
              tone={scoreTone(tree.totals.score as number | null | undefined)}
            />
            <Stat label="Avg. drop" value={formatAvgDrop(drop)} tone={dropTone(drop)} />
            <Stat
              label="Ended here"
              value={String(endedHere)}
              tone={endedHere > 0 ? 'text-soft' : 'text-dim-2'}
            />
            <div className="flex-1" />
            {worst ? (
              <div className="flex flex-col items-end gap-[0.1875rem]">
                <span className="text-[0.65625rem] text-dim-2">Worst move here</span>
                <span className={cn('font-mono text-[0.8125rem]', dropTone(worst.avg_win_loss))}>
                  {plyLabel(ply)}
                  {worst.san}
                </span>
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="flex flex-col gap-[0.1875rem]">
      <span className="text-[0.65625rem] text-dim-2">{label}</span>
      <span className={cn('font-mono text-[0.9375rem] tabular', tone)}>{value}</span>
    </div>
  )
}
