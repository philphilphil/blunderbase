/**
 * The engines every engine dialog chooses from — one list, three modes, drawn as the one
 * one-of-N control (`Segmented`), where they had been pressed chips in the selection blue.
 *
 * `GET /correspondence/status` answers with every enabled UCI engine the deployment has,
 * this host's and the runners', and says per engine why a *search* could not run on it
 * (`search_trouble`: a runner's engine, no board driving, a missing binary). A task can
 * run on any of them. So the picker is the same component in both dialogs and the mode
 * decides what is greyed: in `search` mode an engine with trouble is shown disabled with
 * the reason under the pointer, because an owner who sees their runner's Stockfish and
 * reads why it cannot search yet knows more than one who never sees it; in `task` mode
 * everything is live. The game's Analyse… dialog reads the same rows from
 * `GET /analysis/engines`, where `search_trouble` instead says why a *run* would be
 * refused (a local binary gone, Maia on another host). It picks in `run` mode, which greys
 * those the way `search` mode greys its own — an engine the press would only bounce off is
 * not one to preselect — and the dialog spells the reasons out under the picker.
 *
 * The engine flagged `default` is the analysis role's, and every mode opens on it where the
 * mode allows — the modes must never suggest different engines for one position.
 */
import { Trans, useLingui } from '@lingui/react/macro'

import { Segmented } from '@/components/ui/segmented'
import type { CorrespondenceSearchEngine } from '@/lib/api/types'

export type EngineMode = 'search' | 'task' | 'run'

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
      <p className="text-data text-mistake">
        <Trans>
          No engine is switched on that speaks UCI. Add one under Compute › Engines.
        </Trans>
      </p>
    )
  }
  // One engine out of a few, all on screen: the one `Segmented` (a sunken track, the chosen
  // engine a raised thumb), so this reads as "pick one of these" and never as a row of
  // buttons that each do something. It wraps where a deployment has many engines.
  return (
    <Segmented
      label={t`Engine`}
      value={value === null ? '' : String(value)}
      onChange={(next) => onChange(Number(next))}
      className="h-auto min-h-7 max-w-full flex-wrap"
      options={engines.map((engine) => {
        const usable = allowed(engine, mode)
        return {
          value: String(engine.engine_id),
          disabled: !usable,
          title: usable ? undefined : (engine.search_trouble ?? undefined),
          label: (
            <span className="inline-flex min-w-0 items-center gap-1.5 py-0.5">
              <span className="truncate">{engine.name}</span>
              {engine.runner_id !== null && engine.runner_id !== undefined ? (
                <span className="truncate text-meta text-dim-2">· {engine.host}</span>
              ) : engine.hash_mb ? (
                <span className="font-mono text-meta text-dim-2">
                  {t`${engine.hash_mb} MB`}
                </span>
              ) : null}
            </span>
          ),
        }
      })}
    />
  )
}
