import { t } from '@lingui/core/macro'

/** The server name a client configures — the design's `blunderbase-mcp` affordance. */
export const MCP_SERVER_NAME = 'blunderbase-mcp'

/** `4m ago`, the way the design writes "last call 4m ago". */
export function relative(timestamp: number | string | null | undefined, now = Date.now()): string {
  if (timestamp === null || timestamp === undefined) return '—'
  const value = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp)
  if (Number.isNaN(value)) return '—'
  const seconds = Math.max(0, Math.round((now - value) / 1000))
  if (seconds < 45) return t`just now`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return t`${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t`${hours}h ago`
  const days = Math.round(hours / 24)
  return t`${days}d ago`
}
