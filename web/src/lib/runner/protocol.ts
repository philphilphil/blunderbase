/**
 * The runner wire contract, from the browser's side: `backend/runners/protocol.py` in
 * TypeScript.
 *
 * Kept as a transcription rather than a re-design, and kept in the wire's own snake_case
 * rather than camel-cased on the way in. A `RunPlan` here has the field names
 * `encode_plan` writes, so the two files can be read side by side and a drift is visible
 * instead of hidden behind a mapping table — which matters more than house style for the
 * one module in this app whose input is written by another program.
 *
 * Two things the Python module's own docstring explains and that are load-bearing here:
 * a frame is a plain object with a `type` and no class per message, and a `MoveEval`
 * crosses the wire **without its `run_id`** — the row arrives unattached and `complete_run`
 * binds it to the run the server thinks is current, which is what stops a replayed payload
 * writing itself onto somebody else's run.
 */
import type { Classification } from '@/lib/api/types'

import type { BestLine } from './search'

export const PROTO_VERSION = 1

/** `runners/config.py: WS_SUBPROTOCOL`. Both halves have to spell it identically. */
export const WS_SUBPROTOCOL = 'blunderbase.runner.v1'

/** `runners/config.py: WS_PATH`, under the API mount. */
export const WS_PATH = '/runner/ws'

// Close codes, `protocol.py`'s own 4000 range: the HTTP status the refusal would have
// been, plus 4000.
export const WS_CLOSE_UNAUTHORIZED = 4401
export const WS_CLOSE_REVOKED = 4403
export const WS_CLOSE_DUPLICATE = 4409
export const WS_CLOSE_PROTO_MISMATCH = 4426
export const WS_CLOSE_RATE_LIMITED = 4429

/** `protocol.CLOSE_REASONS` — the error code each close code stands in for. */
export const CLOSE_REASONS: Record<number, string> = {
  [WS_CLOSE_UNAUTHORIZED]: 'unauthorized',
  [WS_CLOSE_REVOKED]: 'revoked',
  [WS_CLOSE_DUPLICATE]: 'duplicate_connection',
  [WS_CLOSE_PROTO_MISMATCH]: 'proto_mismatch',
  [WS_CLOSE_RATE_LIMITED]: 'rate_limited',
}

export interface Thresholds {
  inaccuracy: number
  mistake: number
  blunder: number
}

/** `encode_plan`'s object, field for field. */
export interface RunPlan {
  run_id: number
  tier: string
  game_id: number | null
  fen: string | null
  variant: string
  initial_fen: string | null
  moves_uci: string[]
  moves_san: (string | null)[]
  /** A null in here is meaningful: that ply's position is not stored. */
  position_ids: (number | null)[]
  ply_start: number
  ply_end: number
  nodes: number
  depth: number | null
  multipv: number
  thresholds: Thresholds
  owner_color: 'white' | 'black' | null
  owner_rating: number | null
  maia_target_elo: number
  maia_elos: number[]
  maia_only: boolean
  maia: boolean
  maia_both_sides: boolean
}

/** One unattached `MoveEval`: `protocol.EVAL_FIELDS`, plus the classification's own string. */
export interface MoveEvalPayload {
  ply: number
  position_id: number | null
  move_uci: string | null
  move_san: string | null
  eval_before_cp: number | null
  eval_before_mate: number | null
  eval_after_cp: number | null
  eval_after_mate: number | null
  win_before: number | null
  win_after: number | null
  win_loss: number | null
  best_move_uci: string | null
  best_lines: BestLine[] | null
  maia_policy: Record<string, unknown> | null
  classification: Classification | null
}

/** One engine this runner says it can run — `protocol.EngineAd.as_dict()`. */
export interface EngineAd {
  name: string
  kind: string
  path: string
  version: string | null
  tier: string | null
  options: Record<string, string | number | boolean>
  declared_options: unknown[]
  streams: boolean
}

/** What a `hello` names to say "I am still executing this". */
export interface ActiveRun {
  run_id: number
  attempt_token: string
}

export class ProtocolError extends Error {}

// --- frames this runner sends ---------------------------------------------

/**
 * The runner's first frame, or the server closes 1008.
 *
 * `browser: true` is not decoration. `protocol.hello`'s own comment says the server takes
 * a runner at its word about what kind of host it is, and a tab that says so is what earns
 * a *vanished* tab its attempt refunds — the owner closing the laptop lid mid-run must not
 * cost the run an attempt. `active_runs` is the other half: on a reconnect it is what lets
 * the gateway's `_reconcile` resume a run rather than orphan it.
 */
export function hello(fields: {
  runner: string
  version: string | null
  slots: number
  engines: EngineAd[]
  activeRuns: ActiveRun[]
}): Record<string, unknown> {
  return {
    type: 'hello',
    proto: PROTO_VERSION,
    runner: fields.runner,
    version: fields.version,
    slots: fields.slots,
    engines: fields.engines,
    active_runs: fields.activeRuns,
    browser: true,
  }
}

export function pong(t: number): Record<string, unknown> {
  return { type: 'pong', t }
}

/** Progress, and the run's heartbeat: a deep position must not look like a dead runner. */
export function runProgress(fields: {
  runId: number
  attemptToken: string
  done: number
  total: number
}): Record<string, unknown> {
  return {
    type: 'run_progress',
    run_id: fields.runId,
    attempt_token: fields.attemptToken,
    done: fields.done,
    total: fields.total,
  }
}

export function runComplete(fields: {
  runId: number
  attemptToken: string
  evals: MoveEvalPayload[]
  note?: string | null
}): Record<string, unknown> {
  return {
    type: 'run_complete',
    run_id: fields.runId,
    attempt_token: fields.attemptToken,
    evals: fields.evals,
    note: fields.note ?? null,
    stderr: null,
  }
}

export function runFailed(fields: {
  runId: number
  attemptToken: string
  error: string
  retry?: boolean
}): Record<string, unknown> {
  return {
    type: 'run_failed',
    run_id: fields.runId,
    attempt_token: fields.attemptToken,
    error: fields.error,
    stderr: null,
    retry: fields.retry ?? true,
  }
}

export function runCancelled(runId: number): Record<string, unknown> {
  return { type: 'run_cancelled', run_id: runId }
}

// --- analysis boards --------------------------------------------------------

/** `protocol.STREAM_REASONS` — why a session ended, in the words the server relays. */
export const STREAM_CLOSED_REASON = 'closed'
export const STREAM_ENGINE_FAILED = 'engine_failed'
export const STREAM_RUNNER_GONE = 'runner_gone'

/** `stream_open`'s default cadence, and what this runner falls back to. */
export const DEFAULT_SNAPSHOT_INTERVAL_MS = 500

/** The slot is genuinely held and the engine is searching. */
export function streamStarted(sessionId: string, engine: string): Record<string, unknown> {
  return { type: 'stream_started', session_id: sessionId, engine }
}

/**
 * One throttled picture of a running search.
 *
 * `lines` is `MoveEval.best_lines`' own shape from the side to move's point of view, so a
 * snapshot and a stored evaluation speak one vocabulary all the way from the engine to the
 * board. `seq` counts up per session, and raw UCI text never leaves the tab that produced
 * it — `snapshots.ts` is where it stops.
 */
export function streamSnapshot(fields: {
  sessionId: string
  seq: number
  depth: number | null
  nodes: number | null
  nps: number | null
  timeMs: number | null
  lines: BestLine[]
}): Record<string, unknown> {
  return {
    type: 'stream_snapshot',
    session_id: fields.sessionId,
    seq: fields.seq,
    depth: fields.depth,
    nodes: fields.nodes,
    nps: fields.nps,
    time_ms: fields.timeMs,
    lines: fields.lines,
  }
}

/** A session is over here — an answer to a `stream_close`, or a refusal of a `stream_open`. */
export function streamClosed(fields: {
  sessionId: string
  reason?: string
  error?: string | null
}): Record<string, unknown> {
  return {
    type: 'stream_closed',
    session_id: fields.sessionId,
    reason: fields.reason ?? STREAM_CLOSED_REASON,
    error: fields.error ?? null,
  }
}

// --- reading what came back ------------------------------------------------

/** One frame out of the text, or a `ProtocolError` naming what was wrong with it. */
export function decodeFrame(text: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    throw new ProtocolError(`frame is not JSON: ${String(cause)}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ProtocolError('a frame is an object')
  }
  const frame = parsed as Record<string, unknown>
  if (typeof frame.type !== 'string' || !frame.type) {
    throw new ProtocolError('frame carries no type')
  }
  return frame
}

/**
 * `decode_plan`, refusing rather than defaulting the fields a run cannot be computed
 * without. A plan that does not decode is a `run_failed` with `retry: false`: a second
 * attempt would decode exactly the same bytes.
 */
export function decodePlan(data: unknown): RunPlan {
  if (!data || typeof data !== 'object') throw new ProtocolError('a plan is an object')
  const raw = data as Record<string, unknown>
  const thresholds = raw.thresholds
  if (!thresholds || typeof thresholds !== 'object') {
    throw new ProtocolError('a plan carries its classification thresholds')
  }
  const limits = thresholds as Record<string, unknown>
  const owner = raw.owner_color
  return {
    run_id: requireInt(raw, 'run_id'),
    tier: requireString(raw, 'tier'),
    game_id: optionalInt(raw.game_id),
    fen: optionalString(raw.fen),
    variant: requireString(raw, 'variant'),
    initial_fen: optionalString(raw.initial_fen),
    moves_uci: list(raw.moves_uci).map(String),
    moves_san: list(raw.moves_san).map((value) => (value === null ? null : String(value))),
    position_ids: list(raw.position_ids).map((value) =>
      value === null || value === undefined ? null : Number(value),
    ),
    ply_start: requireInt(raw, 'ply_start'),
    ply_end: requireInt(raw, 'ply_end'),
    nodes: requireInt(raw, 'nodes'),
    depth: optionalInt(raw.depth),
    multipv: requireInt(raw, 'multipv'),
    thresholds: {
      inaccuracy: Number(limits.inaccuracy),
      mistake: Number(limits.mistake),
      blunder: Number(limits.blunder),
    },
    owner_color: owner === 'white' || owner === 'black' ? owner : null,
    owner_rating: optionalInt(raw.owner_rating),
    maia_target_elo: requireInt(raw, 'maia_target_elo'),
    maia_elos: list(raw.maia_elos).map(Number),
    maia_only: Boolean(raw.maia_only),
    // Absent from a frame an older host encoded, which meant a pass over both sides by
    // always doing one — the same backwards compatibility `decode_plan` keeps.
    maia: raw.maia === undefined ? true : Boolean(raw.maia),
    maia_both_sides: raw.maia_both_sides === undefined ? true : Boolean(raw.maia_both_sides),
  }
}

function list(value: unknown): unknown[] {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) throw new ProtocolError('expected a list')
  return value
}

function requireString(data: Record<string, unknown>, key: string): string {
  const value = data[key]
  if (typeof value !== 'string') throw new ProtocolError(`${key} is missing or is not a string`)
  return value
}

function optionalString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

function requireInt(data: Record<string, unknown>, key: string): number {
  const value = Number(data[key])
  if (!Number.isFinite(value)) throw new ProtocolError(`${key} is missing or is not a number`)
  return Math.trunc(value)
}

function optionalInt(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null
}
