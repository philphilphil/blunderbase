import { useMemo, useState } from 'react'

import { useHealth } from '@/lib/api/queries'
import { useEventListener, useEvents } from '@/lib/events/EventsProvider'

export type McpState = 'running' | 'unreachable' | 'connecting'

export interface McpStatus {
  state: McpState
  /** The server name a client configures — the design's `blunderbase-mcp` affordance. */
  server: string
  /** `Date.now()` of the last write that came in over MCP (a note, a live-board move). */
  lastWriteAt: number | null
  /** Browsers currently watching the coach-driven board, per `/live`. */
  label: string
  detail: string
}

export const MCP_SERVER_NAME = 'blunderbase-mcp'

/**
 * What the chrome can honestly say about the MCP server.
 *
 * The HTTP API does not report on it: the MCP server is a second process
 * (`blunderbase mcp`) over stdio or its own bearer-guarded transport, and nothing in
 * `backend/api` observes it. So this derives what it can — the backend the coach and the
 * UI share is up, and MCP-written events (`note.*`, `live.updated`) have or have not been
 * arriving. When a status endpoint lands, only this hook changes.
 */
export function useMcpStatus(): McpStatus {
  const health = useHealth()
  const { status: socket } = useEvents()
  const [lastWriteAt, setLastWriteAt] = useState<number | null>(null)

  useEventListener('note.created', () => setLastWriteAt(Date.now()))
  useEventListener('note.updated', () => setLastWriteAt(Date.now()))
  useEventListener('live.updated', () => setLastWriteAt(Date.now()))

  return useMemo(() => {
    const state: McpState = health.isError
      ? 'unreachable'
      : health.isSuccess && socket === 'open'
        ? 'running'
        : 'connecting'
    return {
      state,
      server: MCP_SERVER_NAME,
      lastWriteAt,
      label:
        state === 'running'
          ? 'MCP server running'
          : state === 'unreachable'
            ? 'Backend unreachable'
            : 'Connecting…',
      detail:
        lastWriteAt === null
          ? 'no coach writes yet this session'
          : `last coach write ${relative(lastWriteAt)}`,
    }
  }, [health.isError, health.isSuccess, socket, lastWriteAt])
}

/** `4m ago`, the way the design writes "last call 4m ago". */
export function relative(timestamp: number | string | null | undefined, now = Date.now()): string {
  if (timestamp === null || timestamp === undefined) return '—'
  const value = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp)
  if (Number.isNaN(value)) return '—'
  const seconds = Math.max(0, Math.round((now - value) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}
