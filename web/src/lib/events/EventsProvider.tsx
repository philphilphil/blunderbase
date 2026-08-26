import { useQueryClient } from '@tanstack/react-query'
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
// Import and analysis events arrive in bursts (one per game, one per ply). Invalidations
// are collected over this window and applied once, so a burst is one refetch.
const FLUSH_MS = 200

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
    let everConnected = false

    const flush = () => {
      flushTimer.current = null
      const keys = dedupeKeys(pending.current)
      pending.current = []
      for (const key of keys) void queryClient.invalidateQueries({ queryKey: key })
    }

    const scheduleFlush = () => {
      if (flushTimer.current !== null) return
      flushTimer.current = setTimeout(flush, FLUSH_MS)
    }

    const dispatch = (event: AnyEvent) => {
      for (const listener of listeners.current.get('*') ?? []) listener(event)
      for (const listener of listeners.current.get(event.event as EventName) ?? []) {
        listener(event)
      }
    }

    const connect = () => {
      if (closed) return
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
      next.onclose = () => {
        if (socket === next) socket = null
        setStatus('closed')
        retry()
      }
    }

    const retry = () => {
      if (closed || retryTimer !== null) return
      const backoff = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** attempt)
      attempt += 1
      // Jitter so a backend restart does not get every tab back at the same millisecond.
      const delay = backoff / 2 + Math.random() * (backoff / 2)
      retryTimer = setTimeout(() => {
        retryTimer = null
        connect()
      }, delay)
    }

    connect()

    return () => {
      closed = true
      if (retryTimer !== null) clearTimeout(retryTimer)
      if (flushTimer.current !== null) {
        clearTimeout(flushTimer.current)
        flushTimer.current = null
      }
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
