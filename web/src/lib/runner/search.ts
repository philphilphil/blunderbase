/**
 * What a search is asked for, what it answers with, and the one piece of arithmetic the
 * two halves of Blunderbase are not allowed to disagree about: whose side a score is
 * written from.
 *
 * This file holds no engine and no chessboard on purpose. `engine.ts` produces these
 * values out of UCI text and `plan.ts` turns them into stored rows, and neither has to
 * import the other to agree on the vocabulary — the same separation `adapters/stockfish.py`
 * draws between its `Score`/`Candidate`/`AnalysisResult` dataclasses and the adapter that
 * fills them in.
 *
 * The score model is `adapters/stockfish.py: Score`, ported field for field. An engine
 * reports from the side to move; the schema stores White's; and a delivered mate reports
 * `mate 0` for both "has mated" and "is mated", so the sign of that one case lives in
 * `foldedCp` and nowhere else. Getting this wrong does not crash anything — it silently
 * writes the wrong sign onto half the plies of every game a browser tab analyses.
 */
import type { Color } from 'chessops/types'

/** A mate folded onto the centipawn scale, so one integer can order every evaluation. */
export const MATE_SCORE = 10_000

/**
 * How much of a principal variation is kept. `adapters/stockfish.py: PV_PLIES` — long
 * enough for the engine-lines panel, short enough that a multi-PV run does not bloat one
 * `MoveEval` row.
 */
export const PV_PLIES = 12

/** An evaluation from White's point of view, as the schema stores it. */
export interface Score {
  cp: number | null
  mateIn: number | null
  foldedCp: number
}

/** One principal variation of one analysis, ranked as the engine ranked it. */
export interface Candidate {
  rank: number
  uci: string
  score: Score
  pv: string[]
}

export interface AnalysisResult {
  score: Score
  depth: number | null
  nodes: number | null
  candidates: Candidate[]
}

/** The shape `MoveEval.best_lines` stores — `Candidate.as_line()`. */
export interface BestLine {
  multipv: number
  cp: number | null
  mate: number | null
  pv: string[]
}

/**
 * One throttled picture of a running search — `adapters/infinite.py: Snapshot`.
 *
 * `lines` are `BestLine`s like any other, with one difference that is the whole point of
 * an analysis board: they are written **from the side to move's** point of view rather
 * than White's, because a board shows "who is better here" from the mover's chair.
 * `snapshots.ts` is the only place that turn is made.
 */
export interface SearchSnapshot {
  depth: number | null
  nodes: number | null
  nps: number | null
  timeMs: number | null
  lines: BestLine[]
}

/** `chess.engine.Limit(nodes=…, depth=…)`, which is all a plan ever asks for. */
export interface SearchLimit {
  nodes: number
  depth: number | null
}

export interface SearchOptions {
  multipv: number
  /**
   * Whether castling is spelled king-takes-rook. python-chess sets `UCI_Chess960` per
   * search from the board, which is exactly why the option is *managed* and must never be
   * advertised as a stored one.
   */
  chess960: boolean
}

/**
 * The little of an engine `analysePlan` uses. A test supplies its own, and nothing in the
 * plan port ever loads a WebAssembly module.
 */
export interface Searcher {
  analyse(fen: string, limit: SearchLimit, options: SearchOptions): Promise<AnalysisResult>
}

/**
 * `Mate(n).score(mate_score=MATE_SCORE)`. `Mate(0)` is "is mated" and folds to -MATE;
 * python-chess's `MateGiven` is the other reading of the same number and never reaches
 * here, because a delivered mate is answered by `terminalScore` rather than by a search.
 */
export function foldMate(mate: number): number {
  return mate > 0 ? MATE_SCORE - mate : -MATE_SCORE - mate
}

/** One score as the engine gave it — from the side to move — turned into White's. */
export function whiteScore(cp: number | null, mate: number | null, turn: Color): Score {
  const folded = cp !== null ? cp : mate !== null ? foldMate(mate) : 0
  const mover: Score = { cp, mateIn: mate, foldedCp: folded }
  return turn === 'white' ? mover : flip(mover)
}

/** `Score.pov`: White's reading of the dial, turned to face `color`. */
export function pov(score: Score, color: Color): Score {
  return color === 'white' ? score : flip(score)
}

function flip(score: Score): Score {
  return {
    cp: negate(score.cp),
    mateIn: negate(score.mateIn),
    foldedCp: negate(score.foldedCp) ?? 0,
  }
}

/**
 * `-x`, with `-0` folded back to `0`.
 *
 * Python has one zero and JavaScript has two, and the difference is not academic here:
 * `mate 0` is the value that says "a mate has been delivered", so flipping it into the
 * other side's frame is the *common* case, not a corner. It serialises as `0` either way,
 * but a `-0` in memory compares unequal to the `0` every reader expects.
 */
function negate(value: number | null): number | null {
  if (value === null) return null
  return value === 0 ? 0 : -value
}

/**
 * `cp` as the schema stores it, with a delivered mate folded into it.
 *
 * `Score.stored_cp`: `mate_in = 0` cannot carry the sign of "was mated" against "has
 * mated", so the folded ±MATE_SCORE goes into `cp` in that one case and the pair stays
 * unambiguous.
 */
export function storedCp(score: Score): number | null {
  if (score.cp !== null || score.mateIn !== 0) return score.cp
  return score.foldedCp
}

/** `Candidate.as_line()`. */
export function asLine(candidate: Candidate): BestLine {
  return {
    multipv: candidate.rank,
    cp: storedCp(candidate.score),
    mate: candidate.score.mateIn,
    pv: [...candidate.pv],
  }
}
