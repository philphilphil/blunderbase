/**
 * The Board's line model, in the browser: `backend/services/live.py`'s mainline, branch
 * and cursor, over the same `LiveState` shape the server sends.
 *
 * It exists for two reasons, and both need it to answer exactly as the server would:
 *
 * - **The demo.** A read-only deployment refuses every `POST /live/*`, and its one shared
 *   board would be fought over by every visitor anyway, so there the page keeps its board
 *   here and never asks the server.
 * - **The drag.** A move on a remote server is a round trip; the page plays it here first
 *   and lets the server's answer replace it, so the piece does not sit on its old square
 *   for the length of a request.
 *
 * Everything is a pure function from one `LiveState` to the next, and the state carries all
 * it needs: the line's first position is `line_positions[0]`, the mainline its `uci`s. That
 * is also why a refusal throws rather than returning the old state — the caller's error
 * path is the same whichever side refused.
 */
import { t } from '@lingui/core/macro'
import { Chess, normalizeMove } from 'chessops/chess'
import { chessgroundDests } from 'chessops/compat'
import { makeFen, parseFen } from 'chessops/fen'
import { parsePgn, startingPosition } from 'chessops/pgn'
import { makeSanAndPlay, parseSan } from 'chessops/san'
import type { SquareName } from 'chessops/types'
import { makeUci, parseSquare, parseUci } from 'chessops/util'

import type { LiveLinePosition, LiveState } from '@/lib/api/types'

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

/** What the page asks of the board, whichever side answers it. */
export type BoardAction =
  | { kind: 'new' }
  | { kind: 'load'; input: BoardInput }
  | { kind: 'play'; ucis: string[] }
  | { kind: 'goto'; ply: number; cursor: number }
  | { kind: 'select'; index: number }
  | { kind: 'reset' }

export type BoardInput = { fen: string } | { pgn: string }

export const EMPTY_BOARD: LiveState = {
  active: false,
  position_index: 0,
  position_count: 0,
  line_positions: [],
  game_id: null,
  ply: null,
  base: null,
  cursor: 0,
  fen: null,
  turn: null,
  moves: [],
  move_sans: [],
  last_move: null,
  arrows: [],
  squares: [],
  text: null,
  viewer_count: 0,
  updated_at: null,
}

/**
 * A pasted text as the thing it is. A FEN is one line of four to six fields whose first is
 * a placement (seven slashes); everything else is offered as a PGN, and the PGN reader says
 * what is wrong with it — a guess here would only hide that message behind a vaguer one.
 */
export function detectInput(text: string): BoardInput | null {
  const body = text.trim()
  if (!body) return null
  const fields = body.split(/\s+/)
  const oneLine = !/[\r\n]/.test(body)
  if (oneLine && fields.length <= 6 && fields[0]!.split('/').length === 8) {
    return { fen: body }
  }
  return { pgn: body }
}

/** Where each piece may go in `fen`, for the board's `dests`; empty for no position. */
export function boardDests(fen: string | null | undefined): Map<SquareName, SquareName[]> {
  if (!fen) return new Map()
  const position = positionOf(fen)
  return position ? chessgroundDests(position) : new Map()
}

/**
 * A drag as UCI, promoting to a queen the way the game page's analysis line does — a drag
 * never says what it promotes to, and a dialog for the one move in a thousand that wants a
 * knight is not worth the other 999.
 */
export function dragToUci(fen: string, orig: string, dest: string): string {
  const position = positionOf(fen)
  const from = parseSquare(orig)
  const promotes =
    position !== null &&
    from !== undefined &&
    position.board.getRole(from) === 'pawn' &&
    (dest.endsWith('8') || dest.endsWith('1'))
  return `${orig}${dest}${promotes ? 'q' : ''}`
}

/** The action ←/→ stands for from here, or null at an end. */
export function stepAction(state: LiveState, delta: -1 | 1): BoardAction | null {
  const model = modelOf(state)
  if (!model) return null
  if (model.cursor > 0) {
    if (delta < 0) return { kind: 'goto', ply: model.base, cursor: model.cursor - 1 }
    return model.cursor < model.moves.length
      ? { kind: 'goto', ply: model.base, cursor: model.cursor + 1 }
      : null
  }
  if (delta < 0) return model.ply > 0 ? { kind: 'goto', ply: model.ply - 1, cursor: 0 } : null
  if (model.ply < model.line.length) return { kind: 'goto', ply: model.ply + 1, cursor: 0 }
  // At the end of the mainline — or on a bare position, which has none — the branch is
  // the only way on.
  return model.moves.length > 0 && model.ply === model.base
    ? { kind: 'goto', ply: model.base, cursor: 1 }
    : null
}

/** `action` answered in the browser, exactly as `services/live.py` answers it. */
export function applyLocal(state: LiveState, action: BoardAction): LiveState {
  switch (action.kind) {
    case 'new':
      return fresh(state, START_FEN, [], 0)
    case 'reset':
      return { ...EMPTY_BOARD, viewer_count: state.viewer_count }
    case 'select':
      // A queue is only ever the coach's, and there is no coach on a board kept here.
      if (action.index !== 0 || !state.active) throw new Error(t`That position is not in the queue.`)
      return state
    case 'load':
      return 'fen' in action.input
        ? fresh(state, readFen(action.input.fen), [], 0)
        : loadPgn(state, action.input.pgn)
    case 'play':
      return play(state, action.ucis)
    case 'goto':
      return goto(state, action.ply, action.cursor)
  }
}

// --- the model ---------------------------------------------------------------

interface Model {
  start: string
  line: string[]
  ply: number
  base: number
  moves: string[]
  cursor: number
}

function modelOf(state: LiveState): Model | null {
  const positions = state.line_positions ?? []
  if (!state.active || positions.length === 0) return null
  const cursor = state.cursor ?? 0
  const base = state.base ?? 0
  return {
    start: positions[0]!.fen,
    line: positions.slice(1).map((position) => position.uci ?? ''),
    ply: cursor > 0 ? base : (state.ply ?? 0),
    base,
    moves: [...state.moves],
    cursor,
  }
}

function fresh(state: LiveState, start: string, line: string[], ply: number): LiveState {
  const board = setup(start)
  const positions: LiveLinePosition[] = [{ ply: 0, fen: start, san: null, uci: null }]
  for (const [index, uci] of line.entries()) {
    const san = makeSanAndPlay(board, normalizeMove(board, parseUci(uci)!))
    positions.push({ ply: index + 1, fen: makeFen(board.toSetup()), san, uci })
  }
  return render(
    { ...EMPTY_BOARD, viewer_count: state.viewer_count, active: true, position_count: 1 },
    { start, line, ply, base: 0, moves: [], cursor: 0 },
    positions,
  )
}

/** The state for `model`, the position on the board and the branch's SAN worked out. */
function render(state: LiveState, model: Model, positions: LiveLinePosition[]): LiveState {
  const inBranch = model.cursor > 0
  const branch = setup(model.start)
  for (const uci of model.line.slice(0, model.base)) branch.play(normalizeMove(branch, parseUci(uci)!))
  let board = inBranch ? null : setup(model.start)
  if (board) for (const uci of model.line.slice(0, model.ply)) board.play(normalizeMove(board, parseUci(uci)!))
  const sans: string[] = []
  for (const [index, uci] of model.moves.entries()) {
    sans.push(makeSanAndPlay(branch, normalizeMove(branch, parseUci(uci)!)))
    if (index + 1 === model.cursor) board = branch.clone()
  }
  const at = board ?? branch
  return {
    ...state,
    line_positions: positions,
    ply: model.line.length > 0 || state.game_id ? model.ply : null,
    base: model.moves.length > 0 ? model.base : null,
    cursor: model.cursor,
    moves: model.moves,
    move_sans: sans,
    fen: makeFen(at.toSetup()),
    turn: at.turn,
    last_move: inBranch
      ? model.moves[model.cursor - 1]!
      : model.ply > 0
        ? model.line[model.ply - 1]!
        : null,
    // The marks named squares of the position that was left.
    arrows: [],
    squares: [],
    updated_at: new Date().toISOString(),
  }
}

function play(state: LiveState, ucis: string[]): LiveState {
  if (ucis.length === 0) throw new Error(t`A move is required.`)
  let current = state.active ? state : fresh(state, START_FEN, [], 0)
  for (const text of ucis) {
    const model = modelOf(current)!
    const board = setup(current.fen!)
    const parsed = parseUci(text.trim())
    const move = parsed ? normalizeMove(board, parsed) : undefined
    if (!move || !board.isLegal(move)) throw new Error(t`${text} is not legal here.`)
    const played = makeUci(move)
    const inBranch = model.cursor > 0
    const atBranch = model.moves.length > 0 && (inBranch || model.ply === model.base)
    if (atBranch && model.cursor < model.moves.length && model.moves[model.cursor] === played) {
      model.cursor += 1
      model.ply = model.base
    } else if (!inBranch && model.ply < model.line.length && model.line[model.ply] === played) {
      model.ply += 1
    } else if (inBranch) {
      model.moves = [...model.moves.slice(0, model.cursor), played]
      model.cursor += 1
    } else {
      model.base = model.ply
      model.moves = [played]
      model.cursor = 1
    }
    current = render(current, model, current.line_positions ?? [])
  }
  return current
}

function goto(state: LiveState, ply: number, cursor: number): LiveState {
  const model = modelOf(state)
  if (!model) throw new Error(t`Nothing is on the board yet.`)
  if (cursor < 0 || ply < 0 || ply > model.line.length) {
    throw new Error(t`That move is not on the line.`)
  }
  if (cursor > 0 && (ply !== model.base || cursor > model.moves.length)) {
    throw new Error(t`That move is not on the line.`)
  }
  return render(state, { ...model, ply, cursor }, state.line_positions ?? [])
}

function loadPgn(state: LiveState, text: string): LiveState {
  const [game] = parsePgn(text)
  if (!game) throw new Error(t`That is not a PGN.`)
  const start = startingPosition(game.headers)
  if (start.isErr) throw new Error(t`That PGN's FEN header is not a position.`)
  const position = start.value
  const startFen = makeFen(position.toSetup())
  const line: string[] = []
  for (const node of game.moves.mainline()) {
    const move = parseSan(position, node.san)
    if (!move) throw new Error(t`That PGN could not be read: ${node.san} is not legal there.`)
    line.push(makeUci(move))
    position.play(move)
  }
  if (line.length === 0 && !game.headers.has('FEN')) throw new Error(t`That PGN has no moves.`)
  return fresh(state, startFen, line, line.length)
}

function readFen(text: string): string {
  const fen = text.trim()
  if (!fen || !positionOf(fen)) throw new Error(t`That is not a position.`)
  return makeFen(setup(fen).toSetup())
}

function positionOf(fen: string): Chess | null {
  const parsed = parseFen(fen)
  if (parsed.isErr) return null
  const position = Chess.fromSetup(parsed.value)
  return position.isOk ? position.value : null
}

function setup(fen: string): Chess {
  return Chess.fromSetup(parseFen(fen).unwrap()).unwrap()
}
