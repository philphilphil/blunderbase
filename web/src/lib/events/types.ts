/**
 * The `/events` frames, as `backend/api/routes/events.py` sends them: one service event
 * per frame, flat, with the `event` key naming it.
 */
import type {
  JobStatus,
  LiveState,
  RunStatus,
  RunnerTransport,
  Source,
  StreamEndReason,
  StreamLine,
  StreamSurface,
  Tier,
} from '@/lib/api/types'

export const EVENT_NAMES = [
  'ping',
  'import.started',
  'import.game',
  'import.finished',
  'analysis.queued',
  'analysis.running',
  'analysis.progress',
  'analysis.done',
  'analysis.failed',
  'analysis.backfill',
  'note.created',
  'note.updated',
  'live.updated',
  'stream.started',
  'stream.snapshot',
  'stream.ended',
  'runner.connected',
  'runner.disconnected',
  'runner.updated',
] as const

export type EventName = (typeof EVENT_NAMES)[number]

export interface PingEvent {
  event: 'ping'
}

interface ImportBase {
  job_id: number | null
  source: Source
}

export interface ImportStartedEvent extends ImportBase {
  event: 'import.started'
  at: string
}

export interface ImportGameEvent extends ImportBase {
  event: 'import.game'
  ref: string
  status: string
  game_id: number | null
  error: string | null
  seen: number
  imported: number
  skipped: number
  failed: number
}

export interface ImportFinishedEvent extends ImportBase {
  event: 'import.finished'
  status: JobStatus
  seen: number
  imported: number
  skipped: number
  failed: number
  message: string | null
  at: string
}

export type ImportEvent = ImportStartedEvent | ImportGameEvent | ImportFinishedEvent

interface AnalysisBase {
  run_id: number
  game_id: number | null
  tier: Tier
  status: RunStatus
  at?: string
}

export interface AnalysisRunEvent extends AnalysisBase {
  event: 'analysis.queued' | 'analysis.running' | 'analysis.done' | 'analysis.failed'
  fen?: string | null
  engine_id?: number | null
  priority?: number
  attempts?: number
  evals?: number
  error?: string
  stderr?: string | null
  will_retry?: boolean
}

export interface AnalysisProgressEvent extends AnalysisBase {
  event: 'analysis.progress'
  done: number
  total: number
}

/**
 * One frame per bulk operation, not per game: a backfill over ten thousand games says
 * this once. It carries no run, so it is not an `AnalysisBase` — `outstanding` is the
 * whole tier's queued-plus-running, which is what a client watching the pass reads.
 */
export interface AnalysisBackfillEvent {
  event: 'analysis.backfill'
  tier: Tier
  queued: number
  outstanding: number
}

export type AnalysisEvent = AnalysisRunEvent | AnalysisProgressEvent | AnalysisBackfillEvent

export interface NoteEvent {
  event: 'note.created' | 'note.updated'
  note_id: number
  text: string
  tags: string[]
  game_id: number | null
  position_id: number | null
  created_at: string
  updated_at: string
}

export type LiveUpdatedEvent = { event: 'live.updated' } & LiveState

/**
 * ~2 per second per open board. Delivery is lossy and may reorder (`CLIENT_BACKLOG = 256`,
 * oldest dropped): `seq` is monotonic per session and is what lets a consumer drop a stale
 * frame. `fen`/`multipv` are the session's, so a frame for a position the board has
 * already left can be recognised and dropped.
 */
export interface StreamSnapshotEvent {
  event: 'stream.snapshot'
  session_id: string
  seq: number
  engine_id: number
  engine: string
  runner_id: number | null
  fen: string
  multipv: number
  depth: number | null
  nodes: number | null
  nps: number | null
  time_ms: number | null
  lines: StreamLine[]
  at: string
}

export interface StreamStartedEvent {
  event: 'stream.started'
  session_id: string
  surface: StreamSurface
  engine_id: number
  engine: string
  runner_id: number | null
  runner: string | null
  fen: string
  multipv: number
  at: string
}

/** NOTE: carries no `surface` — match on `session_id` alone. */
export interface StreamEndedEvent {
  event: 'stream.ended'
  session_id: string
  reason: StreamEndReason
  error: string | null
  engine_id: number
  runner_id: number | null
  at: string
}

export type StreamEvent = StreamStartedEvent | StreamSnapshotEvent | StreamEndedEvent

export interface RunnerConnectedEvent {
  event: 'runner.connected'
  runner_id: number
  name: string
  slots: number
  version: string | null
  transport: RunnerTransport
  /** Advertised engine names. */
  engines: string[]
  at: string
}

export interface RunnerDisconnectedEvent {
  event: 'runner.disconnected'
  runner_id: number
  name: string
  reason: 'socket_closed' | 'timeout' | 'revoked' | 'replaced' | 'shutdown'
  at: string
}

/** A state change only — never a heartbeat, never a snapshot. */
export interface RunnerUpdatedEvent {
  event: 'runner.updated'
  runner_id: number
  name: string
  slots: number
  connected: boolean
  busy: number
  streams: number
  free_slots: number
  at: string
}

export type RunnerEvent = RunnerConnectedEvent | RunnerDisconnectedEvent | RunnerUpdatedEvent

export type BlunderbaseEvent =
  | PingEvent
  | ImportEvent
  | AnalysisEvent
  | NoteEvent
  | LiveUpdatedEvent
  | StreamEvent
  | RunnerEvent

/** A frame carrying an event name we do not model yet. */
export interface UnknownEvent {
  event: string
  [key: string]: unknown
}

export type AnyEvent = BlunderbaseEvent | UnknownEvent

export function isEventName(value: string): value is EventName {
  return (EVENT_NAMES as readonly string[]).includes(value)
}

/** Parse one socket frame. Returns null for anything that is not a shaped event. */
export function parseEvent(raw: string): AnyEvent | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const event = (parsed as { event?: unknown }).event
  if (typeof event !== 'string') return null
  return parsed as AnyEvent
}
