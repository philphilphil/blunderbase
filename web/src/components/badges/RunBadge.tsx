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
 *
 * The chip is a tint with no border (the clarity pass): a readout, not a control, so it
 * must not wear the 1px edge the buttons beside it do.
 *
 * `plain` drops the chip and keeps the words, for a column where every row has a run and
 * fifty filled chips would be the loudest thing on the screen while saying the least: the
 * import pass is quiet metadata (`dim`), and a run somebody asked for keeps its `deep`
 * purple as text — that one is the exception worth seeing.
 */
export function RunBadge({
  run,
  plain = false,
  className,
}: {
  run: RunShape
  plain?: boolean
  className?: string
}) {
  const kind = runKind(run)
  if (plain) {
    return (
      <span
        className={cn(
          'inline-flex items-center text-label whitespace-nowrap',
          kind === 'requested' ? RUN_STYLES.requested.textClass : 'text-dim',
          className,
        )}
      >
        {runLabel(run)}
      </span>
    )
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm px-1.5 py-px text-label whitespace-nowrap',
        RUN_STYLES[kind].chipClass,
        className,
      )}
    >
      {runLabel(run)}
    </span>
  )
}

/**
 * What a game with no run at all shows: the word alone in `dim-2`, in both weights. It was
 * a dashed chip; with readouts borderless, the absence of any tint is what says "none",
 * and `plain` stays as a prop so the column that asks for it compiles unchanged.
 */
export function UnanalysedBadge({
  className,
}: {
  plain?: boolean
  className?: string
}) {
  return (
    <span
      className={cn('inline-flex items-center text-label whitespace-nowrap text-dim-2', className)}
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

/**
 * Where a run is in the queue. Queued, running and done are a dot and a word — routine
 * states, told apart by the dot's colour. A failed run is the one that needs the owner, so
 * it alone keeps a chip, tinted (never framed: a readout has no border) in the blunder red
 * that means "something went wrong". The word itself stays `body`, as in `.bb-error`: red
 * on its own red tint falls under AA on the panel the game header sits on.
 */
export function RunStatusBadge({ status, className }: { status: RunStatus; className?: string }) {
  const { i18n } = useLingui()
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-label whitespace-nowrap',
        status === 'failed'
          ? 'rounded-sm bg-blunder/10 px-1.5 py-px text-body'
          : 'text-soft',
        className,
      )}
    >
      <span className={cn('size-[0.3125rem] flex-none rounded-full', STATUS_DOT[status])} />
      {i18n._(STATUS_LABEL[status])}
    </span>
  )
}
