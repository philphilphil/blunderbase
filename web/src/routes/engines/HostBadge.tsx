import { Trans, useLingui } from '@lingui/react/macro'

import { StatusDot } from '@/components/badges/StatusDot'
import { Badge, Readout } from '@/components/ui/badge'
import type { EngineHost } from '@/lib/engines/hosts'
import { cn } from '@/lib/utils'

/**
 * Where one engine's binary actually is: `local`, or the runner advertising it.
 *
 * The `queue only` chip is the transport speaking — a poll-mode link takes queue work and
 * refuses an analysis board, and a row that does not say so looks broken when the board's
 * toggle will not turn on.
 *
 * All of it is readout, so none of it wears a border (a border is a control's edge): the
 * host is flat text (a runner with its status dot, green while connected), and `queue only`
 * a borderless warning tint.
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
        <Readout num>
          <Trans>local</Trans>
        </Readout>
      ) : (
        <span
          className="inline-flex items-center gap-1.5 text-meta text-soft"
          title={host.connected ? undefined : t`${runnerName} is not connected`}
        >
          <StatusDot tone={host.connected ? 'healthy' : 'away'} />
          {runnerName}
        </span>
      )}
      {queueOnly ? (
        <Badge variant="warn" title={host.streamsReason ?? undefined}>
          <Trans>queue only</Trans>
        </Badge>
      ) : null}
    </span>
  )
}
