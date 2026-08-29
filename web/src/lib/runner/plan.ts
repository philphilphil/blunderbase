/**
 * `services/analysis.py: analyse_plan` and everything it leans on, ported.
 *
 * This is the file that justifies the whole feature, and the one with the least room to
 * improvise. The architecture rule is that a blunder is defined once, in `services/`; a
 * runner does not get its own definition merely because it happens to be a browser tab.
 * The Python runner keeps that promise by *importing* `analyse_plan`. A tab cannot, so the
 * next best thing is a transcription: same order of operations, same constants, same
 * rounding, same treatment of a terminal position, same rows out. Anything cleverer here
 * would be a second opinion about what a mistake is, stored under the same schema.
 *
 * What is deliberately not ported: the Maia pass. A browser tab advertises one wasm
 * Stockfish and no `maia` engine, so `maia_engine_for_host` finds nothing for this runner
 * and a dispatch never carries one. `policyRows` is here anyway because a `maia_only` plan
 * still has to be *answered* — see `analysePlan` for what it answers with and why.
 */
import { makeFen } from 'chessops/fen'

import type { Classification } from '@/lib/api/types'
import { winPercent } from '@/lib/chess/evaluation'

import { CHESS960_VARIANTS, hasChess960CastlingRights, isBest, positionFrom, readUci } from './board'
import type { MoveEvalPayload, RunPlan, Thresholds } from './protocol'
import {
  MATE_SCORE,
  asLine,
  pov,
  storedCp,
  type AnalysisResult,
  type Score,
  type Searcher,
} from './search'

import type { Chess } from 'chessops/chess'

/** `analysis.PROGRESS_EVERY`: how often the search says where it has got to. */
export const PROGRESS_EVERY = 8

export type Progress = (done: number, total: number) => void

export interface PlanRunOptions {
  progress?: Progress
  /** Aborted when the run is cancelled or the tab lets go of it. */
  signal?: AbortSignal
}

/** A run this tab stopped working on. Never reported: the server already knows. */
export class RunAbandoned extends Error {
  constructor() {
    super('the run was abandoned')
    this.name = 'RunAbandoned'
  }
}

/**
 * A plan this runner cannot honour at all, however many times it is handed one.
 *
 * `retry` mirrors what the local worker does with the same plan, because a run bounced
 * between hosts that all refuse it is a run that fails twice as slowly.
 */
export class PlanRefused extends Error {
  readonly retry: boolean

  constructor(message: string, retry: boolean) {
    super(message)
    this.name = 'PlanRefused'
    this.retry = retry
  }
}

/** A run over a bare FEN: one position, no move to judge. */
export function isPositionRun(plan: RunPlan): boolean {
  return plan.game_id === null
}

/** The positions this plan evaluates — one more than the moves it classifies. */
export function positionsOf(plan: RunPlan): number[] {
  if (isPositionRun(plan)) return [0]
  return range(plan.ply_start, plan.ply_end + 1)
}

/** The moves this plan classifies. */
export function pliesOf(plan: RunPlan): number[] {
  return range(plan.ply_start, plan.ply_end)
}

/**
 * `RunPlan.maia_plies`: every ply, or only the ones the owner moved in. A run whose game
 * names no owner asks about everything, because there is no colour to filter on.
 */
export function maiaPlies(plan: RunPlan): number[] {
  if (isPositionRun(plan)) return [plan.ply_start]
  if (plan.maia_both_sides || plan.owner_color === null) return pliesOf(plan)
  const white = plan.owner_color === 'white'
  return pliesOf(plan).filter((ply) => (ply % 2 === 0) === white)
}

/**
 * Every position this plan needs, keyed by ply.
 *
 * The moves before `ply_start` are still replayed — a ply range narrows what is evaluated,
 * not what has to be walked to get there. A move that will not replay ends the walk, which
 * is gentler than the Python's `parse_uci` raising: the rows for the plies that were
 * reached are still worth storing, and `analysePlan`'s own filter drops the rest.
 */
export function replay(plan: RunPlan): Map<number, Chess> {
  const boards = new Map<number, Chess>()
  const board = rootPosition(plan)
  if (!board) return boards
  if (isPositionRun(plan)) {
    boards.set(0, board)
    return boards
  }

  const wanted = positionsOf(plan)
  const first = wanted[0]
  const last = wanted[wanted.length - 1]
  for (let ply = 0; ply <= last; ply += 1) {
    if (ply >= first) boards.set(ply, board.clone())
    if (ply >= last || ply >= plan.moves_uci.length) break
    const uci = plan.moves_uci[ply]
    const move = uci === undefined ? null : readUci(board, uci)
    if (!move) break
    board.play(move)
  }
  return boards
}

/**
 * The position a game's moves start from — `analysis.replay`'s own first board.
 *
 * Its own function because it is not `boards.get(ply_start)`: a windowed run's first
 * *evaluated* board is somewhere in the middle of the game, and by then castling rights
 * have usually been spent. `isChess960` reads the root and only the root, which is what the
 * Python does and the only reading that survives a ply range.
 */
export function rootPosition(plan: RunPlan): Chess | null {
  // `or`, not `??`: an empty string is what `analysis.replay` reads as "no initial FEN",
  // and it reaches here as one whenever the game was stored without a setup position.
  if (isPositionRun(plan)) return positionFrom(plan.fen || START_FEN)
  return positionFrom(plan.initial_fen || START_FEN)
}

/**
 * Whether this plan's moves are spelled king-takes-rook.
 *
 * `analysis.replay`: the variant name, or — for a Chess960 game imported under a variant
 * nobody wrote down — castling rights the standard game could not have. Read off the root
 * position, never off a later one.
 */
export function isChess960(plan: RunPlan, root: Chess | null): boolean {
  // A position run is a bare FEN, and `analysis.replay` builds it as a standard board.
  if (isPositionRun(plan)) return false
  if (CHESS960_VARIANTS.has(plan.variant.toLowerCase())) return true
  return root !== null && hasChess960CastlingRights(root)
}

/** `analysis.terminal_score`: the score of a finished position, which no engine can give. */
export function terminalScore(position: Chess): Score | null {
  if (position.isCheckmate()) {
    // The side to move is the one that has been mated, so White's score is -MATE when it
    // is White's turn and +MATE when it is Black's.
    const folded = position.turn === 'white' ? -MATE_SCORE : MATE_SCORE
    return { cp: null, mateIn: 0, foldedCp: folded }
  }
  if (position.isStalemate() || position.isInsufficientMaterial()) {
    return { cp: 0, mateIn: null, foldedCp: 0 }
  }
  return null
}

/** `analysis.classify_move`. Playing the engine's own first choice is checked first. */
export function classifyMove(
  winLoss: number,
  playedBest: boolean,
  thresholds: Thresholds,
): Classification {
  if (playedBest) return 'best'
  if (winLoss >= thresholds.blunder) return 'blunder'
  if (winLoss >= thresholds.mistake) return 'mistake'
  if (winLoss >= thresholds.inaccuracy) return 'inaccuracy'
  return 'good'
}

/**
 * Evaluate every position of a plan and turn it into unattached `MoveEval` payloads.
 *
 * A `maia_only` plan is refused rather than answered. It is a fill pass whose whole
 * content is the human-move levels it adds, and this runner has no Maia to ask — so the
 * rows it could produce are empty carriers, and storing them would mark the fill run
 * *done* with nothing filled in and no later pass to correct it (`merge_run_evals` reads a
 * row with no evaluation and no policy as saying nothing at all). `workers/analysis_queue`
 * meets exactly this case on a host with no model and raises, which `fail_run` turns into
 * a failure with no retry; this does the same, in the same words, for the same reason —
 * and no retry rather than a retry because the run is pinned to *this* runner's engine, so
 * a second attempt is this same tab refusing again.
 */
export async function analysePlan(
  plan: RunPlan,
  searcher: Searcher,
  options: PlanRunOptions = {},
): Promise<MoveEvalPayload[]> {
  if (plan.maia_only) {
    throw new PlanRefused(
      'this pass asks the human-move model and nothing else, and a browser tab has no ' +
        'Maia to ask',
      false,
    )
  }

  const { progress, signal } = options
  const boards = replay(plan)
  const chess960 = isChess960(plan, rootPosition(plan))
  const limit = { nodes: plan.nodes, depth: plan.depth }
  const wanted = positionsOf(plan)
  const scores = new Map<number, Score>()
  const results = new Map<number, AnalysisResult>()

  let done = 0
  for (const ply of wanted) {
    stopIfAbandoned(signal)
    done += 1
    const board = boards.get(ply)
    if (board) {
      const terminal = terminalScore(board)
      if (terminal) {
        scores.set(ply, terminal)
      } else {
        const result = await searcher.analyse(makeFen(board.toSetup()), limit, {
          multipv: plan.multipv,
          chess960,
        })
        scores.set(ply, result.score)
        results.set(ply, result)
      }
    }
    if (progress && (done % PROGRESS_EVERY === 0 || done === wanted.length)) {
      progress(done, wanted.length)
    }
  }
  stopIfAbandoned(signal)

  if (isPositionRun(plan)) {
    const board = boards.get(0)
    const score = scores.get(0)
    if (!board || !score) throw new PlanRefused('the position of this run does not parse', false)
    return [positionRow(plan, board, score, results.get(0))]
  }
  return pliesOf(plan)
    .filter((ply) => scores.has(ply) && scores.has(ply + 1) && boards.has(ply))
    .map((ply) => moveRow(plan, ply, boards.get(ply)!, scores, results.get(ply)))
}

/**
 * `analysis.policy_rows`: the carrier rows a Maia-only pass fills in — one per ply it asks
 * about, and no evaluation. Exported for completeness of the port and used by nothing
 * here; see `analysePlan` for why this runner refuses such a plan instead.
 */
export function policyRows(plan: RunPlan): MoveEvalPayload[] {
  const boards = replay(plan)
  return maiaPlies(plan)
    .filter((ply) => boards.has(ply))
    .map((ply) => ({
      ...emptyRow(ply),
      position_id: plan.position_ids[ply] ?? null,
      move_uci: plan.moves_uci[ply] ?? null,
      move_san: plan.moves_san[ply] ?? null,
    }))
}

// --- the two row shapes ----------------------------------------------------

function positionRow(
  plan: RunPlan,
  board: Chess,
  score: Score,
  result: AnalysisResult | undefined,
): MoveEvalPayload {
  const before = pov(score, board.turn)
  const best = result?.candidates[0]
  return {
    ...emptyRow(plan.ply_start),
    position_id: plan.position_ids.length > 0 ? (plan.position_ids[0] ?? null) : null,
    eval_before_cp: storedCp(before),
    eval_before_mate: before.mateIn,
    win_before: winPercent({ cp: storedCp(before), mate: before.mateIn }),
    best_move_uci: best ? best.uci : null,
    best_lines: result ? result.candidates.map(asLine) : null,
  }
}

function moveRow(
  plan: RunPlan,
  ply: number,
  board: Chess,
  scores: Map<number, Score>,
  result: AnalysisResult | undefined,
): MoveEvalPayload {
  const before = pov(scores.get(ply)!, board.turn)
  // The score after the move is White's; flipped into the mover's frame so that "before"
  // and "after" are two readings of the same dial.
  const after = pov(scores.get(ply + 1)!, board.turn)
  const beforeCp = storedCp(before)
  const afterCp = storedCp(after)
  const winBefore = winPercent({ cp: beforeCp, mate: before.mateIn })
  const winAfter = winPercent({ cp: afterCp, mate: after.mateIn })
  const winLoss = round2(Math.max(0, winBefore - winAfter))

  const played = plan.moves_uci[ply]
  const best = result?.candidates[0]
  return {
    ...emptyRow(ply),
    position_id: plan.position_ids[ply] ?? null,
    move_uci: played ?? null,
    move_san: plan.moves_san[ply] ?? null,
    eval_before_cp: beforeCp,
    eval_before_mate: before.mateIn,
    eval_after_cp: afterCp,
    eval_after_mate: after.mateIn,
    win_before: winBefore,
    win_after: winAfter,
    win_loss: winLoss,
    classification: classifyMove(
      winLoss,
      isBest(board, played ?? '', best ? best.uci : null),
      plan.thresholds,
    ),
    best_move_uci: best ? best.uci : null,
    best_lines: result ? result.candidates.map(asLine) : null,
  }
}

/**
 * Every column of a `MoveEval` unset. `decode_eval` reads a missing field as None, so
 * spelling them all out is the same row the Python builds — and it is one place rather
 * than two to check the payload against `protocol.EVAL_FIELDS`.
 */
function emptyRow(ply: number): MoveEvalPayload {
  return {
    ply,
    position_id: null,
    move_uci: null,
    move_san: null,
    eval_before_cp: null,
    eval_before_mate: null,
    eval_after_cp: null,
    eval_after_mate: null,
    win_before: null,
    win_after: null,
    win_loss: null,
    best_move_uci: null,
    best_lines: null,
    maia_policy: null,
    classification: null,
  }
}

// --- odds and ends ---------------------------------------------------------

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

function stopIfAbandoned(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new RunAbandoned()
}

function range(start: number, stop: number): number[] {
  const values: number[] = []
  for (let value = start; value < stop; value += 1) values.push(value)
  return values
}

/** `analysis.win_percent` rounds to two places; so does the loss derived from two of them. */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}
