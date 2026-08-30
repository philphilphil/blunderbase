import { cn } from '@/lib/utils'
import { formatCount } from '@/routes/games/format'
import type { AnalysisCoverage } from '@/lib/api/types'

/**
 * How much of the library has been analysed, and with what.
 *
 * The three buckets partition the library — a game has a deep pass, or a quick one and no
 * deep, or nothing — so the bar is honest as a whole rather than three bars that happen to
 * sit together, and the legend restates the same three numbers as counts and shares.
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
  key: 'deep' | 'quick_only' | 'no_pass'
  label: string
  hint: string
  barClass: string
}

/**
 * Deepest first, left to right: the bar reads as progress towards a fully analysed
 * library, so the most analysed bucket is the one that grows from the left.
 */
const BUCKETS: Bucket[] = [
  {
    key: 'deep',
    label: 'Deep pass',
    hint: 'a full deep pass, several lines a position',
    barClass: 'bg-deep',
  },
  {
    key: 'quick_only',
    label: 'Quick only',
    hint: 'the automatic pass on import, and no deep pass yet',
    barClass: 'bg-accent-teal',
  },
  {
    key: 'no_pass',
    label: 'No pass',
    hint: 'never analysed — no engine has been over these',
    barClass: 'bg-edge-strong',
  },
]

function share(count: number, total: number): number {
  return total > 0 ? (count / total) * 100 : 0
}

export function CoverageSplit({ coverage }: { coverage: AnalysisCoverage }) {
  const { total } = coverage
  const rows = BUCKETS.map((bucket) => ({ ...bucket, count: coverage[bucket.key] }))

  return (
    <section
      aria-labelledby="coverage-title"
      className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-3.5"
    >
      <header className="flex items-baseline gap-2">
        <h2 id="coverage-title" className="text-xs font-semibold text-ink">
          Coverage
        </h2>
        <div className="flex-1" />
        <span className="font-mono text-[0.6875rem] tabular text-dim-2">
          {formatCount(total)} games
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

      <dl className="grid gap-2 sm:grid-cols-3">
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
