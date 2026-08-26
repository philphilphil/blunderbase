import { TierBadge } from '@/components/badges/TierBadge'
import type { EngineResponse } from '@/lib/api/types'
import type { EngineHost } from '@/lib/engines/hosts'
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
  return (
    <ul className="flex flex-col gap-1">
      {engines.map((engine) => {
        const selected = engine.id === selectedId
        return (
          <li key={engine.id}>
            <button
              type="button"
              onClick={() => onSelect(engine.id)}
              aria-current={selected ? 'true' : undefined}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors',
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
                  <HostBadge host={hosts?.get(engine.id)} />
                </span>
                <span className="truncate font-mono text-[0.65625rem] text-faint">{engine.path}</span>
              </span>
              {engine.default_tier ? (
                <TierBadge tier={engine.default_tier} className="flex-none" />
              ) : null}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
