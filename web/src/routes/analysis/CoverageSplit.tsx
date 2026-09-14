import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'

import { cn } from '@/lib/utils'
import { formatCount } from '@/routes/games/format'
import type { AnalysisCoverage } from '@/lib/api/types'

/**
 * How much of the library has been analysed, and with what.
 *
 * The two buckets partition the library — a game has had an analysis pass, or nothing — so
 * the bar is honest as a whole rather than two bars that happen to sit together, and the
 * legend restates the same two numbers as counts and shares. There is no bucket for games
 * somebody asked for more on: that is a choice made game by game in the Analyse dialog,
 * not a gap in the library a backfill could close.
 *
 * The legend is not a caption. On the library this was built for one segment is 89% of the
 * bar and another is 4.8%, and a design that leaves the reading to the bar alone would say
 * "mostly unanalysed" and nothing else. The numbers are the answer; the bar is the shape
 * of it. Every segment with a game in it also keeps a minimum width, so a bucket holding
 * six games out of eight thousand is a mark rather than a rounding error.
 */

/** Enough of the bar to be seen and hovered at any share above zero. */
const MIN_SEGMENT = '0.375rem'

interface Bucket {
  key: 'analysed' | 'no_pass'
  label: MessageDescriptor
  hint: MessageDescriptor
  barClass: string
}

/**
 * Analysed first, left to right: the bar reads as progress towards a fully analysed
 * library, so that bucket is the one that grows from the left.
 */
const BUCKETS: Bucket[] = [
  {
    key: 'analysed',
    label: msg`Analysed`,
    hint: msg`an engine has been over every move, on import or when asked`,
    barClass: 'bg-accent-teal',
  },
  {
    key: 'no_pass',
    label: msg`No pass`,
    hint: msg`never analysed — no engine has been over these`,
    barClass: 'bg-edge-strong',
  },
]

function share(count: number, total: number): number {
  return total > 0 ? (count / total) * 100 : 0
}

export function CoverageSplit({ coverage }: { coverage: AnalysisCoverage }) {
  const { i18n } = useLingui()
  const { total } = coverage
  const rows = BUCKETS.map((bucket) => ({
    ...bucket,
    label: i18n._(bucket.label),
    hint: i18n._(bucket.hint),
    count: coverage[bucket.key],
  }))
  const games = formatCount(total)

  return (
    <section
      aria-labelledby="coverage-title"
      className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-3.5"
    >
      <header className="flex items-baseline gap-2">
        <h2 id="coverage-title" className="text-xs font-semibold text-ink">
          <Trans>Coverage</Trans>
        </h2>
        <div className="flex-1" />
        <span className="font-mono text-[0.6875rem] tabular text-dim-2">
          <Trans>{games} games</Trans>
        </span>
      </header>

      <div
        className="flex h-2 overflow-hidden rounded-sm bg-track"
        role="img"
        aria-label={rows
          .map((row) => `${row.label}: ${formatCount(row.count)}`)
          .join(', ')}
      >
        {rows.map((row) =>
          row.count > 0 ? (
            <div
              key={row.key}
              title={`${row.label} — ${formatCount(row.count)}`}
              className={cn('h-full', row.barClass)}
              style={{ width: `${share(row.count, total)}%`, minWidth: MIN_SEGMENT }}
            />
          ) : null,
        )}
      </div>

      <dl className="grid gap-2 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.key} className="flex flex-col gap-1">
            <dt className="flex items-center gap-1.5 text-[0.6875rem] text-soft">
              <span className={cn('size-1.5 flex-none rounded-full', row.barClass)} />
              {row.label}
            </dt>
            <dd className="flex items-baseline gap-1.5">
              <span className="font-mono text-[1.0625rem] leading-none tabular text-ink">
                {formatCount(row.count)}
              </span>
              <span className="font-mono text-[0.65625rem] tabular text-dim-2">
                {`${share(row.count, total).toFixed(1)}%`}
              </span>
            </dd>
            <span className="text-[0.625rem] leading-[1.45] text-dim-2">{row.hint}</span>
          </div>
        ))}
      </dl>
    </section>
  )
}
