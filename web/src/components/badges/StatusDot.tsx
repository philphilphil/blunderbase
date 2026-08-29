import { cn } from '@/lib/utils'

export type StatusDotTone = 'healthy' | 'working' | 'degraded' | 'away' | 'bad'

const TONE: Record<StatusDotTone, string> = {
  // Healthy dots deliberately glow like the engine roster in the side rail: the stronger
  // signal makes available compute readable at a glance on both light and dark surfaces.
  healthy:
    'bg-accent-teal shadow-[0_0_0.25rem_0_color-mix(in_srgb,var(--bb-accent)_55%,transparent)]',
  working: 'bg-info',
  degraded: 'bg-mistake',
  away: 'bg-faint',
  bad: 'bg-blunder',
}

/** A shared status mark keeps the side rail and dense engine tables visually identical. */
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
