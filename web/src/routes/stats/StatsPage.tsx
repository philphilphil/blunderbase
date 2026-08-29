/**
 * Design 2d — the aggregation dashboards.
 *
 * One filter set (window · colour) drives every card: the same `GameFilters` vocabulary
 * `/games` takes, forwarded to each `/stats/{dimension}`. The "vs previous" control turns
 * the KPI row into a comparison with the equally long window before it, over
 * `/stats/compare`.
 *
 * The tile row is the design's five, at its anatomy, but two of its metrics do not exist:
 * `/stats` has no accuracy and no aggregate ACPL — `services.stats` aggregates win percentage
 * given away, while the game page derives ACPL from its move evaluations only, and nothing
 * computes an accuracy score. Their
 * slots carry the two numbers the same aggregation does answer, on the same axis: `Win %
 * given away` (`avg_win_loss`, the average a move costs) and `Blunder rate` (the share of
 * moves that were one). Same question — how expensive are your moves — in real units.
 */
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { SetPageChrome } from '@/components/shell/PageChrome'
import { PageBody, PageHeader } from '@/components/shell/PageHeader'
import { useProfile, useStats } from '@/lib/api/queries'
import type { Color, GameFilters, StatsBucket } from '@/lib/api/types'
import { useIsMobile } from '@/lib/ui/media'
import { cn } from '@/lib/utils'

import { BlundersByPhaseCard } from './cards/BlundersByPhaseCard'
import { BlundersByPieceCard } from './cards/BlundersByPieceCard'
import { ClockPressureCard } from './cards/ClockPressureCard'
import { ProgressCard } from './cards/ProgressCard'
import { TimeControlCard } from './cards/TimeControlCard'
import { TimeOfDayCard } from './cards/TimeOfDayCard'
import {
  DEFAULT_WINDOWS,
  WINDOW_LABELS,
  anchorOf,
  asPercent,
  deltaTone,
  formatCount,
  formatDelta,
  num,
  numOr,
  precedingWindow,
  total,
  useCompare,
  windowProse,
  windowRange,
  type WindowKey,
} from './kit/analytics'
import { downloadCsv, exportRows, toCsv } from './kit/csv'
import { REPORTS, reportFrom } from './reports'
import { DeltaText, Segmented, StatTile } from './kit/states'

type ColorChoice = 'both' | Color

/** What `/stats/compare` answers with under `delta` — the same buckets, as movements. */
interface DeltaPayload {
  buckets?: StatsBucket[]
  total?: StatsBucket
}

export function StatsPage() {
  const [params] = useSearchParams()
  const report = reportFrom(params)
  const reportLabel = REPORTS.find((entry) => entry.key === report)!.label
  const profile = useProfile()
  const lastGame =
    typeof profile.data?.volume?.last_game === 'string' ? profile.data.volume.last_game : null

  const [windowKey, setWindowKey] = useState<WindowKey>('90d')
  const [color, setColor] = useState<ColorChoice>('both')
  const [comparing, setComparing] = useState(false)

  // Every window ends at the newest game rather than at the clock, so a database that has
  // not been synced this month still has a "last 90 days" worth reading. See `anchorOf`.
  const anchor = useMemo(() => anchorOf(lastGame), [lastGame])

  const filters = useMemo<GameFilters>(
    () => ({
      ...windowRange(windowKey, anchor),
      ...(color === 'both' ? {} : { color }),
    }),
    [windowKey, anchor, color],
  )

  // Each of these shares its cache entry with the card that draws it — same key, one
  // fetch — and together they are what "Export CSV" writes out.
  const speed = useStats('performance_by_speed', filters)
  const phase = useStats('blunders_by_phase', filters)
  const piece = useStats('blunders_by_piece', filters)
  const clock = useStats('time_trouble_loss', filters)
  const hour = useStats('performance_by_hour', filters)
  const trend = useStats('rating_trend', filters)

  const canCompare = precedingWindow(filters) !== null
  const compareSpeed = useCompare('performance_by_speed', filters, {
    enabled: comparing,
  })
  const comparePhase = useCompare('blunders_by_phase', filters, {
    enabled: comparing,
  })

  const speedTotal = total(speed.data)
  const phaseTotal = total(phase.data)
  const speedDelta = comparing ? (compareSpeed.data?.delta as DeltaPayload | undefined) : undefined
  const phaseDelta = comparing ? (comparePhase.data?.delta as DeltaPayload | undefined) : undefined
  const comparePending = compareSpeed.isPending || comparePhase.isPending

  const games = numOr(speedTotal, 'games')
  const analysed = numOr(speedTotal, 'analyzed_games')
  const score = asPercent(num(speedTotal, 'score'))
  const perGame = num(speedTotal, 'blunders_per_game')
  const winLoss = num(phaseTotal, 'avg_win_loss')
  const blunderRate = asPercent(num(phaseTotal, 'blunder_rate'))

  function download() {
    const csv = toCsv(
      exportRows([
        { dimension: 'performance_by_speed', data: speed.data },
        { dimension: 'blunders_by_phase', data: phase.data },
        { dimension: 'blunders_by_piece', data: piece.data },
        { dimension: 'time_trouble_loss', data: clock.data },
        { dimension: 'performance_by_hour', data: hour.data },
        { dimension: 'rating_trend', data: trend.data },
      ]),
    )
    downloadCsv(`blunderbase-stats-${windowKey}${color === 'both' ? '' : `-${color}`}.csv`, csv)
  }

  /** The small mono clause under a KPI: a movement while comparing, a unit otherwise. */
  function suffix(value: number | null, unit: string, lowerIsBetter: boolean, digits = 1) {
    if (!comparing || !canCompare) {
      return <span className="font-mono text-[0.6875rem] text-dim">{unit}</span>
    }
    if (comparePending) return <span className="font-mono text-[0.6875rem] text-faint">…</span>
    return (
      <DeltaText tone={deltaTone(value, lowerIsBetter)}>{formatDelta(value, digits)}</DeltaText>
    )
  }

  /**
   * Design 2d puts the window and colour controls in the 46px titlebar, not in the page
   * header — they scope every card on the screen, not just the one below them. Below `md`
   * they come back down into the page: seven buttons will not share that bar with a
   * breadcrumb and the queue widget, and clipped into fragments they are worse than absent.
   * They still scope everything, so moving them is the only option — dropping them is not.
   *
   * Rendered at one place or the other rather than both-with-one-hidden: they are a live
   * control over the page's filters, and two of them would be two things claiming to say
   * what the screen is showing.
   */
  const mobile = useIsMobile()
  const scope = (
    <>
      <Segmented
        label="Window"
        value={windowKey}
        onChange={setWindowKey}
        options={DEFAULT_WINDOWS.map((key) => ({
          value: key,
          label: WINDOW_LABELS[key],
        }))}
      />
      <Segmented
        label="Colour"
        value={color}
        onChange={setColor}
        options={[
          { value: 'both', label: 'both' },
          { value: 'white', label: 'white' },
          { value: 'black', label: 'black' },
        ]}
      />
    </>
  )

  return (
    <PageBody className="gap-3.5">
      <SetPageChrome
        breadcrumb={
          report === 'overview'
            ? [{ label: 'Stats' }]
            : [{ label: 'Stats', to: '/stats' }, { label: reportLabel }]
        }
        actions={mobile ? null : scope}
      />
      <PageHeader
        title="Stats"
        description={
          speed.isPending
            ? 'Reading the aggregations…'
            : `${formatCount(analysed)} analysed of ${formatCount(games)} games · ${windowProse(
                windowKey,
                anchor,
              )} · ${color === 'both' ? 'both colours' : `as ${color}`}`
        }
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!canCompare}
              aria-pressed={comparing && canCompare}
              onClick={() => setComparing((on) => !on)}
              title={
                canCompare
                  ? 'Show every number against the equally long window before this one'
                  : 'All time has nothing before it to compare against'
              }
              className={cn(
                'rounded-md border px-2.5 py-[0.3125rem] text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                comparing && canCompare
                  ? 'border-accent-teal/30 bg-accent-teal/10 text-accent-teal'
                  : 'border-input text-soft hover:border-edge-hover hover:text-ink',
              )}
            >
              vs previous
            </button>
            <button
              type="button"
              onClick={download}
              disabled={!speed.data}
              className="rounded-md border border-input px-2.5 py-[0.3125rem] text-xs text-soft transition-colors hover:border-edge-hover hover:text-ink disabled:opacity-40"
            >
              Export CSV
            </button>
          </div>
        }
      />

      {/* Each `Segmented` names itself, so the row wrapping them needs no label of its
          own — the two together are ~340px and take a line each on a 375px screen. */}
      {mobile ? <div className="flex flex-wrap items-center gap-2">{scope}</div> : null}

      {/* Five tiles across is 70px each on a phone, which fits neither a label nor a
          22px number. Below `md` they go two to a line, and the fifth — the one that
          would otherwise sit alone in half a row — takes the whole last one. */}
      <div className="grid flex-none grid-cols-2 gap-2.5 md:flex md:gap-3">
        <StatTile
          label="Games"
          value={speed.isPending ? '—' : formatCount(games)}
          suffix={suffix(num(speedDelta?.total, 'games'), 'analysed', false, 0)}
        />
        <StatTile
          label="Score"
          value={score === null ? '—' : `${score.toFixed(1)}%`}
          suffix={suffix(asPercent(num(speedDelta?.total, 'score')), 'of the point', false)}
        />
        <StatTile
          label="Blunders per game"
          value={perGame === null ? '—' : perGame.toFixed(1)}
          tone={perGame !== null && perGame > 1 ? 'blunder' : 'ink'}
          suffix={suffix(num(speedDelta?.total, 'blunders_per_game'), 'per game', true)}
        />
        <StatTile
          label="Win % given away"
          value={winLoss === null ? '—' : winLoss.toFixed(1)}
          suffix={suffix(num(phaseDelta?.total, 'avg_win_loss'), 'per move', true)}
        />
        <StatTile
          label="Blunder rate"
          value={blunderRate === null ? '—' : `${blunderRate.toFixed(1)}%`}
          suffix={suffix(asPercent(num(phaseDelta?.total, 'blunder_rate')), 'of your moves', true)}
          className="max-md:col-span-2"
        />
      </div>

      {/* Design 2d's grid: one report at a time, two by two, filling the frame rather than
          scrolling. The rows keep a floor so a short window scrolls instead of squeezing
          a chart to nothing — except the overview's first row, which holds the two compact
          cards (phase meters, time-control table) and is sized to their content so they
          read at about half height and hand the spare room to the charts underneath.
          The blunders report treats the phase card the same way: its stacked row is
          content-sized, and side by side on xl it self-starts against the piece chart,
          whose Recharts container needs the row to keep its 1fr height. */}
      <div
        className={cn(
          'grid min-h-0 flex-1 gap-3 grid-cols-1 xl:grid-cols-2',
          report === 'progress'
            ? 'grid-rows-[minmax(15rem,1fr)] xl:grid-cols-1'
            : report === 'overview'
              ? 'grid-rows-[repeat(2,minmax(7rem,auto))_repeat(2,minmax(15rem,1fr))] xl:grid-rows-[minmax(7rem,auto)_minmax(15rem,1fr)]'
              : report === 'blunders'
                ? 'grid-rows-[minmax(7rem,auto)_minmax(15rem,1fr)] xl:grid-rows-[minmax(15rem,1fr)]'
                : 'grid-rows-[repeat(2,minmax(15rem,1fr))] xl:grid-rows-[minmax(15rem,1fr)]',
        )}
      >
        {report === 'overview' ? (
          <>
            <BlundersByPhaseCard filters={filters} />
            <TimeControlCard filters={filters} />
            <ClockPressureCard filters={filters} />
            <ProgressCard filters={filters} />
          </>
        ) : null}
        {report === 'blunders' ? (
          <>
            <BlundersByPhaseCard filters={filters} className="xl:self-start" />
            <BlundersByPieceCard filters={filters} />
          </>
        ) : null}
        {report === 'clock' ? (
          <>
            <ClockPressureCard filters={filters} />
            <TimeOfDayCard filters={filters} />
          </>
        ) : null}
        {report === 'progress' ? <ProgressCard filters={filters} /> : null}
      </div>
    </PageBody>
  )
}
