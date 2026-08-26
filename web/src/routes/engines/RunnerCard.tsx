import { Check, Loader2, Pencil, Trash2, X } from 'lucide-react'
import { useState } from 'react'

import { TierBadge } from '@/components/badges/TierBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useDeleteRunner, useUpdateRunner } from '@/lib/api/queries'
import type { RunnerEngine, RunnerResponse } from '@/lib/api/types'
import { relative } from '@/lib/mcp/status'
import { cn } from '@/lib/utils'

import { canStream, slotLabel, slotShares, statusLabel, type RunnerTone } from './runners'

const TONE: Record<RunnerTone, { dot: string; text: string }> = {
  connected: { dot: 'bg-accent-teal', text: 'text-accent-teal' },
  degraded: { dot: 'bg-mistake', text: 'text-mistake' },
  away: { dot: 'bg-faint', text: 'text-dim-2' },
}

/** One advertised engine: what it is, where it is, and whether it can drive a board. */
function EngineRow({
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
  // counted against it precisely because nothing is draining it — and the status pill above
  // has already said so.
  const queueOnly = connected && !(engine.streams && streamable)
  return (
    <div className="flex items-center gap-2 rounded-[0.3125rem] px-1 py-1.5 hover:bg-raised">
      <span
        className={cn(
          'size-[0.3125rem] flex-none rounded-full',
          engine.enabled ? 'bg-accent-teal' : 'bg-faint',
        )}
      />
      <span className="truncate text-[0.71875rem] text-body">{engine.name}</span>
      <span
        className={cn(
          'flex-none rounded-sm border px-1.5 py-px text-[0.59375rem]',
          engine.kind === 'maia'
            ? 'border-deep/28 bg-deep/10 text-deep'
            : 'border-edge bg-elevated text-soft',
        )}
      >
        {engine.kind}
      </span>
      {engine.default_tier ? <TierBadge tier={engine.default_tier} className="flex-none" /> : null}
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

/**
 * One registered machine: what its link is doing, what it has advertised, and the two
 * things the owner can do to it — rename, and revoke.
 */
export function RunnerCard({ runner }: { runner: RunnerResponse }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(runner.name)
  const [slots, setSlots] = useState(String(runner.slots))
  const [confirmRevoke, setConfirmRevoke] = useState(false)

  const update = useUpdateRunner({ onSuccess: () => setEditing(false) })
  const revoke = useDeleteRunner()

  function open() {
    setName(runner.name)
    setSlots(String(runner.slots))
    setEditing(true)
  }

  /**
   * Only what changed is sent — `RunnerUpdate` applies exactly the fields it is given, and
   * a cap lowered below what is in flight is honoured for the next dispatch rather than by
   * taking a search away.
   */
  function save() {
    const body: { name?: string; slots?: number } = {}
    if (name.trim() && name.trim() !== runner.name) body.name = name.trim()
    const count = Number.parseInt(slots, 10)
    if (Number.isFinite(count) && count >= 1 && count !== runner.slots) body.slots = count
    if (Object.keys(body).length === 0) {
      setEditing(false)
      return
    }
    update.mutate({ id: runner.id, body })
  }

  const status = statusLabel(runner)
  const tone = TONE[status.tone]
  const shares = slotShares(runner)
  const streamable = canStream(runner)

  return (
    <div className="flex flex-col rounded-xl border border-line bg-panel">
      <div className="flex items-center gap-2.5 border-b border-hairline px-3.5 py-3">
        {editing ? (
          <>
            <Input
              aria-label={`Name of ${runner.name}`}
              value={name}
              spellCheck={false}
              className="h-7 max-w-[11rem]"
              onChange={(event) => setName(event.target.value)}
            />
            <Input
              aria-label={`Slots on ${runner.name}`}
              value={slots}
              inputMode="numeric"
              className="h-7 max-w-[4rem] font-mono"
              onChange={(event) => setSlots(event.target.value)}
            />
            <Button type="button" size="sm" disabled={!name.trim() || update.isPending} onClick={save}>
              {update.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
              Save
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
              <X aria-hidden />
              Cancel
            </Button>
          </>
        ) : (
          <>
            <span className="text-xs font-semibold text-ink">{runner.name}</span>
            <button
              type="button"
              aria-label={`Edit ${runner.name}`}
              onClick={open}
              className="text-dim transition-colors hover:text-ink"
            >
              <Pencil className="size-3" aria-hidden />
            </button>
            <span className={cn('inline-flex items-center gap-1.5 text-[0.625rem]', tone.text)}>
              <span className={cn('size-[0.3125rem] rounded-full', tone.dot)} />
              {status.label}
            </span>
          </>
        )}
        <div className="flex-1" />
        {runner.version ? (
          <span className="font-mono text-[0.65625rem] text-dim">{runner.version}</span>
        ) : null}
        <span className="text-[0.65625rem] text-faint">
          last seen {relative(runner.last_seen_at)}
        </span>
      </div>

      {update.isError ? (
        <p className="px-3.5 pt-2.5 text-[0.6875rem] text-blunder">{update.error.message}</p>
      ) : null}

      <div className="flex flex-col gap-1.5 px-3.5 py-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[0.65625rem] tabular text-soft">{slotLabel(runner)}</span>
          <div className="h-[0.1875rem] flex-1 overflow-hidden rounded-sm bg-track">
            <div className="flex h-full">
              <div className="bg-accent-teal" style={{ width: `${shares.busy}%` }} />
              <div className="bg-deep" style={{ width: `${shares.streams}%` }} />
            </div>
          </div>
          <span className="text-[0.65625rem] text-dim-2">
            {runner.free_slots} free · {runner.queued_eligible} queued here
          </span>
        </div>
        <p className="text-[0.625rem] text-faint">
          {runner.busy} queue run{runner.busy === 1 ? '' : 's'} and {runner.streams} analysis board
          {runner.streams === 1 ? '' : 's'} are holding slots.
        </p>
      </div>

      <div className="flex flex-col gap-px border-t border-hairline px-3.5 py-3">
        <h4 className="mb-1 text-[0.625rem] tracking-[0.1em] text-faint uppercase">
          Advertised engines
        </h4>
        {runner.engines.length === 0 ? (
          <p className="text-[0.6875rem] text-dim-2">This runner has advertised no engines.</p>
        ) : (
          runner.engines.map((engine) => (
            <EngineRow
              key={engine.id}
              engine={engine}
              streamable={streamable}
              connected={runner.connected}
            />
          ))
        )}
      </div>

      <div className="flex flex-col gap-1.5 border-t border-hairline px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          {confirmRevoke ? (
            <>
              <span className="flex-1 text-[0.6875rem] leading-[1.6] text-blunder">
                Revoking closes the link, deletes the engines it advertised and hands its running
                work back to the queue with the attempt refunded. The token stops working; a new
                one means a new runner.
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmRevoke(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(runner.id)}
              >
                {revoke.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Revoke
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmRevoke(true)}
              >
                <Trash2 aria-hidden />
                Revoke
              </Button>
              <div className="flex-1" />
            </>
          )}
        </div>
        {/*
          Outside the branches: a refused DELETE leaves the card confirming, and a click that
          appears to have done nothing is the one that most needs a reason next to it.
        */}
        {revoke.isError ? (
          <p className="text-[0.6875rem] text-blunder">{revoke.error.message}</p>
        ) : null}
      </div>
    </div>
  )
}
