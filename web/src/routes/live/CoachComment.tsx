import { Trans } from '@lingui/react/macro'

import { StatusDot } from '@/components/badges/StatusDot'
import { Readout } from '@/components/ui/badge'
import { relative } from '@/lib/mcp/status'
import { cn } from '@/lib/utils'

/**
 * The sentence or two the coach put under the board.
 *
 * `annotate(text=…)` replaces it and `annotate(text="")` clears it, so this card is
 * either the current comment or an explicit note that there is none — never a stale one.
 *
 * "via MCP" is where the words come from: a status word with its green dot and no box, and
 * the age a flat readout, so nothing in the card's head looks like something to press.
 */
export function CoachComment({
  text,
  updatedAt,
  className,
}: {
  text: string | null | undefined
  updatedAt: string | null | undefined
  className?: string
}) {
  return (
    <section className={cn('flex flex-col rounded-xl border border-line bg-panel', className)}>
      <div className="flex items-center gap-2 border-b border-hairline px-3.5 py-2.5">
        <span className="text-data font-semibold text-ink">
          <Trans>Coach</Trans>
        </span>
        <span className="inline-flex items-center gap-1.5 text-label text-soft">
          <StatusDot tone="healthy" />
          <Trans>via MCP</Trans>
        </span>
        <div className="flex-1" />
        <Readout num>{relative(updatedAt)}</Readout>
      </div>

      <div className="px-3.5 py-3">
        {text ? (
          <p className="border-l-2 border-accent-teal/60 pl-2.5 text-data leading-[1.55] text-body-2">
            {text}
          </p>
        ) : (
          <p className="text-data leading-[1.5] text-dim">
            <Trans>
              Nothing said yet. Whatever your assistant writes with{' '}
              <span className="font-mono text-soft-2">annotate</span> appears here as it types
              it.
            </Trans>
          </p>
        )}
      </div>
    </section>
  )
}
