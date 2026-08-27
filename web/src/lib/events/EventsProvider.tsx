import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { eventsUrl } from '@/lib/api/client'
import { queryKeys } from '@/lib/api/keys'
import type { LiveState } from '@/lib/api/types'
import { onSessionRestored, reportSessionLost } from '@/lib/auth/session'

import { dedupeKeys, invalidationsFor } from './invalidation'
import { parseEvent, type AnyEvent, type EventName } from './types'

export type ConnectionStatus = 'connecting' | 'open' | 'closed'

/** Anything a listener can ask for: one event name, or every frame. */
export type Topic = EventName | '*'

export type EventListener = (event: AnyEvent) => void

export interface EventsContextValue {
  status: ConnectionStatus
  /** How many times the socket has come back after dropping. */
  reconnects: number
  /** Listen to one event name, or to `'*'` for all of them. Returns the unsubscribe. */
  subscribe: (topic: Topic, listener: EventListener) => () => void
}

const EventsContext = createContext<EventsContextValue | null>(null)

// Reconnect backoff: quick enough that a backend restart is invisible, capped so a
// backend that is simply not running does not spin.
const RETRY_MIN_MS = 500
const RETRY_MAX_MS = 8_000
// `backend/api/auth.py: WS_CLOSE_UNAUTHORIZED`. The socket is accepted and then closed with
// this code when there is no session, so it means "signed out", not "the server went away"
// — and the one thing not to do about it is reconnect.
const WS_UNAUTHORIZED = 4401
// Import and analysis events arrive in bursts (one per game, one per ply). Invalidations
// are collected over this window and applied once, so a burst is one refetch.
const FLUSH_MS = 200

/**
 * How long an expensive read gets to itself after being refetched, by query root.
 *
 * 200ms is the right window for a cheap key, and much too short for these: `['games']`
 * sends every loaded page of the infinite `/games?cards=true` query *and* every saved-filter
 * badge count back out at once, and `['analysis']` is the queued/running/done lifecycle of a
 * batch of sixty analyses, which produces bursts for minutes.
 *
 * A key inside its cooldown is not dropped — it is held and flushed on the trailing edge, so
 * the state after the last event of a burst is always the one that ends up on screen.
 *
 * Only the whole-prefix key waits. `['games', 'detail', 7]` is one row, a note landing on it
 * is rare, and it should stay instant. `imports()` is spelled `['import']`, hence the key.
 * `queue()` is the one deliberate exception to "whole-prefix key only": it is not a root, but
 * `analysis.progress` fires once per analysed ply — many times a second during a batch — so it
 * gets its own entry rather than joining `['analysis']`, which would need to cool every key
 * under it (`runs()`, `run()`, …) to avoid dragging a single game's own analysis along.
 */
const COOLDOWN_MS: Record<string, number> = {
  games: 3_000,
  stats: 3_000,
  explorer: 3_000,
  import: 3_000,
  analysis: 1_000,
}

/** Cooldowns for specific keys that are not a whole-prefix root — see `queue()` above. */
const EXACT_COOLDOWN_MS = new Map<string, number>([[JSON.stringify(queryKeys.queue()), 1_000]])

function cooldownFor(key: QueryKey): number {
  const exact = EXACT_COOLDOWN_MS.get(JSON.stringify(key))
  if (exact !== undefined) return exact
  if (key.length !== 1) return 0
  return COOLDOWN_MS[String(key[0])] ?? 0
}

export function EventsProvider({
  children,
  url,
}: {
  children: ReactNode
  /** Overridable so tests and stories can point at a fake socket. */
  url?: string
}) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [reconnects, setReconnects] = useState(0)

  const listeners = useRef(new Map<Topic, Set<EventListener>>())
  const pending = useRef<ReturnType<typeof invalidationsFor>>([])
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Keys a cooldown held back, by serialized key, so a hundred more events for one of them
  // still only ever amount to a single entry — and a single refetch when the cooldown ends.
  const deferred = useRef(new Map<string, QueryKey>())
  const lastFlushed = useRef(new Map<string, number>())
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const subscribe = useCallback((topic: Topic, listener: EventListener) => {
    const map = listeners.current
    let set = map.get(topic)
    if (!set) {
      set = new Set()
      map.set(topic, set)
    }
    set.add(listener)
    return () => {
      set.delete(listener)
      if (set.size === 0) map.delete(topic)
    }
  }, [])

  useEffect(() => {
    const target = url ?? eventsUrl()
    let socket: WebSocket | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0
    let closed = false
    let denied = false
    let everConnected = false

    const clearTimers = () => {
      if (flushTimer.current !== null) clearTimeout(flushTimer.current)
      if (cooldownTimer.current !== null) clearTimeout(cooldownTimer.current)
      flushTimer.current = null
      cooldownTimer.current = null
    }

    /** Nothing is worth refetching for a provider that is going away. */
    const stopFlushing = () => {
      clearTimers()
      pending.current = []
      deferred.current.clear()
    }

    const flush = () => {
      clearTimers()
      // What a cooldown held back is flushed with whatever has arrived since, so the two
      // cannot turn into two refetches of the same key.
      const keys = dedupeKeys([...pending.current, ...deferred.current.values()])
      pending.current = []
      deferred.current.clear()
      const now = Date.now()
      for (const key of keys) {
        const serialized = JSON.stringify(key)
        const cooldown = cooldownFor(key)
        if (cooldown > 0) {
          const last = lastFlushed.current.get(serialized)
          if (last !== undefined && now - last < cooldown) {
            deferred.current.set(serialized, key)
            continue
          }
          lastFlushed.current.set(serialized, now)
        }
        void queryClient.invalidateQueries({ queryKey: key })
      }
      scheduleDeferred()
    }

    const scheduleFlush = () => {
      if (flushTimer.current !== null) return
      flushTimer.current = setTimeout(flush, FLUSH_MS)
    }

    /** The trailing edge: one timer, set for the first held key to come off cooldown. */
    const scheduleDeferred = () => {
      if (cooldownTimer.current !== null || deferred.current.size === 0) return
      const now = Date.now()
      let wait = Infinity
      for (const [serialized, key] of deferred.current) {
        const last = lastFlushed.current.get(serialized) ?? now
        wait = Math.min(wait, Math.max(0, cooldownFor(key) - (now - last)))
      }
      cooldownTimer.current = setTimeout(flush, wait)
    }

    const dispatch = (event: AnyEvent) => {
      for (const listener of listeners.current.get('*') ?? []) listener(event)
      for (const listener of listeners.current.get(event.event as EventName) ?? []) {
        listener(event)
      }
    }

    const connect = () => {
      if (closed || denied) return
      setStatus('connecting')
      let next: WebSocket
      try {
        next = new WebSocket(target)
      } catch {
        retry()
        return
      }
      socket = next

      next.onopen = () => {
        attempt = 0
        setStatus('open')
        if (everConnected) {
          // Nothing is replayed, so whatever happened while we were gone is unknown.
          setReconnects((count) => count + 1)
          void queryClient.invalidateQueries()
        } else {
          // The *first* connect can still be a recovery: opening the app before the
          // backend is up leaves every query settled in an error state, and nothing else
          // retries it (`refetchOnWindowFocus` is off and the retries are exhausted). The
          // socket coming up is the signal that the API is answering again, so the
          // queries that failed are the ones sent back out.
          void queryClient.invalidateQueries({
            predicate: (query) => query.state.status === 'error',
          })
        }
        everConnected = true
      }

      next.onmessage = (message: MessageEvent<string>) => {
        const event = parseEvent(typeof message.data === 'string' ? message.data : '')
        if (!event) return

        if (event.event === 'live.updated') {
          const { event: _name, ...state } = event as { event: string } & LiveState
          queryClient.setQueryData(queryKeys.live(), state as LiveState)
        }

        const keys = invalidationsFor(event)
        if (keys.length > 0) {
          pending.current.push(...keys)
          scheduleFlush()
        }
        dispatch(event)
      }

      next.onerror = () => next.close()
      next.onclose = (event: CloseEvent | undefined) => {
        if (socket === next) socket = null
        setStatus('closed')
        // Signed out. Retrying would be a request per backoff step for an answer that will
        // not change until someone types a password, so the loop stops here and the page is
        // told — `AuthProvider` puts the login screen up, and `onSessionRestored` below is
        // what starts the socket again.
        if (event?.code === WS_UNAUTHORIZED) {
          denied = true
          reportSessionLost(event.reason === 'setup_required' ? 'setup_required' : 'unauthorized')
          return
        }
        retry()
      }
    }

    const retry = () => {
      if (closed || denied || retryTimer !== null) return
      const backoff = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** attempt)
      attempt += 1
      // Jitter so a backend restart does not get every tab back at the same millisecond.
      const delay = backoff / 2 + Math.random() * (backoff / 2)
      retryTimer = setTimeout(() => {
        retryTimer = null
        connect()
      }, delay)
    }

    // Signing in is the only thing that makes the socket worth trying again after a 4401.
    const stopWaitingForSession = onSessionRestored(() => {
      if (closed || !denied) return
      denied = false
      connect()
    })

    connect()

    return () => {
      closed = true
      stopWaitingForSession()
      if (retryTimer !== null) clearTimeout(retryTimer)
      stopFlushing()
      if (socket) {
        socket.onopen = null
        socket.onmessage = null
        socket.onerror = null
        socket.onclose = null
        socket.close()
      }
    }
  }, [queryClient, url])

  // Only connection state lives here. Anything per-frame would re-render every subscriber
  // once per event, and a first sync emits one frame per game.
  const value = useMemo<EventsContextValue>(
    () => ({ status, reconnects, subscribe }),
    [status, reconnects, subscribe],
  )

  return <EventsContext.Provider value={value}>{children}</EventsContext.Provider>
}

export function useEvents(): EventsContextValue {
  const value = useContext(EventsContext)
  if (!value) throw new Error('useEvents must be used inside <EventsProvider>')
  return value
}

/**
 * Run `handler` for every frame of one event name (or `'*'`). The handler is kept in a
 * ref, so a caller may pass an inline closure without resubscribing on every render.
 */
export function useEventListener(topic: Topic, handler: EventListener): void {
  const { subscribe } = useEvents()
  const ref = useRef(handler)
  useEffect(() => {
    ref.current = handler
  })
  useEffect(() => subscribe(topic, (event) => ref.current(event)), [subscribe, topic])
}

/** The live-session feed: every `live.updated` payload, already shaped as `LiveState`. */
export function useLiveUpdates(handler: (state: LiveState) => void): void {
  useEventListener('live.updated', (event) => {
    const { event: _name, ...state } = event as { event: string } & LiveState
    handler(state as LiveState)
  })
}
