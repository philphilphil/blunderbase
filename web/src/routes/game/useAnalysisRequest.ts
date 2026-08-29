import { useCallback, useEffect, useMemo, useState } from 'react'

import { useRequestAnalysis, useRuns } from '@/lib/api/queries'
import type { RunResponse, Tier } from '@/lib/api/types'
import { useEventListener } from '@/lib/events/EventsProvider'
import type { AnalysisProgressEvent, AnalysisRunEvent } from '@/lib/events/types'
import { toast } from '@/lib/toast'

export interface RunProgress {
  done: number
  total: number
}

/**
 * Drives the game view's Quick and Deep analysis triggers: `POST /analysis { game_id,
 * tier }`, followed through the `/events` socket rather than polling. Guarded on the run,
 * not only the game — two runs over one game are ordinary (an import auto-queues a quick
 * pass, and a button can be pressed while that is still going), and a listener that checked
 * `game_id` alone would interleave two counters into one bar and let whichever run finished
 * first clear the other one's progress.
 *
 * `activeRun`/`progress`/`pending`/`error` are per-game, not per-tier: only one run is ever
 * live over a game at a time in practice, so both buttons watch the same state and disable
 * together (`BoardPanel` decides which of the two shows the spinner, off `activeRun.tier`).
 *
 * A refusal is toasted. Nothing falls back any more: if the engine assigned to a tier is
 * switched off or on a machine that is not connected, the POST is refused with a sentence
 * naming it ("'sf-nuc' runs on 'nuc', which is not connected"), and the button's only trace
 * of that was a red tint and a tooltip nobody hovers. The sentence is passed through rather
 * than replaced — it is the same one the Engines page shows for that role, and it says
 * which engine and what to do about it.
 */
export function useAnalysisRequest(gameId: number) {
  const runs = useRuns(gameId)
  const analysis = useRequestAnalysis({ onError: (error) => toast.error(error.message) })

  /** The last `analysis.progress` frame, tagged with the run it belongs to. */
  const [progress, setProgress] = useState<(RunProgress & { runId: number }) | null>(null)
  /** The run `POST /analysis` just returned, until `useRuns` reports it. See `activeRun`. */
  const [requested, setRequested] = useState<RunResponse | null>(null)

  const listedRun = useMemo<RunResponse | null>(
    () => runs.data?.find((run) => run.status === 'queued' || run.status === 'running') ?? null,
    [runs.data],
  )
  // `POST /analysis` never dedupes ("re-analysis is always a new run"), and the run list
  // only catches up a refetch later — the socket invalidation is debounced on top of that.
  // The run the mutation just returned stands in until the list has it, so the button
  // cannot be pressed twice into two full passes over the same game.
  useEffect(() => {
    if (requested && runs.data?.some((run) => run.id === requested.id)) setRequested(null)
  }, [requested, runs.data])
  const activeRun = listedRun ?? requested
  const activeRunId = activeRun?.id ?? null

  const tracksRun = (frame: AnalysisRunEvent | AnalysisProgressEvent) =>
    frame.game_id === gameId && activeRunId !== null && frame.run_id === activeRunId

  useEventListener('analysis.progress', (event) => {
    const frame = event as AnalysisProgressEvent
    if (!tracksRun(frame)) return
    setProgress({ runId: frame.run_id, done: frame.done, total: frame.total })
  })
  useEventListener('analysis.done', (event) => {
    if (!tracksRun(event as AnalysisRunEvent)) return
    setProgress(null)
  })
  useEventListener('analysis.failed', (event) => {
    if (!tracksRun(event as AnalysisRunEvent)) return
    setProgress(null)
  })
  // The counter belongs to one run, so a different run taking the button over starts empty
  // rather than inheriting the last frame of the one before it.
  const runProgress: RunProgress | null =
    progress && progress.runId === activeRunId
      ? { done: progress.done, total: progress.total }
      : null

  const request = useCallback(
    (tier: Tier) => {
      analysis.mutate({ game_id: gameId, tier }, { onSuccess: (run) => setRequested(run) })
    },
    [analysis, gameId],
  )

  return {
    /** A run over this game that is queued or running right now. */
    activeRun,
    /** Live ply counts from `analysis.progress`, while a run is working. */
    progress: runProgress,
    pending: analysis.isPending,
    error: analysis.error,
    request,
  }
}
