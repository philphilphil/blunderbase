/**
 * The engines a host has advertised, listed the same way whether the host is this server
 * or a runner — what it is, what it runs, and whether it can drive a board.
 *
 * This is `RunnerCard`'s old `EngineRow`, moved out so the local host's detail can use the
 * same row without a `RunnerResponse` to hang it off. Roles are deliberately absent: a role
 * is a fact about the deployment's policy (which engine serves quick, which serves deep),
 * not about a machine, and belongs to the role strip at the top of the page.
 */
import { StatusDot } from '@/components/badges/StatusDot'
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
    return <p className="text-[0.6875rem] text-dim-2">Nothing has been advertised.</p>
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
  return (
    <div className="flex items-center gap-2 rounded-[0.3125rem] px-1 py-1.5 hover:bg-raised">
      <StatusDot tone={engine.enabled ? 'healthy' : 'away'} />
      <span className="truncate text-[0.71875rem] text-body">{engine.name}</span>
      <KindBadge kind={engine.kind} />
      {queueOnly ? (
        <span
          className="flex-none rounded-sm border border-mistake/28 bg-mistake/8 px-1.5 py-px text-[0.59375rem] text-mistake"
          title={
            engine.streams
              ? 'this link takes queue work but cannot open an analysis board'
              : 'answers with a policy rather than a search'
          }
        >
          queue only
        </span>
      ) : null}
      <div className="flex-1" />
      <span className="min-w-0 truncate font-mono text-[0.65625rem] text-faint">{engine.path}</span>
    </div>
  )
}
