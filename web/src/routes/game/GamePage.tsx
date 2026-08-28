import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'

import { InfiniteAnalysisPanel } from '@/components/analysis/InfiniteAnalysisPanel'
import { SetPageChrome } from '@/components/shell/PageChrome'
import { liveBest, liveScore, useStreamSession } from '@/lib/analysis'
import {
  useDeleteLine,
  useDeleteNote,
  useGame,
  useGameLines,
  useMaiaElos,
  useNoteTags,
  useSaveLine,
  useSaveNote,
  useUpdateNote,
} from '@/lib/api/queries'
import type { LineResponse, MoveRow } from '@/lib/api/types'
import { useLinePreviewPrefs } from '@/lib/board/linePreviewPrefs'
import { useLinePreview, type HoveredLine } from '@/lib/board/useLinePreview'
import { isFlagged } from '@/lib/chess/classification'
import { whiteWinPercent } from '@/lib/chess/evaluation'
import { cn } from '@/lib/utils'

import { buildAnalysisLine, withBoardMove } from './analysisLine'
import { BoardPanel } from './components/BoardPanel'
import { ColumnSplitter } from './components/ColumnSplitter'
import { EvalGraph } from './components/EvalGraph'
import { GameHeaderBar } from './components/GameHeaderBar'
import { GameLoadError, GameViewSkeleton } from './components/GameStates'
import { MaiaPanel } from './components/MaiaPanel'
import { MoveList, type MoveAnnotation, type MoveListVariation } from './components/MoveList'
import { COMPOSER_TEXT_ID, NoteComposer } from './components/NoteComposer'
import {
  bestRun,
  buildGameLine,
  engineLines,
  evalAtCursor,
  evalCurve,
  formatGameDate,
  humanMoves,
  maiaComparison,
  maiaLevelFor,
  maiaLevelOptions,
  maiaLevels,
  nextFlaggedPly,
  pairMoves,
  previousFlaggedPly,
  runFor,
  sanVariation,
  scoreAfter,
  scoreBefore,
  sortNotes,
  type GameNote,
  type Side,
} from './gameModel'
import { setMaiaCompare, setMaiaEloPick, useMaiaCompare, useMaiaEloPick } from './maiaPreferences'
import {
  noteAtTarget,
  noteRows,
  noteTarget,
  notedLineIndices,
  notedMoveIndices,
  type NoteRow,
} from './notesModel'
import { buildPgn } from './pgn'
import { useSessionVariations } from './sessionVariations'
import { variationRows } from './variationRows'
import { useBoardKeys } from './useBoardKeys'
import { useDeepAnalysis } from './useDeepAnalysis'
import { useLiveMaia } from './useLiveMaia'

// --- the moves column's width ---------------------------------------------
//
// The board takes the spare width and the move table is the column that is *sized*, so the
// width held here is the move table's. Stored in `rem`, the unit the whole page lays out
// in: a physical pixel count would stop meaning the same column the moment the root scale
// moved (`lib/ui/scale.ts`). Page-local state rather than a store — nothing outside this
// page reads it, and a second tab arranging its own columns differently is not a conflict
// to reconcile.

export const MOVES_WIDTH_KEY = 'blunderbase.gameMovesWidth'
/**
 * What the move column is worth until somebody drags it, read off what it holds rather
 * than off the window: the Maia panel's `1fr 3fr` grid wants roughly 6.5rem for the human
 * column ("d5", a percentage, the played mark) and the rest for the engine's own — a SAN
 * move, its eval chip and two or three plies of line without wrapping — and the move table
 * under it wants a move number plus two SAN cells wide enough for a glyph and an
 * annotation. 26rem, which is 499 physical pixels at the app's 120 % scale, seats both
 * comfortably and is well clear of the 280 the design set for this column; every rem past
 * it would be spent on whitespace the move table has no use for, and the board wants it.
 */
const DEFAULT_MOVES_REM = 26
const BOARD_FLOOR_REM = 26.25
const MOVES_FLOOR_REM = 20

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    // Storage disabled: the splitter still drags, the page just forgets by morning.
    return null
  }
}

/** The rendered size of one `rem` — `index.css` scales the root, so it is not 16px. */
function rootPx(): number {
  const size = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
  return Number.isFinite(size) && size > 0 ? size : 16
}

/** The remembered width, or null for "nobody has moved it" — which is the design's own. */
function readMovesWidth(): number | null {
  const store = storage()
  if (!store) return null
  try {
    const raw = store.getItem(MOVES_WIDTH_KEY)
    if (!raw) return null
    const width = Number(raw)
    // Anything that is not a width — a truncated write, an older spelling of the key's
    // contents — is no width, and the design's basis stands.
    if (!Number.isFinite(width) || width <= 0) return null
    // The ceiling needs a container to be measured against and there is none yet; the
    // floor holds on its own, and the first drag re-clamps against the real row.
    return Math.max(width, MOVES_FLOOR_REM)
  } catch {
    // Corrupt or unreadable: the default layout rather than a throw.
    return null
  }
}

function writeMovesWidth(width: number | null): void {
  const store = storage()
  try {
    if (width === null) store?.removeItem(MOVES_WIDTH_KEY)
    else store?.setItem(MOVES_WIDTH_KEY, String(width))
  } catch {
    // Quota or a private window: the width still holds for this session.
  }
}

/**
 * Design 1a "Studio": board with its eval bar, transport row (with the deep-analysis
 * trigger) and a short eval curve on the left; the paired move table with everything said
 * about the position on the board stacked under it — the run's multi-PV lines, the live
 * search, Maia — on the right.
 *
 * The cursor is the ply *last played* (`-1` is the starting position). Everything about the
 * position on the board — the engine lines, Maia's prediction, the flagged-move marks —
 * therefore describes `moves[cursor + 1]`, the move about to happen, which is how a review
 * actually reads: you sit in the position and look at what is coming.
 */
export function GamePage() {
  const { id } = useParams<{ id: string }>()
  const gameId = Number(id)
  if (!Number.isInteger(gameId) || gameId <= 0) {
    return <GameLoadError error={new Error(`“${id}” is not a game id.`)} onRetry={() => {}} />
  }
  // Keyed on the id so navigating between games starts a fresh board rather than carrying
  // the previous game's cursor and orientation over.
  return <GameStudio key={gameId} gameId={gameId} />
}

/** A positive integer out of a query parameter, or null for anything else. */
function intParam(raw: string | null): number | null {
  if (raw === null) return null
  const value = Number(raw)
  return Number.isInteger(value) && value >= 0 ? value : null
}

function GameStudio({ gameId }: { gameId: number }) {
  const game = useGame(gameId, { notes: true })
  const deepAnalysis = useDeepAnalysis(gameId)

  const [cursor, setCursor] = useState(-1)
  const [flipped, setFlipped] = useState(false)
  const [hints, setHints] = useState(true)
  /** The first move of the engine line being pointed at, previewed on the board. */
  const [hoverMove, setHoverMove] = useState<string | null>(null)
  /**
   * The engine line being pointed at, whole — which row, how far into it, and its moves.
   * `hoverMove` is still Maia's: one move, one arrow. A line has a shape, and the board
   * draws it through `useLinePreview` below.
   */
  const [preview, setPreview] = useState<HoveredLine | null>(null)
  const previewPrefs = useLinePreviewPrefs()
  /**
   * The analysis line the reader has played off the game, if any: which game position it
   * branched from, the whole line, and how far into it the board stands. Null is "the board
   * is on the game", which is what keeps Maia on stored data.
   *
   * The line is kept whole and walked with the cursor rather than cut at the clicked move,
   * so clicking the fourth move of an engine PV leaves the rest of the PV to step through.
   */
  const [branch, setBranch] = useState<{
    base: number
    moves: string[]
    cursor: number
  } | null>(null)
  /**
   * The lines already walked this session, which stay in the move list once the board has
   * left them. Held outside the component, so they survive navigating to another game and
   * back within the open app (`./sessionVariations`).
   */
  const { kept, keep, drop } = useSessionVariations(gameId)
  /**
   * The lines pinned to this game on the server, and the notes hanging off them. They are
   * the same rows as the session's own in the move list — only their staying power differs
   * — so they are folded together in `./variationRows` rather than drawn twice.
   */
  const gameLines = useGameLines(gameId)
  const saveLine = useSaveLine()
  const removeLine = useDeleteLine()
  const saveNote = useSaveNote()
  const updateNote = useUpdateNote()
  const removeNote = useDeleteNote()
  const tags = useNoteTags()
  /**
   * The composer is always on screen under the board — a note is read in the same glance
   * as the position it is about, with no click in between. The Note button, the move
   * list's "add" and a Notes-tab row all just put the keyboard in it.
   */
  const focusComposer = useCallback(() => {
    document.getElementById(COMPOSER_TEXT_ID)?.focus()
  }, [])
  const blurComposer = useCallback(() => {
    const box = document.getElementById(COMPOSER_TEXT_ID)
    if (box && box === document.activeElement) box.blur()
  }, [])
  /**
   * A note the reader named rather than a position they walked to — the Notes tab hands one
   * over, and where a position carries two notes it decides which of them the composer is
   * rewriting. Never cleared: it only counts while it is still the note on the target
   * (`noteAtTarget`), so a stale id costs nothing.
   */
  const [preferredNote, setPreferredNote] = useState<number | null>(null)

  // --- the column split -----------------------------------------------------
  //
  // The row the two columns sit in, measured rather than remembered: a window resized
  // between two drags must not leave a stale ceiling behind.
  const columnsRef = useRef<HTMLDivElement | null>(null)
  /** The moves column in `rem`; null is "the design's basis", which is also the reset. */
  const [movesWidth, setMovesWidth] = useState<number | null>(readMovesWidth)
  const widthRef = useRef(movesWidth)
  /** The width the drag started from — deltas are measured off it, not off each other, so
   * dragging past a floor and back does not leave the pointer and the line apart. */
  const dragBase = useRef(DEFAULT_MOVES_REM)

  /**
   * A width the layout can actually hold: never under the move table's own floor, and never
   * so wide that the board drops under its. A row too narrow for both floors gives the move
   * table its floor and overflows, which is what the CSS `min-w` pair does anyway.
   */
  const clampWidth = useCallback((width: number) => {
    const row = columnsRef.current?.getBoundingClientRect().width ?? 0
    const available = row > 0 ? row / rootPx() : Number.POSITIVE_INFINITY
    const ceiling = Math.max(MOVES_FLOOR_REM, available - BOARD_FLOOR_REM)
    const clamped = Math.min(Math.max(width, MOVES_FLOOR_REM), ceiling)
    // Three decimals of a `rem` is a fifth of a pixel: enough to drag smoothly, short
    // enough to read in the DOM and in storage.
    return Math.round(clamped * 1000) / 1000
  }, [])

  const startResize = useCallback(() => {
    dragBase.current = clampWidth(widthRef.current ?? DEFAULT_MOVES_REM)
  }, [clampWidth])

  /**
   * The splitter reports raw pointer travel, rightwards positive, and the column it moves
   * is the one on its *right*: a pointer going right is the move table getting narrower,
   * so the delta is subtracted rather than added.
   */
  const resize = useCallback(
    (deltaPx: number) => {
      const next = clampWidth(dragBase.current - deltaPx / rootPx())
      widthRef.current = next
      setMovesWidth(next)
    },
    [clampWidth],
  )

  /** Storage is written where the drag settles, not on every pointer move. */
  const endResize = useCallback(() => writeMovesWidth(widthRef.current), [])

  /** Double-click forgets the width rather than storing the default over it. */
  const resetWidth = useCallback(() => {
    widthRef.current = null
    setMovesWidth(null)
    writeMovesWidth(null)
  }, [])

  const detail = game.data
  const moves = useMemo<MoveRow[]>(() => detail?.moves ?? [], [detail])
  const plyCount = moves.length

  const line = useMemo(() => buildGameLine(moves), [moves])
  const pairs = useMemo(() => pairMoves(moves), [moves])
  const curve = useMemo(() => evalCurve(moves), [moves])
  const notes = useMemo<GameNote[]>(
    () => sortNotes((detail?.notes ?? []) as GameNote[]),
    [detail],
  )
  /** The pinned lines, or an empty list while they are in flight. */
  const persisted = useMemo<LineResponse[]>(() => gameLines.data ?? [], [gameLines.data])
  /**
   * Every note this game carries, from both places one can arrive from: the game payload
   * (`?notes=true`, which already includes the notes pinned to its lines) and the lines
   * payload (which carries them again, with the line). Deduped by id, game payload first —
   * it is the one that knows a position note's ply in *this* game.
   */
  const allNotes = useMemo<GameNote[]>(() => {
    const byId = new Map<number, GameNote>()
    for (const note of notes) byId.set(note.id, note)
    for (const pinned of persisted) {
      for (const note of pinned.notes ?? []) {
        if (!byId.has(note.id)) byId.set(note.id, { ...note, scope: 'line' } as GameNote)
      }
    }
    return [...byId.values()]
  }, [notes, persisted])
  const noteList = useMemo<NoteRow[]>(
    () => noteRows(allNotes, persisted, moves),
    [allNotes, persisted, moves],
  )
  /** Every tag the owner has ever used, for the composer's suggestions. */
  const tagNames = useMemo(() => (tags.data ?? []).map((row) => row.tag), [tags.data])
  /** Which mainline moves carry a note, and which move of which line does. */
  const notedMoves = useMemo(() => notedMoveIndices(allNotes, persisted), [allNotes, persisted])
  const notedByLine = useMemo(() => notedLineIndices(persisted), [persisted])
  // The opening is never folded away: a move list that hides moves 1–18 behind a
  // "collapsed" rule cost a click on every game, and the Notes tab now does the job of
  // pointing at where the game got interesting.
  const collapsedThrough = null
  const flaggedCount = useMemo(
    () => moves.filter((move) => isFlagged(move.classification)).length,
    [moves],
  )

  const boardIndex = Math.min(cursor + 1, line.positions.length - 1)
  const position = line.positions[Math.max(0, boardIndex)]
  const played = cursor >= 0 ? moves[cursor] : undefined
  const upcoming = moves[cursor + 1]

  const { score, win } = useMemo(() => evalAtCursor(moves, cursor), [moves, cursor])
  const lines = useMemo(
    () => engineLines(line, boardIndex, upcoming),
    [line, boardIndex, upcoming],
  )
  // The board's arrow is the engine's move *here*, which is the top stored line for this
  // position — not the move that happens next, and nothing at all where no run has looked.
  // A live search running on this position speaks over it; that is `boardEngineBest`,
  // derived below because the stream session is opened further down.
  const engineBest = lines[0]?.firstUci ?? null

  // --- the analysis board ---------------------------------------------------
  //
  // The same board, one branch off the game: `buildAnalysisLine` with no moves is just the
  // game position, and is built anyway because it also carries the legal destinations
  // chessground needs to accept the first drag.
  const analysis = useMemo(
    () => buildAnalysisLine(line, branch?.base ?? boardIndex, branch?.moves ?? [], branch?.cursor),
    [line, branch, boardIndex],
  )
  // The moves actually on the board, not the moves of the line: walked back to its head, the
  // board is on the game position again and the stored data speaks for it once more.
  const exploring = (analysis?.cursor ?? 0) > 0
  const boardPosition = exploring && analysis ? analysis.position : position
  const analysisPly = analysis?.ply ?? boardIndex
  /** What the hovered line draws: the transient position, its shapes, and where it stands. */
  const previewView = useLinePreview(
    boardPosition?.fen ?? null,
    preview,
    previewPrefs,
    analysisPly,
  )

  /**
   * Hand the line the reader is walking to the session store, on the way out of it.
   *
   * Called from everything that abandons or replaces the branch — a step back past its
   * head, "Back to game", any seek, a click into another line, a drag that truncates it —
   * so that leaving a line is what keeps it, and nothing has to be pressed to say so.
   *
   * What is kept is the whole *replayed* line, `analysis.moves`, not the raw list it was
   * replayed from and not the part walked so far: the tail the reader never got to is still
   * theirs to come back to, and an illegal tail was never on the board to begin with.
   */
  const keepBranch = useCallback(() => {
    if (!branch || !analysis) return
    keep(analysis.base, analysis.moves)
  }, [analysis, branch, keep])

  const seek = useCallback(
    (next: number) => {
      setCursor(Math.max(-1, Math.min(plyCount - 1, next)))
      // A hovered line belongs to the position it was read in: leaving that position drops
      // the preview, even where the pointer never left the row it was drawn from.
      setHoverMove(null)
      setPreview(null)
      // Any move of the game cursor — a key, the transport, a click in the move list — is a
      // request to be back on the game, so the analysis line goes with it. It goes to the
      // kept list rather than nowhere.
      keepBranch()
      setBranch(null)
    },
    [keepBranch, plyCount],
  )
  /** Selecting a move puts the board *after* it, which is what a move list click means. */
  const selectPly = useCallback((ply: number) => seek(ply), [seek])

  /**
   * Walk into a line from the position on the board — an engine PV, a Maia rollout, a row.
   *
   * The caller hands over the whole line, measured from the position the board is showing,
   * and which of its moves was clicked. What is kept is everything already walked (the
   * moves up to the cursor) followed by that line entire, with the cursor just after the
   * clicked move: the board lands where the click asked, and the rest of the line is still
   * there to step through.
   *
   * The head comes from `analysis`, the replayed line — not `branch.moves`, the raw list it
   * was replayed from. The two part company the moment a click lands on a move that is not
   * legal here (a stale panel, two clicks in one batch): `buildAnalysisLine` drops the
   * illegal tail, and appending behind that tail would wedge the board on a line no later
   * move can extend. Building on what was actually replayed heals it on the next click.
   */
  const playLine = useCallback(
    (ucis: string[], index: number) => {
      if (ucis.length === 0 || !analysis) return
      // The line standing here is being replaced by another; it stays in the move list.
      keepBranch()
      setHoverMove(null)
      setPreview(null)
      setBranch({
        base: analysis.base,
        moves: [...analysis.moves.slice(0, analysis.cursor), ...ucis],
        // Clamped against what replays in `buildAnalysisLine`, so a click on a move the
        // position rejects leaves the board where it stands.
        cursor: analysis.cursor + index + 1,
      })
    },
    [analysis, keepBranch],
  )

  /** A drag in the middle of a line truncates it there and continues from the board move. */
  const playMove = useCallback(
    (orig: string, dest: string) => {
      if (!analysis) return
      const next = withBoardMove(analysis, orig, dest)
      if (!next) return
      // The truncated tail is not lost with the drag: the line as it stood is kept.
      keepBranch()
      setHoverMove(null)
      setPreview(null)
      setBranch({ base: analysis.base, moves: next, cursor: next.length })
    },
    [analysis, keepBranch],
  )

  /** Put the board after the `index`-th move of the line the reader is walking. */
  const seekVariation = useCallback(
    (index: number) => {
      if (!analysis) return
      setHoverMove(null)
      setPreview(null)
      setBranch({ base: analysis.base, moves: analysis.moves, cursor: index + 1 })
    },
    [analysis],
  )

  /**
   * Walk back into a line kept from earlier in the session: it becomes the active branch,
   * standing after its `index`-th move, and is walkable from there like a fresh one.
   *
   * A branch hangs off the game position after `base` plies, and that position is the one
   * the page derives from the game cursor — `boardIndex` is `cursor + 1`. So the game
   * cursor is put one ply short of the base: it is what makes `branch.base` and
   * `boardIndex` agree, and it is where stepping back out of the line will land.
   */
  const enterKeptVariation = useCallback(
    (id: number, index: number) => {
      const target = kept.find((entry) => entry.id === id)
      if (!target) return
      // Clicking into another line is leaving this one, which is what keeps it.
      keepBranch()
      setHoverMove(null)
      setPreview(null)
      setCursor(Math.max(-1, Math.min(plyCount - 1, target.base - 1)))
      setBranch({ base: target.base, moves: target.moves, cursor: index + 1 })
    },
    [keepBranch, kept, plyCount],
  )

  /**
   * One move forwards or back — the arrow keys and the wheel over the board.
   *
   * Inside a line that walks the line, forwards to its last move and back to its head; one
   * step further back leaves the line altogether, which puts the board on the game position
   * it branched from. Everywhere else it is a plain seek along the game.
   */
  const step = useCallback(
    (delta: number) => {
      if (!branch || !analysis) {
        seek(cursor + delta)
        return
      }
      const next = analysis.cursor + delta
      setHoverMove(null)
      setPreview(null)
      if (next < 0) {
        // Off the head of the line and back onto the game: the line stays in the table.
        keepBranch()
        setBranch(null)
      } else
        setBranch({
          base: analysis.base,
          moves: analysis.moves,
          cursor: Math.min(analysis.moves.length, next),
        })
    },
    [analysis, branch, cursor, keepBranch, seek],
  )

  /**
   * The wheel's step. Every other way off a position takes the keyboard with it — a click
   * moves focus, and the arrow keys are not shortcuts while a field has it — so the composer
   * saves itself on the way out. A wheel over the board moves nothing but the board, and a
   * note half-written on this position would otherwise follow the reader to the next one.
   * Blurring first writes it where it was meant, then the board moves.
   */
  const stepFromBoard = useCallback(
    (delta: number) => {
      blurComposer()
      step(delta)
    },
    [blurComposer, step],
  )

  /**
   * Every line of this session's reading, as the move list draws them: SAN, replayed against
   * *this* game, so a stored line can never disagree with the position it hangs off (one
   * that no longer replays at all simply drops out).
   *
   * The order is the order they were walked, and entering one does not change it. The line
   * the board is standing in is drawn in the slot of the kept entry it came out of — lit and
   * walkable, but exactly where it has always been — because a row that jumps to the front
   * of its anchor's stack the moment it is clicked is a table that will not hold still.
   * Only a line the store has never been handed is new enough to go last.
   */
  const rows = useMemo(
    () =>
      variationRows({
        line,
        persisted,
        kept,
        walked:
          branch && analysis && analysis.sans.length > 0
            ? {
                base: analysis.base,
                moves: analysis.moves,
                sans: analysis.sans,
                cursor: analysis.cursor,
              }
            : null,
        notedByLine,
      }),
    [analysis, branch, kept, line, notedByLine, persisted],
  )
  const variations = useMemo<MoveListVariation[]>(
    () =>
      rows.map((row) => ({
        id: row.keptId,
        lineId: row.lineId,
        base: row.base,
        moves: row.moves,
        sans: row.sans,
        cursor: row.cursor,
        pinnedThrough: row.pinnedThrough,
        noted: row.noted,
      })),
    [rows],
  )
  /** The row the board is standing in, which is the one a pin or a note would act on. */
  const walkedRow = useMemo(() => rows.find((row) => row.cursor !== null) ?? null, [rows])

  // --- pinned lines and notes -----------------------------------------------

  /**
   * Walk into a line the server holds, standing after `movesIn` of its moves.
   *
   * The same arithmetic as `enterKeptVariation`: a branch hangs off the game position after
   * `base` plies, and the page derives that position from `cursor + 1`, so the game cursor
   * goes one ply short of the base — which is also where stepping back out of the line
   * lands. The whole line is handed to the branch, not the part being entered, so the tail
   * is still there to step through.
   */
  const enterLine = useCallback(
    (lineId: number, movesIn: number) => {
      const target = persisted.find((entry) => entry.id === lineId)
      if (!target) return
      keepBranch()
      setHoverMove(null)
      setPreview(null)
      setCursor(Math.max(-1, Math.min(plyCount - 1, target.base_ply - 1)))
      setBranch({
        base: target.base_ply,
        moves: target.moves,
        cursor: Math.max(0, Math.min(target.moves.length, movesIn)),
      })
    },
    [keepBranch, persisted, plyCount],
  )

  /**
   * Keep a line with the game — or extend a pin the reading has grown past, which is the
   * same call: the backend folds a line that continues a kept one into that row.
   *
   * The session store hands the line over on success rather than keeping a second copy of
   * what the server now holds. It may well be handed back the moment the reader steps out
   * of the line again, which the fold absorbs.
   */
  const pinVariation = useCallback(
    (variation: MoveListVariation) => {
      const moves = [...(variation.moves ?? [])]
      if (moves.length === 0) return
      saveLine.mutate(
        { game_id: gameId, base_ply: variation.base, moves },
        {
          onSuccess: () => {
            if (variation.id !== null) drop(variation.id)
          },
        },
      )
    },
    [drop, gameId, saveLine],
  )

  const unpinVariation = useCallback(
    (lineId: number) => removeLine.mutate({ id: lineId, gameId }),
    [gameId, removeLine],
  )

  /**
   * What a new note would hang on: the position on the board, and off the game's own line
   * the whole walk as a variation to pin. Derived rather than chosen — see `./notesModel`.
   */
  const target = useMemo(
    () =>
      noteTarget({
        gameId,
        moves,
        boardIndex,
        fen: boardPosition.fen,
        branch:
          analysis && analysis.cursor > 0
            ? {
                base: analysis.base,
                moves: analysis.moves,
                sans: analysis.sans,
                cursor: analysis.cursor,
              }
            : null,
      }),
    [analysis, boardIndex, boardPosition, gameId, moves],
  )

  /**
   * The note already hanging where the composer is pointed, which it rewrites rather than
   * laying a second one beside. Only this game's own: a note that came here because some
   * other game reached the same position belongs to that game (`./notesModel`).
   */
  const editedNote = useMemo(
    () =>
      noteAtTarget({
        target,
        notes: allNotes,
        lines: persisted,
        lineId: walkedRow?.lineId ?? null,
        preferId: preferredNote,
      }),
    [allNotes, persisted, preferredNote, target, walkedRow],
  )

  /** Forget the note the composer is on. The composer goes with it. */
  const forgetNote = useCallback(
    (id: number) => removeNote.mutate(id),
    [removeNote],
  )

  const writeNote = useCallback(
    (text: string, noteTags: string[], id: number | null) => {
      if (id !== null) {
        // A rewrite of the note that is already there: it keeps the anchor it was written
        // with — the ply, the FEN, the line it pinned — and only the words change.
        updateNote.mutate({ id, body: { text, tags: noteTags } })
        return
      }
      saveNote.mutate(
        {
          text,
          tags: noteTags,
          game_id: gameId,
          fen: target.fen,
          ply: target.ply,
          line: target.line,
          source: 'web',
        },
        {
          onSuccess: () => {
            // The note has just pinned the walk, so the session's copy of it is redundant.
            if (target.line && walkedRow?.keptId !== null && walkedRow?.keptId !== undefined) {
              drop(walkedRow.keptId)
            }
          },
        },
      )
    },
    [drop, gameId, saveNote, target, updateNote, walkedRow],
  )

  // --- arriving from somewhere else ----------------------------------------
  //
  // `/games/{id}?ply=12` opens on the position after twelve half-moves, and `&line=3` opens
  // inside pinned line 3 (with `ply` then naming a position *in* the line, `base_ply + k`,
  // which is the same count a note carries). It is how the Notes page and the command
  // palette hand a position over, so the two must agree about what a `ply` is: everywhere
  // notes are concerned it is a half-move **count**, and the board's cursor is one less.
  //
  // Read once, applied once — a link is where the reader arrived, not a leash. Everything
  // they do afterwards moves the board freely, and the URL is deliberately not rewritten to
  // follow: this page has no business owning the address bar mid-review.
  const [params] = useSearchParams()
  const [requested] = useState(() => ({
    ply: intParam(params.get('ply')),
    line: intParam(params.get('line')),
  }))
  const arrived = useRef(false)
  useEffect(() => {
    if (arrived.current || !detail) return
    const { ply, line: lineId } = requested
    if (ply === null && lineId === null) {
      arrived.current = true
      return
    }
    // A line deep-link cannot be honoured before the lines are in; a bare ply can.
    if (lineId !== null && gameLines.isPending) return
    arrived.current = true

    const target = lineId === null ? undefined : persisted.find((entry) => entry.id === lineId)
    if (target) {
      setCursor(Math.max(-1, Math.min(plyCount - 1, target.base_ply - 1)))
      setBranch({
        base: target.base_ply,
        moves: target.moves,
        // No ply with the line means "the whole line"; a ply names a position inside it.
        cursor:
          ply === null
            ? target.moves.length
            : Math.max(0, Math.min(target.moves.length, ply - target.base_ply)),
      })
      return
    }
    // A line that is no longer pinned still leaves a position worth opening on.
    if (ply !== null) setCursor(Math.max(-1, Math.min(plyCount - 1, ply - 1)))
  }, [detail, gameLines.isPending, persisted, plyCount, requested])

  /**
   * A note in the Notes tab is a bookmark: jump to its ply, or into the line it pinned —
   * and open it, which is what picking a note out of a list means. A note that came in on a
   * position this game merely reached belongs to another game and is only a jump.
   */
  const selectNote = useCallback(
    (row: NoteRow) => {
      if (row.anchor.kind !== 'loose' && row.note.scope !== 'position') {
        setPreferredNote(row.note.id)
        focusComposer()
      }
      if (row.anchor.kind === 'line') {
        if (row.anchor.index === 0) {
          seek(row.anchor.base - 1)
          return
        }
        enterLine(row.anchor.lineId, row.anchor.index)
        return
      }
      if (row.anchor.kind === 'mainline') seek(row.anchor.count - 1)
    },
    [enterLine, focusComposer, seek],
  )

  // --- Maia -----------------------------------------------------------------
  //
  // The configured levels drive everything: the batch pass stores a policy per level, and
  // the live endpoint is asked at all of them in one call, so the panel can switch level or
  // compare them without a round trip and the two halves of the card never speak for two
  // different humans. Runs stored before a level was configured are keyed by whatever they
  // were computed at, which is what `preferredLevel` falls back to; the reader's own pick
  // (`maiaPreferences`) wins over both, resolved against what this position actually has.
  const elos = useMaiaElos()
  const targetElo = elos?.[0] ?? null
  const pick = useMaiaEloPick()
  const compare = useMaiaCompare()
  const storedLevels = useMemo(() => maiaLevels(upcoming?.maia), [upcoming])
  const stored = useMemo(
    () => maiaLevelFor(storedLevels, pick, detail?.game.rating, targetElo),
    [storedLevels, pick, detail, targetElo],
  )
  // Positions on the game line are stored data, instant and free; only an analysis position
  // is worth a query.
  const live = useLiveMaia(
    exploring ? boardPosition.fen : null,
    elos,
    // Off the game line there is no game rating to fall back on, so the pick falls back to
    // the deployment's first level rather than to the middle of what came back.
    pick ?? targetElo,
  )
  const maia = exploring ? (live.view?.level ?? null) : stored
  const human = useMemo(
    () => humanMoves(maia, exploring ? [] : lines, exploring ? undefined : upcoming),
    [maia, exploring, lines, upcoming],
  )
  // The levels on offer, and the comparison across them, are the same derivation whether
  // the position is stored or live — only where the levels came from differs.
  const maiaLevelsHere = useMemo(
    () => (exploring ? live.views.map((view) => view.level) : storedLevels),
    [exploring, live.views, storedLevels],
  )
  const levelOptions = useMemo(() => maiaLevelOptions(maiaLevelsHere, elos), [maiaLevelsHere, elos])
  const comparison = useMemo(
    () =>
      maiaComparison(
        maiaLevelsHere,
        exploring ? [] : lines,
        exploring ? undefined : upcoming,
      ),
    [maiaLevelsHere, exploring, lines, upcoming],
  )

  const annotation = useMemo<MoveAnnotation | null>(() => {
    const focus = isFlagged(upcoming?.classification)
      ? upcoming
      : isFlagged(played?.classification)
        ? played
        : undefined
    if (!focus?.classification) return null
    const best = focus.best_move_uci
      ? sanVariation(line, focus.ply, [focus.best_move_uci], 1)[0] ?? null
      : null
    return {
      ply: focus.ply,
      classification: focus.classification,
      before: scoreBefore(focus),
      after: scoreAfter(focus),
      winLoss: focus.win_loss ?? null,
      bestSan: best,
    }
  }, [line, played, upcoming])

  const finishedRuns = useMemo(() => detail?.runs ?? [], [detail])
  const best = useMemo(() => bestRun(finishedRuns), [finishedRuns])
  const deepRun = useMemo(
    () => bestRun(finishedRuns.filter((run) => run.tier === 'deep')),
    [finishedRuns],
  )
  const engineRun = useMemo(() => runFor(finishedRuns, upcoming), [finishedRuns, upcoming])

  // Design 1a's `PGN` affordance in the move-list tab row. No endpoint exports one, so it
  // is assembled from this payload (`./pgn`).
  const pgn = useMemo(
    () => (detail ? buildPgn(detail.game, moves) : undefined),
    [detail, moves],
  )

  const orientation: Side = useMemo(() => {
    const owner = detail?.game.color === 'black' ? 'black' : 'white'
    return flipped ? (owner === 'white' ? 'black' : 'white') : owner
  }, [detail, flipped])

  // The live search on the position the board is showing. Nothing is opened until the
  // reader asks for it, and scrubbing the move list PATCHes the one session rather than
  // opening one per ply.
  const stream = useStreamSession({
    surface: 'game',
    fen: boardPosition?.fen ?? null,
    gameId,
    ply: analysisPly,
  })

  /**
   * What the board actually points at: the live search's top move while one is running on
   * the position on the board, and the stored run's otherwise.
   *
   * `liveBest` drops a snapshot whose FEN is not this position — the reader scrubs faster
   * than the search reopens, and a stale arrow from two plies back is worse than no live
   * arrow at all. Off the game line the stored fallback is nothing, the same as it has
   * always been: the run never saw that position, so only the live search can speak for it.
   *
   * The stored-run box (`MaiaPanel`) is deliberately not told any of this. It is that run's
   * own box and its header reports whose numbers those are.
   */
  const boardEngineBest =
    liveBest(stream.snapshot, boardPosition?.fen ?? null) ?? (exploring ? null : engineBest)

  /**
   * What the eval bar and the score chip actually describe: the same rule as
   * `boardEngineBest`, because they are the same claim — a number about the position on the
   * board, not about the game. The live search wins while one is running on that exact
   * position; short of that, `score`/`win` are the game's own stored evals, and those are
   * only true of the game line. Off it (`exploring`) they go to null rather than keep
   * showing the game position's number under a board that has left it — a stale claim is
   * worse than an empty one, same as the arrow above.
   */
  const boardLiveScore = liveScore(stream.snapshot, boardPosition?.fen ?? null)
  const boardScore = boardLiveScore ?? (exploring ? null : score)
  const boardWin = boardLiveScore
    ? whiteWinPercent(boardLiveScore)
    : exploring
      ? null
      : win

  useBoardKeys(
    {
      step,
      seekStart: () => seek(-1),
      seekEnd: () => seek(plyCount - 1),
      // Landing one ply short puts the board in the position the mistake was made from,
      // which is where the engine lines and Maia's prediction are worth reading.
      nextFlagged: () => {
        const ply = nextFlaggedPly(moves, cursor + 1)
        if (ply !== null) seek(ply - 1)
      },
      previousFlagged: () => {
        const ply = previousFlaggedPly(moves, cursor + 1)
        if (ply !== null) seek(ply - 1)
      },
      flip: () => setFlipped((value) => !value),
    },
    !!detail,
  )

  if (game.isPending) return <GameViewSkeleton />
  if (game.isError || !detail || !position) {
    return (
      <GameLoadError
        error={game.error ?? new Error('The game payload was empty.')}
        onRetry={() => void game.refetch()}
      />
    )
  }

  const players = `${detail.game.white ?? '?'} — ${detail.game.black ?? '?'}`

  // The box sits above the move table whether or not a deep pass has finished: the panel
  // moving as analysis lands read as a layout bug, so it keeps one place.
  //
  // The human column beside the engine's own is what `hints` turns off; the run's own
  // findings are not a hint and stay either way. Off the game line the human column is a
  // live query, dropped entirely where the deployment has no Maia to ask
  // (`live.unavailable`) rather than reporting a failure.
  //
  // Its engine rows are previewed by the same hook as the live panel below: one `preview`
  // state, one `useLinePreview`, and the namespaced ids (`run:1` here, `live:1` there) are
  // what keeps the two boxes' line 1 from being the same row. `onHoverMove` stays for the
  // human column, the compare grid and the rollout, which offer single moves.
  const maiaPanel = (
    <MaiaPanel
      rating={maia?.rating ?? null}
      human={human}
      levels={levelOptions}
      onSelectLevel={setMaiaEloPick}
      compare={compare}
      onCompareChange={setMaiaCompare}
      comparison={comparison}
      showHuman={hints && !(exploring && live.unavailable)}
      run={engineRun}
      // A stored run says nothing about a position it never saw: off the game line the
      // column empties rather than describing the position the reader has left.
      engine={exploring ? [] : lines}
      ply={analysisPly}
      fen={boardPosition.fen}
      live={exploring ? { rollout: live.view?.rollout ?? [], pending: live.pending } : null}
      orientation={orientation}
      onHoverMove={setHoverMove}
      onHoverLine={setPreview}
      onStepPreview={previewView.step}
      previewLine={previewView.line}
      previewPly={previewView.ply}
      onPlayLine={playLine}
      className="border-b border-t-0 border-hairline"
    />
  )

  return (
    <>
      <SetPageChrome
        breadcrumb={[
          { label: 'Library', to: '/games' },
          { label: formatGameDate(detail.game.played_at), mono: true },
          { label: players },
        ]}
      />

      <div ref={columnsRef} className="flex min-h-0 flex-1">
        {/*
          Column floors are in `rem`, so at the app's scale the board never drops below
          504 physical pixels and the move table never below 384 — both clear of the
          420/280 the design set at 100 % for these two columns, now that there is no
          third.

          Which of the two takes the spare width is the whole point of the split. The move
          table is a fixed thing to read — a move number and two SAN cells — and a room's
          worth of it is whitespace, so it is the column that is *sized*: `grow-0` on
          `movesWidth`, 26rem until somebody drags it. Everything left over is the board's
          (`flex-1`), which is the one element on the page that is worth more the larger it
          is. Growing sideways is not free, though: the board is square, so width is height,
          and past a point it would push the transport row and the eval curve out of the
          viewport — which is why `BoardPanel` caps it against `100vh` and centres what it
          caps. The floors are unchanged.

          Between those two floors the boundary is the reader's: the hairline is a
          `ColumnSplitter`, and what it drags is `movesWidth` — held here in `rem` and
          remembered under `blunderbase.gameMovesWidth`. The splitter reports pointer travel
          and nothing else, so the direction is decided in `resize`: rightwards is a
          narrower move table. The floors are still the invariant. Every drag is clamped to
          them against the row's measured width, and the `min-w` pair holds them again in
          CSS for a width no drag produced. Until something is dragged there is no stored
          width and the column keeps its own `basis-[26rem]`.
        */}
        <div
          data-testid="board-column"
          // `min-h-0` and `overflow-hidden`: the row is exactly the viewport's height and
          // the board in it is sized by its width, so a column that is allowed to grow past
          // its box grows silently *below the fold* — which is where the eval curve and the
          // composer's own save button used to end up. Clipped, an overrun is visible.
          className="flex min-h-0 min-w-[26.25rem] flex-1 flex-col gap-3.5 overflow-hidden px-5 py-[1.125rem]"
        >
          <GameHeaderBar game={detail.game} best={best} active={deepAnalysis.activeRun} />
          <BoardPanel
            position={position}
            analysis={analysis}
            onPlayMove={playMove}
            onExitAnalysis={() => {
              keepBranch()
              setBranch(null)
            }}
            orientation={orientation}
            lastMove={played}
            // The marks and the engine arrow are claims about a position a run has looked
            // at; on an analysis position there is no such claim, and only Maia's own
            // (live) arrow is left — and the live search's, which is looking at exactly the
            // position on the board (`boardEngineBest` carries that rule).
            upcoming={exploring ? undefined : upcoming}
            engineBest={boardEngineBest}
            hoverMove={hoverMove}
            previewFen={previewView.fen}
            previewShapes={previewView.shapes}
            previewLastMove={previewView.lastMove}
            previewCaption={previewView.caption}
            previewDim={previewView.dim}
            maia={maia}
            win={boardWin}
            score={boardScore}
            cursor={cursor}
            plyCount={plyCount}
            hints={hints}
            onHintsChange={setHints}
            onFlip={() => setFlipped((value) => !value)}
            onSeek={seek}
            onStep={stepFromBoard}
            deepRun={deepRun}
            deepActiveRun={deepAnalysis.activeRun}
            deepProgress={deepAnalysis.progress}
            deepPending={deepAnalysis.pending}
            deepError={deepAnalysis.error}
            onRequestDeep={deepAnalysis.request}
            onNote={focusComposer}
          />
          {/*
            The composer sits to the right of the eval curve under the transport row, always: the
            note on a position is read in the same glance as the position, and side by side
            the pair costs no more height than the curve did alone.
          */}
          <div className="flex min-h-0 flex-1 gap-3.5">
            <EvalGraph
              points={curve}
              plyCount={plyCount}
              cursor={cursor}
              ownerSide={detail?.game.color ?? null}
              onSelectPly={selectPly}
              className="min-w-0 flex-1 basis-1/2"
            />
            <NoteComposer
              target={target}
              note={editedNote}
              knownTags={tagNames}
              pending={saveNote.isPending || updateNote.isPending}
              error={saveNote.error ?? updateNote.error ?? removeNote.error}
              onSave={writeNote}
              onDelete={forgetNote}
              onClose={blurComposer}
              className="max-h-[6.5rem] min-w-0 flex-1 basis-1/2"
            />
          </div>
        </div>

        <ColumnSplitter
          label="Moves column width"
          onResizeStart={startResize}
          onResize={resize}
          onResizeEnd={endResize}
          onReset={resetWidth}
        />

        <div
          data-testid="moves-column"
          className={cn(
            'flex min-w-[20rem] grow-0 flex-col',
            movesWidth === null && 'basis-[26rem]',
          )}
          style={movesWidth === null ? undefined : { flexBasis: `${movesWidth}rem` }}
        >
          {maiaPanel}
          <MoveList
            pairs={pairs}
            cursor={cursor}
            collapsedThrough={collapsedThrough}
            annotation={annotation}
            flaggedCount={flaggedCount}
            plyCount={plyCount}
            pgn={pgn}
            // Every line this session has walked, each under the move it hangs off and in
            // the order they were walked — the one the board is standing in among them.
            variations={variations}
            onSelectVariationMove={seekVariation}
            onSelectKeptMove={enterKeptVariation}
            onSelectLineMove={(lineId, index) => enterLine(lineId, index + 1)}
            onPinVariation={pinVariation}
            onUnpinVariation={unpinVariation}
            onSelectPly={selectPly}
            notes={noteList}
            notedMoves={notedMoves}
            onSelectNote={selectNote}
            onAddNote={focusComposer}
            className="min-h-0 flex-1"
          />
          {/*
            The whole line, not its first move: `onHoverLine` replaces the single arrow
            `onHoverMove` drew here, and the preview it feeds is what the board shows. The
            box above reports the same three gestures from its engine rows, into the same
            state — the ids are what keeps the two apart.
          */}
          <InfiniteAnalysisPanel
            stream={stream}
            fen={boardPosition.fen}
            ply={analysisPly}
            orientation={orientation}
            onHoverLine={setPreview}
            onStepPreview={previewView.step}
            onPlayLine={playLine}
            previewLine={previewView.line}
            previewPly={previewView.ply}
          />
          {/*
            Two panels, two different claims about the same position: the live search says
            what an engine is finding right now, and the box at the top of the column says
            what the stored run concluded and what a human of this rating would play. The
            deep-analysis trigger lives in the board's transport row now, rather than here.
          */}
        </div>
      </div>
    </>
  )
}
