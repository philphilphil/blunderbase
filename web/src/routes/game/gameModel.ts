/**
 * Everything the game view derives from one `/games/{id}` payload, as pure functions.
 *
 * Two conventions the backend fixes and this module translates once, so no component has
 * to remember them:
 *
 * - `eval_before_*`, `eval_after_*`, `win_before` and `win_after` on a move are from the
 *   **mover's** point of view (`backend/services/analysis.py:_move_row` flips the score
 *   into `board.turn`). Every eval the design shows — the bar, the graph, the readout —
 *   is White-relative, so it is flipped back here.
 * - `best_lines[].cp` is *not* flipped: it comes off `Score.stored_cp`, which is already
 *   White's. Engine lines are therefore shown as they arrive.
 *
 * A game carries no FEN per ply either, so the move list is replayed once with chessops
 * to get a position for every ply.
 */
import { Chess, normalizeMove } from 'chessops/chess'
import { makeFen } from 'chessops/fen'
import { makeSanAndPlay } from 'chessops/san'
import { parseUci } from 'chessops/util'

import type {
  Classification,
  EngineLine,
  GameRunSummary,
  GameSummary,
  MaiaLevelPolicy,
  MaiaPolicyResponse,
  MomentResponse,
  MoveRow,
  NoteResponse,
} from '@/lib/api/types'
import { isFlagged } from '@/lib/chess/classification'
import { winPercent, type Score } from '@/lib/chess/evaluation'

export type Side = 'white' | 'black'

/**
 * A note as `services.games.game_notes` writes it: the shared `NoteResponse` fields minus
 * the foreign keys, plus where it hangs in this game. Not the `/notes` shape.
 */
export interface GameNote extends NoteResponse {
  /** `line` where the note is pinned to a kept variation off this game. */
  scope?: 'game' | 'position' | 'line'
  /**
   * The half-move **count** the note is about — `0` the starting position, `n` the position
   * after `n` half-moves, `line.base_ply + k` on a line note. For a position note the
   * backend fills in the first count of this game that reached the noted position. See
   * `./notesModel` for the conversion to a `MoveRow.ply`.
   */
  ply?: number | null
}

/** The position after `index` plies. */
export interface PlyPosition {
  fen: string
  turn: Side
  check: boolean
}

export interface GameLine {
  /** `positions[i]` is the position after `i` plies; always at least the start position. */
  positions: PlyPosition[]
  /** The same positions as chessops boards, for turning a UCI variation into SAN. */
  boards: Chess[]
  /** How many plies replayed cleanly. Below `moves.length` only for a broken move list. */
  playable: number
}

/** The side that plays a ply. Ply 0 is White's first move (`backend/services/games.py`). */
export function sideOf(ply: number): Side {
  return ply % 2 === 0 ? 'white' : 'black'
}

/** `46` -> `24.`, `47` -> `24…` — the move-list number column. */
export function plyLabel(ply: number): string {
  return `${Math.floor(ply / 2) + 1}${ply % 2 === 0 ? '.' : '…'}`
}

/**
 * Replay the game once. A move that will not parse stops the replay rather than throwing:
 * a half-replayed game still shows its opening, and `playable` says where it stopped.
 */
export function buildGameLine(moves: MoveRow[]): GameLine {
  const board = Chess.default()
  const positions: PlyPosition[] = [snapshot(board)]
  const boards: Chess[] = [board.clone()]

  let playable = 0
  for (const row of moves) {
    const uci = row.uci
    if (!uci) break
    const parsed = parseUci(uci)
    if (!parsed) break
    const move = normalizeMove(board, parsed)
    if (!board.isLegal(move)) break
    board.play(move)
    positions.push(snapshot(board))
    boards.push(board.clone())
    playable += 1
  }
  return { positions, boards, playable }
}

function snapshot(board: Chess): PlyPosition {
  return { fen: makeFen(board.toSetup()), turn: board.turn, check: board.isCheck() }
}

/**
 * A UCI variation as SAN, played out from the position after `index` plies. Stops at the
 * first move the position rejects, so a truncated PV shows what it can.
 */
export function sanVariation(line: GameLine, index: number, pv: string[], limit = 8): string[] {
  const start = line.boards[index]
  if (!start) return []
  const board = start.clone()
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

/** `24…Rfe8 25.b3 h6 26.a4` — a variation numbered from the ply it starts on. */
export function formatVariation(startPly: number, sans: string[]): string {
  return sans
    .map((san, offset) => {
      const ply = startPly + offset
      if (ply % 2 === 0) return `${Math.floor(ply / 2) + 1}.${san}`
      return offset === 0 ? `${Math.floor(ply / 2) + 1}…${san}` : san
    })
    .join(' ')
}

// --- game header formatting -----------------------------------------------

/** `1-0` -> `1–0`, with the en dash and the fraction the design sets results in. */
export function formatResult(result: string | null | undefined): string {
  if (!result || result === '*') return '·'
  if (result === '1/2-1/2') return '½–½'
  return result.replace('-', '–')
}

/** `Rapid 10+0`, or whatever the source gave us of it. */
export function formatTimeControl(game: GameSummary): string | null {
  const speed = game.speed ? game.speed[0].toUpperCase() + game.speed.slice(1) : null
  if (speed && game.time_control) return `${speed} ${game.time_control}`
  return speed ?? game.time_control ?? null
}

/** `22 Aug 2026` — the breadcrumb and header date format. */
export function formatGameDate(played: string | null | undefined): string {
  if (!played) return 'undated'
  const value = new Date(played)
  if (Number.isNaN(value.getTime())) return 'undated'
  return value.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// --- evaluations ----------------------------------------------------------

/** Flip a mover-relative score into White's frame. */
export function toWhite(score: Score, side: Side): Score {
  if (side === 'white') return score
  return {
    cp: score.cp === null || score.cp === undefined ? score.cp : -score.cp,
    mate: score.mate === null || score.mate === undefined ? score.mate : -score.mate,
  }
}

/** The White-relative score of the position a move was played from. */
export function scoreBefore(move: MoveRow | undefined | null): Score | null {
  if (!move) return null
  if (move.eval_before_cp === undefined && move.eval_before_mate === undefined) return null
  return toWhite({ cp: move.eval_before_cp, mate: move.eval_before_mate }, sideOf(move.ply))
}

/** The White-relative score of the position a move led to. */
export function scoreAfter(move: MoveRow | undefined | null): Score | null {
  if (!move) return null
  if (move.eval_after_cp === undefined && move.eval_after_mate === undefined) return null
  return toWhite({ cp: move.eval_after_cp, mate: move.eval_after_mate }, sideOf(move.ply))
}

/** White's win percentage in the position after `move`, 0..100. */
export function whiteWinAfter(move: MoveRow | undefined | null): number | null {
  if (!move || move.win_after === null || move.win_after === undefined) return null
  return sideOf(move.ply) === 'white' ? move.win_after : 100 - move.win_after
}

/** White's win percentage in the position `move` was played from, 0..100. */
export function whiteWinBefore(move: MoveRow | undefined | null): number | null {
  if (!move || move.win_before === null || move.win_before === undefined) return null
  return sideOf(move.ply) === 'white' ? move.win_before : 100 - move.win_before
}

/**
 * The board's own evaluation at a cursor: what the last move led to, falling back to what
 * the next move was played from. The two are the same reading of the same position, and
 * either can be missing when only part of a game has been analysed.
 */
export function evalAtCursor(
  moves: MoveRow[],
  cursor: number,
): { score: Score | null; win: number | null } {
  const played = cursor >= 0 ? moves[cursor] : undefined
  const upcoming = moves[cursor + 1]
  return {
    score: scoreAfter(played) ?? scoreBefore(upcoming),
    win: whiteWinAfter(played) ?? whiteWinBefore(upcoming),
  }
}

// --- the eval curve -------------------------------------------------------

export interface CurvePoint {
  /** The ply this point is the *result* of; `-1` is the position before move 1. */
  ply: number
  /** White's win percentage, 0..100. */
  win: number
  san: string | null
  /** Only set where the move that produced this point was flagged. */
  classification: Classification | null
}

/**
 * The filled area chart's series: one point per evaluated ply, plus the starting position
 * so the curve leaves the axis at equality rather than at move 1.
 */
export function evalCurve(moves: MoveRow[]): CurvePoint[] {
  const points: CurvePoint[] = []
  const opening = whiteWinBefore(moves[0])
  if (opening !== null) {
    points.push({ ply: -1, win: opening, san: null, classification: null })
  }
  for (const move of moves) {
    const win = whiteWinAfter(move)
    if (win === null) continue
    points.push({
      ply: move.ply,
      win,
      san: move.san ?? null,
      classification: isFlagged(move.classification) ? (move.classification ?? null) : null,
    })
  }
  return points
}

// --- move list ------------------------------------------------------------

export interface MovePair {
  moveNumber: number
  white?: MoveRow
  black?: MoveRow
}

/** The paired table from design 1a: one row per move number, two cells. */
export function pairMoves(moves: MoveRow[]): MovePair[] {
  const pairs = new Map<number, MovePair>()
  for (const move of moves) {
    const moveNumber = move.move_number ?? Math.floor(move.ply / 2) + 1
    let pair = pairs.get(moveNumber)
    if (!pair) {
      pair = { moveNumber }
      pairs.set(moveNumber, pair)
    }
    if (sideOf(move.ply) === 'white') pair.white = move
    else pair.black = move
  }
  return [...pairs.values()].sort((left, right) => left.moveNumber - right.moveNumber)
}

/** The first ply the UI flags — an inaccuracy, a mistake or a blunder. */
export function firstFlaggedPly(moves: MoveRow[]): number | null {
  const found = moves.find((move) => isFlagged(move.classification))
  return found ? found.ply : null
}

/** The next flagged ply strictly after `ply`, for the `J` shortcut. */
export function nextFlaggedPly(moves: MoveRow[], ply: number): number | null {
  const found = moves.find((move) => move.ply > ply && isFlagged(move.classification))
  return found ? found.ply : null
}

/** The previous flagged ply strictly before `ply`. */
export function previousFlaggedPly(moves: MoveRow[], ply: number): number | null {
  let found: number | null = null
  for (const move of moves) {
    if (move.ply >= ply) break
    if (isFlagged(move.classification)) found = move.ply
  }
  return found
}

/** Minimum collapsed moves worth an affordance — below this the row saves nothing. */
export const MIN_COLLAPSED_MOVES = 4
/** Full moves of quiet play kept visible before the first thing worth looking at. */
export const COLLAPSE_CONTEXT_MOVES = 2

/**
 * How much of the opening the move list folds away: everything before the first flagged
 * move, less two moves of run-up so the mistake is not the first row on screen. Returns
 * `null` when nothing is worth collapsing.
 *
 * A game carries no book depth of its own — that lives on the explorer, per position —
 * so "the part nobody needs to read" is derived from where the analysis first has
 * something to say. A game with no analysis at all collapses nothing.
 */
export function collapsedThroughMove(
  moves: MoveRow[],
  notedPlies: readonly number[] = [],
): number | null {
  const flagged = firstFlaggedPly(moves)
  const firstNoted = notedPlies.length > 0 ? Math.min(...notedPlies) : null
  const anchor =
    flagged === null ? firstNoted : firstNoted === null ? flagged : Math.min(flagged, firstNoted)
  if (anchor === null) return null

  const anchorMove = Math.floor(anchor / 2) + 1
  const through = anchorMove - 1 - COLLAPSE_CONTEXT_MOVES
  return through >= MIN_COLLAPSED_MOVES ? through : null
}

// --- engine lines ---------------------------------------------------------

export interface EngineLineView {
  multipv: number
  /** White-relative, as `best_lines` already stores it. */
  score: Score
  /** The variation in SAN, numbered from the ply it starts on. */
  text: string
  /** The same variation move by move — what the dual panel makes clickable. */
  sans: string[]
  /** Those moves in UCI, so clicking the third SAN can play the first three. */
  pv: string[]
  /** The first move of the line, in UCI, for the board arrow. */
  firstUci: string | null
  /** Set on the row that is the move actually played from this position. */
  played: boolean
  /** The verdict on the played move, on that row only — how it is coloured. */
  classification: Classification | null
}

/**
 * The multi-PV rows for the position on the board. The move that was actually played is
 * appended as its own row when the engine did not rank it, which is what design 1a shows
 * for a blunder: three engine lines, then the played move in red.
 *
 * A ply the engine never looked at gets no rows at all — a lone "played" row with no
 * evaluation beside it would look like an engine verdict that was never given.
 */
export function engineLines(
  line: GameLine,
  ply: number,
  move: MoveRow | undefined,
  pvLimit = 8,
): EngineLineView[] {
  const rows: EngineLineView[] = []
  const played = move?.uci ?? null
  const verdict = move?.classification ?? null

  for (const candidate of move?.best_lines ?? []) {
    const pv = candidateMoves(candidate).slice(0, pvLimit)
    const first = pv[0] ?? null
    const isPlayed = first !== null && played !== null && sameMove(first, played)
    const sans = sanVariation(line, ply, pv, pvLimit)
    rows.push({
      multipv: candidate.multipv ?? rows.length + 1,
      score: { cp: candidate.cp, mate: candidate.mate },
      text: formatVariation(ply, sans),
      sans,
      // A PV whose tail the position rejects is truncated to what actually replayed, so a
      // click on the last SAN can never play a move that is not there.
      pv: pv.slice(0, sans.length),
      firstUci: first,
      played: isPlayed,
      classification: isPlayed ? verdict : null,
    })
  }
  rows.sort((left, right) => left.multipv - right.multipv)

  if (played && rows.length > 0 && !rows.some((row) => row.played)) {
    const after = scoreAfter(move)
    const sans = sanVariation(line, ply, [played], 1)
    rows.push({
      multipv: rows.length + 1,
      score: after ?? { cp: null, mate: null },
      text: formatVariation(ply, sans),
      sans,
      pv: sans.length > 0 ? [played] : [],
      firstUci: played,
      played: true,
      classification: verdict,
    })
  }
  return rows
}

function candidateMoves(candidate: EngineLine): string[] {
  if (Array.isArray(candidate.pv) && candidate.pv.length > 0) return candidate.pv
  return candidate.move_uci ? [candidate.move_uci] : []
}

/** Two UCI moves, promotion suffix and all, naming the same move. */
export function sameMove(left: string, right: string): boolean {
  return left.slice(0, 4) === right.slice(0, 4)
}

// --- Maia -----------------------------------------------------------------

export interface MaiaMove {
  uci: string
  san: string
  rank: number
  /** The policy share, 0..1, where the build publishes one. */
  probability: number | null
}

export interface MaiaLevel {
  /**
   * The rating band, as `MoveEval.maia_policy` keys it. A stored level always has one;
   * a live one is null where the engine that answered is fixed-weights and never said
   * which human it plays as, and the header then reads plain "Maia".
   */
  rating: string | null
  moves: MaiaMove[]
}

/**
 * One list of predicted moves, however it arrived: as a value in the stored
 * `maia_policy` blob, or as `policy`/`rollout` off `POST /maia/policy`. Both write the
 * same `{uci, san, rank, p}` entries, and neither is typed on the wire, so both are read
 * defensively here rather than trusted.
 */
export function maiaMoves(value: unknown): MaiaMove[] {
  if (!Array.isArray(value)) return []
  const moves: MaiaMove[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as { uci?: unknown; san?: unknown; rank?: unknown; p?: unknown }
    if (typeof row.uci !== 'string') continue
    moves.push({
      uci: row.uci,
      san: typeof row.san === 'string' ? row.san : row.uci,
      rank: typeof row.rank === 'number' ? row.rank : moves.length + 1,
      probability: typeof row.p === 'number' ? row.p : null,
    })
  }
  return moves
}

/** `{"1500": [...]}` as the overlay reads it: levels low to high, moves best-ranked first. */
export function maiaLevels(policy: MoveRow['maia']): MaiaLevel[] {
  if (!policy || typeof policy !== 'object') return []
  const levels: MaiaLevel[] = []
  for (const [rating, value] of Object.entries(policy)) {
    const moves = maiaMoves(value)
    if (moves.length === 0) continue
    moves.sort((left, right) => left.rank - right.rank)
    levels.push({ rating, moves })
  }
  return levels.sort((left, right) => Number(left.rating) - Number(right.rating))
}

/**
 * `POST /maia/policy` as the panel reads it — the same `MaiaLevel` the stored blob
 * produces, so one column renders either, plus the rollout line.
 */
export interface MaiaLiveView {
  level: MaiaLevel
  /** The most likely continuation from here, both sides at `level.rating`. */
  rollout: MaiaMove[]
}

/** One entry of the response — a level's own policy — as a view, or nothing to show. */
function liveView(value: MaiaLevelPolicy | null | undefined): MaiaLiveView | null {
  if (!value || typeof value !== 'object') return null
  const moves = maiaMoves(value.policy).sort((left, right) => left.rank - right.rank)
  if (moves.length === 0) return null
  return {
    // The level *asked for* is deliberately not a fallback here: a fixed-weights build
    // answers under the key it was asked at while naming no level of its own, and a column
    // headed 1700 by a build that never claimed 1700 is a comparison nobody made.
    level: { rating: typeof value.elo === 'number' ? String(value.elo) : null, moves },
    // The rollout arrives in played order; its `rank` is per-position and means nothing
    // across plies, so it is deliberately left unsorted.
    rollout: maiaMoves(value.rollout),
  }
}

/**
 * Every level one live query answered with, lowest first — the columns of a comparison.
 *
 * The endpoint keys `levels` by the level asked about and repeats the first of them at the
 * top of the payload, which is the shape the board read before there was more than one
 * level; both are read here so an older deployment still answers. A build with fixed
 * weights answers with one level however many were asked for, and duplicates are folded,
 * so the number of columns is what the engine could actually distinguish — never the
 * number of questions.
 */
export function maiaLiveLevels(response: MaiaPolicyResponse | undefined | null): MaiaLiveView[] {
  if (!response) return []
  const entries =
    response.levels && typeof response.levels === 'object' ? Object.values(response.levels) : []
  const views: MaiaLiveView[] = []
  const seen = new Set<string>()
  for (const entry of entries.length > 0 ? entries : [response]) {
    const view = liveView(entry as MaiaLevelPolicy)
    if (!view) continue
    const key = view.level.rating ?? ''
    if (seen.has(key)) continue
    seen.add(key)
    views.push(view)
  }
  return views.sort((left, right) => ratingOrder(left.level) - ratingOrder(right.level))
}

/** A level's place in a list of them; an unnamed level sorts last. */
function ratingOrder(level: MaiaLevel): number {
  const rating = levelElo(level)
  return rating === null ? Number.POSITIVE_INFINITY : rating
}

/** A level's rating as a number, or null where the engine named none. */
export function levelElo(level: MaiaLevel): number | null {
  if (level.rating === null) return null
  const elo = Number(level.rating)
  return Number.isFinite(elo) ? elo : null
}

/** The first level of a live answer — for a caller that shows one. */
export function maiaLive(response: MaiaPolicyResponse | undefined | null): MaiaLiveView | null {
  return maiaLiveLevels(response)[0] ?? null
}

/**
 * The level nearest `elo` among the ones actually there — exactly it, where it is one of
 * them.
 *
 * A pick of 1900 against a run that only holds 1500 and 1700 reads 1700 rather than
 * nothing: what the pick names is which human the column speaks for, and the nearest human
 * on hand is a better answer than an empty column. Null only where there is no named level
 * at all to fall back to.
 */
export function nearestLevel(
  levels: MaiaLevel[],
  elo: number | null | undefined,
): MaiaLevel | null {
  if (elo === null || elo === undefined) return null
  const named = levels.filter((level) => levelElo(level) !== null)
  if (named.length === 0) return null
  return named.reduce((best, level) =>
    Math.abs(levelElo(level)! - elo) < Math.abs(levelElo(best)! - elo) ? level : best,
  )
}

/**
 * Which stored level the panel and the board arrow speak for when nobody has picked one.
 *
 * The configured target elo wins where the run was actually made at it — a run pinned to
 * one level keys the blob by exactly that number. Legacy runs (levels centred on the
 * rating the game was played at) have no such key, and fall back to the nearest level to
 * that rating, which is what they were computed for.
 */
export function preferredLevel(
  levels: MaiaLevel[],
  rating: number | null | undefined,
  targetElo?: number | null,
): MaiaLevel | null {
  if (levels.length === 0) return null
  const middle = levels[Math.floor(levels.length / 2)] ?? null
  if (targetElo !== null && targetElo !== undefined) {
    const pinned = levels.find((level) => levelElo(level) === targetElo)
    if (pinned) return pinned
  }
  if (rating === null || rating === undefined) return middle
  return nearestLevel(levels, rating) ?? middle
}

/**
 * The level the panel shows: the reader's own pick where they have made one, resolved
 * against the levels this position actually carries, and the deployment's preference where
 * they have not.
 *
 * The pick is a standing choice across games (`maiaPreferences`), so it routinely names a
 * level a given run was never made at — which is why it resolves to the nearest rather
 * than to nothing.
 */
export function maiaLevelFor(
  levels: MaiaLevel[],
  pick: number | null | undefined,
  rating: number | null | undefined,
  targetElo: number | null | undefined,
): MaiaLevel | null {
  if (pick !== null && pick !== undefined) {
    const picked = nearestLevel(levels, pick)
    if (picked) return picked
  }
  return preferredLevel(levels, rating, targetElo)
}

/** One entry of the level dropdown. */
export interface MaiaLevelOption {
  /** The level, as the dropdown's value and as the pick is remembered. */
  elo: number
  /**
   * False for a level the deployment is configured for that this position has no data at:
   * offered and disabled, because the fix is a fresh pass rather than another click.
   */
  available: boolean
}

/**
 * The levels a reader may pick between here: what this position actually has, and what the
 * deployment is configured for.
 *
 * The two are not the same list and neither contains the other. A run made before a level
 * was configured carries bands nobody asks for any more — still readable, so still
 * offered. A level configured after the run has no data here at all — offered too, but
 * disabled, because otherwise a level the owner has chosen looks like a level Maia cannot
 * answer at.
 */
export function maiaLevelOptions(
  levels: MaiaLevel[],
  configured: readonly number[] | null | undefined,
): MaiaLevelOption[] {
  const present = new Set<number>()
  for (const level of levels) {
    const elo = levelElo(level)
    if (elo !== null) present.add(elo)
  }
  const all = new Set<number>(present)
  for (const elo of configured ?? []) {
    if (Number.isFinite(elo)) all.add(elo)
  }
  return [...all]
    .sort((left, right) => left - right)
    .map((elo) => ({ elo, available: present.has(elo) }))
}

/**
 * Classification thresholds in win-percentage points, mirroring `backend/config.py`'s
 * defaults. They colour *engine-ranked* human moves only — a guess at what the engine
 * would have said about a move it ranked but nobody played. Wherever the backend actually
 * stored a verdict (the played move) that verdict is used instead, so a deployment with
 * its own thresholds never sees the two disagree about a real move.
 */
const LOSS_THRESHOLDS: readonly [number, Classification][] = [
  [30, 'blunder'],
  [20, 'mistake'],
  [10, 'inaccuracy'],
]

/** One row of the panel's human column: what a human plays, and what it costs. */
export interface HumanMoveView extends MaiaMove {
  /** The move actually played from this position. */
  played: boolean
  /** The engine's verdict, where this position's stored lines have one. */
  classification: Classification | null
  /** Win percentage this move gives away against the engine's top line, where known. */
  loss: number | null
  /** The engine's rank for this move, where it ranked it at all. */
  multipv: number | null
}

/**
 * The human column, crossed with the engine's own reading of the same position — the
 * whole point of the panel: "62% of players at your level play this, and it loses 26%".
 *
 * A move the engine never ranked and nobody played gets no verdict at all rather than a
 * flattering or damning guess.
 */
export function humanMoves(
  level: MaiaLevel | null,
  lines: EngineLineView[],
  played: MoveRow | undefined,
): HumanMoveView[] {
  if (!level) return []
  const top = lines.find((row) => row.multipv === 1) ?? lines[0] ?? null
  const playedUci = played?.uci ?? null
  const mover: Side = played ? sideOf(played.ply) : 'white'
  const bestWin = top ? winPercent(toWhite(top.score, mover)) : null

  return level.moves.map((move) => {
    const ranked = lines.find((row) => row.firstUci && sameMove(row.firstUci, move.uci)) ?? null
    const isPlayed = playedUci !== null && sameMove(move.uci, playedUci)
    // The played move's own numbers are the backend's, thresholds and all; only a move
    // nobody played is scored off the multi-PV spread.
    const loss = isPlayed
      ? (played?.win_loss ?? null)
      : ranked && bestWin !== null
        ? Math.max(0, bestWin - winPercent(toWhite(ranked.score, mover)))
        : null
    const classification = isPlayed
      ? (played?.classification ?? null)
      : ranked
        ? lossClassification(ranked.multipv === 1 ? 0 : loss)
        : null
    return {
      ...move,
      played: isPlayed,
      classification,
      loss,
      multipv: ranked?.multipv ?? null,
    }
  })
}

/** How many moves a comparison column lists — enough for a distribution, not a table. */
export const COMPARE_MOVES = 3

/** One level's column of the comparison grid. */
export interface MaiaComparisonColumn {
  /** The level this column speaks for; null where the engine named none. */
  rating: string | null
  /** The likeliest moves at this level, best first. */
  moves: HumanMoveView[]
  /**
   * The played move as this level saw it, wherever it ranked. Kept beside `moves` rather
   * than only inside them, because the interesting column is the one that did *not* rank
   * it: "a 1900 barely considers this" is the comparison, and a column that simply left it
   * out would read as a level with no opinion.
   */
  played: HumanMoveView | null
}

/**
 * The compare grid: the same position read by every level at once.
 *
 * One `humanMoves` per level over the one engine reading of the position — the engine's
 * verdicts do not change with the level, only who plays into them, which is precisely what
 * the grid puts side by side.
 */
export function maiaComparison(
  levels: MaiaLevel[],
  lines: EngineLineView[],
  played: MoveRow | undefined,
  limit = COMPARE_MOVES,
): MaiaComparisonColumn[] {
  return levels.map((level) => {
    const rows = humanMoves(level, lines, played)
    return {
      rating: level.rating,
      moves: rows.slice(0, limit),
      played: rows.find((row) => row.played) ?? null,
    }
  })
}

function lossClassification(loss: number | null): Classification | null {
  if (loss === null) return null
  for (const [threshold, verdict] of LOSS_THRESHOLDS) {
    if (loss >= threshold) return verdict
  }
  return loss <= 0 ? 'best' : 'good'
}

// --- runs -----------------------------------------------------------------

/** The run that produced a ply's evaluation, so the engine panel names the right engine. */
export function runFor(runs: GameRunSummary[], move: MoveRow | undefined): GameRunSummary | null {
  if (!move || move.run_id === null || move.run_id === undefined) return null
  return runs.find((run) => run.id === move.run_id) ?? null
}

/**
 * The deepest tier that has finished over this game — what the header chip reports.
 *
 * Maia fills are left out of it entirely. A fill is filed under the quick tier and carries
 * that tier's node budget on its row, but it searched nothing, so letting one win the
 * "newest run" contest would have the header claim the game was analysed at 250k nodes at
 * the moment the missing Maia levels landed.
 */
export function bestRun(runs: GameRunSummary[]): GameRunSummary | null {
  const searched = runs.filter((run) => !run.maia_only)
  const deep = searched.filter((run) => run.tier === 'deep')
  const pool = deep.length > 0 ? deep : searched
  return (
    pool.reduce<GameRunSummary | null>((best, run) => {
      if (!best) return run
      return finishedAt(run) >= finishedAt(best) ? run : best
    }, null) ?? null
  )
}

function finishedAt(run: GameRunSummary): number {
  const value = run.finished_at ? Date.parse(run.finished_at) : Number.NaN
  return Number.isNaN(value) ? 0 : value
}

// --- recurring mistakes ---------------------------------------------------

export interface RecurringMistake {
  /** The piece the pattern is about, as `/stats/worst-moments` names it. */
  piece: string
  phase: string
  /** How many blunders in the window share this piece, this game's included. */
  count: number
  /** `4th time this month` — the ordinal of this game's occurrence in the window. */
  ordinal: string
  days: number
}

const ORDINALS = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th']

/**
 * The recurring-mistake card from design 1a, derived rather than invented: the worst
 * blunder of this game, and how many other blunders in the window were made with the same
 * piece in the same phase. Returns null unless it has actually recurred.
 */
export function recurringMistake(
  moments: MomentResponse[],
  gameId: number,
  days: number,
): RecurringMistake | null {
  const mine = moments.filter((moment) => moment.game?.id === gameId)
  if (mine.length === 0) return null
  const worst = mine.reduce((best, moment) =>
    (moment.win_loss ?? 0) > (best.win_loss ?? 0) ? moment : best,
  )
  if (!worst.piece || !worst.phase) return null

  const matching = moments.filter(
    (moment) => moment.piece === worst.piece && moment.phase === worst.phase,
  )
  if (matching.length < 2) return null
  return {
    piece: worst.piece,
    phase: worst.phase,
    count: matching.length,
    ordinal: ORDINALS[Math.min(matching.length, ORDINALS.length - 1)] || `${matching.length}th`,
    days,
  }
}

// --- notes ----------------------------------------------------------------

/** The accent a note card is drawn with: the move it is about, or its own tag. */
export function noteAccent(note: GameNote, moves: MoveRow[]): Classification | 'pattern' | null {
  const tags = note.tags ?? []
  if (tags.some((tag) => /^(pattern|recurring|drill)$/i.test(tag))) return 'pattern'
  if (note.ply === null || note.ply === undefined) return null
  const move = moves.find((row) => row.ply === note.ply)
  return isFlagged(move?.classification) ? (move?.classification ?? null) : null
}

/** Notes newest first, the order `game_notes` already returns them in — made explicit. */
export function sortNotes(notes: GameNote[]): GameNote[] {
  return [...notes].sort(
    (left, right) => Date.parse(right.created_at) - Date.parse(left.created_at),
  )
}
