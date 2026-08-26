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
