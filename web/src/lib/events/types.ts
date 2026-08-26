/**
 * The `/events` frames, as `backend/api/routes/events.py` sends them: one service event
 * per frame, flat, with the `event` key naming it.
 */
import type { JobStatus, LiveState, RunStatus, Source, Tier } from '@/lib/api/types'

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
  'note.created',
  'note.updated',
  'live.updated',
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

export type AnalysisEvent = AnalysisRunEvent | AnalysisProgressEvent

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

export type BlunderbaseEvent =
  | PingEvent
  | ImportEvent
  | AnalysisEvent
  | NoteEvent
  | LiveUpdatedEvent

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
