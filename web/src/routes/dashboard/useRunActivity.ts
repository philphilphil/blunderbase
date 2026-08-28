/**
 * The analysis runs this browser has watched go by, newest first.
 *
 * `/analysis/queue` reports counts and nothing else — there is no endpoint that lists the
 * runs in the queue — so the per-run rows design 2a draws are assembled from the `/events`
 * socket instead. That means the list is what has happened since the page was opened, not
 * a backlog: the card says so, and falls back to the counts when it is empty.
 */
import { useCallback, useState } from 'react'

import { useEventListener } from '@/lib/events/EventsProvider'
import type { AnyEvent } from '@/lib/events/types'
import type { RunStatus, Tier } from '@/lib/api/types'

export interface RunActivity {
  runId: number
  gameId: number | null
  tier: Tier
  /**
   * A Maia fill rather than an engine pass. Fills are queued under the quick tier for its
   * engine and its place in the queue, so `tier` is not what a row should be labelled by.
   */
  maiaOnly: boolean
  status: RunStatus
  /** 0..100 while a run is executing, null before it reports any progress. */
  progress: number | null
  error: string | null
  updatedAt: number
}

/** More than the card shows, so finishing a run does not make the list jump. */
const KEEP = 12

function isAnalysisEvent(event: AnyEvent): event is AnyEvent & {
  event: string
  run_id: number
  game_id?: number | null
  tier?: Tier
  status?: RunStatus
  maia_only?: boolean
  done?: number
  total?: number
  error?: string
} {
  return (
    typeof event.event === 'string' &&
    event.event.startsWith('analysis.') &&
    typeof (event as { run_id?: unknown }).run_id === 'number'
  )
}

const STATUS_OF: Record<string, RunStatus> = {
  'analysis.queued': 'queued',
  'analysis.running': 'running',
  'analysis.progress': 'running',
  'analysis.done': 'done',
  'analysis.failed': 'failed',
}

export function useRunActivity(): RunActivity[] {
  const [runs, setRuns] = useState<RunActivity[]>([])

  // The socket hands events to a listener bound once, so the update is functional and
  // never closes over a stale list.
  const record = useCallback((event: AnyEvent) => {
    if (!isAnalysisEvent(event)) return
    const status = STATUS_OF[event.event]
    if (!status) return
    setRuns((current) => {
      const previous = current.find((run) => run.runId === event.run_id)
      const next: RunActivity = {
        runId: event.run_id,
        gameId: event.game_id ?? previous?.gameId ?? null,
        tier: event.tier ?? previous?.tier ?? 'quick',
        maiaOnly: event.maia_only ?? previous?.maiaOnly ?? false,
        status,
        progress:
          event.event === 'analysis.progress' && typeof event.total === 'number' && event.total > 0
            ? Math.min(100, Math.round(((event.done ?? 0) / event.total) * 100))
            : status === 'done'
              ? 100
              : status === 'running'
                ? (previous?.progress ?? null)
                : null,
        error: event.error ?? (status === 'failed' ? 'the run failed' : null),
        updatedAt: Date.now(),
      }
      return [next, ...current.filter((run) => run.runId !== event.run_id)].slice(0, KEEP)
    })
  }, [])

  useEventListener('analysis.queued', record)
  useEventListener('analysis.running', record)
  useEventListener('analysis.progress', record)
  useEventListener('analysis.done', record)
  useEventListener('analysis.failed', record)

  return runs
}
