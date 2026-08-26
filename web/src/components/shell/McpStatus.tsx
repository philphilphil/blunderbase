import { useLiveState } from '@/lib/api/queries'
import { useMcpStatus } from '@/lib/mcp/status'
import { cn } from '@/lib/utils'

const DOT: Record<string, string> = {
  running: 'bg-good',
  connecting: 'bg-mistake',
  unreachable: 'bg-blunder',
}

/** The compact titlebar affordance: a dot, `blunderbase-mcp`, and what it last did. */
export function McpIndicator({ className }: { className?: string }) {
  const status = useMcpStatus()
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border border-edge bg-elevated px-2.5 py-[0.3125rem]',
        className,
      )}
      title={`${status.label} · ${status.detail}`}
    >
      <span className={cn('size-[0.3125rem] rounded-full', DOT[status.state])} />
      <span className="font-mono text-[0.6875rem] text-soft">{status.server}</span>
    </div>
  )
}

/**
 * The fuller panel from the game view's notes column: "MCP server running", the client
 * arrow and the tool chips.
 */
export function McpPanel({ className }: { className?: string }) {
  const status = useMcpStatus()
  const { data: live } = useLiveState()

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-2.5',
        className,
      )}
    >
      <div className="flex items-center gap-[0.4375rem]">
        <span className={cn('size-[0.3125rem] rounded-full', DOT[status.state])} />
        <span className="text-[0.71875rem] font-medium text-body-3">{status.label}</span>
        <div className="flex-1" />
        <span className="font-mono text-[0.625rem] text-dim tabular">
          {live?.viewer_count ?? 0} viewer{(live?.viewer_count ?? 0) === 1 ? '' : 's'}
        </span>
      </div>
      <div className="text-[0.6875rem] leading-[1.5] text-dim-3">
        Notes are written by your own assistant. Blunderbase just keeps them next to the move.
      </div>
      <div className="flex items-center gap-[0.4375rem] font-mono text-[0.65625rem] text-dim">
        <span className="text-soft">your assistant</span>
        <span className="text-faint-2">→</span>
        <span>{status.server}</span>
        <div className="flex-1" />
        <span>{status.detail}</span>
      </div>
    </div>
  )
}
