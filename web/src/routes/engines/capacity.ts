/**
 * The arithmetic the Machines page does for this server: how many threads its cap would
 * use at full load, against the cores it has.
 *
 * One cap, `analysis_concurrency`, because every engine process on the host — an analysis
 * pass, an analysis board, a correspondence search — holds one of the same slots.
 * There used to be a second cap for the searches, added to this one, and the page had to
 * explain that two slots and a concurrency of six were up to eight processes; with one
 * number there is nothing to add. A process costs its engine's `Threads`, so the sum that
 * has to fit the cores is `processes × threads`, and the page draws it rather than asking
 * the owner to work it out from two screens.
 *
 * The threads a slot costs are the rows' own, priced at the heaviest engine a slot may be
 * holding. While correspondence mode is on that is any enabled search engine here, since a
 * search may run on any of them; off, the engine holding the analysis role is priced. That
 * is an approximation: the Analyse dialog may put a single run on any enabled engine, but
 * the queue's steady load — every import and backfill — is the role's engine, and pricing
 * every slot at a heavy engine used once a week would cry overrun at a machine that is
 * fine. Nothing set means UCI's own default, one thread.
 *
 * Pure, so the sentence and the meter the page draws from it can be asserted on their own.
 */
import type { EngineResponse } from '@/lib/api/types'

import type { EngineRoles } from './roles'

/** UCI engines default to one thread when nothing sets `Threads`. */
const DEFAULT_THREADS = 1

export interface HostBudget {
  cores: number | null
  /** Engine processes the cap allows at once. */
  processes: number
  /** Threads one of them costs — the most any engine a slot may be holding asks for. */
  threads: number
  /** Threads at full load: `processes × threads`. */
  total: number
  /** Whether the total exceeds what the machine has; false when the cores are unknown. */
  over: boolean
}

/** `Threads` as the row stores it, or the engine's own default when it does not. */
export function engineThreads(engine: Pick<EngineResponse, 'options'>): number {
  const raw = engine.options?.Threads
  const threads = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10)
  return Number.isFinite(threads) && threads >= 1 ? Math.floor(threads) : DEFAULT_THREADS
}

/** `Hash` in megabytes as the row stores it, or null when the engine's own default applies. */
export function engineHashMb(engine: Pick<EngineResponse, 'options'>): number | null {
  const raw = engine.options?.Hash
  const hash = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10)
  return Number.isFinite(hash) && hash >= 0 ? Math.floor(hash) : null
}

function mostThreads(engines: EngineResponse[]): number {
  return engines.reduce((most, engine) => Math.max(most, engineThreads(engine)), 0)
}

export function hostBudget({
  cores,
  processes,
  correspondenceOn,
  engines,
  roles,
}: {
  cores: number | null | undefined
  processes: number
  /** Whether a search may be holding a slot — which is what puts every engine in the price. */
  correspondenceOn: boolean
  /** The engines on this host only — a runner's threads are that machine's business. */
  engines: EngineResponse[]
  roles: Map<number, EngineRoles>
}): HostBudget {
  const enabledSearch = engines.filter((engine) => engine.enabled && engine.kind === 'uci')
  // With the mode off the analysis role's engine is what the queue mostly runs here; with
  // nothing assigned the honest cost is the heaviest engine the queue could be handed, and
  // with no engine at all it is one thread. With the mode on any slot may be holding any
  // search engine.
  const roleEngines = enabledSearch.filter((engine) =>
    (roles.get(engine.id) ?? []).includes('analysis'),
  )
  const threads =
    (correspondenceOn ? 0 : mostThreads(roleEngines)) ||
    mostThreads(enabledSearch) ||
    DEFAULT_THREADS
  const allowed = Math.max(0, processes)
  const total = allowed * threads
  const known = typeof cores === 'number' && cores > 0
  return {
    cores: known ? cores : null,
    processes: allowed,
    threads,
    total,
    over: known && total > cores,
  }
}

/** The meter's two widths in percent of the wider of the cores and the total. */
export function budgetShares(budget: HostBudget): { used: number; over: number } {
  const scale = Math.max(budget.cores ?? 0, budget.total, 1)
  const within = budget.cores ?? budget.total
  const over = Math.max(0, budget.total - within)
  return {
    used: (Math.min(budget.total, within) / scale) * 100,
    over: (over / scale) * 100,
  }
}
