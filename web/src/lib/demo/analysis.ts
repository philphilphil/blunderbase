/** Analysis private to this demo tab. Nothing is registered or uploaded to the server. */
import { useSyncExternalStore } from 'react'
import type { AnalysisRequest, AppSettings, GameDetail, RunResponse } from '@/lib/api/types'
import { SETTING_DEFAULTS } from '@/lib/api/appSettings'
import { startEngine, type BrowserEngine } from '@/lib/runner/engine'
import { analysePlan, RunAbandoned } from '@/lib/runner/plan'
import type { RunPlan } from '@/lib/runner/protocol'

export const DEMO_ENGINE_ID = -1

/**
 * Where this tab's run ids start. They count *up*, far above any id the seeded library
 * holds, because `gameModel.bestRun` lets the higher id win the way the server's newer run
 * does: counting down from -1 made the first run in the tab outrank the second, so the
 * header named one run while the moves showed the next one's evaluations. 2^40 stays well
 * inside the integers a double holds exactly.
 */
export const DEMO_RUN_ID_BASE = 2 ** 40

/**
 * What the Analyse dialog asks a demo run for: the parts of `AnalysisRequest` a tab can
 * honour. No engine — there is one, this tab's Stockfish — and no Maia, which the demo
 * does not download. `null` in its place is the import pass, at the Settings page's budget.
 */
export type DemoRunRequest = Pick<
  AnalysisRequest,
  'multipv' | 'nodes' | 'depth' | 'seconds' | 'ply_start' | 'ply_end'
>

/** The priority a requested run carries on the server (`analysis.REQUESTED_PRIORITY`). */
const REQUESTED_PRIORITY = 10

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
  private nextRunId = DEMO_RUN_ID_BASE

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

  /**
   * One run over `detail`, the way the server would have queued it: `request` is the
   * Analyse dialog's body, `null` the import pass. Refusals — a second limit, a window off
   * the game — are thrown before the engine is touched, as the API's 422 would be.
   */
  async run(detail: GameDetail, request: DemoRunRequest | null, settings: AppSettings): Promise<void> {
    // See `demoPlan`: without the game's starting position, only a standard game replays
    // correctly, and a wrong replay would look like an answer rather than a refusal.
    const variant = detail.game.variant ?? 'standard'
    if (variant !== 'standard') {
      throw new Error(`${variant} games cannot be analysed in the browser here`)
    }
    const id = this.nextRunId
    const plan = demoPlan(detail, request, settings, id)
    const work = this.begin()
    this.nextRunId++
    const requested = request !== null
    // A window over the whole game is stored as no window, the way the service stores it,
    // so the demo's run rows read like a real library's.
    const whole = plan.ply_start === 0 && plan.ply_end === detail.moves.length
    const window = whole ? { ply_start: null, ply_end: null } : { ply_start: plan.ply_start, ply_end: plan.ply_end }
    const limits = { nodes: plan.nodes, depth: plan.depth, seconds: plan.seconds, multipv: plan.multipv }
    const run: RunResponse = {
      id, game_id: detail.game.id, status: 'running', engine_id: DEMO_ENGINE_ID, ...limits,
      ...window, priority: requested ? REQUESTED_PRIORITY : 0, requested, attempts: 1,
      created_at: new Date().toISOString(), started_at: new Date().toISOString(), maia: false,
    }
    this.patch({ activeRun: run, progress: { done: 0, total: plan.ply_end - plan.ply_start + 1 } })
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
          id, engine_id: DEMO_ENGINE_ID, requested, status: 'done',
          engine: `${work.engine.version} · this browser`, engine_kind: 'uci', maia: false,
          ...limits, ...window, finished_at: new Date().toISOString(),
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
 *
 * The limits follow `request_analysis`: one of nodes, depth or seconds, none meaning the
 * `analysis_nodes` setting, two refused — a search that stops at whichever comes first is
 * not what either number on the dialog promised. The import pass (`request` null) is
 * `analysis_nodes` at `analysis_multipv`, what a new game gets on the server.
 */
export function demoPlan(
  detail: GameDetail,
  request: DemoRunRequest | null,
  settings: AppSettings,
  runId: number,
): RunPlan {
  const given = (['nodes', 'depth', 'seconds'] as const).filter((key) => request?.[key] != null)
  if (given.length > 1) throw new Error(`a run stops at one limit, not ${given.join(' and ')}`)
  const multipv = request?.multipv ?? settings.analysis_multipv ?? SETTING_DEFAULTS.analysis_multipv
  if (!Number.isInteger(multipv) || multipv < 1 || multipv > 5) {
    throw new Error('a run keeps 1 to 5 lines')
  }
  const moves = detail.moves.length
  // Clamped to the game and refused only when nothing is left, as `analysis.ply_window` does.
  const windowed = request?.ply_start != null && request.ply_end != null
  const plyStart = windowed ? Math.max(0, request.ply_start!) : 0
  const plyEnd = windowed ? Math.min(moves, request.ply_end!) : moves
  if (windowed && plyStart >= plyEnd) {
    throw new Error(`ply range ${request.ply_start}–${request.ply_end} is empty for a game of ${moves} plies`)
  }
  const nodes = given.length === 0
    ? settings.analysis_nodes ?? SETTING_DEFAULTS.analysis_nodes
    : request?.nodes ?? null
  return {
    run_id: runId, game_id: detail.game.id, fen: null,
    variant: detail.game.variant ?? 'standard', initial_fen: null,
    moves_uci: detail.moves.map((move) => move.uci ?? ''),
    moves_san: detail.moves.map((move) => move.san ?? null),
    position_ids: detail.moves.map(() => null), ply_start: plyStart, ply_end: plyEnd,
    nodes, depth: request?.depth ?? null, seconds: request?.seconds ?? null, multipv,
    thresholds: { inaccuracy: settings.inaccuracy_threshold ?? 5, mistake: settings.mistake_threshold ?? 10, blunder: settings.blunder_threshold ?? 15 },
    owner_color: detail.game.color ?? null, owner_rating: detail.game.rating ?? null,
    maia_target_elo: settings.maia_target_elo, maia_elos: [], maia: false, maia_only: false, maia_both_sides: false,
  }
}

export const demoAnalysis = new DemoAnalysis()
export function useDemoAnalysis() {
  return useSyncExternalStore(demoAnalysis.subscribe, demoAnalysis.getSnapshot, demoAnalysis.getSnapshot)
}
