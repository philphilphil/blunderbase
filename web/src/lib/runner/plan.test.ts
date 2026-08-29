import { describe, expect, it, vi } from 'vitest'

import {
  analysePlan,
  isChess960,
  maiaPlies,
  PlanRefused,
  policyRows,
  replay,
  rootPosition,
  terminalScore,
} from './plan'
import type { RunPlan } from './protocol'
import type { AnalysisResult, Searcher } from './search'

/**
 * The port is checked against the Python, not against itself.
 *
 * Every row below was produced by running the same plan and the same canned engine answers
 * through `backend/services/analysis.analyse_plan` and printing `protocol.encode_evals`.
 * That is the only assertion worth making here: a browser tab's rows are stored in the same
 * table as a Python host's, and nothing downstream can tell them apart, so the two have to
 * agree to the last decimal of `win_loss`.
 *
 * The game is the fool's mate, which buys a checkmate in four plies — so the last position
 * is scored by `terminalScore` and the engine is never asked about it.
 */
const PLAN: RunPlan = {
  run_id: 7,
  tier: 'quick',
  game_id: 3,
  fen: null,
  variant: 'standard',
  initial_fen: null,
  moves_uci: ['f2f3', 'e7e5', 'g2g4', 'd8h4'],
  moves_san: ['f3', 'e5', 'g4', 'Qh4#'],
  position_ids: [10, 11, 12, 13, 14],
  ply_start: 0,
  ply_end: 4,
  nodes: 1000,
  depth: null,
  multipv: 1,
  thresholds: { inaccuracy: 5, mistake: 10, blunder: 20 },
  owner_color: 'white',
  owner_rating: 1700,
  maia_target_elo: 1700,
  maia_elos: [1500, 1900],
  maia_only: false,
  maia: true,
  maia_both_sides: true,
}

/** What the fake engine answers, ply by ply, already in White's frame. */
const ANSWERS: AnalysisResult[] = [
  { score: white(35), depth: 12, nodes: 1000, candidates: [line(35, ['e2e4', 'e7e5', 'g1f3'])] },
  { score: white(40), depth: 12, nodes: 1000, candidates: [line(40, ['e7e5', 'e2e4'])] },
  { score: white(150), depth: 12, nodes: 1000, candidates: [line(150, ['e2e4', 'd7d5'])] },
  { score: white(-300), depth: 12, nodes: 1000, candidates: [line(-300, ['d8h4'])] },
]

function white(cp: number) {
  return { cp, mateIn: null, foldedCp: cp }
}

function line(cp: number, pv: string[]) {
  return { rank: 1, uci: pv[0], score: white(cp), pv }
}

function fakeEngine(answers = ANSWERS) {
  const seen: string[] = []
  const searcher: Searcher = {
    analyse: (fen) => {
      const answer = answers[seen.length]
      seen.push(fen)
      if (!answer) throw new Error(`the engine was asked one position too many: ${fen}`)
      return Promise.resolve(answer)
    },
  }
  return { searcher, seen }
}

describe('analysePlan', () => {
  it('produces exactly the rows the Python produces for the same plan', async () => {
    const { searcher, seen } = fakeEngine()
    const rows = await analysePlan(PLAN, searcher)

    // Five positions, four of them searched: the mated one is never asked about.
    expect(seen).toHaveLength(4)
    expect(rows).toEqual([
      {
        ply: 0,
        position_id: 10,
        move_uci: 'f2f3',
        move_san: 'f3',
        eval_before_cp: 35,
        eval_before_mate: null,
        eval_after_cp: 40,
        eval_after_mate: null,
        win_before: 53.22,
        win_after: 53.68,
        win_loss: 0,
        best_move_uci: 'e2e4',
        best_lines: [{ multipv: 1, cp: 35, mate: null, pv: ['e2e4', 'e7e5', 'g1f3'] }],
        maia_policy: null,
        classification: 'good',
      },
      {
        ply: 1,
        position_id: 11,
        move_uci: 'e7e5',
        move_san: 'e5',
        eval_before_cp: -40,
        eval_before_mate: null,
        eval_after_cp: -150,
        eval_after_mate: null,
        win_before: 46.32,
        win_after: 36.53,
        win_loss: 9.79,
        best_move_uci: 'e7e5',
        best_lines: [{ multipv: 1, cp: 40, mate: null, pv: ['e7e5', 'e2e4'] }],
        maia_policy: null,
        classification: 'best',
      },
      {
        ply: 2,
        position_id: 12,
        move_uci: 'g2g4',
        move_san: 'g4',
        eval_before_cp: 150,
        eval_before_mate: null,
        eval_after_cp: -300,
        eval_after_mate: null,
        win_before: 63.47,
        win_after: 24.89,
        win_loss: 38.58,
        best_move_uci: 'e2e4',
        best_lines: [{ multipv: 1, cp: 150, mate: null, pv: ['e2e4', 'd7d5'] }],
        maia_policy: null,
        classification: 'blunder',
      },
      {
        ply: 3,
        position_id: 13,
        move_uci: 'd8h4',
        move_san: 'Qh4#',
        eval_before_cp: 300,
        eval_before_mate: null,
        // The mate White has been given: `mate 0` cannot carry the sign, so the folded
        // ±MATE_SCORE goes into `cp` — from the mover's side, +10000.
        eval_after_cp: 10000,
        eval_after_mate: 0,
        win_before: 75.11,
        win_after: 99.96,
        win_loss: 0,
        best_move_uci: 'd8h4',
        // Candidate scores stay in White's frame while `eval_before_cp` is the mover's.
        best_lines: [{ multipv: 1, cp: -300, mate: null, pv: ['d8h4'] }],
        maia_policy: null,
        classification: 'best',
      },
    ])
  })

  it('reports progress on the last position even when there are fewer than eight', async () => {
    const { searcher } = fakeEngine()
    const progress = vi.fn()
    await analysePlan(PLAN, searcher, { progress })
    expect(progress).toHaveBeenCalledTimes(1)
    expect(progress).toHaveBeenCalledWith(5, 5)
  })

  it('refuses a Maia-only plan rather than storing empty carrier rows', async () => {
    const { searcher, seen } = fakeEngine()
    const refusal = await analysePlan({ ...PLAN, maia_only: true }, searcher).catch(
      (cause: unknown) => cause,
    )
    expect(refusal).toBeInstanceOf(PlanRefused)
    expect((refusal as PlanRefused).retry).toBe(false)
    expect((refusal as PlanRefused).message).toContain('human-move model')
    expect(seen).toHaveLength(0)
  })

  it('scores a run over a bare position with no move to judge', async () => {
    const position: RunPlan = {
      ...PLAN,
      game_id: null,
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      position_ids: [99],
      ply_start: 4,
      ply_end: 4,
      moves_uci: [],
      moves_san: [],
    }
    const rows = await analysePlan(position, fakeEngine().searcher)
    expect(rows).toEqual([
      {
        ply: 4,
        position_id: 99,
        move_uci: null,
        move_san: null,
        eval_before_cp: 35,
        eval_before_mate: null,
        eval_after_cp: null,
        eval_after_mate: null,
        win_before: 53.22,
        win_after: null,
        win_loss: null,
        best_move_uci: 'e2e4',
        best_lines: [{ multipv: 1, cp: 35, mate: null, pv: ['e2e4', 'e7e5', 'g1f3'] }],
        maia_policy: null,
        classification: null,
      },
    ])
  })

  it('stops between positions when the run is abandoned', async () => {
    const controller = new AbortController()
    controller.abort()
    const { searcher, seen } = fakeEngine()
    await expect(analysePlan(PLAN, searcher, { signal: controller.signal })).rejects.toThrow(
      'abandoned',
    )
    expect(seen).toHaveLength(0)
  })
})

describe('terminalScore', () => {
  it('names a checkmate from White’s point of view', () => {
    const mated = replay(PLAN).get(4)
    expect(mated).toBeDefined()
    // White is to move and has been mated.
    expect(terminalScore(mated!)).toEqual({ cp: null, mateIn: 0, foldedCp: -10000 })
  })

  it('is silent about a position the engine still has to judge', () => {
    expect(terminalScore(replay(PLAN).get(0)!)).toBeNull()
  })
})

describe('isChess960', () => {
  it('reads the variant name the importer writes', () => {
    const root = rootPosition(PLAN)
    expect(isChess960(PLAN, root)).toBe(false)
    expect(isChess960({ ...PLAN, variant: 'Chess960' }, root)).toBe(true)
    expect(isChess960({ ...PLAN, variant: 'fischerandom' }, root)).toBe(true)
  })

  it('turns itself on for castling rights a standard game could not have', () => {
    const shuffled: RunPlan = {
      ...PLAN,
      initial_fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBKQBNR w KQkq - 0 1',
      moves_uci: [],
      moves_san: [],
      ply_end: 0,
    }
    expect(isChess960(shuffled, rootPosition(shuffled))).toBe(true)
  })

  it('reads the root, not the window: a mid-game board has spent its castling rights', () => {
    // The board this run actually evaluates first is ply 4, where nobody may castle.
    const windowed: RunPlan = { ...PLAN, ply_start: 2, ply_end: 4 }
    expect(rootPosition(windowed)?.castles.castlingRights.size()).toBe(4)
  })
})

describe('maiaPlies and policyRows', () => {
  it('asks about every ply when the pass covers both sides', () => {
    expect(maiaPlies(PLAN)).toEqual([0, 1, 2, 3])
  })

  it('asks only about the owner’s own moves otherwise', () => {
    expect(maiaPlies({ ...PLAN, maia_both_sides: false })).toEqual([0, 2])
    expect(maiaPlies({ ...PLAN, maia_both_sides: false, owner_color: 'black' })).toEqual([1, 3])
  })

  it('builds carrier rows with a move and no evaluation', () => {
    const rows = policyRows(PLAN)
    expect(rows).toHaveLength(4)
    expect(rows[0]).toMatchObject({
      ply: 0,
      position_id: 10,
      move_uci: 'f2f3',
      move_san: 'f3',
      eval_before_cp: null,
      win_before: null,
      classification: null,
    })
  })
})
