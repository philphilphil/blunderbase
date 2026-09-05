/**
 * One analysis board's `/streams` session, from the page's point of view.
 *
 * The lifecycle the backend defines and this hook drives:
 *
 * - **open** — `POST /streams`. Never before the user asks: `enabled` starts false, is not
 *   persisted, and a session is never opened for a board with no position on it. *Which*
 *   engine it opens on is remembered, though (`enginePreference.ts`) — that is a preference,
 *   not a running search.
 * - **position change** — `PATCH /streams/{id} {fen}`, debounced. A restart on the same
 *   slot, never a teardown (`services/streams.py:restart`) — arrow-key scrubbing would
 *   otherwise be one request and one slot handover per ply.
 * - **engine change** — `DELETE` then `POST`. The engine is the one thing a session cannot
 *   be patched onto.
 * - **close** — `DELETE /streams/{id}` from the effect cleanup. The server's idle reaper is
 *   the backstop, not the plan.
 *
 * Two things the wire forces on the consumer:
 *
 * - **The server owns the FEN's spelling.** `services/streams.py:_position` runs a caller's
 *   FEN through `read_fen(...).fen()`, so the string that comes back on `StreamResponse`
 *   and on every `stream.snapshot` frame is python-chess's spelling, not the chessops one
 *   the board computed. A frame is therefore matched against the session's own FEN, and the
 *   *board's* position is tracked separately so a frame can still be attributed to the ply
 *   it belongs to. While a restart is in flight there is no such FEN — the server has not
 *   moved yet — and frames are dropped rather than attributed to a position the search has
 *   not started on.
 * - **Delivery is lossy and may reorder** (`CLIENT_BACKLOG = 256`, oldest dropped), so a
 *   frame whose `seq` is not ahead of the last one accepted is dropped.
 */
import { useLingui } from '@lingui/react/macro'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ApiError } from '@/lib/api/client'
import { closeStream, listStreams, openStream, restartStream } from '@/lib/api/endpoints'
import { useRunnersStatus } from '@/lib/api/queries'
import type {
  StreamEndReason,
  StreamResponse,
  StreamSurface,
  StreamUpdate,
} from '@/lib/api/types'
import { engineHosts, type EngineHost } from '@/lib/engines/hosts'
import { useEventListener, useEvents } from '@/lib/events/EventsProvider'
import type { StreamEndedEvent, StreamSnapshotEvent } from '@/lib/events/types'

import { readStreamEnginePick, writeStreamEnginePick } from './enginePreference'
import { snapshotFrom, type StreamSnapshot } from './streamModel'

export type { StreamSnapshot }

/** Scrubbing with the arrow keys is one PATCH after the keyboard settles, not one per ply. */
const PATCH_DEBOUNCE_MS = 150

export type StreamPhase = 'off' | 'opening' | 'running' | 'ended' | 'error'

/**
 * Set when a session ended for a reason worth offering a restart on: `runner_gone`,
 * `engine_failed`, `idle`. Never for `closed`/`replaced` — those are something the user
 * (or another window) did on purpose.
 */
export interface StreamOffer {
  reason: StreamEndReason
  error: string | null
  /**
   * Engines that could take it over now, deep tier first. A runner that went away takes
   * every engine it advertises with it; an engine that crashed, or a session reaped for
   * sitting idle, takes nothing with it and is offered back — on a one-engine deployment
   * it is the only way back at all.
   */
  candidates: EngineHost[]
}

/** What `stream.ended` said, kept so the offer can be recomputed as the roster catches up. */
interface EndedSession {
  reason: StreamEndReason
  error: string | null
  engineId: number
  runnerId: number | null
}

export interface UseStreamSessionOptions {
  surface: StreamSurface
  /**
   * The position to analyse; null keeps the session shut. A change PATCHes the open
   * session (debounced), never a teardown.
   */
  fen: string | null
  /** Echo-only context, handed back on `StreamResponse`. */
  gameId?: number | null
  ply?: number | null
  /** 1..5, default 3. */
  defaultMultipv?: number
}

export interface StreamSessionApi {
  /** The user's toggle; never persisted, never auto-on. */
  enabled: boolean
  setEnabled: (on: boolean) => void
  phase: StreamPhase
  /** The open session as the server described it, for the engine and host labels. */
  session: StreamResponse | null
  /** The newest accepted frame for the position on the board. */
  snapshot: StreamSnapshot | null
  /** The last REST failure, or the error carried on `stream.ended`. */
  error: Error | null
  /**
   * A one-line fact about a session that ended without anything to offer — the other
   * window taking this surface over, most of all.
   */
  note: string | null
  offer: StreamOffer | null
  /**
   * Every engine, streamable or not; the picker disables the rest and shows
   * `streamsReason`. From `engineHosts(useRunnersStatus().data)`.
   */
  engines: EngineHost[]
  /**
   * null ⇒ let the server take the deep tier's engine. Starts at whatever was picked last
   * in this browser, which is null until something else is picked.
   */
  engineId: number | null
  setEngineId: (id: number | null) => void
  multipv: number
  setMultipv: (lines: number) => void
  /** Take the offer: reopen on this engine (null = the deep-tier default). */
  resume: (engineId: number | null) => void
  dismissOffer: () => void
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

export function useStreamSession({
  surface,
  fen,
  gameId = null,
  ply = null,
  defaultMultipv = 3,
}: UseStreamSessionOptions): StreamSessionApi {
  const { t } = useLingui()
  const { reconnects } = useEvents()
  const status = useRunnersStatus()
  const engines = useMemo(() => engineHosts(status.data), [status.data])

  const [enabled, setEnabledState] = useState(false)
  const [phase, setPhase] = useState<StreamPhase>('off')
  const [session, setSession] = useState<StreamResponse | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [ended, setEnded] = useState<EndedSession | null>(null)
  // The engine survives the route: whichever one was picked last is read back here, and
  // the guard below drops it if this deployment no longer offers a board on it.
  const [engineId, setEngineIdState] = useState<number | null>(readStreamEnginePick)
  const [multipv, setMultipvState] = useState(defaultMultipv)
  /** Bumped to make the open effect run again on the same inputs (a lost session). */
  const [reopen, setReopen] = useState(0)
  /** The newest accepted frame, tagged with the *board* position it was asked for. */
  const [frame, setFrame] = useState<{ fen: string; snapshot: StreamSnapshot } | null>(null)

  /** The live session id. A ref, because the socket listeners must not resubscribe. */
  const idRef = useRef<string | null>(null)
  /** Which run of the open effect owns `idRef` — StrictMode mounts it twice. */
  const generation = useRef(0)
  /** The *server's* spelling of the position the session is on; what frames are matched to. */
  const serverFen = useRef<string | null>(null)
  /** The *board's* fen the session was last asked to analyse. */
  const sentFen = useRef<string | null>(null)
  /** Bumped by every restart that moves the position; an older one's answer is stale. */
  const fenEpoch = useRef(0)
  const sentMultipv = useRef(multipv)
  const lastSeq = useRef(-1)

  // Read inside effects and async continuations, which must see the current value rather
  // than the one closed over when they started.
  const fenRef = useRef(fen)
  const multipvRef = useRef(multipv)
  const gameIdRef = useRef(gameId)
  const plyRef = useRef(ply)
  useEffect(() => {
    fenRef.current = fen
    multipvRef.current = multipv
    gameIdRef.current = gameId
    plyRef.current = ply
  })

  const hasFen = fen !== null && fen !== ''

  /** The user's toggle. Turning it off is also what clears everything it left behind. */
  const setEnabled = useCallback((on: boolean) => {
    setEnabledState(on)
    if (on) {
      setError(null)
      setNote(null)
      setEnded(null)
    } else {
      setPhase('off')
      setSession(null)
      setFrame(null)
      setError(null)
      setNote(null)
      setEnded(null)
    }
  }, [])

  const setEngineId = useCallback((id: number | null) => {
    // The engine is the one thing a session cannot be patched onto, so the open effect
    // tears down and reopens — which is what changing this dependency does.
    setEngineIdState(id)
    writeStreamEnginePick(id)
  }, [])

  // A remembered engine this deployment cannot open a board on — a runner that has not come
  // back, an engine switched off or deleted since — would open straight into the backend's
  // refusal, which flips the toggle off again. So it falls back to the deep tier, and only
  // while nothing is running: an engine lost *mid-search* is the offer's business, not this
  // one's. What is stored is left alone, so the machine coming back brings the pick with it.
  useEffect(() => {
    if (engineId === null || enabled) return
    // Before the roster has been read, every engine looks missing.
    if (status.data === undefined) return
    if (engines.some((host) => host.engineId === engineId && host.streams)) return
    setEngineIdState(null)
  }, [engineId, enabled, engines, status.data])

  const setMultipv = useCallback((lines: number) => {
    setMultipvState(Math.max(1, Math.min(5, Math.round(lines))))
  }, [])

  /**
   * One PATCH, with the two failures that mean something. `unknown_stream` is the session
   * having been reaped under us: it is dropped and reopened once, rather than left showing
   * lines from a search that no longer exists.
   *
   * A restart that *moves the position* also blanks `serverFen` for the length of the round
   * trip. Until the server answers, the session is still searching the position the board
   * has left — every frame arriving in that window carries the old spelling, and accepting
   * one would put the previous ply's eval and PV under the new board. On a remote runner
   * that window is a websocket hop plus the runner's ack, so it is several frames wide.
   */
  const applyPatch = useCallback((id: string, body: StreamUpdate) => {
    const moves = body.fen !== undefined
    if (moves) {
      serverFen.current = null
      fenEpoch.current += 1
    }
    const epoch = fenEpoch.current
    return restartStream(id, body)
      .then((updated) => {
        if (idRef.current !== id) return
        // A newer restart has already gone out: this answer describes a position the
        // session has left again, and taking its fen would reopen the window above.
        if (epoch !== fenEpoch.current) return
        serverFen.current = updated.fen
        setSession(updated)
      })
      .catch((failure: unknown) => {
        if (idRef.current !== id) return
        if (failure instanceof ApiError && failure.error === 'unknown_stream') {
          idRef.current = null
          serverFen.current = null
          setReopen((count) => count + 1)
          return
        }
        setError(asError(failure))
        // The panel draws an error on this phase alone. A refused *restart* is the one that
        // has to reach the reader: the search is stuck on a position the board has left, so
        // without it the board sits on skeleton rows with the backend's reason unsaid.
        if (moves && epoch === fenEpoch.current) setPhase('error')
      })
  }, [])

  // --- the session itself -------------------------------------------------
  //
  // Deps are everything a session cannot survive: the toggle, the engine, whether there is
  // a position at all, and the surface. A *position* change is deliberately absent — that
  // is a PATCH below.
  useEffect(() => {
    if (!enabled) return
    if (!hasFen) {
      // The live board with nothing on it. Nothing to analyse, nothing to tear down.
      setPhase('off')
      setSession(null)
      setFrame(null)
      return
    }

    const mine = ++generation.current
    let cancelled = false

    setPhase('opening')
    setFrame(null)
    setError(null)
    lastSeq.current = -1
    serverFen.current = null

    const requestedFen = fenRef.current as string
    const requestedMultipv = multipvRef.current
    sentFen.current = requestedFen
    sentMultipv.current = requestedMultipv

    void (async () => {
      try {
        const opened = await openStream({
          fen: requestedFen,
          engine_id: engineId,
          multipv: requestedMultipv,
          surface,
          game_id: gameIdRef.current ?? null,
          ply: plyRef.current ?? null,
        })
        if (cancelled || generation.current !== mine) {
          // A session opened by an effect that has already been torn down — StrictMode's
          // double mount, or the user flicking the toggle — is closed the moment it
          // exists rather than left for the reaper.
          void closeStream(opened.id).catch(() => {})
          return
        }
        idRef.current = opened.id
        serverFen.current = opened.fen
        setSession(opened)

        // What the user asked for while the POST was in flight. Neither change re-ran this
        // effect (a position and a line count are both patchable), so they are caught up
        // here rather than sitting silently un-applied.
        const patch: StreamUpdate = {}
        if (fenRef.current && fenRef.current !== sentFen.current) {
          sentFen.current = fenRef.current
          patch.fen = fenRef.current
        }
        if (multipvRef.current !== sentMultipv.current) {
          sentMultipv.current = multipvRef.current
          patch.multipv = multipvRef.current
        }
        if (patch.fen !== undefined || patch.multipv !== undefined) {
          void applyPatch(opened.id, patch)
        }
      } catch (failure) {
        if (cancelled || generation.current !== mine) return
        setPhase('error')
        // The backend's own sentence, verbatim. `stream_limit` names the cap this
        // deployment is configured with (`stream_max_sessions`, not always two) and
        // `stream_unavailable` names the engine and why — better than anything written here.
        setError(asError(failure))
        // The toggle goes back off: a refusal is an answer, not something to retry into.
        setEnabledState(false)
      }
    })()

    return () => {
      cancelled = true
      const id = idRef.current
      idRef.current = null
      serverFen.current = null
      if (id) void closeStream(id).catch(() => {})
    }
  }, [enabled, hasFen, engineId, surface, reopen, applyPatch])

  // --- position changes ---------------------------------------------------
  useEffect(() => {
    if (!enabled || fen === null || fen === '') return
    const id = idRef.current
    // Nothing open yet: the POST above carries whatever the board is showing when it fires.
    if (!id) return
    if (sentFen.current === fen) return

    const timer = setTimeout(() => {
      if (idRef.current !== id) return
      sentFen.current = fen
      lastSeq.current = -1
      void applyPatch(id, { fen })
    }, PATCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [fen, enabled, applyPatch, session])

  // --- line count ---------------------------------------------------------
  useEffect(() => {
    if (!enabled) return
    const id = idRef.current
    if (!id) return
    if (sentMultipv.current === multipv) return
    sentMultipv.current = multipv
    void applyPatch(id, { multipv })
  }, [multipv, enabled, applyPatch, session])

  // --- the socket ---------------------------------------------------------
  useEventListener('stream.snapshot', (event) => {
    const incoming = event as StreamSnapshotEvent
    if (incoming.session_id !== idRef.current) return
    // Lossy and reordered delivery: only a frame ahead of the last one is news.
    if (incoming.seq <= lastSeq.current) return
    // A frame for a position the session is not on. `serverFen` is the server's own
    // spelling, which is the only thing a frame's `fen` can be compared against — and it is
    // null exactly while a restart is in flight, when everything still arriving describes
    // the position the board has just left.
    if (serverFen.current === null || incoming.fen !== serverFen.current) return
    lastSeq.current = incoming.seq
    setFrame({ fen: sentFen.current ?? incoming.fen, snapshot: snapshotFrom(incoming) })
    setPhase('running')
  })

  useEventListener('stream.ended', (event) => {
    // No `surface` on this frame — the session id is the whole match.
    const finished = event as StreamEndedEvent
    if (finished.session_id !== idRef.current) return
    idRef.current = null
    serverFen.current = null
    setFrame(null)
    // The effect's cleanup finds `idRef` already null, so nothing tries to DELETE a
    // session the server has just told us is gone.
    setEnabledState(false)

    if (finished.reason === 'closed' || finished.reason === 'replaced') {
      setPhase('off')
      setNote(
        finished.reason === 'replaced'
          ? t`Another analysis board took this position over.`
          : null,
      )
      return
    }

    setPhase('ended')
    setError(finished.error ? new Error(finished.error) : null)
    // Only what the frame said. Which engines can take it over is worked out at render
    // time: `runner.disconnected` invalidates `['runners']` on a 200ms flush, so a roster
    // read here would still have the machine that just vanished in it.
    setEnded({
      reason: finished.reason,
      error: finished.error,
      engineId: finished.engine_id,
      runnerId: finished.runner_id,
    })
  })

  /**
   * The offer, against the roster as it stands now rather than as it stood the instant the
   * session died. A runner that went away takes every engine it advertises with it — the
   * siblings included, whatever `/runners/status` still says about them. Anything else
   * (`engine_failed`, `idle`) took nothing with it, so the engine that ended is offered
   * back: on a deployment with one engine it is the only way to resume at all.
   */
  const offer = useMemo<StreamOffer | null>(() => {
    if (ended === null) return null
    const gone = (host: EngineHost) =>
      ended.runnerId === null
        ? host.engineId === ended.engineId
        : host.runnerId === ended.runnerId
    return {
      reason: ended.reason,
      error: ended.error,
      candidates: engines.filter(
        (host) => host.streams && !(ended.reason === 'runner_gone' && gone(host)),
      ),
    }
  }, [ended, engines])

  // --- reconnects ---------------------------------------------------------
  //
  // Nothing is replayed on `/events`, so a session may have been reaped while the socket
  // was down. `GET /streams` is the only way to tell, and it is asked once per reconnect
  // rather than on a timer.
  const seenReconnects = useRef(reconnects)
  useEffect(() => {
    if (reconnects === seenReconnects.current) return
    seenReconnects.current = reconnects
    if (!enabled) return
    const id = idRef.current
    if (!id) return
    void listStreams()
      .then((open) => {
        if (idRef.current !== id) return
        if (open.some((entry) => entry.id === id)) return
        idRef.current = null
        serverFen.current = null
        setReopen((count) => count + 1)
      })
      .catch(() => {
        // The socket is back but the API is not answering yet; the next reconnect asks
        // again, and the panel is still showing the last frame it had.
      })
  }, [reconnects, enabled])

  const resume = useCallback(
    (id: number | null) => {
      setEnded(null)
      setError(null)
      setNote(null)
      // Taking the offer is a pick like any other; the next page opens on it.
      setEngineIdState(id)
      writeStreamEnginePick(id)
      setEnabledState(true)
      // Same engine as before: the toggle going off and on again is what re-runs the open
      // effect, so nothing else is needed.
    },
    [],
  )

  const dismissOffer = useCallback(() => {
    setEnded(null)
    setError(null)
    setPhase('off')
  }, [])

  return {
    enabled,
    setEnabled,
    phase,
    session,
    // Synchronous: a frame is only ever shown against the position it was asked for, so
    // scrubbing forward never leaves the previous ply's lines under the new board.
    snapshot: frame && frame.fen === fen ? frame.snapshot : null,
    error,
    note,
    offer,
    engines,
    engineId,
    setEngineId,
    multipv,
    setMultipv,
    resume,
    dismissOffer,
  }
}
