/**
 * What a hovered engine line draws on the board, as pure functions.
 *
 * Hovering a PV should say *how the line goes*, not just what its first move is. Five
 * gestures answer different questions (`docs/design/prototypes/line-preview.html` is the
 * design source): the row draws the whole line — layered arrows, a plan overlay, a
 * playthrough or a peek board — and a token in the PV scrubs the board to the position
 * after that move. Which one is a per-device preference, so all of them live here.
 *
 * Everything is a chessground `DrawShape`: chessground 10 already draws arrow badges
 * (`label`), ghost pieces (`piece`, with `scale`), per-shape widths (`modifiers.lineWidth`)
 * and free-form svg, so the preview is one `setAutoShapes` call and no custom layer.
 *
 * The whole module is total. A PV that runs past what the position can replay, a ply that
 * has walked off the end of a line the engine has since shortened, a FEN nothing can parse
 * — each degrades to fewer shapes or none. A preview must never blank the page it decorates.
 */
import type { DrawShape } from '@lichess-org/chessground/draw'
import type { Key } from '@lichess-org/chessground/types'
import { Chess, castlingSide, normalizeMove } from 'chessops/chess'
import { makeFen, parseFen } from 'chessops/fen'
import { makeSanAndPlay } from 'chessops/san'
import { isNormal, type NormalMove, type Role } from 'chessops/types'
import {
  defined,
  kingCastlesTo,
  makeSquare,
  parseSquare,
  parseUci,
  rookCastlesTo,
  squareFile,
  squareFromCoords,
  squareRank,
} from 'chessops/util'

import { formatVariation } from '@/lib/analysis/streamModel'

export type RowPreview = 'arrows' | 'overlay' | 'play' | 'peek' | 'off'

export interface LinePreviewPrefs {
  row: RowPreview
  scrub: boolean
  lookahead: 0 | 1 | 2 | 3 | 4
  depth: number
  badges: boolean
  labels: 'move' | 'ply'
  bySide: boolean
  fade: boolean
  play: { tempo: number; delay: number; loop: boolean; ahead: boolean }
  overlay: { dim: boolean }
}

/** The defaults, exported so the prefs store and the tests share one source. */
export const LINE_PREVIEW_DEFAULTS: LinePreviewPrefs = {
  row: 'arrows',
  scrub: true,
  lookahead: 2,
  depth: 6,
  badges: true,
  labels: 'move',
  bySide: true,
  fade: true,
  play: { tempo: 450, delay: 250, loop: false, ahead: true },
  overlay: { dim: true },
}

/** Which line is pointed at, and how far into it the preview stands. `null` = the row only. */
export interface PreviewState {
  /**
   * The panel's own id for the row (`HoveredLine.line`). Nothing in this module reads it —
   * it is here because a state without it could not say *which* line the ply belongs to,
   * which is the whole of what the hook keys its transients on.
   */
  line: string
  ply: number | null
}

export interface PreviewMove {
  uci: string
  from: string
  to: string
  role: Role
  color: 'white' | 'black'
  san: string
  /** Where a piece was taken, when one was: not always `to` (en passant). */
  captured?: { square: string; role: Role; color: 'white' | 'black' }
  /** The rook's own trip, on a castling move. */
  rook?: { from: string; to: string }
}

export interface LineReplay {
  /** `fens[0]` is the starting position; `fens[k]` is after `moves[k-1]`. */
  fens: string[]
  moves: PreviewMove[]
}

/** Past this the arrows are mush and the FENs are dead weight; engines send far more. */
const MAX_PLIES = 40
const MIN_DEPTH = 1
const MAX_DEPTH = 18
const MAX_LOOKAHEAD = 4
/**
 * One width per brush step, so a shape's `modifiers.lineWidth` thins in step with the
 * brush it fades through. Index 0 is the nearest ply.
 */
const STEP_WIDTHS = [10, 9, 8, 7]
/** The overlay's trails are hairlines: they are the route, not the move. */
const TRAIL_WIDTH = 5
/** A live engine rewrites its PVs several times a second; the memo is bounded for it. */
const CACHE_LIMIT = 64

type Step = 0 | 1 | 2 | 3

/** Every square here comes out of `makeSquare`, so it is one of chessground's own keys. */
const key = (square: string) => square as Key

/**
 * chessops replay of a UCI PV, stopping at the first move the position rejects — the same
 * walk `streamModel.sanLine` does, keeping the positions and the detail the preview draws.
 */
export function replayLine(fen: string, pv: string[]): LineReplay {
  const setup = parseFen(fen)
  if (setup.isErr) return { fens: [fen], moves: [] }
  const position = Chess.fromSetup(setup.value)
  if (position.isErr) return { fens: [fen], moves: [] }

  const board = position.value
  const fens = [makeFen(board.toSetup())]
  const moves: PreviewMove[] = []
  for (const uci of pv.slice(0, MAX_PLIES)) {
    const parsed = parseUci(uci)
    if (!parsed || !isNormal(parsed)) break
    const move = normalizeMove(board, parsed)
    if (!isNormal(move) || !board.isLegal(move)) break
    // The detail is read off the position *before* the move; the SAN plays it.
    const detail = describeMove(board, move, uci)
    const san = makeSanAndPlay(board, move)
    moves.push({ ...detail, san })
    fens.push(makeFen(board.toSetup()))
  }
  return { fens, moves }
}

/**
 * `replayLine` memoised on the position and the line, because the panel and the preview
 * hook both ask for the same replay on every render of a snapshot that has not changed.
 */
const cache = new Map<string, LineReplay>()

export function cachedReplay(fen: string, pv: string[]): LineReplay {
  const id = `${fen}|${pv.join(' ')}`
  const hit = cache.get(id)
  if (hit) return hit
  const replay = replayLine(fen, pv)
  cache.set(id, replay)
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  return replay
}

/**
 * One move, as the preview needs it, read off `board` before the move is played.
 *
 * Two encodings have to be undone. chessops normalises a castling move to "king takes own
 * rook", so `move.to` is the rook's square rather than where the king lands — the drawn
 * arrow wants the king's real trip and the rook's separately. And a pawn capture where the
 * destination is empty is an en passant, whose victim stands beside the mover, not on `to`;
 * an overlay that crossed out the wrong square would be a lie about the position.
 */
function describeMove(board: Chess, move: NormalMove, uci: string): Omit<PreviewMove, 'san'> {
  const color = board.turn
  const role = board.board.getRole(move.from) ?? 'pawn'
  const side = castlingSide(board, move)
  if (side) {
    return {
      uci,
      from: makeSquare(move.from),
      to: makeSquare(kingCastlesTo(color, side)),
      role: 'king',
      color,
      rook: { from: makeSquare(move.to), to: makeSquare(rookCastlesTo(color, side)) },
    }
  }

  const detail: Omit<PreviewMove, 'san'> = {
    uci,
    from: makeSquare(move.from),
    to: makeSquare(move.to),
    role,
    color,
  }
  const target = board.board.get(move.to)
  if (target) {
    detail.captured = { square: makeSquare(move.to), role: target.role, color: target.color }
    return detail
  }
  if (role === 'pawn' && squareFile(move.from) !== squareFile(move.to)) {
    const victim = squareFromCoords(squareFile(move.to), squareRank(move.from))
    const piece = defined(victim) ? board.board.get(victim) : undefined
    if (defined(victim) && piece) {
      detail.captured = { square: makeSquare(victim), role: piece.role, color: piece.color }
    }
  }
  return detail
}

/** The shapes for a preview; `startPly` is the half-move count of `fens[0]` (for numbering). */
export function previewShapes(
  replay: LineReplay,
  prefs: LinePreviewPrefs,
  state: PreviewState,
  startPly: number,
): DrawShape[] {
  const total = replay.moves.length
  if (!total) return []

  // Peek never moves the main board, so it never scrubs it either: the board keeps the one
  // arrow it has always had and the popover carries the line.
  if (prefs.row === 'peek') return [arrowShape(replay, prefs, 1, 0, startPly)]

  if (state.ply === null) {
    if (prefs.row === 'arrows') {
      const depth = Math.min(clampDepth(prefs.depth), total)
      const shapes: DrawShape[] = []
      // Deepest first, so the plies nearest the position paint on top of the tail.
      for (let ply = depth; ply >= 1; ply--) {
        shapes.push(arrowShape(replay, prefs, ply, fadeStep(ply - 1, depth, prefs.fade), startPly))
      }
      return shapes
    }
    if (prefs.row === 'overlay') return overlayShapes(replay, prefs, startPly)
    // `off`, and `play` before its timer has placed the board on a ply.
    return []
  }

  // A ply is pointed at, so the board is showing that position (`previewFen`) and the row
  // mode's own shapes would describe a position that is no longer on the board. What is
  // drawn is what comes next.
  const at = clampPly(state.ply, total)
  if (prefs.row === 'play') {
    if (!prefs.play.ahead || at >= total) return []
    return [arrowShape(replay, prefs, at + 1, 0, startPly)]
  }
  const look = Math.min(clampLookahead(prefs.lookahead), total - at)
  const shapes: DrawShape[] = []
  for (let i = look; i >= 1; i--) {
    shapes.push(arrowShape(replay, prefs, at + i, fadeStep(i - 1, look, prefs.fade), startPly))
  }
  return shapes
}

/**
 * Where the pieces of a line end up, rather than the moves that took them there — the plan
 * instead of the sequence. Each piece that moves within the depth cap gets a ghost on its
 * final square, a hairline trail through the squares it visited, and a cross wherever
 * something was taken. Modelled on the prototype's `ghost` mode.
 */
function overlayShapes(replay: LineReplay, prefs: LinePreviewPrefs, startPly: number): DrawShape[] {
  const depth = Math.min(clampDepth(prefs.depth), replay.moves.length)
  const end = parseFen(replay.fens[depth] ?? '')

  /** Live paths, keyed by the square the piece stands on now. */
  const paths = new Map<string, { squares: string[]; arrival: number; color: 'white' | 'black' }>()
  const walk = (from: string, to: string, ply: number, color: 'white' | 'black') => {
    const path = paths.get(from) ?? { squares: [from], arrival: ply, color }
    path.squares.push(to)
    path.arrival = ply
    path.color = color
    paths.delete(from)
    paths.set(to, path)
  }

  const crosses: DrawShape[] = []
  for (let ply = 1; ply <= depth; ply++) {
    const move = replay.moves[ply - 1]
    if (move.captured) {
      crosses.push(crossShape(move.captured.square))
      // A piece that is taken has no plan left; its ghost and trail go with it.
      paths.delete(move.captured.square)
    }
    walk(move.from, move.to, ply, move.color)
    if (move.rook) walk(move.rook.from, move.rook.to, ply, move.color)
  }

  const trails: DrawShape[] = []
  const ghosts: DrawShape[] = []
  for (const [square, path] of paths) {
    const step = fadeStep(path.arrival - 1, depth, prefs.fade)
    for (let i = 0; i + 1 < path.squares.length; i++) {
      const last = i + 2 === path.squares.length
      const trail: DrawShape = {
        orig: key(path.squares[i]),
        dest: key(path.squares[i + 1]),
        brush: 'previewGhost',
        modifiers: { lineWidth: TRAIL_WIDTH },
        below: true,
      }
      // The badge rides the arriving hop, where it lands beside the ghost. A `piece` shape
      // cannot carry one: chessground renders those as auto-pieces, outside the svg layer
      // that draws labels.
      if (last && prefs.badges) trail.label = { text: badgeText(prefs, path.arrival, startPly) }
      trails.push(trail)
    }
    // The role is read from the end position, so a promoted pawn is a queen where it stands.
    const at = parseSquare(square)
    const piece = end.isErr || !defined(at) ? undefined : end.value.board.get(at)
    if (!piece) continue
    ghosts.push({
      orig: key(square),
      piece: { role: piece.role, color: piece.color, scale: 0.8 },
      brush: previewBrush(prefs.bySide ? path.color : 'white', step),
    })
  }
  // Crosses under the trails, ghosts on top: the plan reads from the pieces down.
  return [...crosses, ...trails, ...ghosts]
}

/** The transient position to show instead of the board's, or null to keep the real one. */
export function previewFen(
  replay: LineReplay,
  prefs: LinePreviewPrefs,
  state: PreviewState,
): string | null {
  const at = scrubPly(replay, prefs, state)
  return at === null ? null : (replay.fens[at] ?? null)
}

/** The move to highlight with that transient position (`["e2","e4"]`), or null. */
export function previewLastMove(
  replay: LineReplay,
  prefs: LinePreviewPrefs,
  state: PreviewState,
): [string, string] | null {
  const at = scrubPly(replay, prefs, state)
  if (at === null) return null
  const move = replay.moves[at - 1]
  return move ? [move.from, move.to] : null
}

/** `after 10.O-O-O` for the hairline label over a scrubbed board; null when the board is real. */
export function previewCaption(
  replay: LineReplay,
  prefs: LinePreviewPrefs,
  state: PreviewState,
  startPly: number,
): string | null {
  const at = scrubPly(replay, prefs, state)
  return at === null ? null : caption(replay, at, startPly)
}

/** The position the peek popover shows: `fens[ply]`, or the depth-capped end of the line. */
export function peekFen(
  replay: LineReplay,
  prefs: LinePreviewPrefs,
  state: PreviewState,
): string | null {
  if (prefs.row !== 'peek') return null
  return replay.fens[peekPly(replay, prefs, state)] ?? null
}

/** Ditto its caption, `after 10.O-O-O`. */
export function peekCaption(
  replay: LineReplay,
  prefs: LinePreviewPrefs,
  state: PreviewState,
  startPly: number,
): string | null {
  if (prefs.row !== 'peek') return null
  return caption(replay, peekPly(replay, prefs, state), startPly)
}

/**
 * The ply the main board stands on, or null when it stands on the real position: the row
 * only (no ply), the start of a line (nothing has been played yet), or peek, which draws on
 * a popover instead.
 */
function scrubPly(
  replay: LineReplay,
  prefs: LinePreviewPrefs,
  state: PreviewState,
): number | null {
  if (prefs.row === 'peek' || state.ply === null) return null
  const at = clampPly(state.ply, replay.moves.length)
  return at === 0 ? null : at
}

function peekPly(replay: LineReplay, prefs: LinePreviewPrefs, state: PreviewState): number {
  const total = replay.moves.length
  if (state.ply === null) return Math.min(clampDepth(prefs.depth), total)
  return clampPly(state.ply, total)
}

/** `after 24…Rfe8`, numbered the way the move list numbers a variation. */
function caption(replay: LineReplay, ply: number, startPly: number): string | null {
  const move = replay.moves[ply - 1]
  if (!move) return null
  return `after ${formatVariation(halfMove(ply, startPly), [move.san])}`
}

/** `ply` is 1-based within the line; the arrow is the move at that ply. */
function arrowShape(
  replay: LineReplay,
  prefs: LinePreviewPrefs,
  ply: number,
  step: Step,
  startPly: number,
): DrawShape {
  const move = replay.moves[ply - 1]
  const shape: DrawShape = {
    orig: key(move.from),
    dest: key(move.to),
    brush: previewBrush(prefs.bySide ? move.color : 'white', step),
    modifiers: { lineWidth: STEP_WIDTHS[step] },
  }
  if (prefs.badges) shape.label = { text: badgeText(prefs, ply, startPly) }
  return shape
}

/** The captured square, crossed out. Chessground scales the html into one square. */
function crossShape(square: string): DrawShape {
  return {
    orig: key(square),
    customSvg: {
      html:
        '<g stroke="var(--bb-blunder)" stroke-width="11" stroke-linecap="round" opacity="0.8">' +
        '<line x1="28" y1="28" x2="72" y2="72"/><line x1="28" y1="72" x2="72" y2="28"/></g>',
    },
  }
}

/** `7.` / `7…` (matching the move list) or the plain ply index within the line. */
function badgeText(prefs: LinePreviewPrefs, ply: number, startPly: number): string {
  if (prefs.labels === 'ply') return String(ply)
  const at = halfMove(ply, startPly)
  return at % 2 === 0 ? `${Math.floor(at / 2) + 1}.` : `${Math.floor(at / 2) + 1}…`
}

/** Ply `k` of the line is half-move `startPly + k - 1`; even half-moves are White's. */
function halfMove(ply: number, startPly: number): number {
  return Math.max(0, (Number.isFinite(startPly) ? startPly : 0) + ply - 1)
}

/**
 * The brush step for the `index`th of `count` shapes: 0 (nearest) through 3 (deepest), and
 * always 0 — the strongest, at a constant width — when the fade is switched off.
 */
function fadeStep(index: number, count: number, fade: boolean): Step {
  if (!fade) return 0
  const step = Math.floor((index * STEP_WIDTHS.length) / Math.max(1, count))
  return Math.min(STEP_WIDTHS.length - 1, Math.max(0, step)) as Step
}

function clampDepth(depth: number): number {
  if (!Number.isFinite(depth)) return LINE_PREVIEW_DEFAULTS.depth
  return Math.min(MAX_DEPTH, Math.max(MIN_DEPTH, Math.round(depth)))
}

function clampLookahead(lookahead: number): number {
  if (!Number.isFinite(lookahead)) return 0
  return Math.min(MAX_LOOKAHEAD, Math.max(0, Math.round(lookahead)))
}

function clampPly(ply: number, total: number): number {
  if (!Number.isFinite(ply)) return 0
  return Math.min(total, Math.max(0, Math.round(ply)))
}

/**
 * The stepped brushes `components/board/brushes.ts` defines, named here so that one module
 * builds the names: `lib/` does not reach into `components/`, and a brush name is a string
 * chessground looks up, not a type either side can check.
 */
function previewBrush(side: 'white' | 'black', step: Step): string {
  return `preview${side === 'white' ? 'White' : 'Black'}${step + 1}`
}
