import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { demoAnalysis, useDemoAnalysis } from '@/lib/demo/analysis'
import { useEngineSetup } from '@/components/analysis/useEngineSetup'
import { ApiError } from '@/lib/api/client'
import { getGame, getAppSettings, listEngineRoles } from '@/lib/api/endpoints'

import { useRequestAnalysis, useRuns } from '@/lib/api/queries'
import type { RunResponse, Tier } from '@/lib/api/types'
import { useEventListener } from '@/lib/events/EventsProvider'
import type { AnalysisProgressEvent, AnalysisRunEvent } from '@/lib/events/types'
import { toast } from '@/lib/toast'

export interface RunProgress {
  done: number
  total: number
}

/** Refusals that *may* mean the tier has no engine; the roles decide whether they do. */
const OFFERS_SETUP = ['tier_unavailable', 'no_engine']

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
 * **A missing engine is not a refusal to report, it is a step to offer.** A deployment
 * whose Quick or Deep role has nothing assigned answers the POST with the same status as
 * one whose engine is merely away, so the roles are read to tell the two apart: unassigned
 * opens the setup dialog and, once browser Stockfish holds the role, presses the button
 * again on the reader's behalf. Everything else is toasted — an engine switched off, or on
 * a machine that is not connected, is refused with a sentence naming it ("'sf-nuc' runs on
 * 'nuc', which is not connected"). That sentence is passed through rather than replaced:
 * it is the same one the Engines page shows for that role, and it says what to do.
 *
 * On the demo there is no POST at all. Nothing on that server searches, so both tiers run
 * in this tab (`lib/demo/analysis.ts`) and the result is read back out of `demoDetail`
 * instead of the library.
 */
export function useAnalysisRequest(gameId: number | null) {
  // A reference game has no id in the library and nothing to run over, so the run list is
  // not asked for. `useRuns` still needs *an* id for its key; nothing reads the result.
  const setup = useEngineSetup()
  const capabilities = useRuntimeCapabilities()
  const demo = useDemoAnalysis()
  // Moving to another game abandons whatever the last one was in the middle of: the dialog
  // is shut, and `requestEpoch` is bumped so a `resume` still waiting on Stockfish resolves
  // into a game nobody is looking at and does nothing. `setup.close` is stable by design.
  const requestEpoch = useRef(0)
  const { close } = setup
  useEffect(() => {
    close()
    return () => {
      requestEpoch.current += 1
    }
  }, [gameId, close])
  const runs = useRuns(gameId ?? 0, undefined, { enabled: gameId !== null })
  const analysis = useRequestAnalysis()

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
      if (gameId === null) return
      // The demo never queues: there is nothing on its server to queue *onto*, and the
      // pass runs in this tab against the game the API already has. A second pass builds
      // on the first one's result, so Deep after Quick keeps both runs on the game.
      if (capabilities.read_only) {
        const start = () => {
          void Promise.all([getGame(gameId), getAppSettings()])
            .then(([detail, settings]) =>
              demoAnalysis.run(
                demoAnalysis.getSnapshot().results.get(gameId) ?? detail,
                tier,
                settings,
              ),
            )
            .catch((cause: unknown) =>
              toast.error(cause instanceof Error ? cause.message : String(cause)),
            )
        }
        if (demoAnalysis.getSnapshot().ready) start()
        else setup.show(tier, start)
        return
      }
      // `resume` is what the dialog calls back: the same request, after an engine exists.
      // `mine` pins it to this game — a reader who has moved on before Stockfish finished
      // downloading must not have a run started on a game they have left.
      const mine = requestEpoch.current
      const resume = () =>
        analysis.mutate(
          { game_id: gameId, tier },
          {
            onSuccess: (run) => setRequested(run),
            onError: (error) => {
              const missing =
                error instanceof ApiError && OFFERS_SETUP.includes(error.error)
              if (!missing) return toast.error(error.message)
              // "No engine for this tier" and "the engine for this tier is away" are the
              // same refusal on the wire. Only the first is something a browser engine
              // fixes, and the roles say which of the two it was.
              void listEngineRoles()
                .then((roles) => {
                  if (mine !== requestEpoch.current) return
                  const unassigned = roles.roles.some(
                    (role) => role.role === tier && !role.configured,
                  )
                  if (unassigned) setup.show(tier, resume)
                  else toast.error(error.message)
                })
                .catch(() => toast.error(error.message))
            },
          },
        )
      resume()
    },
    [analysis, gameId, setup, capabilities.read_only],
  )

  return {
    /** A run over this game that is queued or running right now. */
    activeRun: capabilities.read_only ? (demo.activeRun?.game_id === gameId ? demo.activeRun : null) : activeRun,
    demoDetail: capabilities.read_only && gameId !== null ? demo.results.get(gameId) : undefined,
    setupDialog: setup.dialog,
    /** Live ply counts from `analysis.progress`, while a run is working. */
    progress: capabilities.read_only ? (demo.activeRun?.game_id === gameId ? demo.progress : null) : runProgress,
    pending: analysis.isPending,
    error: analysis.error,
    request,
  }
}
