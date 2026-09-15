import { useLingui } from '@lingui/react/macro'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { AnalyseChoice } from '@/components/analysis/AnalyseDialog'
import { useEngineSetup } from '@/components/analysis/useEngineSetup'
import { SETTING_DEFAULTS } from '@/lib/api/appSettings'
import { getAppSettings, getGame } from '@/lib/api/endpoints'
import {
  useAnalysisEngines,
  useAppSettings,
  useCancelRun,
  useQueueStatus,
  useRequestAnalysis,
  useRuns,
} from '@/lib/api/queries'
import type { CorrespondenceSearchEngine, RunResponse } from '@/lib/api/types'
import { demoAnalysis, demoPlan, DEMO_ENGINE_ID, useDemoAnalysis } from '@/lib/demo/analysis'
import { useEventListener } from '@/lib/events/EventsProvider'
import type { AnalysisProgressEvent, AnalysisRunEvent } from '@/lib/events/types'
import { useRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { toast } from '@/lib/toast'

export interface RunProgress {
  done: number
  total: number
}

/**
 * Drives the game view's **Analyse…**: the dialog's open state, what it offers, and the
 * `POST /analysis` its press sends, followed through the `/events` socket rather than
 * polling. Guarded on the run, not only the game — two runs over one game are ordinary (an
 * import queues its pass, and somebody can ask for a run while that is still waiting), and
 * a listener that checked `game_id` alone would interleave two counters into one bar and
 * let whichever run finished first clear the other one's progress.
 *
 * The run the button follows prefers one somebody asked for: a requested run goes ahead of
 * every import pass, so it is the one about to move, and the one the reader is waiting on.
 * An import pass still shows in the header, but does not hold the button — asking for a
 * run over a game whose pass is 400th in the queue is exactly what the dialog is for.
 *
 * **A missing engine is not a refusal to report, it is a step to offer.** When the
 * deployment has no UCI engine switched on at all, the dialog would be a form with nothing
 * to pick, so the browser-Stockfish setup opens in its place and, once that engine has
 * registered, the dialog opens with it listed. Every other refusal — an engine switched
 * off, on a machine that is not connected, a limit the server will not take — is shown in
 * the dialog in the backend's own words ("'sf-nuc' runs on 'nuc', which is not
 * connected"), where the choice that caused it can still be changed.
 *
 * On the demo there is no POST at all. Nothing on that server searches, so the run happens
 * in this tab (`lib/demo/analysis.ts`) with the dialog's lines, limit and moves, and the
 * result is read back out of `demoDetail` instead of the library.
 */
export function useAnalysisRequest(gameId: number | null) {
  const { t } = useLingui()
  const setup = useEngineSetup()
  const capabilities = useRuntimeCapabilities()
  const demo = useDemoAnalysis()
  const readOnly = capabilities.read_only
  // Which game the dialog was opened over, rather than a bare flag: moving to another game
  // closes it by no longer matching, with no effect to run.
  const [openFor, setOpenFor] = useState<number | null>(null)
  const open = openFor !== null && openFor === gameId
  const [refusal, setRefusal] = useState<string | null>(null)
  const [demoPending, setDemoPending] = useState(false)
  // Moving to another game abandons whatever the last one was in the middle of: the setup
  // is shut, and `requestEpoch` is bumped so a `resume` still waiting on Stockfish resolves
  // into a game nobody is looking at and does nothing. `setup.close` is stable.
  const requestEpoch = useRef(0)
  const { close: closeSetup, show: showSetup } = setup
  useEffect(() => {
    closeSetup()
    return () => {
      requestEpoch.current += 1
    }
  }, [gameId, closeSetup])
  // A reference game has no id in the library and nothing to run over, so the run list is
  // not asked for. `useRuns` still needs *an* id for its key; nothing reads the result.
  const runs = useRuns(gameId ?? 0, { enabled: gameId !== null })
  const analysis = useRequestAnalysis()
  const cancelRun = useCancelRun()
  // Whether the queue is paused: a queued run then waits for the resume, and the button has
  // to say so rather than spin as though it were moving. The same cache the top bar reads.
  const queue = useQueueStatus({ enabled: gameId !== null && !readOnly })
  // Both only while the dialog is up: a reader stepping through a game never needs them.
  const serverEngines = useAnalysisEngines({ enabled: open && gameId !== null && !readOnly })
  const settings = useAppSettings({ enabled: open && gameId !== null })
  // The demo's one engine is this tab's Stockfish; there is nothing on its server to list.
  const engines: CorrespondenceSearchEngine[] | undefined = readOnly
    ? [{ engine_id: DEMO_ENGINE_ID, name: t`Stockfish in this tab`, default: true }]
    : serverEngines.data

  // Nothing to pick is a missing step, not a form: the setup stands in for the dialog, which
  // stays open underneath but undrawn. Setting up browser Stockfish invalidates `['engines']`,
  // the list comes back with it, and the dialog draws itself with nothing to reopen. Waits
  // out a refetch, so the empty answer from before the setup cannot bounce straight back.
  // Declining the setup closes the dialog too: left open and undrawn, it would pop up over
  // the board the moment a runner connected or an engine was added in another tab.
  const noEngines =
    open && !readOnly && serverEngines.data?.length === 0 && !serverEngines.isFetching
  useEffect(() => {
    if (noEngines) {
      showSetup(
        () => {},
        () => setOpenFor(null),
      )
    }
  }, [noEngines, showSetup])

  const openDialog = useCallback(() => {
    if (gameId === null) return
    setRefusal(null)
    if (readOnly && !demoAnalysis.getSnapshot().ready) {
      const mine = requestEpoch.current
      showSetup(() => {
        if (mine === requestEpoch.current) setOpenFor(gameId)
      })
      return
    }
    setOpenFor(gameId)
  }, [gameId, readOnly, showSetup])

  const closeDialog = useCallback(() => {
    setOpenFor(null)
    setRefusal(null)
  }, [])

  /** The last `analysis.progress` frame, tagged with the run it belongs to. */
  const [progress, setProgress] = useState<(RunProgress & { runId: number }) | null>(null)
  /** The run `POST /analysis` just returned, until `useRuns` reports it. See `activeRun`. */
  const [requested, setRequested] = useState<RunResponse | null>(null)

  const listedRun = useMemo<RunResponse | null>(() => {
    const live = runs.data?.filter((run) => run.status === 'queued' || run.status === 'running') ?? []
    return live.find((run) => run.requested) ?? live[0] ?? null
  }, [runs.data])
  // `POST /analysis` never dedupes ("re-analysis is always a new run"), and the run list
  // only catches up a refetch later — the socket invalidation is debounced on top of that.
  // The run the mutation just returned stands in until the list has it, so the button
  // cannot be pressed twice into two runs over the same game.
  useEffect(() => {
    if (requested && runs.data?.some((run) => run.id === requested.id)) setRequested(null)
  }, [requested, runs.data])
  const activeRun = listedRun?.requested ? listedRun : (requested ?? listedRun)
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
  useEventListener('analysis.cancelled', (event) => {
    if (!tracksRun(event as AnalysisRunEvent)) return
    setProgress(null)
    setRequested(null)
  })
  // The counter belongs to one run, so a different run taking the button over starts empty
  // rather than inheriting the last frame of the one before it.
  const runProgress: RunProgress | null =
    progress && progress.runId === activeRunId
      ? { done: progress.done, total: progress.total }
      : null

  const request = useCallback(
    (choice: AnalyseChoice) => {
      if (gameId === null) return
      const mine = requestEpoch.current
      setRefusal(null)
      // The demo never queues: there is nothing on its server to queue *onto*, and the run
      // happens in this tab against the game the API already has. A second run builds on
      // the first one's result, so both stay on the game. The plan is built once up front
      // for its refusals alone — a limit or window it would throw on is said in the
      // dialog, not in a toast after the dialog has gone.
      if (readOnly) {
        // The tab has one engine, so there is no engine to send.
        const { engine_id: _engine, ...runRequest } = choice
        setDemoPending(true)
        void Promise.all([getGame(gameId), getAppSettings()])
          .then(([detail, appSettings]) => {
            if (mine !== requestEpoch.current) return
            const base = demoAnalysis.getSnapshot().results.get(gameId) ?? detail
            demoPlan(base, runRequest, appSettings, 0)
            setOpenFor(null)
            demoAnalysis
              .run(base, runRequest, appSettings)
              .catch((cause: unknown) =>
                toast.error(cause instanceof Error ? cause.message : String(cause)),
              )
          })
          .catch((cause: unknown) => {
            if (mine === requestEpoch.current) {
              setRefusal(cause instanceof Error ? cause.message : String(cause))
            }
          })
          .finally(() => setDemoPending(false))
        return
      }
      analysis.mutate(
        { game_id: gameId, ...choice },
        {
          onSuccess: (run) => {
            setRequested(run)
            if (mine === requestEpoch.current) setOpenFor(null)
          },
          onError: (error) => {
            if (mine === requestEpoch.current) setRefusal(error.message)
          },
        },
      )
    },
    [analysis, gameId, readOnly],
  )

  const demoRun = demo.activeRun?.game_id === gameId ? demo.activeRun : null
  const pending = readOnly ? demoPending : analysis.isPending
  // The rule the button is disabled by (`BoardPanel`), applied to every way of opening the
  // dialog, the A key included: while a requested run is live or a press is in flight, a
  // second press would queue the same run twice — and on the demo, abort the one working.
  const busy = pending || (readOnly ? demoRun : activeRun)?.requested === true
  const openWhenIdle = useCallback(() => {
    if (!busy) openDialog()
  }, [busy, openDialog])

  // The stop square beside the button: only for a run somebody asked for, the same run the
  // button is held by. An import pass is the queue's business and is stopped from there.
  // `requested` is cleared on success because the list may never have caught up with a run
  // that was taken back at once, and the stand-in would then hold the button for ever.
  const stoppableId = readOnly ? null : activeRun?.requested ? activeRun.id : null
  const { mutate: cancel } = cancelRun
  const stop = useCallback(() => {
    if (readOnly) {
      demoAnalysis.stop()
      return
    }
    if (stoppableId === null) return
    cancel(stoppableId, {
      onSuccess: () => {
        setRequested(null)
        setProgress(null)
      },
      onError: (error) => toast.error(error.message),
    })
  }, [cancel, readOnly, stoppableId])
  const canStop = readOnly ? demoRun?.requested === true : stoppableId !== null
  return {
    /** A run over this game that is queued or running right now, a requested one first. */
    activeRun: readOnly ? demoRun : activeRun,
    demoDetail: readOnly && gameId !== null ? demo.results.get(gameId) : undefined,
    setupDialog: setup.dialog,
    /** Live ply counts from `analysis.progress`, while a run is working. */
    progress: readOnly ? (demoRun ? demo.progress : null) : runProgress,
    pending,
    /** Stops the requested run the button is held by; undefined while there is none. */
    stop: canStop ? stop : undefined,
    /** Whether that stop is on its way to the server. */
    stopping: cancelRun.isPending,
    /** The queue is paused, so a queued run is waiting for the resume, not for its turn. */
    queuePaused: !readOnly && queue.data?.paused === true,
    /** Whether the Analyse dialog is up, and what it needs to draw. */
    dialog: {
      open: open && !noEngines,
      engines,
      defaultMultipv: settings.data?.analysis_multipv ?? SETTING_DEFAULTS.analysis_multipv,
      defaultNodes: settings.data?.analysis_nodes ?? SETTING_DEFAULTS.analysis_nodes,
      /** The last refusal, in the backend's (or the demo planner's) own words. */
      error: refusal,
    },
    /** Opens the dialog, unless a requested run or a press is already under way. */
    openDialog: openWhenIdle,
    closeDialog,
    request,
  }
}
