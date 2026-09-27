/**
 * **Analyse…**, which opens the dialog where a run is shaped (engine, lines, limit, moves)
 * rather than queueing one outright — there is no single "right" run to put behind a bare
 * button. Its label turns the accent once a run has finished over the game, and it stays
 * pressable: re-analysis is always a new run.
 *
 * While a run somebody asked for is queued or running it disables and carries a spinner and
 * the progress, with the run's own description (`d24 · 2 lines`) in the tooltip. An import
 * pass waiting over the game neither disables nor spins it: a requested run goes ahead of
 * that pass, which is the point of asking.
 *
 * It lives at the end of the engine pane's title strip, on the Run tab, left of the rule
 * that fences off the live switch: this button changes the stored run, the switch starts a
 * search that stores nothing, and the scan icons say they are the same kind of look
 * (`ScanIcons`). `variant="strip"` is that placement. `variant="row"` is the board's control
 * row, where it stands in only while ⇧E has taken the engine pane off the screen — the one
 * moment a reader most wants to ask, having written their own verdict down.
 *
 * On a strip too narrow for the word, the word goes and the icon stays (`@max-`, against the
 * strip's container).
 *
 * **Held, it can be stopped.** A depth-40 look that turns out to take an hour is a run the
 * reader has to be able to take back, so while a requested run holds the button a stop
 * square sits inside the same pill — the Live tab's square (`EnginePaneTabs`), because it is
 * the same act on the other claim. A sibling of the button rather than inside it, since the
 * held button is disabled and a button cannot hold a button.
 *
 * **Paused, it says so.** A run queued while the queue is paused is not about to move, and a
 * spinner would say it is: the pause icon and "Paused" stand in until the queue is resumed.
 * A run already on an engine keeps spinning — the pause only stops the next claim.
 */
import { useLingui } from '@lingui/react/macro'
import { Loader2, Pause, Square } from 'lucide-react'

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
  // No ellipsis, though it opens a dialog: beside the icon the word is a verb on a tab, and
  // the dot run made the strip read as truncated.
  const name = t`Analyse`
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

  // The pill is the wrapper, so it wears the tool button (`secondary`) at the placement's
  // standard size — `xs` in the strip, `sm` in the control row — and the stop square fits
  // inside it. The phone's taller row target (`max-md:`) is the control row's own, kept.
  //
  // Done is said in the accent on the label and icon only. It used to tint the whole pill
  // blue, which is what a pressed toggle looks like; the blue fill and border now mean
  // selected or pressed and nothing else, and a finished run is neither.
  const icon = strip ? 'size-3' : 'size-3.5'
  return (
    <span
      className={cn(
        'inline-flex flex-none items-center rounded-md border border-edge bg-elevated',
        strip ? 'h-6' : 'h-7 max-md:h-auto',
      )}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            disabled={busy}
            onClick={onAnalyse}
            aria-label={busy ? undefined : name}
            className={cn(
              'flex h-full flex-none items-center rounded-md font-medium transition-colors enabled:hover:bg-raised disabled:cursor-default',
              strip ? 'gap-1 px-2 text-label' : 'gap-1.5 px-2.5 text-data max-md:py-1.5',
              stoppable && (strip ? 'pr-1' : 'pr-1.5'),
              finishedRun ? 'text-accent-teal' : 'text-body hover:text-ink',
            )}
          >
            {waiting ? (
              <Pause className={icon} aria-hidden />
            ) : busy ? (
              <Loader2 className={cn(icon, 'animate-spin')} aria-hidden />
            ) : (
              <AnalyseIcon className={icon} />
            )}
            <span className={cn(strip && '@max-[24rem]:sr-only')}>
              {waiting ? t`Paused` : percent !== null ? `${percent}%` : name}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
      {stoppable ? (
        <button
          type="button"
          aria-label={t`Stop this analysis`}
          title={t`Stop this analysis`}
          data-testid="analyse-stop"
          disabled={stopping}
          onClick={onStop}
          className="mr-0.5 inline-flex size-5 items-center justify-center rounded-md text-soft outline-none transition-colors hover:bg-raised hover:text-blunder focus-visible:bg-raised disabled:opacity-50"
        >
          <Square className="size-2.5" fill="currentColor" strokeWidth={0} />
        </button>
      ) : null}
    </span>
  )
}
