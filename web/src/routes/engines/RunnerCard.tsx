import { Plural, Trans, useLingui } from '@lingui/react/macro'
import { Check, Loader2, Pencil, Trash2, X } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useDeleteRunner, useUpdateRunner } from '@/lib/api/queries'
import type { RunnerResponse } from '@/lib/api/types'
import { relative } from '@/lib/mcp/status'

import { MachineEngineList } from './MachineEngineList'
import { MachineRow, type MachineTone } from './MachineRow'
import { canStream, slotShares, statusLabel } from './runners'

const TONE: Record<'connected' | 'degraded' | 'away', MachineTone> = {
  connected: 'connected',
  degraded: 'degraded',
  away: 'away',
}

/**
 * A remote runner stays collapsed to connection and slot health so several hosts remain
 * scannable; expanding it reveals its advertised engines plus rename and revoke controls.
 *
 * Renaming and revoking used to sit in the card's own header and footer; both move into
 * the detail now that the collapsed row has four columns to hold instead of a header's
 * worth of space. Revoke keeps its inline, two-click confirmation rather than a dialog —
 * this codebase confirms in place everywhere else (`EngineInventory`, `BrowserRunnerSection`).
 */
export function RunnerCard({
  runner,
  expanded,
  onToggleExpand,
  layout,
}: {
  runner: RunnerResponse
  expanded: boolean
  onToggleExpand: () => void
  /** The one-page screen presents capacity as cards without changing runner mutations. */
  layout?: 'row' | 'card'
}) {
  const { t } = useLingui()
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
  const shares = slotShares(runner)
  const streamable = canStream(runner)
  const runnerName = runner.name
  const free = runner.free_slots
  const queued = runner.queued_eligible
  const busy = runner.busy
  const streams = runner.streams
  const seen = relative(runner.last_seen_at)

  return (
    <MachineRow
      tone={TONE[status.tone]}
      name={runner.name}
      caption={status.label}
      type={t`Remote runner`}
      slots={`${runner.busy + runner.streams}/${runner.slots}`}
      engines={String(runner.engines.length)}
      expanded={expanded}
      onToggleExpand={onToggleExpand}
      ariaLabel={expanded ? t`Collapse ${runnerName}` : t`Expand ${runnerName}`}
      layout={layout}
      detail={
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 max-md:flex-wrap">
            {editing ? (
              <>
                <Input
                  aria-label={t`Name of ${runnerName}`}
                  value={name}
                  spellCheck={false}
                  className="h-7 max-w-[11rem]"
                  onChange={(event) => setName(event.target.value)}
                />
                <Input
                  aria-label={t`Slots on ${runnerName}`}
                  value={slots}
                  inputMode="numeric"
                  className="h-7 max-w-[4rem] font-mono"
                  onChange={(event) => setSlots(event.target.value)}
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={!name.trim() || update.isPending}
                  onClick={save}
                >
                  {update.isPending ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Check aria-hidden />
                  )}
                  <Trans>Save</Trans>
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
                  <X aria-hidden />
                  <Trans>Cancel</Trans>
                </Button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  aria-label={t`Edit ${runnerName}`}
                  onClick={open}
                  className="inline-flex items-center gap-1.5 text-[0.6875rem] text-dim transition-colors hover:text-ink"
                >
                  <Pencil className="size-3" aria-hidden />
                  <Trans>Rename or resize</Trans>
                </button>
                <div className="flex-1" />
                {runner.version ? (
                  <span className="font-mono text-[0.65625rem] text-dim">{runner.version}</span>
                ) : null}
                <span className="text-[0.65625rem] text-faint">
                  <Trans>last seen {seen}</Trans>
                </span>
              </>
            )}
          </div>

          {update.isError ? (
            <p className="text-[0.6875rem] text-blunder">{update.error.message}</p>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <div className="h-[0.1875rem] flex-1 overflow-hidden rounded-sm bg-track">
                <div className="flex h-full">
                  <div className="bg-accent-teal" style={{ width: `${shares.busy}%` }} />
                  <div className="bg-deep" style={{ width: `${shares.streams}%` }} />
                </div>
              </div>
              <span className="text-[0.65625rem] text-dim-2">
                <Trans>
                  {free} free · {queued} queued here
                </Trans>
              </span>
            </div>
            <p className="text-[0.625rem] text-faint">
              <Trans>
                <Plural value={busy} one="# queue run" other="# queue runs" /> and{' '}
                <Plural value={streams} one="# analysis board" other="# analysis boards" /> are
                holding slots.
              </Trans>
            </p>
          </div>

          <div className="flex flex-col gap-px border-t border-hairline pt-2.5">
            <h4 className="mb-1 text-[0.625rem] tracking-[0.1em] text-faint uppercase">
              <Trans>Advertised engines</Trans>
            </h4>
            <MachineEngineList
              engines={runner.engines}
              streamable={streamable}
              connected={runner.connected}
            />
          </div>

          <div className="flex flex-col gap-1.5 border-t border-hairline pt-2.5">
            {/* The confirm sentence and its two buttons need a second line on a phone. */}
            <div className="flex items-center gap-2 max-md:flex-wrap max-md:justify-end">
              {confirmRevoke ? (
                <>
                  <span className="flex-1 text-[0.6875rem] leading-[1.6] text-blunder">
                    <Trans>
                      Revoking closes the link, deletes the engines it advertised and hands its
                      running work back to the queue with the attempt refunded. The token stops
                      working; a new one means a new runner.
                    </Trans>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmRevoke(false)}
                  >
                    <Trans>Cancel</Trans>
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(runner.id)}
                  >
                    {revoke.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                    <Trans context="button">Revoke</Trans>
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
                    <Trans context="button">Revoke</Trans>
                  </Button>
                  <div className="flex-1" />
                </>
              )}
            </div>
            {/*
              Outside the branches: a refused DELETE leaves the row confirming, and a click
              that appears to have done nothing is the one that most needs a reason next to it.
            */}
            {revoke.isError ? (
              <p className="text-[0.6875rem] text-blunder">{revoke.error.message}</p>
            ) : null}
          </div>
        </div>
      }
    />
  )
}
