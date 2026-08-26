import { Loader2, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { TierBadge } from '@/components/badges/TierBadge'
import { Button } from '@/components/ui/button'
import { useDeleteEngine } from '@/lib/api/queries'
import type { EngineResponse } from '@/lib/api/types'
import { isRemote, type EngineHost } from '@/lib/engines/hosts'
import { cn } from '@/lib/utils'

import { HostBadge } from './HostBadge'

/** The engine roster: one row each, the selected one carrying the teal inset bar. */
export function EngineList({
  engines,
  hosts,
  selectedId,
  onSelect,
}: {
  engines: EngineResponse[]
  /** Where each engine lives, joined from `/runners/status` on engine id. */
  hosts?: Map<number, EngineHost>
  selectedId: number | null
  onSelect: (id: number) => void
}) {
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null)

  const remove = useDeleteEngine({
    onSuccess: (result) => {
      setConfirmId(null)
      setNotice({
        error: false,
        text:
          result.unqueued > 0
            ? `Engine deleted, ${result.unqueued} queued run${result.unqueued === 1 ? '' : 's'} removed`
            : 'Engine deleted',
      })
    },
    onError: (error) => setNotice({ error: true, text: error.message }),
  })

  return (
    <div className="flex flex-col gap-1.5">
      {notice ? (
        <p
          className={cn(
            'rounded-md px-2.5 py-1.5 text-[0.6875rem]',
            notice.error ? 'bg-blunder/8 text-blunder' : 'bg-elevated text-dim-2',
          )}
        >
          {notice.text}
        </p>
      ) : null}
      <ul className="flex flex-col gap-1">
        {engines.map((engine) => {
          const selected = engine.id === selectedId
          const host = hosts?.get(engine.id)
          // A runner re-advertises whatever it still has running, so a row that is both
          // bound and enabled is the one case where deleting it does not stick.
          const reattaches = isRemote(host) && engine.enabled

          if (confirmId === engine.id) {
            return (
              <li
                key={engine.id}
                className="flex flex-col gap-1.5 rounded-md border border-blunder/28 bg-blunder/5 px-2.5 py-2"
              >
                <p className="text-[0.71875rem] leading-[1.6] text-blunder">
                  Delete {engine.name}? This removes the engine and unqueues its pending
                  analyses.
                  {reattaches
                    ? ' It is still advertised by its runner, so it will re-register the next time that runner connects.'
                    : ''}
                </p>
                <div className="flex items-center justify-end gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmId(null)}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(engine.id)}
                  >
                    {remove.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                    Delete
                  </Button>
                </div>
              </li>
            )
          }

          return (
            <li key={engine.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onSelect(engine.id)}
                aria-current={selected ? 'true' : undefined}
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors',
                  selected
                    ? 'bg-raised-2 shadow-[inset_0.125rem_0_0_var(--bb-accent)]'
                    : 'hover:bg-raised',
                )}
              >
                <span
                  className={cn(
                    'size-1.5 flex-none rounded-full',
                    engine.enabled ? 'bg-accent-teal' : 'bg-faint',
                  )}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      className={cn(
                        'min-w-0 truncate text-[0.8125rem]',
                        selected ? 'font-medium text-ink' : 'text-soft',
                      )}
                    >
                      {engine.name}
                    </span>
                    <HostBadge host={host} />
                  </span>
                  <span className="truncate font-mono text-[0.65625rem] text-faint">
                    {engine.path}
                  </span>
                </span>
                {engine.default_tier ? (
                  <TierBadge tier={engine.default_tier} className="flex-none" />
                ) : null}
              </button>
              <button
                type="button"
                aria-label={`Delete ${engine.name}`}
                onClick={() => {
                  setNotice(null)
                  setConfirmId(engine.id)
                }}
                className="flex-none px-1 text-faint transition-colors hover:text-blunder"
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
