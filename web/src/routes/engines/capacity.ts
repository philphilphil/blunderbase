/**
 * The arithmetic the Machines page does for this server: how many threads its two caps
 * would use at full load, against the cores it has.
 *
 * Two caps because two kinds of work never share a slot — the analysis queue's engine
 * processes (`analysis_concurrency`) and the correspondence searches beside them
 * (`correspondence_slots`) — and they are *added*, which is the thing nobody could read off
 * the old page: two slots and a concurrency of six are up to eight processes. A process
 * costs its engine's `Threads`, so the sum that has to fit the cores is
 * `processes × threads` for each cap, and the page draws that sum rather than asking the
 * owner to work it out from three screens.
 *
 * The threads a cap costs are the rows' own. The queue runs the engines holding Quick and
 * Deep on this host, so its per-process cost is the most threads any of them asks for; a
 * search may run on any enabled search engine here, so its cost is the most any of those
 * asks for. Nothing set means UCI's own default, one thread.
 *
 * Pure, so the sentence and the meter the page draws from it can be asserted on their own.
 */
import type { EngineResponse } from '@/lib/api/types'

import type { EngineRoles } from './roles'

/** UCI engines default to one thread when nothing sets `Threads`. */
const DEFAULT_THREADS = 1

export interface CapShare {
  /** Processes this cap allows at once. */
  processes: number
  /** Threads one of them costs — the most any engine the cap may run here asks for. */
  threads: number
}

export interface HostBudget {
  cores: number | null
  queue: CapShare
  /** Null while correspondence mode is off: no search can start, so none is counted. */
  searches: CapShare | null
  /** Threads at full load, both caps added. */
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
  queueProcesses,
  searchSlots,
  correspondenceOn,
  engines,
  roles,
}: {
  cores: number | null | undefined
  queueProcesses: number
  searchSlots: number
  correspondenceOn: boolean
  /** The engines on this host only — a runner's threads are that machine's business. */
  engines: EngineResponse[]
  roles: Map<number, EngineRoles>
}): HostBudget {
  const enabledSearch = engines.filter((engine) => engine.enabled && engine.kind === 'uci')
  // The queue runs whatever holds a tier; with nothing assigned the honest cost is the
  // heaviest search engine it could be handed, and with no engine at all it is one thread.
  const tierEngines = enabledSearch.filter((engine) =>
    (roles.get(engine.id) ?? []).some((role) => role === 'quick' || role === 'deep'),
  )
  const queueThreads =
    mostThreads(tierEngines) || mostThreads(enabledSearch) || DEFAULT_THREADS
  const searchThreads = mostThreads(enabledSearch) || DEFAULT_THREADS
  const queue: CapShare = { processes: Math.max(0, queueProcesses), threads: queueThreads }
  const searches: CapShare | null = correspondenceOn
    ? { processes: Math.max(0, searchSlots), threads: searchThreads }
    : null
  const total =
    queue.processes * queue.threads +
    (searches ? searches.processes * searches.threads : 0)
  const known = typeof cores === 'number' && cores > 0
  return {
    cores: known ? cores : null,
    queue,
    searches,
    total,
    over: known && total > cores,
  }
}

/** The meter's three widths in percent of the wider of the cores and the total. */
export function budgetShares(budget: HostBudget): {
  queue: number
  searches: number
  over: number
} {
  const scale = Math.max(budget.cores ?? 0, budget.total, 1)
  const queue = budget.queue.processes * budget.queue.threads
  const searches = budget.searches ? budget.searches.processes * budget.searches.threads : 0
  const within = budget.cores ?? budget.total
  const over = Math.max(0, budget.total - within)
  return {
    queue: (Math.min(queue, within) / scale) * 100,
    searches: (Math.min(searches, Math.max(0, within - queue)) / scale) * 100,
    over: (over / scale) * 100,
  }
}
