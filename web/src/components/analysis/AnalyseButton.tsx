/**
 * **Analyse…**, which opens the dialog where a run is shaped (engine, lines, limit, moves)
 * rather than queueing one outright — there is no single "right" run to put behind a bare
 * button. Tinted once a run has finished over the game, and still pressable: re-analysis is
 * always a new run.
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
 */
import { useLingui } from '@lingui/react/macro'
import { Loader2 } from 'lucide-react'

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
  variant?: 'strip' | 'row'
}

export function AnalyseButton({
  finishedRun,
  busy,
  activeRun,
  progress,
  onAnalyse,
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

  const state = activeRun?.status === 'running' ? t`Analysing` : t`Queued`
  const tooltip = busy
    ? activeRun
      ? `${state} · ${runLabel(activeRun)}`
      : state
    : activeRun
      ? t`An analysis pass is waiting over this game; a run you ask for goes ahead of it (A)`
      : finishedRun
        ? t`Analysed — choose a run to go deeper (A)`
        : t`Choose an engine, a limit and the moves to analyse (A)`

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={busy}
          onClick={onAnalyse}
          aria-label={busy ? undefined : name}
          className={cn(
            'flex flex-none items-center gap-1 rounded-md border disabled:cursor-default',
            strip
              ? 'h-6 px-1.5 text-[0.6875rem]'
              : 'px-2.5 py-[0.3125rem] text-xs max-md:py-1.5',
            finishedRun
              ? 'border-accent-teal/30 bg-accent-teal/10 text-accent-teal'
              : 'border-edge bg-elevated text-soft hover:text-ink',
          )}
        >
          {busy ? (
            <Loader2 className="size-3 animate-spin" aria-hidden />
          ) : (
            <AnalyseIcon className="size-3" />
          )}
          <span className={cn(strip && '@max-[24rem]:sr-only')}>
            {percent !== null ? `${percent}%` : name}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}
