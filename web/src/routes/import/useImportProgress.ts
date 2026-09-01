/**
 * Live sync progress, assembled from the `import.*` frames on `/events`.
 *
 * A sync is not request-shaped — the POST answers with a job id the moment the row
 * exists and the adapter keeps walking the archive for minutes afterwards. The job row
 * is the record of what happened; this is what the page shows *while* it is happening,
 * one entry per source, and it is deliberately reset by `import.started` so a second
 * sync of the same source never shows the first one's counts.
 */
import { useReducer } from 'react'

import type { JobStatus, Source } from '@/lib/api/types'
import { useEventListener } from '@/lib/events/EventsProvider'
import type { AnyEvent } from '@/lib/events/types'

export interface ImportFailure {
  ref: string
  error: string
}

export interface SourceProgress {
  source: Source
  jobId: number | null
  /** Between `import.started` and `import.finished`. */
  running: boolean
  seen: number
  imported: number
  skipped: number
  /** Games left alone because the owner deleted them; Manage is where that is taken back. */
  blocked: number
  failed: number
  /** The game the adapter touched last — a Lichess id, a PGN header, a chess.com URL. */
  lastRef: string | null
  /** The per-game failures seen so far, newest last, capped. */
  failures: ImportFailure[]
  /** Set once the job has finished. */
  status: JobStatus | null
  /** The adapter's own note: the account it synced, or the error that stopped it. */
  message: string | null
  finishedAt: string | null
}

export type ImportProgressState = Partial<Record<Source, SourceProgress>>

/**
 * A sync of a broken archive can fail every game it sees; the job row keeps all of them,
 * and this only has to say enough for the person watching to stop it.
 */
export const MAX_TRACKED_FAILURES = 25

function blank(source: Source, jobId: number | null): SourceProgress {
  return {
    source,
    jobId,
    running: true,
    seen: 0,
    imported: 0,
    skipped: 0,
    blocked: 0,
    failed: 0,
    lastRef: null,
    failures: [],
    status: null,
    message: null,
    finishedAt: null,
  }
}

function counts(event: Record<string, unknown>) {
  return {
    seen: Number(event.seen ?? 0),
    imported: Number(event.imported ?? 0),
    skipped: Number(event.skipped ?? 0),
    blocked: Number(event.blocked ?? 0),
    failed: Number(event.failed ?? 0),
  }
}

/**
 * One frame folded into the progress table. Returns the state it was given whenever the
 * frame is not an import event, so a component reading this never re-renders for a
 * `ping` or an analysis frame.
 */
export function reduceImportProgress(
  state: ImportProgressState,
  event: AnyEvent,
): ImportProgressState {
  const frame = event as Record<string, unknown>
  const source = frame.source as Source | undefined
  if (!source) return state
  const jobId = typeof frame.job_id === 'number' ? frame.job_id : null

  switch (event.event) {
    case 'import.started':
      return { ...state, [source]: blank(source, jobId) }

    case 'import.game': {
      const current = state[source] ?? blank(source, jobId)
      const ref = typeof frame.ref === 'string' ? frame.ref : null
      const error = typeof frame.error === 'string' ? frame.error : null
      const failures =
        frame.status === 'failed' && ref
          ? [...current.failures, { ref, error: error ?? 'failed' }].slice(-MAX_TRACKED_FAILURES)
          : current.failures
      return {
        ...state,
        [source]: { ...current, jobId: jobId ?? current.jobId, lastRef: ref, failures, ...counts(frame) },
      }
    }

    case 'import.finished': {
      const current = state[source] ?? blank(source, jobId)
      return {
        ...state,
        [source]: {
          ...current,
          jobId: jobId ?? current.jobId,
          running: false,
          status: (frame.status as JobStatus | undefined) ?? null,
          message: typeof frame.message === 'string' ? frame.message : null,
          finishedAt: typeof frame.at === 'string' ? frame.at : null,
          ...counts(frame),
        },
      }
    }

    default:
      return state
  }
}

/** The live progress of every sync this page has watched, keyed by source. */
export function useImportProgress(): ImportProgressState {
  const [state, dispatch] = useReducer(reduceImportProgress, {})
  useEventListener('import.started', dispatch)
  useEventListener('import.game', dispatch)
  useEventListener('import.finished', dispatch)
  return state
}
