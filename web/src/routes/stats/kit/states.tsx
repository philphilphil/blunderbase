/**
 * The card idiom the Dashboard and the Stats page are both built from, plus the three
 * states every one of them has to be able to be in (design 1c): loading, empty, failed.
 *
 * Geometry is lifted from design 2a/2d: a `#0b0d10` panel on a 1px `#1f242b` line at a
 * 9px radius, 13–14px of padding, a 12/12.5px semibold title, and a hairline-topped
 * footer for the one dry sentence each card ends on.
 */
import type { CSSProperties, ReactNode } from 'react'

import { cn } from '@/lib/utils'

// --- the card ------------------------------------------------------------

export function StatCard({
  title,
  hint,
  aside,
  footer,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode
  /** The small grey clause the design sets beside a title. */
  hint?: ReactNode
  /** Pushed to the right of the title row — a count, a legend, a control. */
  aside?: ReactNode
  footer?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section
      className={cn(
        'flex min-h-0 flex-col gap-3 rounded-xl border border-line bg-panel p-3.5',
        className,
      )}
    >
      <header className="flex items-baseline gap-2">
        <h2 className="text-[0.78125rem] font-semibold text-ink">{title}</h2>
        {hint ? <span className="text-[0.6875rem] text-dim-2">{hint}</span> : null}
        <div className="flex-1" />
        {aside}
      </header>
      <div className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', bodyClassName)}>
        {children}
      </div>
      {footer ? (
        <p className="border-t border-hairline pt-2.5 text-[0.71875rem] leading-relaxed text-dim-2">
          {footer}
        </p>
      ) : null}
    </section>
  )
}

// --- states --------------------------------------------------------------

/** The pulse the design's surfaces read as while a fetch is in flight. */
export function Bar({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div className={cn('animate-pulse rounded-sm bg-raised', className)} style={style} />
}

export function LoadingRows({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div
      className={cn('flex flex-1 flex-col justify-center gap-4', className)}
      data-testid="loading"
    >
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex flex-col gap-1.5">
          <Bar className="h-2.5 w-1/3" />
          <Bar className="h-[0.5625rem] w-full rounded-full" />
        </div>
      ))}
    </div>
  )
}

export function LoadingChart({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-1 items-end gap-2.5', className)} data-testid="loading">
      {[38, 62, 47, 80, 55, 71, 44].map((height, index) => (
        <Bar
          key={index}
          className="flex-1 rounded-t-sm rounded-b-none"
          style={{ height: `${height}%` }}
        />
      ))}
    </div>
  )
}

/** Nothing matched — the dashed idiom design 1c uses for "not here yet". */
export function EmptyBlock({
  children,
  action,
  className,
}: {
  children: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-2.5 rounded-lg border border-dashed border-edge-strong px-4 py-6 text-center',
        className,
      )}
      data-testid="empty"
    >
      <p className="max-w-[34ch] text-[0.71875rem] leading-relaxed text-dim-2">{children}</p>
      {action}
    </div>
  )
}

/** A fetch that failed, in the blunder tint, with the one thing worth doing about it. */
export function ErrorBlock({
  error,
  onRetry,
  className,
}: {
  error: Error | null | undefined
  onRetry?: () => void
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-blunder/28 bg-blunder/5 px-4 py-6 text-center',
        className,
      )}
      data-testid="error"
      role="alert"
    >
      <p className="text-[0.71875rem] font-medium text-blunder">Could not load this.</p>
      <p className="max-w-[38ch] font-mono text-[0.65625rem] leading-relaxed break-words text-dim-2">
        {error?.message ?? 'the request failed'}
      </p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-edge-strong px-2.5 py-1 text-[0.6875rem] text-soft transition-colors hover:border-edge-hover hover:text-ink"
        >
          Try again
        </button>
      ) : null}
    </div>
  )
}

/**
 * The one place loading / error / empty are decided, so every card behaves the same way.
 * Renders `children` only when there is something to draw.
 */
export function Async({
  query,
  empty,
  emptyMessage,
  loading,
  children,
}: {
  query: {
    isPending: boolean
    isError: boolean
    error: Error | null
    refetch: () => unknown
  }
  /** Whether the resolved data has nothing in it. */
  empty?: boolean
  emptyMessage?: ReactNode
  loading?: ReactNode
  children: ReactNode
}) {
  if (query.isPending) return <>{loading ?? <LoadingRows />}</>
  if (query.isError) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />
  if (empty) return <EmptyBlock>{emptyMessage ?? 'Nothing here for this window yet.'}</EmptyBlock>
  return <>{children}</>
}

// --- pieces --------------------------------------------------------------

/**
 * The labelled meter from design 2d's "Blunders by game phase": a name, an optional
 * range in grey, the count, the share, and a 9px track.
 */
export function MeterRow({
  label,
  sub,
  value,
  share,
  color,
  emphasis = false,
  title,
}: {
  label: ReactNode
  sub?: ReactNode
  value: ReactNode
  /** 0..100 — both the bar width and the percentage shown. */
  share: number
  /** A CSS colour for the fill. */
  color: string
  /** The bucket the card is making a point about is set brighter. */
  emphasis?: boolean
  /** The detail behind the row, on hover — the rate the share does not show. */
  title?: string
}) {
  const width = Math.max(0, Math.min(100, share))
  return (
    <div className="flex flex-col gap-1.5" title={title}>
      <div className="flex items-baseline gap-2">
        <span className="flex-1 truncate text-xs text-body">
          {label}
          {sub ? <span className="ml-1.5 text-dim-2">{sub}</span> : null}
        </span>
        <span className={cn('font-mono text-xs tabular', emphasis ? 'text-ink' : 'text-soft')}>
          {value}
        </span>
        <span
          className="w-9 text-right font-mono text-[0.6875rem] tabular"
          style={{ color: emphasis ? color : undefined }}
        >
          {width.toFixed(0)}%
        </span>
      </div>
      <div className="h-[0.5625rem] overflow-hidden rounded-full bg-raised">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${width}%`, background: color }}
        />
      </div>
    </div>
  )
}

/** The KPI tile across the top of design 2d. */
export function StatTile({
  label,
  value,
  suffix,
  tone = 'ink',
  className,
}: {
  label: ReactNode
  value: ReactNode
  /** The small mono clause after the number — a unit, or a delta. */
  suffix?: ReactNode
  tone?: 'ink' | 'blunder' | 'good'
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-1 flex-col gap-1 rounded-xl border border-line bg-panel px-3.5 py-3',
        className,
      )}
    >
      <span className="text-[0.6875rem] text-dim-2">{label}</span>
      <div className="flex items-baseline gap-[0.4375rem]">
        <span
          className={cn(
            'font-mono text-[1.375rem] font-semibold tracking-[-0.02em] tabular',
            tone === 'blunder' ? 'text-blunder' : tone === 'good' ? 'text-good' : 'text-ink',
          )}
        >
          {value}
        </span>
        {suffix}
      </div>
    </div>
  )
}

const DELTA_TONE = {
  good: 'text-good',
  blunder: 'text-blunder',
  dim: 'text-dim',
} as const

/** The `+3.4` / `−11` next to a KPI, coloured by whether it is progress. */
export function DeltaText({
  children,
  tone,
  className,
}: {
  children: ReactNode
  tone: 'good' | 'blunder' | 'dim'
  className?: string
}) {
  return (
    <span className={cn('font-mono text-[0.6875rem] tabular', DELTA_TONE[tone], className)}>
      {children}
    </span>
  )
}

/** The bordered inline group the design uses for `30d · 90d · 1y`. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange: (value: T) => void
  label: string
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'flex overflow-hidden rounded-md border border-edge font-mono text-[0.6875rem]',
        className,
      )}
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            'px-2.5 py-1 transition-colors',
            index > 0 && 'border-l border-edge',
            option.value === value ? 'bg-selected text-ink' : 'text-dim hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** The tiny legend swatch design 2d puts beside the "Progress" title. */
export function LegendSwatch({
  color,
  dashed = false,
  children,
}: {
  color: string
  dashed?: boolean
  children: ReactNode
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[0.65625rem] text-dim">
      <span
        className="h-[0.125rem] w-[0.4375rem]"
        style={
          dashed
            ? {
                backgroundImage: `linear-gradient(90deg, ${color} 60%, transparent 60%)`,
              }
            : { background: color }
        }
      />
      {children}
    </span>
  )
}
