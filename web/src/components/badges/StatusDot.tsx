import { cn } from '@/lib/utils'

export type StatusDotTone =
  | 'healthy'
  | 'working'
  | 'waiting'
  | 'degraded'
  | 'away'
  | 'error'
  /** The old name for `error`, kept so callers compile. */
  | 'bad'

const TONE: Record<StatusDotTone, string> = {
  healthy: 'bg-good',
  working: 'bg-good animate-pulse',
  waiting: 'bg-dim',
  degraded: 'bg-mistake',
  away: 'bg-faint',
  error: 'bg-blunder',
  bad: 'bg-blunder',
}

/**
 * A shared status mark, so the side rail and the dense engine tables say "alive" the same
 * way. Green is alive (pulsing while it works), grey is waiting or away, orange degraded,
 * red broken (the clarity pass, spec §4). Healthy used to be the accent, glowing; blue is
 * kept for interaction and choice, so a status can never be mistaken for a selection.
 */
export function StatusDot({
  tone,
  label,
  className,
}: {
  tone: StatusDotTone
  label?: string
  className?: string
}) {
  return (
    <span
      className={cn('size-1.5 flex-none rounded-full', TONE[tone], className)}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  )
}
