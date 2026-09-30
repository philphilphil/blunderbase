import { useLingui } from '@lingui/react/macro'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { cn } from '@/lib/utils'

import { Button } from './button'

/**
 * Previous / next page around where you are ("‹ 1 / 231 ›"): the games table's footer, the
 * sync history (docs/design/README.md, "Controls").
 *
 * The two arrows are faces (`secondary icon-sm`, so the strong edge an icon-only face
 * takes, since there is no label to say what it is); the position between them is a flat
 * readout in mono, because it is a figure and not a control. At either end the arrow takes
 * the one disabled look (no face) and says why in its title, rather than vanishing and
 * moving the other one.
 */
export function Pager({
  page,
  pages,
  onPrev,
  onNext,
  label,
  className,
}: {
  /** 1-based. */
  page: number
  pages: number
  onPrev: () => void
  onNext: () => void
  /** The group's accessible name ("Pages"). */
  label: string
  className?: string
}) {
  const { t } = useLingui()
  const first = page <= 1
  const last = page >= pages
  return (
    <div role="group" aria-label={label} className={cn('inline-flex items-center gap-1.5', className)}>
      <Button
        variant="secondary"
        size="icon-sm"
        aria-label={t`Previous page`}
        title={first ? t`Already on the first page` : t`Previous page`}
        disabled={first}
        onClick={onPrev}
      >
        <ChevronLeft aria-hidden />
      </Button>
      <span className="font-mono text-data text-body tabular">
        {page.toLocaleString()} / {Math.max(pages, 1).toLocaleString()}
      </span>
      <Button
        variant="secondary"
        size="icon-sm"
        aria-label={t`Next page`}
        title={last ? t`Already on the last page` : t`Next page`}
        disabled={last}
        onClick={onNext}
      >
        <ChevronRight aria-hidden />
      </Button>
    </div>
  )
}
