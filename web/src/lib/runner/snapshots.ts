/**
 * `adapters/infinite.py: SnapshotBuffer` in a browser: `info` lines in, throttled pictures
 * of a running search out.
 *
 * The rest of this module answers a bounded question — search this position to N nodes and
 * tell me what you found. An analysis board asks the opposite: keep searching until I stop
 * you, and show me what you have as you go. The three things that shape it are the three
 * the Python's own docstring names, and they matter for the same reasons:
 *
 * - **The merge is as important as the throttle.** A multi-PV engine reports one line at a
 *   time, so the naive thing — one snapshot per `info` — would draw a board whose second
 *   variation belongs to the previous depth. Lines are keyed by their own `multipv` rank
 *   and the whole set goes out together.
 * - **Throttling happens at the producer.** Stockfish emits several `info` lines per depth
 *   and a great many per second; the board wants two pictures a second. Doing it here is
 *   what keeps a tab from putting a megabyte a second onto the runner socket, and it is
 *   what `stream_open`'s `interval_ms` asks for.
 * - **A snapshot speaks `MoveEval.best_lines`' vocabulary, from the mover's chair.**
 *   `{multipv, cp, mate, pv}` — the same shape the database stores and the engine-lines
 *   panel already renders, but from the side to move's point of view rather than White's.
 *   Raw UCI text never leaves this file.
 */
import type { Chess } from 'chessops/chess'

import { truncateLine } from './board'
import {
  PV_PLIES,
  asLine,
  pov,
  whiteScore,
  type BestLine,
  type SearchSnapshot,
} from './search'
import type { InfoLine } from './uci'

/**
 * Two pictures a second — `adapters/infinite.py: SNAPSHOT_INTERVAL`, in the milliseconds
 * `stream_open` speaks. Fast enough that the numbers look alive, slow enough that a deep
 * multi-PV search is not a flood.
 */
export const SNAPSHOT_INTERVAL_MS = 500

/**
 * What tells the throttle how long it has been. `Date.now`, not `performance.now`: the
 * interval is half a second, so the two are equally precise here, and the wall clock is
 * the one the rest of the runner already measures its waits against.
 */
export type Clock = () => number

export interface SnapshotBufferOptions {
  multipv?: number
  intervalMs?: number
  clock?: Clock
  pvPlies?: number
}

export class SnapshotBuffer {
  private readonly position: Chess
  private readonly multipv: number
  private readonly intervalMs: number
  private readonly clock: Clock
  private readonly pvPlies: number
  private readonly lines = new Map<number, BestLine>()

  private depth: number | null = null
  private nodes: number | null = null
  private nps: number | null = null
  private timeMs: number | null = null
  private dirty = false
  /**
   * null until the first snapshot: that one goes out at once, so a board is never blank
   * for half a second before its first evaluation appears.
   */
  private last: number | null = null

  constructor(position: Chess, options: SnapshotBufferOptions = {}) {
    this.position = position
    this.multipv = Math.max(1, Math.trunc(options.multipv ?? 1) || 1)
    this.intervalMs = Math.max(0, options.intervalMs ?? SNAPSHOT_INTERVAL_MS)
    this.clock = options.clock ?? Date.now
    this.pvPlies = options.pvPlies ?? PV_PLIES
  }

  /** Fold one `info` in. A snapshot comes back only when one is due. */
  offer(info: InfoLine): SearchSnapshot | null {
    this.merge(info)
    return this.due()
  }

  /**
   * The merged picture, if something changed and the interval has passed.
   *
   * Called on its own by a caller whose engine has gone quiet: three `info` lines in a
   * burst followed by a long think must still reach the board.
   */
  due(): SearchSnapshot | null {
    if (!this.dirty) return null
    const now = this.clock()
    if (this.last !== null && now - this.last < this.intervalMs) return null
    return this.emit(now)
  }

  /** The merged picture whatever the clock says, or null if nothing is pending. */
  flush(): SearchSnapshot | null {
    if (!this.dirty) return null
    return this.emit(this.clock())
  }

  private emit(now: number): SearchSnapshot {
    this.last = now
    this.dirty = false
    return {
      depth: this.depth,
      nodes: this.nodes,
      nps: this.nps,
      timeMs: this.timeMs,
      lines: [...this.lines.keys()].sort((a, b) => a - b).map((rank) => this.lines.get(rank)!),
    }
  }

  private merge(info: InfoLine): void {
    if (info.depth !== null) {
      this.depth = info.depth
      this.dirty = true
    }
    if (info.nodes !== null) {
      this.nodes = info.nodes
      this.dirty = true
    }
    if (info.nps !== null) {
      this.nps = info.nps
      this.dirty = true
    }
    if (info.timeMs !== null) {
      this.timeMs = info.timeMs
      this.dirty = true
    }
    this.mergeLine(info)
  }

  private mergeLine(info: InfoLine): void {
    const score = info.score
    if (score === null || score.bounded || info.pv === null || info.pv.length === 0) return
    const rank = info.multipv ?? 1
    if (rank < 1 || rank > this.multipv) return
    // Chess960 spelling is deliberately off: a board is drawn from these, never replayed
    // into a stored `best_move_uci`, and `stream_open` carries a FEN with no variant on it.
    const pv = truncateLine(this.position, info.pv, this.pvPlies, false)
    if (pv.length === 0) return
    // Out of White's frame and back into the mover's — the round trip `Score.from_pov(…)
    // .pov(board.turn)` makes, so a delivered mate keeps the sign `storedCp` reads.
    const mover = pov(whiteScore(score.cp, score.mate, this.position.turn), this.position.turn)
    this.lines.set(rank, asLine({ rank, uci: pv[0]!, score: mover, pv }))
    this.dirty = true
  }
}
