/**
 * What the screens have to work out about searches, as pure functions.
 *
 * The engine column, the tree, the candidates table and the list page all ask the same
 * handful of questions — *which engines have something to say about this node*, *is this
 * line so far behind its best sibling that it should fade*, *what does an eval history
 * actually say* — and they must not answer them differently. So the answers live here,
 * beside `tree.ts`, and are tested without a DOM.
 *
 * The one number worth arguing about is `WEAK_CP`. It is the gap, in centipawns and in the
 * frame the siblings share, below which a move is no longer part of the decision: 150 is
 * about a pawn and a half — a whole piece of compensation short — and everything at that
 * distance in a correspondence tree is a line the engines have already answered. It fades
 * rather than disappears, and **nothing is ever pruned automatically**; the Prune weak
 * action is the owner's, behind a confirm, and this is only what it offers to delete.
 */
import { t } from '@lingui/core/macro'

import type {
  CorrespondenceEval,
  CorrespondenceSearch,
  CorrespondenceSearchStatus,
  CorrespondenceTreeNode,
  EngineResponse,
} from '@/lib/api/types'

import { scoreRank, sortSiblings } from './tree'

/** Queued, running or parked: a search that still has something to give. */
export const ACTIVE_STATUSES: readonly CorrespondenceSearchStatus[] = [
  'queued',
  'running',
  'paused',
]

export function isActive(search: CorrespondenceSearch): boolean {
  return ACTIVE_STATUSES.includes(search.status)
}

export function isLive(search: CorrespondenceSearch): boolean {
  return search.status === 'running'
}

/** Parked with its process and its hash still in memory — the amber dot. */
export function isWarm(search: CorrespondenceSearch): boolean {
  return search.status === 'paused' && search.warm === true
}

/**
 * One row of the engine column: an engine that is searching this node, has a verdict on
 * it, or both.
 *
 * A search and a stored evaluation are two claims about the same engine on the same
 * position — what it is finding now, and what it had concluded when it last checkpointed —
 * so they are one pane, not two. The stored row is what the pane draws while the search is
 * parked or before it has sent a picture, which is exactly the state a page reloaded
 * mid-search opens in.
 */
export interface EnginePaneModel {
  /** Stable across a re-render: the engine when there is one, else the search. */
  key: string
  engineId: number | null
  engineName: string
  search: CorrespondenceSearch | null
  stored: CorrespondenceEval | null
  /** This engine's verdict is the one the node's `own` states. */
  chosen: boolean
  /** The owner pinned this engine here, rather than the tree choosing the deepest. */
  pinned: boolean
}

/**
 * The panes for one node, in the order they stack: what is running first — that is what
 * the reader came to look at — then what is parked or queued, then the stored verdicts
 * nothing is working on, deepest first.
 */
export function enginePanes(node: CorrespondenceTreeNode | null): EnginePaneModel[] {
  if (!node) return []
  const evals = node.evals ?? []
  const searches = (node.searches ?? []).filter(isActive)
  const byEngine = new Map<number, EnginePaneModel>()
  const loose: EnginePaneModel[] = []

  const model = (
    engineId: number | null,
    engineName: string,
    search: CorrespondenceSearch | null,
    stored: CorrespondenceEval | null,
  ): EnginePaneModel => ({
    key: engineId === null ? `search-${search?.id ?? 0}` : `engine-${engineId}`,
    engineId,
    engineName,
    search,
    stored,
    chosen: engineId !== null && node.chosen_engine_id === engineId,
    pinned: engineId !== null && node.pinned_engine_id === engineId,
  })

  for (const stored of evals) {
    const id = stored.engine_id ?? null
    const pane = model(id, stored.engine_name, null, stored)
    if (id === null) loose.push(pane)
    else byEngine.set(id, pane)
  }
  for (const search of searches) {
    const id = search.engine_id ?? null
    const held = id === null ? null : byEngine.get(id)
    const name = search.engine_name ?? held?.engineName ?? ''
    const pane = model(id, name, search, held?.stored ?? null)
    if (id === null) loose.push(pane)
    else byEngine.set(id, pane)
  }

  const rank = (pane: EnginePaneModel) => {
    if (pane.search && isLive(pane.search)) return 0
    if (pane.search) return 1
    return 2
  }
  return [...byEngine.values(), ...loose].sort(
    (left, right) =>
      rank(left) - rank(right) ||
      (right.stored?.depth ?? 0) - (left.stored?.depth ?? 0) ||
      left.engineName.localeCompare(right.engineName),
  )
}

/** The engines the picker may offer when the owner has not chosen a list. */
export function eligibleEngines(engines: readonly EngineResponse[]): EngineResponse[] {
  return engines.filter((engine) => engine.enabled && engine.kind === 'uci')
}

/** How far behind its best sibling a move may fall before it stops being a candidate. */
export const WEAK_CP = 150

/**
 * The children of one node that are so far behind the best of them that they have stopped
 * being part of the decision.
 *
 * Read off the **backed** number, falling back to the node's own: what a move is worth is
 * what the tree has proved under it, and a move whose engine likes it while the minimax
 * has refuted it is the opposite of weak. A sibling set where nothing is evaluated fades
 * nothing — an unknown number is not a bad one.
 */
export function weakChildren(node: CorrespondenceTreeNode): Set<number> {
  const weak = new Set<number>()
  const children = sortSiblings(node.children ?? [])
  if (children.length < 2) return weak
  const ranks = children.map((child) => {
    const backed = scoreRank(child.backed)
    return backed === Number.NEGATIVE_INFINITY ? scoreRank(child.own) : backed
  })
  const best = Math.max(...ranks)
  if (!Number.isFinite(best)) return weak
  children.forEach((child, at) => {
    const rank = ranks[at]
    if (!Number.isFinite(rank)) return
    if (best - rank >= WEAK_CP) weak.add(child.id)
  })
  return weak
}

/** Every node in the tree that fades, over the whole tree in one walk. */
export function weakNodes(root: CorrespondenceTreeNode | null): Set<number> {
  const weak = new Set<number>()
  if (!root) return weak
  const walk = (node: CorrespondenceTreeNode) => {
    for (const id of weakChildren(node)) weak.add(id)
    for (const child of node.children) walk(child)
  }
  walk(root)
  return weak
}

/**
 * What **Prune weak** offers to delete: the faded subtrees, and only the roots of them —
 * deleting a node takes its children with it, so listing those too would double-count what
 * the confirm is about.
 *
 * A node the game played is never offered, and neither is anything with a search inside
 * it: the server refuses both, and a confirm that promised to delete twelve nodes and
 * deleted nine would be worse than one that never offered them.
 */
export function prunableNodes(root: CorrespondenceTreeNode | null): CorrespondenceTreeNode[] {
  if (!root) return []
  const weak = weakNodes(root)
  const found: CorrespondenceTreeNode[] = []
  const walk = (node: CorrespondenceTreeNode) => {
    for (const child of node.children) {
      if (weak.has(child.id) && !hasPlayed(child) && !hasSearch(child)) {
        found.push(child)
        continue
      }
      walk(child)
    }
  }
  walk(root)
  return found
}

function hasPlayed(node: CorrespondenceTreeNode): boolean {
  return node.played || node.children.some(hasPlayed)
}

function hasSearch(node: CorrespondenceTreeNode): boolean {
  return (node.searches ?? []).some(isActive) || node.children.some(hasSearch)
}

/** How many nodes a prune would take, subtrees counted whole. */
export function countPruned(nodes: readonly CorrespondenceTreeNode[]): number {
  const size = (node: CorrespondenceTreeNode): number =>
    1 + node.children.reduce((total, child) => total + size(child), 0)
  return nodes.reduce((total, node) => total + size(node), 0)
}

/** One entry of an eval's trajectory, as the sparkline reads it. */
export interface HistoryPoint {
  depth?: number | null
  nodes?: number | null
  cp?: number | null
  mate?: number | null
  best?: string | null
}

/**
 * The sparkline's polyline, in a 0..100 by 0..12 box.
 *
 * Clamped to ±300 centipawns: a history that touches a mate score would otherwise flatten
 * every real movement in it into one horizontal line, and the point of the picture is
 * whether the number is *settling*, not what its extreme was.
 */
export function sparkline(history: readonly HistoryPoint[], width = 100, height = 12): string {
  const points = history.filter(
    (point) => point.cp !== null && point.cp !== undefined || point.mate !== null && point.mate !== undefined,
  )
  if (points.length < 2) return ''
  const value = (point: HistoryPoint) =>
    point.mate !== null && point.mate !== undefined
      ? point.mate >= 0
        ? 300
        : -300
      : Math.max(-300, Math.min(300, point.cp ?? 0))
  const step = width / (points.length - 1)
  return points
    .map((point, at) => {
      const y = height / 2 - (value(point) / 300) * (height / 2 - 1)
      return `${(at * step).toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

/** Where a history started and where it got to — the two ends the footer names. */
export interface HistoryReading {
  from: HistoryPoint
  to: HistoryPoint
  /** How many entries the best move at the end has been the best move for. */
  stableFor: number
  /** True while the trajectory's last third moved less than a tenth of a pawn. */
  settled: boolean
}

/**
 * The one-line reading under the sparkline: how far the number moved, and whether the
 * engine has changed its mind lately.
 *
 * "Settled" is the question a correspondence player actually asks of a three-day search —
 * a number that is still climbing at depth 50 is a number that is not finished — and it is
 * answered off the last third of the trajectory rather than off the last entry, which
 * moves for its own reasons.
 */
export function readHistory(history: readonly HistoryPoint[]): HistoryReading | null {
  if (history.length < 2) return null
  const from = history[0]
  const to = history[history.length - 1]
  const best = to.best ?? null
  let stableFor = 0
  for (let at = history.length - 1; at >= 0; at -= 1) {
    if (!best || history[at].best !== best) break
    stableFor += 1
  }
  // The last third, but never fewer than two entries: a trajectory of three would
  // otherwise be judged on its final point alone, which moves for its own reasons.
  const window = Math.max(2, Math.ceil(history.length / 3))
  const tail = history.slice(Math.max(0, history.length - window))
  const values = tail
    .map((point) => (point.mate === null || point.mate === undefined ? point.cp : null))
    .filter((cp): cp is number => cp !== null && cp !== undefined)
  const settled = values.length > 1 && Math.max(...values) - Math.min(...values) < 10
  return { from, to, stableFor, settled }
}

/** The search's limits in one short phrase, or null for a search with no end to it. */
export function limitParts(search: CorrespondenceSearch): {
  depth: number | null
  nodes: number | null
  seconds: number | null
} | null {
  const depth = search.limit_depth ?? null
  const nodes = search.limit_nodes ?? null
  const seconds = search.limit_seconds ?? null
  if (depth === null && nodes === null && seconds === null) return null
  return { depth, nodes, seconds }
}

/**
 * How long a search has been going, in whole seconds — from the last start, so a resumed
 * search counts the current stretch rather than pretending the pause did not happen: the
 * server stamps `started_at` on every stretch, and `created_at` is where the search's whole
 * age lives. The clock comes in as an argument so the caller decides how often it ticks.
 */
export function runningSeconds(search: CorrespondenceSearch, now: number): number | null {
  if (!search.started_at) return null
  const started = new Date(search.started_at).getTime()
  if (Number.isNaN(started)) return null
  return Math.max(0, Math.floor((now - started) / 1000))
}

/**
 * `2d 4h`, `6h 12m`, `48s` — a duration a *search* is measured in.
 *
 * Not `lib/analysis`'s `formatDuration`, which floors at "under a minute" and has no days
 * in it: that one prices a queue that finishes this afternoon, and this one has to say how
 * long an engine has been on one position, which is routinely three days.
 *
 * Through Lingui's global `t`, as `formatDuration` is: the units are text a person reads,
 * on the pane header, the "Running now" cards and the capacity strip, and a German reader
 * gets them from the catalog rather than from this file.
 */
export function formatSpan(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return ''
  if (seconds < 60) {
    const whole = Math.floor(seconds)
    return t`${whole}s`
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return t`${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    const rest = minutes % 60
    return t`${hours}h ${rest}m`
  }
  const days = Math.floor(hours / 24)
  const rest = hours % 24
  return t`${days}d ${rest}h`
}
