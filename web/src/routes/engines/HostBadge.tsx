import { Trans, useLingui } from '@lingui/react/macro'

import { StatusDot } from '@/components/badges/StatusDot'
import type { EngineHost } from '@/lib/engines/hosts'
import { cn } from '@/lib/utils'

/**
 * Where one engine's binary actually is: `local`, or the runner advertising it.
 *
 * The `queue only` chip is the transport speaking — a poll-mode link takes queue work and
 * refuses an analysis board, and a row that does not say so looks broken when the board's
 * toggle will not turn on.
 */
export function HostBadge({ host, className }: { host?: EngineHost; className?: string }) {
  const { t } = useLingui()
  if (!host) return null

  // Only the transport earns this chip. A Maia is already labelled by its kind, and a
  // runner that is simply away is said by the grey dot beside its name — neither is a
  // machine that takes queue work and refuses a board, which is what "queue only" means.
  const queueOnly = host.transport === 'poll' && host.kind === 'uci' && host.enabled
  const runnerName = host.runnerName

  return (
    <span className={cn('inline-flex flex-none items-center gap-1.5', className)}>
      {host.runnerId === null ? (
        <span className="rounded-sm border border-edge bg-elevated px-1.5 py-px font-mono text-[0.59375rem] text-dim">
          <Trans>local</Trans>
        </span>
      ) : (
        <span
          className="inline-flex items-center gap-1 rounded-sm border border-edge bg-elevated px-1.5 py-px text-[0.59375rem] text-soft"
          title={host.connected ? undefined : t`${runnerName} is not connected`}
        >
          <StatusDot tone={host.connected ? 'healthy' : 'away'} className="size-1" />
          {runnerName}
        </span>
      )}
      {queueOnly ? (
        <span
          className="rounded-sm border border-mistake/28 bg-mistake/8 px-1.5 py-px text-[0.59375rem] text-mistake"
          title={host.streamsReason ?? undefined}
        >
          <Trans>queue only</Trans>
        </span>
      ) : null}
    </span>
  )
}
