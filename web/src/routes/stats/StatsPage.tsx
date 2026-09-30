/**
 * Design 2d — the aggregation dashboards.
 *
 * One filter set (window · colour · speed · collection) drives every card: the same `GameFilters`
 * vocabulary `/games` takes, forwarded to each `/stats/{dimension}`. The "vs previous
 * window" switch turns the KPI row into a comparison with the equally long window before
 * it, over `/stats/compare`.
 *
 * The tile row is the design's five, at its anatomy, but two of its metrics do not exist:
 * `/stats` has no accuracy and no aggregate ACPL — `services.stats` aggregates win percentage
 * given away, while the game page derives ACPL from its move evaluations only, and nothing
 * computes an accuracy score. Their
 * slots carry the two numbers the same aggregation does answer, on the same axis: `Win %
 * given away` (`avg_win_loss`, the average a move costs) and `Blunder rate` (the share of
 * moves that were one). Same question — how expensive are your moves — in real units.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import { FileDown } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'

import { CollectionSwatch } from '@/components/collections/CollectionChip'
import { SpeedPicker } from '@/components/filters/SpeedPicker'
import { SetPageChrome } from '@/components/shell/PageChrome'
import { PageBody } from '@/components/shell/PageHeader'
import { Button } from '@/components/ui/button'
import { PickerSelect } from '@/components/ui/native-select'
import { Segmented } from '@/components/ui/segmented'
import { Switch } from '@/components/ui/switch'
import { useCollections, useStatsDashboard } from '@/lib/api/queries'
import { SPEEDS } from '@/lib/api/types'
import type { Color, GameFilters, Speed, StatsBucket, StatsResponse } from '@/lib/api/types'
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
  asPercent,
  deltaTone,
  formatCount,
  formatDelta,
  num,
  numOr,
  parseCollectionParam,
  precedingWindow,
  total,
  useCompare,
  type WindowKey,
} from './kit/analytics'
import { downloadCsv, exportRows, toCsv } from './kit/csv'
import { DEFAULT_REPORT, REPORTS, reportFrom, reportPath } from './reports'
import { DeltaText, StatTile, type StatsQuery } from './kit/states'

type ColorChoice = 'both' | Color

/** What `/stats/compare` answers with under `delta` — the same buckets, as movements. */
interface DeltaPayload {
  buckets?: StatsBucket[]
  total?: StatsBucket
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
  const [params, setParams] = useSearchParams()
  const report = reportFrom(params)
  // The one scope in the URL rather than in state: a collection's card links here with it
  // (`collectionStatsPath`), and "Stats for the league" is worth a bookmark where "the
  // last 90 days, blitz" is not. Every card and the comparison read it through `filters`.
  const collections = useCollections()
  const collectionList = collections.data?.collections
  const requested = parseCollectionParam(params.get('collection'))
  const inCollection = collectionList?.find((entry) => entry.id === requested) ?? null
  // Asked for straight from the URL while the list is loading, so the page does not count
  // everything first and then again; a collection the list no longer has (deleted since
  // the link was made) is no scope at all rather than a page of zeros.
  const collection = collectionList === undefined || inCollection ? requested : null
  const setCollection = (next: number | null) => {
    const updated = new URLSearchParams(params)
    if (next === null) updated.delete('collection')
    else updated.set('collection', String(next))
    setParams(updated, { replace: true })
  }
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
    ...(collection === null ? {} : { collection }),
  })

  // `speeds` is a fresh array on every toggle, so the memo keys off its content rather than
  // its identity — a filter object rebuilt each render is a new query key for every
  // comparison that reads it. Empty means "all of them", which is no filter at all.
  // The window's two ends as plain strings, so the memo keys off them and not off the whole
  // response (which the compiler would otherwise infer, rebuilding on every refetch).
  const speedKey = allSpeeds ? '' : speeds.join(',')
  const since = dashboard.data?.since
  const until = dashboard.data?.until
  const filters = useMemo<GameFilters>(
    () => ({
      ...(since ? { since } : {}),
      ...(until ? { until } : {}),
      ...(color === 'both' ? {} : { color }),
      ...(speedKey ? { speed: speedKey.split(',') as Speed[] } : {}),
      ...(collection === null ? {} : { collection }),
    }),
    [since, until, color, speedKey, collection],
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
  const analysedCount = formatCount(analysed)
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
    // The name carries every filter the rows were counted under, so two exports taken a
    // minute apart under different filters are not the same file twice.
    downloadCsv(
      `blunderbase-stats-${windowKey}${color === 'both' ? '' : `-${color}`}${
        allSpeeds ? '' : `-${speeds.join('-')}`
      }${collection === null ? '' : `-collection-${collection}`}.csv`,
      csv,
    )
  }

  /** The small mono clause under a KPI: a movement while comparing, a unit otherwise. */
  function suffix(value: number | null, unit: string, lowerIsBetter: boolean, digits = 1) {
    if (!comparing || !canCompare) {
      return <span className="font-mono text-label text-dim">{unit}</span>
    }
    if (comparePending) return <span className="font-mono text-label text-faint">…</span>
    return (
      <DeltaText tone={deltaTone(value, lowerIsBetter)}>{formatDelta(value, digits)}</DeltaText>
    )
  }

  /**
   * The scope row: what every card on the screen is counting.
   *
   * These lived in the 46px titlebar, on the theory that a control scoping the whole page
   * belongs above the whole page. In practice the titlebar is chrome — a breadcrumb and the
   * queue widget — and controls parked there are not looked at: the page under them says
   * "90 days · both colours" in its own subtitle and nothing points at what would change
   * it. They sit on the page now, at the top of the cards they qualify.
   *
   * Each shape says what kind of choice it is (the clarity pass). Window and colour are
   * one-of-N, so they are the app's one segmented control, a sentence-case name beside
   * each. Speed is a set — "everything except bullet" is the ordinary question — so it is
   * the one Speed picker the Dashboard and the Explorer use too ("Speed: All"); it had been
   * a row of five lit chips, the loudest thing on the page while it narrowed nothing. The
   * collection is one-of-N of a list the owner writes, any length and any name, so a picker
   * over the native select ("Collection: All games"); it is only there once there is a
   * collection to pick. The pickers name themselves, so they carry no separate label.
   *
   * A hairline rule stands between groups on a wide screen; on a phone the groups wrap and
   * the rules go, since a rule at the start of a line would separate nothing.
   *
   * "vs previous window" sits at the row's far end as a switch. It had been a pressed
   * button in the titlebar, where it read as a command beside Export CSV; it is a mode of
   * the whole page, so it is a switch, and it lives with the other things that decide what
   * the numbers are. Disabled under All, with a title saying why: all time has nothing
   * before it.
   */
  const scope = (
    // `max-md:relative`: on a phone the Speed picker's panel spans this row rather than
    // hanging off the picker's edge (`FilterPopover`).
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 max-md:relative">
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
      <Rule />
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
      <Rule />
      <SpeedPicker speeds={SPEEDS} value={speeds} onChange={setSpeeds} />
      {collectionList?.length ? (
        <>
          <Rule />
          <PickerSelect
            label={t`Collection`}
            value={inCollection ? String(inCollection.id) : ''}
            set={inCollection !== null}
            leading={inCollection ? <CollectionSwatch color={inCollection.color} /> : undefined}
            onChange={(next) => setCollection(next === '' ? null : Number(next))}
            options={[
              { value: '', label: t`All games` },
              ...collectionList.map((entry) => ({ value: String(entry.id), label: entry.name })),
            ]}
            className="max-w-[18rem]"
          />
        </>
      ) : null}
      <Switch
        label={t`vs previous window`}
        checked={comparing && canCompare}
        onCheckedChange={setComparing}
        disabled={!canCompare}
        title={
          canCompare
            ? t`Show every number against the equally long window before this one`
            : windowKey === 'all'
              ? t`All time has nothing before it to compare against`
              : t`Waiting for the window's dates to compare against`
        }
        // Words before the track, like Hide engine in the bar: the row reads left to right
        // and the switch ends it.
        className="ml-auto flex-row-reverse max-md:ml-0"
      />
    </div>
  )

  return (
    <PageBody className="gap-3.5">
      <SetPageChrome
        // "Stats › Overview": the place, then the report as the title, on every report, so
        // the bar names the same leaf the rail lights. Stats goes back to the overview of
        // the same scope, not of the whole library.
        breadcrumb={[
          {
            label: t`Stats`,
            to: collection === null ? '/stats' : reportPath(DEFAULT_REPORT, params.toString()),
          },
          { label: reportLabel },
        ]}
        manual="guide/stats"
        actions={
          // The bar's one command. No "…": it downloads at once and asks nothing.
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={download}
            disabled={!speed.data}
            title={speed.data ? undefined : t`Nothing is counted yet, so there is nothing to export`}
          >
            <FileDown aria-hidden />
            <Trans>Export CSV</Trans>
          </Button>
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
          whose Recharts container needs the row to keep its 1fr height.
          On a phone the page scrolls instead of the frame being filled, so the grid takes
          its content's height (`max-md:flex-none`): squeezed into what was left under the
          tiles, the auto rows fell to their floor and the phase card showed one meter. */}
      <div
        className={cn(
          'grid min-h-0 flex-1 gap-3 grid-cols-1 xl:grid-cols-2 max-md:flex-none',
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
 * One segmented filter in the row: its name beside the control that answers it.
 *
 * The name is drawn because a segment's values ("both", "90d") do not say which question
 * they answer; a picker says it itself ("Speed: All") and needs no Field. Sentence case in
 * `label` size, not spaced caps: caps are for column heads, and the rail's section heads
 * had made the two read alike. `Segmented` carries the same string as its `aria-label`,
 * which is the group's accessible name; this span is what makes it visible.
 */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span aria-hidden className="flex-none text-label text-dim">
        {label}
      </span>
      {children}
    </div>
  )
}

/** The hairline between two groups of the scope row; gone on a phone, where they wrap. */
function Rule() {
  return <span aria-hidden className="h-4 w-px flex-none bg-hairline max-md:hidden" />
}
