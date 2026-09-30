/**
 * The engines a host has advertised, listed the same way whether the host is this server
 * or a runner — what it is, what it runs, and whether it can drive a board.
 *
 * This is `RunnerCard`'s old `EngineRow`, moved out so the local host's detail can use the
 * same row without a `RunnerResponse` to hang it off. Roles are deliberately absent: a role
 * is a fact about the deployment's policy (which engine analyses, which predicts human moves),
 * not about a machine, and belongs to the role strip at the top of the page.
 *
 * Every line is readout: a status dot, the name, a borderless kind tint and, where it
 * applies, a borderless `queue only` warning. Nothing here is pressable, so nothing lifts
 * under the pointer.
 */
import { Trans, useLingui } from '@lingui/react/macro'

import { StatusDot } from '@/components/badges/StatusDot'
import { Badge } from '@/components/ui/badge'
import type { RunnerEngine } from '@/lib/api/types'

import { KindBadge } from './EngineBadges'

export function MachineEngineList({
  engines,
  streamable,
  connected,
}: {
  engines: RunnerEngine[]
  /** Whether this host's transport can open an analysis board at all. */
  streamable: boolean
  connected: boolean
}) {
  if (engines.length === 0) {
    return (
      <p className="text-label text-dim-2">
        <Trans>Nothing has been advertised.</Trans>
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-px">
      {engines.map((engine) => (
        <MachineEngineRow
          key={engine.id}
          engine={engine}
          streamable={streamable}
          connected={connected}
        />
      ))}
    </div>
  )
}

function MachineEngineRow({
  engine,
  streamable,
  connected,
}: {
  engine: RunnerEngine
  streamable: boolean
  connected: boolean
}) {
  // The same rule `HostBadge` follows: "queue only" is a machine that takes queue work and
  // refuses a board. One that is simply away takes no queue work either — its backlog is
  // counted against it precisely because nothing is draining it — and the status caption
  // beside the row's name has already said so.
  const queueOnly = connected && !(engine.streams && streamable)
  const { t } = useLingui()
  return (
    // No hover: the line is a fact about the machine, not something to press.
    <div className="flex items-center gap-2 px-1 py-1.5">
      <StatusDot tone={engine.enabled ? 'healthy' : 'away'} />
      {/* The name is what the row is read for, so the path gives way first: a `m…` beside
          forty characters of path was the row saying the least important thing. */}
      <span className="max-w-[60%] flex-none truncate text-data text-body">
        {engine.name}
      </span>
      <KindBadge kind={engine.kind} />
      {queueOnly ? (
        <Badge
          variant="warn"
          className="flex-none"
          title={
            engine.streams
              ? t`this link takes queue work but cannot open an analysis board`
              : t`answers with a policy rather than a search`
          }
        >
          <Trans>queue only</Trans>
        </Badge>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-right font-mono text-label text-faint">
        {engine.path}
      </span>
    </div>
  )
}
