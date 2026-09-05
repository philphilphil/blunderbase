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

import { DemoAnalysis, demoPlan, DEMO_ENGINE_ID } from './analysis'

const analysePlan = vi.hoisted(() => vi.fn())
vi.mock('@/lib/runner/plan', async (original) => ({
  ...(await original<typeof import('@/lib/runner/plan')>()),
  analysePlan,
}))

const SETTINGS = {
  quick_nodes: 300_000,
  deep_nodes: 4_000_000,
  deep_multipv: 5,
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
  it('spends the deployment’s own quick budget on one line', () => {
    const plan = demoPlan(detail(), 'quick', SETTINGS, -1)
    expect([plan.nodes, plan.multipv]).toEqual([300_000, 1])
    expect(plan.moves_uci).toEqual(['e2e4', 'c7c5'])
    expect([plan.ply_start, plan.ply_end]).toEqual([0, 2])
  })

  it('spends the deep budget across the configured lines, and never asks for Maia', () => {
    const plan = demoPlan(detail(), 'deep', SETTINGS, -2)
    expect([plan.nodes, plan.multipv]).toEqual([4_000_000, 5])
    expect([plan.maia, plan.maia_only, plan.maia_elos]).toEqual([false, false, []])
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
    await demo.run(before, 'quick', SETTINGS)

    const state = demo.getSnapshot()
    expect(state.activeRun).toBeNull()
    expect(state.progress).toBeNull()
    const result = state.results.get(12)!
    expect(result.moves.map((move) => move.win_loss)).toEqual([2, 2])
    expect(result.moves.map((move) => move.san)).toEqual(['e4', 'c5'])
    expect(result.runs).toHaveLength(1)
    expect(result.runs[0]).toMatchObject({ tier: 'quick', status: 'done', engine_kind: 'uci' })
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
    await demo.run(detail(), 'deep', SETTINGS)
    expect(seen!.activeRun).toMatchObject({
      game_id: 12, tier: 'deep', status: 'running', engine_id: DEMO_ENGINE_ID, multipv: 5,
    })
    expect(seen!.progress).toEqual({ done: 1, total: 2 })
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
    await demo.run(detail(), 'quick', SETTINGS)

    expect(running.stopSearch).toHaveBeenCalled()
    expect(demo.getSnapshot().results.has(12)).toBe(false)
    expect(demo.getSnapshot().activeRun).toBeNull()
  })

  it('refuses a game it cannot replay rather than answering about the wrong position', async () => {
    const { demo } = store()
    await demo.install()
    const chess960 = detail()
    ;(chess960.game as { variant: string }).variant = 'chess960'
    await expect(demo.run(chess960, 'quick', SETTINGS)).rejects.toThrow('chess960')
    expect(analysePlan).not.toHaveBeenCalled()
    expect(demo.getSnapshot().activeRun).toBeNull()
  })

  it('lets a real failure through rather than losing it', async () => {
    const { demo } = store()
    await demo.install()
    analysePlan.mockRejectedValueOnce(new Error('the engine died'))
    await expect(demo.run(detail(), 'quick', SETTINGS)).rejects.toThrow('the engine died')
    expect(demo.getSnapshot().activeRun).toBeNull()
  })
})
