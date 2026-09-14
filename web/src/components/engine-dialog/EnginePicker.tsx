/**
 * The engine chips every correspondence dialog chooses from — one list, two modes.
 *
 * `GET /correspondence/status` answers with every enabled UCI engine the deployment has,
 * this host's and the runners', and says per engine why a *search* could not run on it
 * (`search_trouble`: a runner's engine, no board driving, a missing binary). A task can
 * run on any of them. So the picker is the same component in both dialogs and the mode
 * decides what is greyed: in `search` mode an engine with trouble is shown disabled with
 * the reason under the pointer, because an owner who sees their runner's Stockfish and
 * reads why it cannot search yet knows more than one who never sees it; in `task` mode
 * everything is live.
 *
 * The engine flagged `default` is the deep role's, and both modes open on it where the
 * mode allows — the two modes must never suggest different engines for one position.
 */
import { Trans, useLingui } from '@lingui/react/macro'

import type { CorrespondenceSearchEngine } from '@/lib/api/types'
import { cn } from '@/lib/utils'

export type EngineMode = 'search' | 'task'

/** Whether this engine may be chosen in this mode. */
export function allowed(engine: CorrespondenceSearchEngine, mode: EngineMode): boolean {
  return mode === 'task' || !engine.search_trouble
}

/** The engine a picker opens on: the default where the mode allows it, else the first it does. */
export function preferredEngine(
  engines: CorrespondenceSearchEngine[],
  mode: EngineMode,
): number | null {
  const usable = engines.filter((engine) => allowed(engine, mode))
  const preferred = usable.find((engine) => engine.default) ?? usable[0] ?? null
  return preferred?.engine_id ?? null
}

export function EnginePicker({
  engines,
  mode,
  value,
  onChange,
}: {
  engines: CorrespondenceSearchEngine[]
  mode: EngineMode
  value: number | null
  onChange: (engineId: number) => void
}) {
  const { t } = useLingui()
  if (engines.length === 0) {
    return (
      <p className="text-[0.71875rem] text-mistake">
        <Trans>
          No engine is switched on that speaks UCI. Add one under Analysis → Engines.
        </Trans>
      </p>
    )
  }
  return (
    <div role="group" aria-label={t`Engine`} className="flex flex-wrap gap-2">
      {engines.map((engine) => {
        const usable = allowed(engine, mode)
        return (
          <button
            key={engine.engine_id}
            type="button"
            aria-pressed={value === engine.engine_id}
            disabled={!usable}
            title={usable ? undefined : (engine.search_trouble ?? undefined)}
            onClick={() => onChange(engine.engine_id)}
            className={cn(
              'flex min-w-0 items-center gap-2 rounded-md border px-2.5 py-1.5 text-[0.75rem] transition-colors',
              value === engine.engine_id
                ? 'border-accent-teal/40 bg-selected text-ink'
                : 'border-edge text-dim hover:border-edge-hover hover:text-ink',
              !usable && 'cursor-not-allowed opacity-45 hover:border-edge hover:text-dim',
            )}
          >
            <span className="truncate">{engine.name}</span>
            {engine.runner_id !== null && engine.runner_id !== undefined ? (
              <span className="truncate text-[0.625rem] text-dim-2">· {engine.host}</span>
            ) : engine.hash_mb ? (
              <span className="font-mono text-[0.625rem] text-dim-2">
                {t`${engine.hash_mb} MB`}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
