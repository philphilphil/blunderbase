import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'

import type { RunStatus, Tier } from '@/lib/api/types'
import { cn } from '@/lib/utils'

/**
 * The analysis-tier chips from design 1c. `depth` is what turns "Quick" into "Quick · d18",
 * which is how the design labels a run that has actually happened.
 */
export function TierBadge({
  tier,
  depth,
  nodes,
  className,
}: {
  tier: Tier
  depth?: number | null
  nodes?: string | null
  className?: string
}) {
  const suffix = depth ? ` · d${depth}` : nodes ? ` · ${nodes}` : ''
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[0.3125rem] border px-2 py-[0.1875rem] text-[0.71875rem]',
        tier === 'deep'
          ? 'border-deep/28 bg-deep/10 text-deep'
          : 'border-edge-strong bg-raised text-soft',
        className,
      )}
    >
      {tier === 'deep' ? <Trans>Deep</Trans> : <Trans>Quick</Trans>}
      {suffix}
    </span>
  )
}

/** The dashed chip a game with no run at all gets. */
export function UnanalysedBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[0.3125rem] border border-dashed border-edge-strong px-2 py-[0.1875rem] text-[0.71875rem] text-dim-2',
        className,
      )}
    >
      <Trans>Unanalysed</Trans>
    </span>
  )
}

const STATUS_DOT: Record<RunStatus, string> = {
  queued: 'bg-mistake',
  running: 'bg-accent-teal',
  done: 'bg-good',
  failed: 'bg-blunder',
}

const STATUS_LABEL: Record<RunStatus, MessageDescriptor> = {
  queued: msg`Queued`,
  running: msg`Running`,
  done: msg`Done`,
  failed: msg`Failed`,
}

export function RunStatusBadge({ status, className }: { status: RunStatus; className?: string }) {
  const { i18n } = useLingui()
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[0.3125rem] border border-edge-strong bg-raised px-2 py-[0.1875rem] text-[0.71875rem] text-soft',
        className,
      )}
    >
      <span className={cn('size-[0.3125rem] rounded-full', STATUS_DOT[status])} />
      {i18n._(STATUS_LABEL[status])}
    </span>
  )
}
