import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'

import type { RunStatus } from '@/lib/api/types'
import { RUN_STYLES, runKind, runLabel, type RunShape } from '@/lib/chess/classification'
import { cn } from '@/lib/utils'

/**
 * A run as the chip from design 1c: what it stopped each move at and how many lines it
 * kept (`d24 · 2 lines`), rather than a name for the kind of pass — there is one pass now,
 * and the dialog's choices are the only honest description of what ran. The colour says
 * whether somebody asked for it, which is the run that answers for a move. Legacy rows
 * render from the nodes and lines they stored, the same way.
 */
export function RunBadge({ run, className }: { run: RunShape; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[0.3125rem] border px-2 py-[0.1875rem] text-[0.71875rem] whitespace-nowrap',
        RUN_STYLES[runKind(run)].chipClass,
        className,
      )}
    >
      {runLabel(run)}
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
