/**
 * Design 2d — the aggregation dashboards.
 *
 * One filter set (window · colour · speed) drives every card: the same `GameFilters`
 * vocabulary `/games` takes, forwarded to each `/stats/{dimension}`. The "vs previous"
 * control turns the KPI row into a comparison with the equally long window before it, over
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
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'

import { SetPageChrome } from '@/components/shell/PageChrome'
import { PageBody, PageHeader } from '@/components/shell/PageHeader'
import { FilterChip } from '@/components/ui/chip'
import { useStatsDashboard } from '@/lib/api/queries'
import { SPEEDS } from '@/lib/api/types'
import type { Color, GameFilters, Speed, StatsBucket, StatsResponse } from '@/lib/api/types'
import { toggleFilter } from '@/lib/filters'
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
  type WindowKey,
} from './kit/analytics'
import { downloadCsv, exportRows, toCsv } from './kit/csv'
import { REPORTS, reportFrom } from './reports'
import { DeltaText, Segmented, StatTile, type StatsQuery } from './kit/states'

type ColorChoice = 'both' | Color

/** What `/stats/compare` answers with under `delta` — the same buckets, as movements. */
interface DeltaPayload {
  buckets?: StatsBucket[]
  total?: StatsBucket
}

/** Chip labels. "correspondence" is twice the width of the bar's other five put together. */
/** The same speeds as words in a sentence, where "corr." would not do. */
const SPEED_WORDS: Record<Speed, MessageDescriptor> = {
  bullet: msg`bullet`,
  blitz: msg`blitz`,
  rapid: msg`rapid`,
  classical: msg`classical`,
  correspondence: msg`correspondence`,
}

const SPEED_LABELS: Record<Speed, MessageDescriptor> = {
  bullet: msg`bullet`,
  blitz: msg`blitz`,
  rapid: msg`rapid`,
  classical: msg`classical`,
  correspondence: msg({
    message: 'corr.',
    comment: 'Short for "correspondence", the speed of a game played over days',
  }),
}

const WINDOW_DAYS: Record<WindowKey, number | undefined> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '1y': 365,
  all: undefined,
}

function dimensionQuery(
  query: {
    data?: { dimensions: Record<string, StatsResponse> }
    isPending: boolean
    isError: boolean
    error: Error | null
    refetch: () => unknown
  },
  dimension: string,
): StatsQuery {
  return { ...query, data: query.data?.dimensions[dimension] }
}

export function StatsPage() {
  const [params] = useSearchParams()
  const report = reportFrom(params)
  const { i18n, t } = useLingui()
  const reportLabel = i18n._(REPORTS.find((entry) => entry.key === report)!.label)
  const [windowKey, setWindowKey] = useState<WindowKey>('90d')
  const [color, setColor] = useState<ColorChoice>('both')
  // Every speed on is the same question as no speed filter, so that is what it is sent as:
  // an untouched bar asks for the whole library, and a game whose speed was never parsed is
  // counted until the moment somebody names the speeds they want.
  const [speeds, setSpeeds] = useState<readonly Speed[]>(SPEEDS)
  const [comparing, setComparing] = useState(false)
  const allSpeeds = speeds.length === SPEEDS.length

  const dashboard = useStatsDashboard({
    ...(WINDOW_DAYS[windowKey] === undefined ? {} : { days: WINDOW_DAYS[windowKey] }),
    ...(color === 'both' ? {} : { color }),
    ...(allSpeeds ? {} : { speed: speeds }),
  })

  // The server finds the anchor and calculates against it in the same request. The old
  // profile-first path rendered six clock-anchored queries, then replaced all six when
  // the newest-game timestamp arrived.
  const anchor = useMemo(() => anchorOf(dashboard.data?.anchor ?? null), [dashboard.data?.anchor])

  // `speeds` is a fresh array on every toggle, so the memo keys off its content rather than
  // its identity — a filter object rebuilt each render is a new query key for every
  // comparison that reads it. Empty means "all of them", which is no filter at all.
  const speedKey = allSpeeds ? '' : speeds.join(',')
  const filters = useMemo<GameFilters>(
    () => ({
      ...(dashboard.data?.since ? { since: dashboard.data.since } : {}),
      ...(dashboard.data?.until ? { until: dashboard.data.until } : {}),
      ...(color === 'both' ? {} : { color }),
      ...(speedKey ? { speed: speedKey.split(',') as Speed[] } : {}),
    }),
    [dashboard.data?.since, dashboard.data?.until, color, speedKey],
  )

  const speed = dimensionQuery(dashboard, 'performance_by_speed')
  const phase = dimensionQuery(dashboard, 'blunders_by_phase')
  const piece = dimensionQuery(dashboard, 'blunders_by_piece')
  const clock = dimensionQuery(dashboard, 'time_trouble_loss')
  const hour = dimensionQuery(dashboard, 'performance_by_hour')
  const trend = dimensionQuery(dashboard, 'rating_trend')

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

  // The subtitle is what the page counted; a speed left out changes that and has to be
  // said, while the untouched bar leaves the sentence as it was. Both readings are whole
  // sentences rather than a stem with a clause appended, so the order is a translator's to
  // choose; the locals are named because an identifier is what they see as a placeholder.
  const analysedCount = formatCount(analysed)
  const gameCount = formatCount(games)
  const period = windowProse(windowKey, anchor)
  const colours = color === 'both' ? t`both colours` : color === 'white' ? t`as white` : t`as black`
  const speedList = speeds.map((speed) => i18n._(SPEED_WORDS[speed])).join(', ')
  const subtitle = allSpeeds
    ? t`${analysedCount} analysed of ${gameCount} games · ${period} · ${colours}`
    : t`${analysedCount} analysed of ${gameCount} games · ${period} · ${colours} · ${speedList} only`

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
    // The name carries every filter the rows were counted under, so two exports taken a
    // minute apart under different filters are not the same file twice.
    downloadCsv(
      `blunderbase-stats-${windowKey}${color === 'both' ? '' : `-${color}`}${
        allSpeeds ? '' : `-${speeds.join('-')}`
      }.csv`,
      csv,
    )
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
   * The filter bar: what every card on the screen is counting.
   *
   * These lived in the 46px titlebar, on the theory that a control scoping the whole page
   * belongs above the whole page. In practice the titlebar is chrome — a breadcrumb and the
   * queue widget — and controls parked there are not looked at: the page under them says
   * "90 days · both colours" in its own subtitle and nothing points at what would change
   * it. They sit on the page now, directly under the header they qualify, the way the
   * explorer's speed and rating chips sit under the board they filter.
   *
   * Three filters, two shapes. Window and colour are one-of-N, so they are segmented
   * controls; speed is a set — "everything except bullet" is the ordinary question — so it
   * is a row of chips, which is the same distinction the explorer draws.
   */
  const scope = (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <Field label={t`Window`}>
        <Segmented
          label={t`Window`}
          value={windowKey}
          onChange={setWindowKey}
          options={DEFAULT_WINDOWS.map((key) => ({
            value: key,
            label: WINDOW_LABELS[key],
          }))}
        />
      </Field>
      <Field label={t`Colour`}>
        <Segmented
          label={t`Colour`}
          value={color}
          onChange={setColor}
          options={[
            { value: 'both', label: t`both` },
            { value: 'white', label: t`white` },
            { value: 'black', label: t`black` },
          ]}
        />
      </Field>
      <Field label={t`Speed`}>
        {SPEEDS.map((speedName) => {
          const speedWord = i18n._(SPEED_WORDS[speedName])
          return (
            <FilterChip
              key={speedName}
              label={i18n._(SPEED_LABELS[speedName])}
              name={speedName}
              title={t`Count ${speedWord} games`}
              on={speeds.includes(speedName)}
              onClick={() => setSpeeds(toggleFilter(speeds, speedName, SPEEDS))}
            />
          )
        })}
      </Field>
    </div>
  )

  return (
    <PageBody className="gap-3.5">
      <SetPageChrome
        breadcrumb={
          report === 'overview'
            ? [{ label: t`Stats` }]
            : [{ label: t`Stats`, to: '/stats' }, { label: reportLabel }]
        }
        manual="guide/stats"
      />
      <PageHeader
        title={t`Stats`}
        description={speed.isPending ? t`Reading the aggregations…` : subtitle}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!canCompare}
              aria-pressed={comparing && canCompare}
              onClick={() => setComparing((on) => !on)}
              title={
                canCompare
                  ? t`Show every number against the equally long window before this one`
                  : t`All time has nothing before it to compare against`
              }
              className={cn(
                'rounded-md border px-2.5 py-[0.3125rem] text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                comparing && canCompare
                  ? 'border-accent-teal/30 bg-accent-teal/10 text-accent-teal'
                  : 'border-input text-soft hover:border-edge-hover hover:text-ink',
              )}
            >
              <Trans>vs previous</Trans>
            </button>
            <button
              type="button"
              onClick={download}
              disabled={!speed.data}
              className="rounded-md border border-input px-2.5 py-[0.3125rem] text-xs text-soft transition-colors hover:border-edge-hover hover:text-ink disabled:opacity-40"
            >
              <Trans>Export CSV</Trans>
            </button>
          </div>
        }
      />

      {scope}

      {/* Five tiles across is 70px each on a phone, which fits neither a label nor a
          22px number. Below `md` they go two to a line, and the fifth — the one that
          would otherwise sit alone in half a row — takes the whole last one. */}
      <div className="grid flex-none grid-cols-2 gap-2.5 md:flex md:gap-3">
        <StatTile
          label={<Trans>Games</Trans>}
          value={speed.isPending ? '—' : formatCount(games)}
          // The number is every game in the window; the caption is how many of them an
          // engine has been over, which is what the four tiles beside it are computed from.
          // It read "analysed" alone, which named the big number as the analysed count and
          // made the tile disagree with the coverage on the dashboard for no reason.
          suffix={suffix(num(speedDelta?.total, 'games'), t`${analysedCount} analysed`, false, 0)}
        />
        <StatTile
          label={<Trans>Score</Trans>}
          value={score === null ? '—' : `${score.toFixed(1)}%`}
          suffix={suffix(asPercent(num(speedDelta?.total, 'score')), t`of the point`, false)}
        />
        <StatTile
          label={<Trans>Blunders per game</Trans>}
          value={perGame === null ? '—' : perGame.toFixed(1)}
          tone={perGame !== null && perGame > 1 ? 'blunder' : 'ink'}
          suffix={suffix(num(speedDelta?.total, 'blunders_per_game'), t`per game`, true)}
        />
        <StatTile
          label={<Trans>Win % given away</Trans>}
          value={winLoss === null ? '—' : winLoss.toFixed(1)}
          suffix={suffix(num(phaseDelta?.total, 'avg_win_loss'), t`per move`, true)}
        />
        <StatTile
          label={<Trans>Blunder rate</Trans>}
          value={blunderRate === null ? '—' : `${blunderRate.toFixed(1)}%`}
          suffix={suffix(asPercent(num(phaseDelta?.total, 'blunder_rate')), t`of your moves`, true)}
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
            <BlundersByPhaseCard query={phase} />
            <TimeControlCard query={speed} />
            <ClockPressureCard query={clock} />
            <ProgressCard query={trend} />
          </>
        ) : null}
        {report === 'blunders' ? (
          <>
            <BlundersByPhaseCard query={phase} className="xl:self-start" />
            <BlundersByPieceCard query={piece} />
          </>
        ) : null}
        {report === 'clock' ? (
          <>
            <ClockPressureCard query={clock} />
            <TimeOfDayCard query={hour} />
          </>
        ) : null}
        {report === 'progress' ? <ProgressCard query={trend} /> : null}
      </div>
    </PageBody>
  )
}

/**
 * One filter in the bar: a small uppercase name and the control that answers it.
 *
 * The name is drawn rather than left to the control because the bar mixes shapes — two
 * segmented controls and a row of chips — and without names a reader has to work out from
 * the values which question each one is answering. `Segmented` carries the same string as
 * its `aria-label`, which is the group's accessible name; this span is what makes it
 * visible.
 */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        aria-hidden
        className="flex-none text-[0.65625rem] tracking-[.06em] text-dim-2 uppercase"
      >
        {label}
      </span>
      {children}
    </div>
  )
}
