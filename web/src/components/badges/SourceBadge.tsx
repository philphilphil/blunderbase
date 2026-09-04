import type { Source } from '@/lib/api/types'
import { SOURCE_STYLES } from '@/lib/chess/classification'
import { cn } from '@/lib/utils'

/** Lichess / Chess.com / OTB / PGN, as design 1c draws them. */
export function SourceBadge({
  source,
  size = 'md',
  className,
  title,
}: {
  source: Source
  size?: 'sm' | 'md'
  className?: string
  /** A hover note about the source — what its adapter does, where a row has room for none. */
  title?: string
}) {
  const style = SOURCE_STYLES[source]
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center rounded-sm border',
        size === 'sm' ? 'gap-1 px-1.5 py-px text-[0.625rem]' : 'gap-1.5 px-2 py-[0.1875rem] text-[0.71875rem]',
        style.chipClass,
        className,
      )}
    >
      <span
        className={cn('rounded-full', size === 'sm' ? 'size-1' : 'size-[0.3125rem]', style.dotClass)}
      />
      {style.label}
    </span>
  )
}
