/**
 * Design 2a, the MCP panel.
 *
 * The design counts tool calls per tool. Nothing in `backend/api` observes the MCP server
 * — it is a second process over stdio — so what this can honestly show is the state
 * `useMcpStatus` derives and the writes that reached this browser over `/events` since it
 * was opened: a note written, a note edited, the coach's board moved.
 */
import { useCallback, useState } from 'react'

import { useEventListener } from '@/lib/events/EventsProvider'
import { MCP_SERVER_NAME, relative, useMcpStatus } from '@/lib/mcp/status'
import { cn } from '@/lib/utils'

/** What a client puts in its MCP config to talk to this database. */
const CLIENT_CONFIG = JSON.stringify(
  {
    mcpServers: {
      blunderbase: { command: 'uv', args: ['run', 'blunderbase', 'mcp'] },
    },
  },
  null,
  2,
)

const ACTIVITY = [
  { key: 'note.created', label: 'write_note' },
  { key: 'note.updated', label: 'edit_note' },
  { key: 'live.updated', label: 'show_position' },
] as const

const STATE_CHIP = {
  running: 'text-good',
  connecting: 'text-mistake',
  unreachable: 'text-blunder',
} as const

const STATE_DOT = {
  running: 'bg-good',
  connecting: 'bg-mistake',
  unreachable: 'bg-blunder',
} as const

export function McpCard() {
  const status = useMcpStatus()
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [copied, setCopied] = useState(false)

  const bump = useCallback((key: string) => {
    setCounts((current) => ({ ...current, [key]: (current[key] ?? 0) + 1 }))
  }, [])

  useEventListener('note.created', () => bump('note.created'))
  useEventListener('note.updated', () => bump('note.updated'))
  useEventListener('live.updated', () => bump('live.updated'))

  const peak = Math.max(1, ...ACTIVITY.map((row) => counts[row.key] ?? 0))
  const total = ACTIVITY.reduce((sum, row) => sum + (counts[row.key] ?? 0), 0)

  async function copy() {
    try {
      await navigator.clipboard.writeText(CLIENT_CONFIG)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className="flex flex-none flex-col gap-2.5 rounded-xl border border-line bg-panel p-[0.8125rem]">
      <header className="flex items-center gap-2">
        <h2 className="text-xs font-semibold text-ink">MCP</h2>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-sm border border-edge px-1.5 py-px text-[0.625rem]',
            STATE_CHIP[status.state],
          )}
          title={status.label}
        >
          <span className={cn('size-[0.3125rem] rounded-full', STATE_DOT[status.state])} />
          {status.state}
        </span>
        <div className="flex-1" />
        <span className="font-mono text-[0.625rem] text-dim">
          {total === 0 ? 'no writes yet' : `${total} write${total === 1 ? '' : 's'}`}
        </span>
      </header>

      <div className="flex items-center gap-[0.4375rem] font-mono text-[0.65625rem] text-dim">
        <span className="text-soft">uv run blunderbase mcp</span>
        <span className="text-faint-2">→</span>
        <span>{MCP_SERVER_NAME}</span>
      </div>

      <div className="flex flex-col gap-1.5 font-mono text-[0.65625rem]">
        {ACTIVITY.map((row) => {
          const count = counts[row.key] ?? 0
          return (
            <div key={row.key} className="flex items-center gap-2">
              <span className={cn('flex-1', count > 0 ? 'text-info' : 'text-faint')}>
                {row.label}
              </span>
              <div className="h-[0.1875rem] w-14 overflow-hidden rounded-sm bg-track">
                <div
                  className="h-full bg-meter transition-[width] duration-500"
                  style={{ width: `${(count / peak) * 100}%` }}
                />
              </div>
              <span className="w-5 text-right tabular text-soft">{count}</span>
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-2 border-t border-hairline pt-2.5">
        <span className="flex-1 text-[0.6875rem] text-dim-2">
          {status.lastWriteAt === null
            ? 'nothing written from a chat yet'
            : `last coach write ${relative(status.lastWriteAt)}`}
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          className="text-[0.6875rem] text-accent-teal hover:text-accent-link"
        >
          {copied ? 'copied' : 'copy config'}
        </button>
      </div>
    </section>
  )
}
