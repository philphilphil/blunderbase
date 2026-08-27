/**
 * What the live-analysis panel derives from one `stream.snapshot` frame, as pure functions.
 *
 * One convention the backend fixes and this module undoes: a snapshot line's `cp`/`mate` is
 * from the **side to move**'s point of view (contracts §1.3 — `adapters/infinite.py` flips
 * every score with `.pov(board.turn)` before it goes on the wire). Everything the app draws
 * is White-relative: the eval graph, the move list, and `MaiaPanel`'s engine column — whose
 * lines are `MoveEval.best_lines`, which `adapters/stockfish.py` writes in White's frame and
 * nothing flips. The live panel shares the move-list column with that box on the game page,
 * so a snapshot kept in the engine's frame would have the two of them print opposite signs
 * for the same position and the same engine on every Black-to-move ply. `snapshotFrom`
 * therefore flips the lines into White's frame, using the frame's *own* FEN to decide.
 */
import { Chess, normalizeMove } from 'chessops/chess'
import { parseFen } from 'chessops/fen'
import { makeSanAndPlay } from 'chessops/san'
import { parseUci } from 'chessops/util'

import { formatNodes } from '@/lib/chess/evaluation'
import type { StreamSnapshotEvent } from '@/lib/events/types'
import type { StreamLine } from '@/lib/api/types'

/** A snapshot, camel-cased, with its lines in White's frame. Nothing else is derived here. */
export interface StreamSnapshot {
  sessionId: string
  seq: number
  engineId: number
  engine: string
  runnerId: number | null
  fen: string
  multipv: number
  depth: number | null
  nodes: number | null
  nps: number | null
  timeMs: number | null
  lines: StreamLine[]
  at: string
}

/**
 * A UCI variation as SAN, played out from `fen`. Stops at the first move the position
 * rejects, so a PV that runs past what we can replay shows what it can.
 *
 * A FEN that will not parse gives `[]` rather than throwing: an analysis board sitting on
 * an unusual position must degrade to the raw UCI text, never blank the page.
 */
export function sanLine(fen: string, pv: string[], limit = 8): string[] {
  const setup = parseFen(fen)
  if (setup.isErr) return []
  const position = Chess.fromSetup(setup.value)
  if (position.isErr) return []

  const board = position.value
  const sans: string[] = []
  for (const uci of pv.slice(0, limit)) {
    const parsed = parseUci(uci)
    if (!parsed) break
    const move = normalizeMove(board, parsed)
    if (!board.isLegal(move)) break
    sans.push(makeSanAndPlay(board, move))
  }
  return sans
}

/**
 * `24…Rfe8 25.b3 h6` — the same numbering `gameModel.formatVariation` uses. A position
 * with no ply behind it (a bare FEN on the live board) is numbered from move 1.
 */
export function formatVariation(ply: number | null | undefined, sans: string[]): string {
  const start = typeof ply === 'number' && ply >= 0 ? ply : 0
  return sans
    .map((san, offset) => {
      const at = start + offset
      if (at % 2 === 0) return `${Math.floor(at / 2) + 1}.${san}`
      return offset === 0 ? `${Math.floor(at / 2) + 1}…${san}` : san
    })
    .join(' ')
}

/**
 * One line in White's frame. `mate` is 0 both for "has mated" and for "is mated", so the
 * sign of that pair lives in `cp` — negating both keeps them saying the same thing.
 */
function whiteRelative(line: StreamLine): StreamLine {
  return {
    ...line,
    cp: line.cp === null || line.cp === undefined ? line.cp : -line.cp,
    mate: line.mate === null || line.mate === undefined ? line.mate : -line.mate,
  }
}

/** The frame as the hook keeps it: camel case, and the lines in White's frame. */
export function snapshotFrom(event: StreamSnapshotEvent): StreamSnapshot {
  const blackToMove = event.fen.split(/\s+/)[1] === 'b'
  return {
    sessionId: event.session_id,
    seq: event.seq,
    engineId: event.engine_id,
    engine: event.engine,
    runnerId: event.runner_id ?? null,
    fen: event.fen,
    multipv: event.multipv,
    depth: event.depth ?? null,
    nodes: event.nodes ?? null,
    nps: event.nps ?? null,
    timeMs: event.time_ms ?? null,
    lines: blackToMove ? (event.lines ?? []).map(whiteRelative) : (event.lines ?? []),
    at: event.at,
  }
}

/** `1840211` -> `1.8M/s`, in the same units the node counts are written in. */
export function formatNps(nps: number | null | undefined): string {
  if (nps === null || nps === undefined) return '—'
  return `${formatNodes(nps)}/s`
}
