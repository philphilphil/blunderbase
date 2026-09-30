/**
 * **Analyse…**, which opens the dialog where a run is shaped (engine, lines, limit, moves)
 * rather than queueing one outright — there is no single "right" run to put behind a bare
 * button. It stays pressable once a run has finished: re-analysis is always a new run.
 *
 * While a run somebody asked for is queued or running it disables and carries a spinner and
 * the progress, with the run's own description (`d24 · 2 lines`) in the tooltip. An import
 * pass waiting over the game neither disables nor spins it: a requested run goes ahead of
 * that pass, which is the point of asking.
 *
 * It lives at the end of the engine pane's title strip, on the Run tab, among the tools
 * after the strip's rule: it is the Run tab's one command, a labelled `xs` face, since it
 * queues a run of this game. `variant="strip"` is that placement. `variant="row"` is the
 * board's control row, where it stands in only while ⇧E has taken the engine pane off the
 * screen — the one moment a reader most wants to ask, having written their own verdict
 * down; there it carries the scan icon (`ScanIcons`) like the row's other commands.
 *
 * **Held, it can be stopped.** A depth-40 look that turns out to take an hour is a run the
 * reader has to be able to take back, so while a requested run holds the button a stop
 * square stands beside it — the Live search's Stop (`EnginePaneTabs`), because it is the
 * same act on the other claim.
 *
 * **Paused, it says so.** A run queued while the queue is paused is not about to move, and a
 * spinner would say it is: the pause icon and "Paused" stand in until the queue is resumed.
 * A run already on an engine keeps spinning — the pause only stops the next claim.
 */
import { useLingui } from '@lingui/react/macro'
import { Loader2, Pause, Square } from 'lucide-react'

import { Button, buttonVariants } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { GameRunSummary, RunResponse } from '@/lib/api/types'
import { runLabel } from '@/lib/chess/classification'
import { cn } from '@/lib/utils'

import { AnalyseIcon } from './ScanIcons'

export interface AnalyseButtonProps {
  finishedRun: GameRunSummary | null
  busy: boolean
  activeRun: RunResponse | null
  progress: { done: number; total: number } | null
  onAnalyse: () => void
  /** Stops the run holding the button. Left out while nothing somebody asked for is live. */
  onStop?: () => void
  stopping?: boolean
  /** The analysis queue is paused. */
  queuePaused?: boolean
  variant?: 'strip' | 'row'
}

export function AnalyseButton({
  finishedRun,
  busy,
  activeRun,
  progress,
  onAnalyse,
  onStop,
  stopping = false,
  queuePaused = false,
  variant = 'strip',
}: AnalyseButtonProps) {
  const { t } = useLingui()
  const percent =
    busy && progress && progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : null
  // The ellipsis says it opens a dialog, like every dialog opener (the clarity pass).
  const name = t`Analyse…`
  const strip = variant === 'strip'

  const waiting = busy && queuePaused && activeRun?.status === 'queued'
  const stoppable = busy && onStop !== undefined
  const state = activeRun?.status === 'running' ? t`Analysing` : t`Queued`
  const tooltip = waiting
    ? t`The analysis queue is paused; this run starts once it is resumed`
    : busy
    ? activeRun
      ? `${state} · ${runLabel(activeRun)}`
      : state
    : activeRun
      ? t`An analysis pass is waiting over this game; a run you ask for goes ahead of it (A)`
      : finishedRun
        ? t`Analysed — choose a run to go deeper (A)`
        : t`Choose an engine, a limit and the moves to analyse (A)`

  // The tool button (`secondary`) at the placement's standard size — `xs` in the strip, `sm`
  // in the control row. The phone's taller row target (`max-md:`) is the control row's own.
  // In the strip it is the label alone: the word says it, and the glyph would cost the
  // strip's facts their room; a spinner or the pause stands in while a run holds it.
  //
  // A finished run is not marked on the button: "analysed …" in the header says it, and
  // accent text is a link's, a blue fill a pressed toggle's.
  const icon = strip ? 'size-3' : 'size-3.5'
  const glyph = waiting ? (
    <Pause className={icon} aria-hidden />
  ) : busy ? (
    <Loader2 className={cn(icon, 'animate-spin')} aria-hidden />
  ) : strip ? null : (
    <AnalyseIcon className={icon} />
  )
  return (
    <span className="inline-flex flex-none items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger asChild wrapDisabled>
          <Button
            variant="secondary"
            size={strip ? 'xs' : 'sm'}
            disabled={busy}
            onClick={onAnalyse}
            aria-label={busy ? undefined : name}
            className={cn('flex-none', !strip && 'max-md:h-auto max-md:py-1.5')}
          >
            {glyph}
            <span className={cn(strip && busy && '@max-[24rem]:sr-only')}>
              {waiting ? t`Paused` : percent !== null ? `${percent}%` : name}
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
      {/* Beside the held button, not inside it: the held button is disabled, and a button
          cannot hold a button. The same ghost square as the Live search's Stop. */}
      {stoppable ? (
        <button
          type="button"
          aria-label={t`Stop this analysis`}
          title={stopping ? t`Stopping this analysis…` : t`Stop this analysis`}
          data-testid="analyse-stop"
          disabled={stopping}
          onClick={onStop}
          className={cn(
            buttonVariants({ variant: 'ghost', size: 'icon-xs' }),
            'hover:not-disabled:text-blunder',
          )}
        >
          <Square className="size-3" fill="currentColor" strokeWidth={0} aria-hidden />
        </button>
      ) : null}
    </span>
  )
}
