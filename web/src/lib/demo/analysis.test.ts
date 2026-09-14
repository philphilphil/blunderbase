/**
 * The demo's tab-local analysis. What matters here is not the search — `plan.ts` owns that
 * and is tested against a real engine elsewhere — but the three promises this store makes
 * to a screen that cannot fall back on the server: one engine, one search at a time, and a
 * result that reads exactly like a `GameDetail` the API would have sent.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppSettings, GameDetail } from '@/lib/api/types'
import type { BrowserEngine } from '@/lib/runner/engine'
import { RunAbandoned } from '@/lib/runner/plan'
import type { MoveEvalPayload } from '@/lib/runner/protocol'

import { bestRun } from '@/routes/game/gameModel'
import { DemoAnalysis, demoPlan, DEMO_ENGINE_ID } from './analysis'

const analysePlan = vi.hoisted(() => vi.fn())
vi.mock('@/lib/runner/plan', async (original) => ({
  ...(await original<typeof import('@/lib/runner/plan')>()),
  analysePlan,
}))

const SETTINGS = {
  analysis_nodes: 300_000,
  analysis_multipv: 3,
  inaccuracy_threshold: 5,
  mistake_threshold: 10,
  blunder_threshold: 15,
  maia_target_elo: 1700,
} as unknown as AppSettings

function detail(): GameDetail {
  return {
    game: { id: 12, variant: 'standard', color: 'white', rating: 1650 },
    moves: [
      { ply: 1, uci: 'e2e4', san: 'e4' },
      { ply: 2, uci: 'c7c5', san: 'c5' },
    ],
    runs: [],
  } as unknown as GameDetail
}

function row(ply: number): MoveEvalPayload {
  return {
    ply,
    position_id: null,
    move_uci: null,
    move_san: null,
    eval_before_cp: 20,
    eval_before_mate: null,
    eval_after_cp: 10,
    eval_after_mate: null,
    win_before: 0.52,
    win_after: 0.5,
    win_loss: 2,
    best_move_uci: 'g1f3',
    best_lines: [{ multipv: 1, cp: 20, mate: null, pv: ['g1f3'] } as never],
    maia_policy: null,
    classification: null,
  }
}

function engine(): BrowserEngine {
  return { version: 'Stockfish 18', stopSearch: vi.fn() } as unknown as BrowserEngine
}

function store(started = engine()) {
  return { demo: new DemoAnalysis(async () => started), engine: started }
}

beforeEach(() => {
  analysePlan.mockReset()
  analysePlan.mockResolvedValue([row(1), row(2)])
})

describe('demoPlan', () => {
  it('spends the deployment’s own analysis budget on the import pass', () => {
    const plan = demoPlan(detail(), null, SETTINGS, -1)
    expect([plan.nodes, plan.depth, plan.seconds, plan.multipv]).toEqual([300_000, null, null, 3])
    expect(plan.moves_uci).toEqual(['e2e4', 'c7c5'])
    expect([plan.ply_start, plan.ply_end]).toEqual([0, 2])
    expect([plan.maia, plan.maia_only, plan.maia_elos]).toEqual([false, false, []])
  })

  it('falls back to the shipped defaults when nobody has set the budget', () => {
    const unset = { ...SETTINGS, analysis_nodes: null, analysis_multipv: null } as AppSettings
    const plan = demoPlan(detail(), {}, unset, -1)
    expect([plan.nodes, plan.multipv]).toEqual([500_000, 2])
  })

  it('stops at the one limit the dialog chose, and never backfills nodes beside it', () => {
    expect(demoPlan(detail(), { depth: 24, multipv: 1 }, SETTINGS, -1)).toMatchObject({
      nodes: null, depth: 24, seconds: null, multipv: 1,
    })
    expect(demoPlan(detail(), { seconds: 5 }, SETTINGS, -1)).toMatchObject({
      nodes: null, depth: null, seconds: 5, multipv: 3,
    })
    expect(demoPlan(detail(), { nodes: 2_000_000 }, SETTINGS, -1)).toMatchObject({
      nodes: 2_000_000, depth: null, seconds: null,
    })
  })

  it('refuses two limits, as the API does', () => {
    expect(() => demoPlan(detail(), { depth: 24, seconds: 5 }, SETTINGS, -1)).toThrow(
      'one limit, not depth and seconds',
    )
  })

  it('walks only the window it was given, clamped to the game', () => {
    const plan = demoPlan(detail(), { depth: 20, ply_start: 1, ply_end: 9 }, SETTINGS, -1)
    expect([plan.ply_start, plan.ply_end]).toEqual([1, 2])
    expect(() => demoPlan(detail(), { ply_start: 2, ply_end: 2 }, SETTINGS, -1)).toThrow('empty')
  })
})

describe('DemoAnalysis', () => {
  it('starts one engine however many times it is asked', async () => {
    const start = vi.fn(async () => engine())
    const demo = new DemoAnalysis(start)
    await Promise.all([demo.install(), demo.install()])
    await demo.install()
    expect(start).toHaveBeenCalledOnce()
    expect(demo.getSnapshot().ready).toBe(true)
  })

  it('refuses to search before an engine is installed', () => {
    expect(() => new DemoAnalysis(async () => engine()).begin()).toThrow('No browser engine')
  })

  it('files the evaluations onto the game and clears the run', async () => {
    const { demo } = store()
    await demo.install()
    const before = detail()
    await demo.run(before, null, SETTINGS)

    const state = demo.getSnapshot()
    expect(state.activeRun).toBeNull()
    expect(state.progress).toBeNull()
    const result = state.results.get(12)!
    expect(result.moves.map((move) => move.win_loss)).toEqual([2, 2])
    expect(result.moves.map((move) => move.san)).toEqual(['e4', 'c5'])
    expect(result.runs).toHaveLength(1)
    expect(result.runs[0]).toMatchObject({
      requested: false, nodes: 300_000, multipv: 3, status: 'done', engine_kind: 'uci',
      ply_start: null, ply_end: null,
    })
    expect(result.runs[0]!.engine).toContain('this browser')
    // The game the caller handed in is not the game it gets back.
    expect(before.moves[0]!.win_loss).toBeUndefined()
  })

  it('reports the pass as running, on the demo engine, while it works', async () => {
    const { demo } = store()
    await demo.install()
    let seen: ReturnType<typeof demo.getSnapshot> | null = null
    analysePlan.mockImplementation(async (_plan: unknown, _engine: unknown, options: {
      progress?: (done: number, total: number) => void
    }) => {
      options.progress?.(1, 2)
      seen = demo.getSnapshot()
      return [row(1), row(2)]
    })
    await demo.run(detail(), { depth: 24, multipv: 5 }, SETTINGS)
    expect(seen!.activeRun).toMatchObject({
      game_id: 12, requested: true, priority: 10, status: 'running', engine_id: DEMO_ENGINE_ID,
      depth: 24, nodes: null, multipv: 5,
    })
    expect(seen!.progress).toEqual({ done: 1, total: 2 })
  })

  it('files a windowed run as a window, on top of the game it was given', async () => {
    const { demo } = store()
    await demo.install()
    analysePlan.mockResolvedValueOnce([row(2)])
    await demo.run(detail(), { seconds: 5, ply_start: 1, ply_end: 2 }, SETTINGS)
    const result = demo.getSnapshot().results.get(12)!
    expect(result.runs[0]).toMatchObject({ requested: true, seconds: 5, ply_start: 1, ply_end: 2 })
    expect(result.moves.map((move) => move.win_loss)).toEqual([undefined, 2])
  })

  it('refuses a bad request before it stops whatever the engine is doing', async () => {
    const { demo, engine: running } = store()
    await demo.install()
    await expect(demo.run(detail(), { nodes: 1, depth: 2 }, SETTINGS)).rejects.toThrow('one limit')
    expect(running.stopSearch).not.toHaveBeenCalled()
    expect(analysePlan).not.toHaveBeenCalled()
  })

  it('lets the next search stop the one before it, and keeps its result', async () => {
    const { demo, engine: running } = store()
    await demo.install()
    analysePlan.mockImplementationOnce(async (_plan: unknown, _engine: unknown, options: {
      signal?: AbortSignal
    }) => {
      demo.begin() // a board opening while the pass is still walking the game
      if (options.signal?.aborted) throw new RunAbandoned()
      return [row(1), row(2)]
    })
    await demo.run(detail(), null, SETTINGS)

    expect(running.stopSearch).toHaveBeenCalled()
    expect(demo.getSnapshot().results.has(12)).toBe(false)
    expect(demo.getSnapshot().activeRun).toBeNull()
  })

  it('names the newest run as the one that answers, the run whose rows the moves show', async () => {
    const { demo } = store()
    await demo.install()
    await demo.run(detail(), { depth: 24 }, SETTINGS)
    const first = demo.getSnapshot().results.get(12)!
    await demo.run(first, { seconds: 10, multipv: 1 }, SETTINGS)
    const second = demo.getSnapshot().results.get(12)!

    const best = bestRun(second.runs)
    expect(best).toMatchObject({ seconds: 10 })
    expect(second.moves.every((move) => move.run_id === best!.id)).toBe(true)
  })

  it('refuses a game it cannot replay rather than answering about the wrong position', async () => {
    const { demo } = store()
    await demo.install()
    const chess960 = detail()
    ;(chess960.game as { variant: string }).variant = 'chess960'
    await expect(demo.run(chess960, null, SETTINGS)).rejects.toThrow('chess960')
    expect(analysePlan).not.toHaveBeenCalled()
    expect(demo.getSnapshot().activeRun).toBeNull()
  })

  it('lets a real failure through rather than losing it', async () => {
    const { demo } = store()
    await demo.install()
    analysePlan.mockRejectedValueOnce(new Error('the engine died'))
    await expect(demo.run(detail(), null, SETTINGS)).rejects.toThrow('the engine died')
    expect(demo.getSnapshot().activeRun).toBeNull()
  })
})
