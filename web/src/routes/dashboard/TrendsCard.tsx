/**
 * Design 2a, the "This week" panel — three numbers and how they moved.
 *
 * The design names accuracy and ACPL. Neither exists in this backend, so the three are the
 * ones it does compute: blunders per game, the win percentage an average move gives away,
 * and the score. Movement comes from `/stats/compare` against the equally long window
 * before this one.
 */
import { useMemo, useState } from 'react'

import { useStats } from '@/lib/api/queries'
import { useProfile } from '@/lib/api/queries'
import type { GameFilters, StatsBucket } from '@/lib/api/types'
import { cn } from '@/lib/utils'

import {
  WINDOW_DAYS,
  WINDOW_LABELS,
  anchorOf,
  asPercent,
  deltaTone,
  formatDelta,
  num,
  numOr,
  total,
  useCompare,
  windowProse,
  windowRange,
  type WindowKey,
} from '@/routes/stats/kit/analytics'
import { Bar, DeltaText, EmptyBlock, ErrorBlock, Segmented } from '@/routes/stats/kit/states'

const WINDOWS: WindowKey[] = ['7d', '30d', '90d']

interface DeltaPayload {
  total?: StatsBucket
}

interface Metric {
  label: string
  value: string
  delta: number | null
  lowerIsBetter: boolean
  digits: number
}

function sentence(metrics: Metric[]): string | null {
  const [blunders, , score] = metrics
  if (blunders.delta === null || score.delta === null) return null
  const fewer = blunders.delta < 0
  const better = score.delta > 0
  if (Math.abs(blunders.delta) < 0.05 && Math.abs(score.delta) < 1) {
    return 'Nothing has moved either way. A flat window is still a window.'
  }
  if (fewer && better) return 'Fewer blunders and more points. Whatever you changed, keep it.'
  if (fewer && !better) {
    return 'Fewer blunders, fewer points. You are losing the game in smaller pieces now.'
  }
  if (!fewer && better) return 'More blunders and more points. You are getting away with it.'
  return 'More blunders and fewer points. The two usually travel together.'
}

export function TrendsCard({ className }: { className?: string }) {
  const profile = useProfile()
  const lastGame =
    typeof profile.data?.volume?.last_game === 'string' ? profile.data.volume.last_game : null
  const [windowKey, setWindowKey] = useState<WindowKey>('30d')

  // Anchored on the newest game rather than on the clock, so "the last 30 days" means the
  // last 30 days of play even when the archive stops years ago. See `anchorOf`.
  const anchor = useMemo(() => anchorOf(lastGame), [lastGame])
  const filters = useMemo<GameFilters>(() => windowRange(windowKey, anchor), [windowKey, anchor])
  const speed = useStats('performance_by_speed', filters)
  const phase = useStats('blunders_by_phase', filters)
  const compareSpeed = useCompare('performance_by_speed', filters)
  const comparePhase = useCompare('blunders_by_phase', filters)

  const speedTotal = total(speed.data)
  const phaseTotal = total(phase.data)
  const speedDelta = compareSpeed.data?.delta as DeltaPayload | undefined
  const phaseDelta = comparePhase.data?.delta as DeltaPayload | undefined

  const games = numOr(speedTotal, 'games')
  const perGame = num(speedTotal, 'blunders_per_game')
  const winLoss = num(phaseTotal, 'avg_win_loss')
  const score = asPercent(num(speedTotal, 'score'))

  const metrics: Metric[] = [
    {
      label: 'Blunders per game',
      value: perGame === null ? '—' : perGame.toFixed(1),
      delta: num(speedDelta?.total, 'blunders_per_game'),
      lowerIsBetter: true,
      digits: 1,
    },
    {
      label: 'Win % given away',
      value: winLoss === null ? '—' : winLoss.toFixed(1),
      delta: num(phaseDelta?.total, 'avg_win_loss'),
      lowerIsBetter: true,
      digits: 1,
    },
    {
      label: 'Score',
      value: score === null ? '—' : `${score.toFixed(0)}%`,
      delta: asPercent(num(speedDelta?.total, 'score')),
      lowerIsBetter: false,
      digits: 1,
    },
  ]

  const dry = sentence(metrics)

  return (
    <section
      className={cn(
        'flex flex-col gap-3 rounded-xl border border-line bg-panel p-[0.8125rem]',
        className,
      )}
    >
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">
            Last {WINDOW_DAYS[windowKey as Exclude<WindowKey, 'all'>]} days
          </h2>
          <Segmented
            className="shrink-0"
            label="Trend window"
            value={windowKey}
            onChange={setWindowKey}
            options={WINDOWS.map((key) => ({
              value: key,
              label: WINDOW_LABELS[key],
            }))}
          />
        </div>
        <span className="font-mono text-[0.625rem] tabular text-dim-2">
          {speed.isPending ? '…' : `${games} game${games === 1 ? '' : 's'}`} ·{' '}
          {windowProse(windowKey, anchor)
            .replace(/^the last \d+ days$/, 'to today')
            .replace(/^the \d+ days /, '')}
        </span>
      </header>

      {speed.isError ? (
        <ErrorBlock
          error={speed.error}
          onRetry={() => void speed.refetch()}
          className="flex-none"
        />
      ) : speed.isPending ? (
        <div className="flex flex-col gap-2.5" data-testid="loading">
          <Bar className="h-4 w-full" />
          <Bar className="h-4 w-full" />
          <Bar className="h-4 w-full" />
        </div>
      ) : games === 0 ? (
        <EmptyBlock className="flex-none">
          No games in {windowProse(windowKey, anchor)}. Widen the window, or play some chess.
        </EmptyBlock>
      ) : (
        <>
          <div className="flex flex-col gap-2.5">
            {metrics.map((metric) => (
              <div key={metric.label} className="flex items-baseline gap-2">
                <span className="flex-1 text-[0.71875rem] text-soft">{metric.label}</span>
                <span className="font-mono text-[0.9375rem] tabular text-ink">{metric.value}</span>
                <span className="w-11 text-right">
                  {compareSpeed.isPending || comparePhase.isPending ? (
                    <span className="font-mono text-[0.6875rem] text-faint">…</span>
                  ) : (
                    <DeltaText tone={deltaTone(metric.delta, metric.lowerIsBetter)}>
                      {formatDelta(metric.delta, metric.digits)}
                    </DeltaText>
                  )}
                </span>
              </div>
            ))}
          </div>
          <p className="border-t border-hairline pt-2.5 text-[0.6875rem] leading-relaxed text-dim-2">
            {dry ?? `Against the ${windowKey} before this one, once there is one to compare.`}
          </p>
        </>
      )}
    </section>
  )
}
