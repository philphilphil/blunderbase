/**
 * What runs what — and, now, where it is decided.
 *
 * This was a read-only panel that reported whatever the backend had resolved. Nobody could
 * tell from it why an engine was doing a job, because nothing on the page had assigned it
 * one: the tier was a *preference* the resolution was free to fall back away from. There is
 * no resolution left. Three roles, three engine ids the owner picks here, and nothing falls
 * back — so the panel that reported the answer is the form that writes it.
 *
 * One `<select>` per role, listing only the engines whose kind can serve it: a search engine
 * for Quick and Deep, a human-move model for Human moves. Asking a Maia for an evaluation
 * would answer a policy where a score was wanted, and asking Stockfish for a human move
 * would answer the best move rather than the likely one — the backend refuses both, and a
 * dropdown that offered them would be offering a refusal.
 *
 * The sentence under a broken picker is the backend's own (`services.engines.role_status`),
 * printed verbatim. It is the same sentence a run fails with, which is the point: an owner
 * who has read it here recognises it there, and rewording it would make the two look like
 * two different problems.
 *
 * Unassigned is drawn calmly — dashed and dim, not red. A deployment that has not chosen a
 * human-move model has one fewer column, not a fault. A role that *is* assigned and cannot
 * run is the red one, and it always names the engine that was chosen.
 */
import { Skeleton } from '@/components/ui/skeleton'
import { StatusDot } from '@/components/badges/StatusDot'
import { Label } from '@/components/ui/label'
import { useSetEngineRoles } from '@/lib/api/queries'
import {
  ENGINE_ROLES,
  type EngineResponse,
  type EngineRoleName,
  type EngineRolesResponse,
  type EngineRoleStatus,
} from '@/lib/api/types'
import type { EngineHost } from '@/lib/engines/hosts'
import { cn } from '@/lib/utils'

import { roleName } from './roles'

/** How a picker is doing: assigned and working, assigned and broken, or not assigned at all. */
type Tone = 'ok' | 'broken' | 'absent'

/** The kind of engine a role can be served by — `services.engines.ROLE_KINDS`. */
function kindFor(role: EngineRoleName): EngineResponse['kind'] {
  return role === 'human' ? 'maia' : 'uci'
}

/**
 * How one engine reads in the list. The host is always named, `local` included: two engines
 * of the same name on two machines is the ordinary case, and "which of these is the one on
 * my other machine" is the question this form exists to answer.
 */
function optionLabel(engine: EngineResponse, host: EngineHost | undefined): string {
  const where = host ? (host.runnerName ?? 'local') : null
  const name = where === null ? engine.name : `${engine.name} · ${where}`
  return engine.enabled ? name : `${name} (off)`
}

/**
 * One of three equal-width answers to the same question.
 *
 * The label sits above the native select instead of taking width from it: three cards must
 * remain readable in one line, including engine and host names. The reason wraps underneath;
 * the parent grid stretches every card to the same height, so one broken assignment cannot
 * turn the strip into three ragged rows.
 */
function RolePicker({
  status,
  engines,
  hosts,
  pending,
  error,
  onAssign,
}: {
  status: EngineRoleStatus
  /** Every engine of a kind this role can use, roster order. */
  engines: EngineResponse[]
  hosts: Map<number, EngineHost>
  pending: boolean
  /** Why the last save of *this* picker was refused; the form owns its own errors. */
  error: Error | null
  onAssign: (engineId: number | null) => void
}) {
  const tone: Tone = status.available ? 'ok' : status.configured ? 'broken' : 'absent'
  const id = `engine-role-${status.role}`
  const assigned = status.engine_id ?? null
  // An engine that is assigned but cannot serve the role — switched off, on a runner that
  // is away, or deleted out from under the setting — is not in the list above. It is still
  // what is stored, and a select showing something else would be lying about that.
  const missing = assigned !== null && !engines.some((engine) => engine.id === assigned)

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-1.5 rounded-lg border px-3 py-2.5',
        tone === 'ok' ? 'border-line bg-panel' : '',
        tone === 'broken' ? 'border-mistake/28 bg-mistake/5' : '',
        tone === 'absent' ? 'border-dashed border-edge-strong bg-panel/60' : '',
      )}
    >
      <div className="flex items-center gap-2">
        <StatusDot
          tone={tone === 'ok' ? 'healthy' : tone === 'broken' ? 'degraded' : 'away'}
          label={tone === 'ok' ? 'available' : tone === 'broken' ? 'unavailable' : 'not set up'}
        />
        <Label htmlFor={id}>{roleName(status.role)}</Label>
      </div>
      <select
        id={id}
        value={assigned === null ? '' : String(assigned)}
        disabled={pending}
        onChange={(event) => onAssign(event.target.value === '' ? null : Number(event.target.value))}
        className="h-8 w-full min-w-0 rounded-md border border-input bg-elevated px-2 text-xs text-ink outline-none transition-colors hover:border-edge-hover focus-visible:border-accent-teal/50 disabled:opacity-50"
      >
        <option value="">Nothing assigned</option>
        {missing ? (
          <option value={String(assigned)}>{status.engine_name ?? `engine ${assigned}`}</option>
        ) : null}
        {engines.map((engine) => (
          <option key={engine.id} value={String(engine.id)}>
            {optionLabel(engine, hosts.get(engine.id))}
          </option>
        ))}
      </select>
      {error ? (
        <p className="text-[0.6875rem] leading-[1.5] text-blunder">{error.message}</p>
      ) : status.available ? null : status.reason ? (
        <p
          className={cn(
            'text-[0.6875rem] leading-[1.5]',
            tone === 'broken' ? 'text-mistake' : 'text-dim',
          )}
        >
          {status.reason}
        </p>
      ) : null}
    </div>
  )
}

export function RolesForm({
  roles,
  engines,
  hosts,
  isLoading,
  error,
}: {
  roles: EngineRolesResponse | undefined
  /** The whole roster; each row takes the engines of the kind it can use. */
  engines: EngineResponse[]
  /** Where each engine lives, joined from `/runners/status` on engine id. */
  hosts: Map<number, EngineHost>
  isLoading: boolean
  error: Error | null
}) {
  // One role is written per change, so the picker that failed is the one that was changed —
  // which is where the refusal has to be read, beside the select that caused it.
  const assign = useSetEngineRoles()
  const changed = assign.variables ? (Object.keys(assign.variables)[0] as EngineRoleName) : null

  if (isLoading) {
    return (
      <div className="grid grid-cols-3 gap-2.5 max-md:grid-cols-1" data-testid="roles-loading">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <p className="rounded-lg border border-blunder/28 bg-blunder/5 px-3 py-2.5 text-[0.71875rem] text-blunder">
        What runs what could not be read — {error.message}
      </p>
    )
  }

  if (!roles) return null

  const byRole = new Map(roles.roles.map((status) => [status.role, status]))

  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="text-[0.625rem] tracking-[0.1em] text-faint uppercase">What runs what</h2>
      <p className="text-[0.6875rem] leading-[1.5] text-dim">
        Each job runs on the engine chosen for it and on no other — nothing falls back, so a
        role left empty simply does not run.
      </p>
      {/* One picker per row below `md`: a third of 375px cannot hold "Stockfish · nuc". */}
      <div className="mt-1 grid grid-cols-3 gap-2.5 max-md:grid-cols-1">
        {ENGINE_ROLES.map((role) => {
          const status = byRole.get(role)
          if (!status) return null
          return (
            <RolePicker
              key={role}
              status={status}
              engines={engines.filter((engine) => engine.kind === kindFor(role))}
              hosts={hosts}
              pending={assign.isPending && changed === role}
              error={changed === role ? assign.error : null}
              onAssign={(engineId) => assign.mutate({ [role]: engineId })}
            />
          )
        })}
      </div>
    </section>
  )
}
