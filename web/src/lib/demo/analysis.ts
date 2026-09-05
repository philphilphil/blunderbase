/** Analysis private to this demo tab. Nothing is registered or uploaded to the server. */
import { useSyncExternalStore } from 'react'
import type { AppSettings, GameDetail, RunResponse, Tier } from '@/lib/api/types'
import { startEngine, type BrowserEngine } from '@/lib/runner/engine'
import { analysePlan, RunAbandoned } from '@/lib/runner/plan'
import type { RunPlan } from '@/lib/runner/protocol'

export const DEMO_ENGINE_ID = -1

interface State {
  ready: boolean
  activeRun: RunResponse | null
  progress: { done: number; total: number } | null
  results: ReadonlyMap<number, GameDetail>
}

export class DemoAnalysis {
  private engine: BrowserEngine | null = null
  private loading: Promise<void> | null = null
  private operation: AbortController | null = null
  private listeners = new Set<() => void>()
  private state: State = { ready: false, activeRun: null, progress: null, results: new Map() }
  private nextRunId = -1

  private start: () => Promise<BrowserEngine>
  constructor(start: () => Promise<BrowserEngine> = startEngine) { this.start = start }
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private patch(next: Partial<State>) {
    this.state = { ...this.state, ...next }
    this.listeners.forEach((listener) => listener())
  }

  install(): Promise<void> {
    if (this.engine) return Promise.resolve()
    if (!this.loading) {
      this.loading = this.start().then((engine) => {
        this.engine = engine
        this.patch({ ready: true })
      }).finally(() => { this.loading = null })
    }
    return this.loading
  }

  /** One search at a time. Starting a board stops a pass, and vice versa. */
  begin() {
    if (!this.engine) throw new Error('No browser engine is set up')
    this.operation?.abort()
    this.engine.stopSearch()
    const controller = new AbortController()
    this.operation = controller
    return {
      engine: this.engine,
      signal: controller.signal,
      cancel: () => {
        controller.abort()
        if (this.operation === controller) this.engine?.stopSearch()
      },
      release: () => { if (this.operation === controller) this.operation = null },
    }
  }

  async run(detail: GameDetail, tier: Tier, settings: AppSettings): Promise<void> {
    // See `demoPlan`: without the game's starting position, only a standard game replays
    // correctly, and a wrong replay would look like an answer rather than a refusal.
    const variant = detail.game.variant ?? 'standard'
    if (variant !== 'standard') {
      throw new Error(`${variant} games cannot be analysed in the browser here`)
    }
    const work = this.begin()
    const id = this.nextRunId--
    const plan = demoPlan(detail, tier, settings, id)
    const run: RunResponse = {
      id, game_id: detail.game.id, tier, status: 'running', engine_id: DEMO_ENGINE_ID,
      nodes: plan.nodes, depth: null, multipv: plan.multipv, priority: 0, attempts: 1,
      created_at: new Date().toISOString(), started_at: new Date().toISOString(), maia: false,
    }
    this.patch({ activeRun: run, progress: { done: 0, total: detail.moves.length + 1 } })
    try {
      const rows = await analysePlan(plan, work.engine, {
        signal: work.signal,
        progress: (done, total) => {
          if (!work.signal.aborted) this.patch({ progress: { done, total } })
        },
      })
      if (work.signal.aborted) return
      const byPly = new Map(rows.map((row) => [row.ply, row]))
      const result: GameDetail = {
        ...detail,
        moves: detail.moves.map((move) => {
          const row = byPly.get(move.ply)
          return row ? { ...move, ...row, best_lines: row.best_lines?.map((line) => ({ ...line })) ?? null, run_id: id } : move
        }),
        runs: [...detail.runs, {
          id, tier, status: 'done', engine: `${work.engine.version} · this browser`,
          engine_kind: 'uci', nodes: plan.nodes, depth: null, multipv: plan.multipv,
          finished_at: new Date().toISOString(),
        }],
      }
      const results = new Map(this.state.results)
      results.set(detail.game.id, result)
      this.patch({ results })
    } catch (cause) {
      if (!(cause instanceof RunAbandoned) && !work.signal.aborted) throw cause
    } finally {
      work.release()
      if (this.state.activeRun?.id === id) this.patch({ activeRun: null, progress: null })
    }
  }

  stop() {
    this.operation?.abort()
    this.engine?.stopSearch()
  }
}

/**
 * The `RunPlan` the server would have sent, assembled from what a `GameDetail` carries.
 *
 * One thing it cannot carry: the position the moves start from. `analysis.build_plan` reads
 * that off `game_positions` at ply 0 and `GET /games/{id}` does not expose it, so the plan
 * says `initial_fen: null` and `plan.ts` replays from the standard start. That is correct
 * for every game a demo holds — `demo create` selects standard games only — and wrong for
 * anything else, silently, which is why `run` refuses a non-standard variant outright
 * rather than handing back evaluations of a position the game was never in.
 */
export function demoPlan(detail: GameDetail, tier: Tier, settings: AppSettings, runId: number): RunPlan {
  return {
    run_id: runId, tier, game_id: detail.game.id, fen: null,
    variant: detail.game.variant ?? 'standard', initial_fen: null,
    moves_uci: detail.moves.map((move) => move.uci ?? ''),
    moves_san: detail.moves.map((move) => move.san ?? null),
    position_ids: detail.moves.map(() => null), ply_start: 0, ply_end: detail.moves.length,
    nodes: tier === 'quick' ? settings.quick_nodes ?? 250_000 : settings.deep_nodes ?? 2_000_000,
    depth: null, multipv: tier === 'quick' ? 1 : settings.deep_multipv ?? 4,
    thresholds: { inaccuracy: settings.inaccuracy_threshold ?? 5, mistake: settings.mistake_threshold ?? 10, blunder: settings.blunder_threshold ?? 15 },
    owner_color: detail.game.color ?? null, owner_rating: detail.game.rating ?? null,
    maia_target_elo: settings.maia_target_elo, maia_elos: [], maia: false, maia_only: false, maia_both_sides: false,
  }
}

export const demoAnalysis = new DemoAnalysis()
export function useDemoAnalysis() {
  return useSyncExternalStore(demoAnalysis.subscribe, demoAnalysis.getSnapshot, demoAnalysis.getSnapshot)
}
