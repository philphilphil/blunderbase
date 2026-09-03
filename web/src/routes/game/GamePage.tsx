import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { InfiniteAnalysisPanel } from '@/components/analysis/InfiniteAnalysisPanel'
import { BOARD_SETTINGS_ID } from '@/components/board/BoardSettings'
import { SetPageChrome } from '@/components/shell/PageChrome'
import { PageBody } from '@/components/shell/PageHeader'
import { liveBest, liveScore, useStreamSession } from '@/lib/analysis'
import {
  useDeleteLine,
  useDeleteNote,
  useGame,
  useGameLines,
  useMaiaElos,
  useNoteTags,
  usePositionBook,
  useReferenceGame,
  useSaveLine,
  useSaveNote,
  useUpdateNote,
} from '@/lib/api/queries'
import type { LineResponse, MoveRow, ReferenceSource } from '@/lib/api/types'
import { cachedReplay } from '@/lib/board/linePreview'
import { useLinePreviewPrefs } from '@/lib/board/linePreviewPrefs'
import { useMoveSound } from '@/lib/board/moveSound'
import { useLinePreview, type HoveredLine } from '@/lib/board/useLinePreview'
import { isFlagged } from '@/lib/chess/classification'
import { whiteWinPercent } from '@/lib/chess/evaluation'
import { useIsMobile } from '@/lib/ui/media'
import { cn } from '@/lib/utils'
import { ReferenceTokenCard } from '@/routes/explorer/components/ReferenceTokenCard'
import { advanceTrail, useGameTrail } from '@/routes/games/gameTrail'
import { tokenTrouble } from '@/routes/explorer/reference'

import { buildAnalysisLine, lineStartingWith, withBoardMove } from './analysisLine'
import { BoardPanel } from './components/BoardPanel'
import type { BookMove } from './components/BookPanel'
import { ColumnSplitter } from './components/ColumnSplitter'
import { EvalGraph } from './components/EvalGraph'
import { FlaggedMoments } from './components/FlaggedMoments'
import { GameHeaderBar } from './components/GameHeaderBar'
import { GameLoadError, GameViewSkeleton } from './components/GameStates'
import { MaiaPanel } from './components/MaiaPanel'
import { MobileGameView, type MobileTab } from './components/MobileGameView'
import {
  MoveList,
  PGN_BUTTON_ID,
  type MoveAnnotation,
  type MoveListVariation,
  type MoveTab,
} from './components/MoveList'
import { COMPOSER_TEXT_ID, NoteComposer } from './components/NoteComposer'
import { NotesTrack } from './components/NotesTrack'
import { StudioActions } from './components/StudioActions'
import {
  bestRun,
  buildGameLine,
  engineLines,
  evalAtCursor,
  evalCurve,
  formatGameDate,
  formatVariation,
  gameAnalysisSummary,
  humanMoves,
  maiaComparison,
  maiaLevelFor,
  maiaLevelOptions,
  maiaLevels,
  nextFlaggedPly,
  pairMoves,
  previousFlaggedPly,
  runFor,
  sameMove,
  sanVariation,
  scoreAfter,
  scoreBefore,
  sortNotes,
  type EngineLineView,
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
import { referenceDetail } from './referenceGame'
import { useSessionVariations } from './sessionVariations'
import { variationRows } from './variationRows'
import { useAnalysisRequest } from './useAnalysisRequest'
import { useBoardKeys } from './useBoardKeys'
import { useLiveMaia } from './useLiveMaia'

// --- the right column's width ---------------------------------------------
//
// The board is flush left and takes what the right column does not, so the boundary between
// the two is the one that trades board size against everything else — which is the whole
// point of this screen. What is stored is the *right column's* width, in `rem`, the unit the
// page lays out in: a physical pixel count would stop meaning the same column the moment the
// root scale moved (`lib/ui/scale.ts`). Page-local state rather than a store — nothing
// outside this page reads it, and a second tab arranging its columns differently is not a
// conflict to reconcile.
//
// The key is still `gameMovesWidth`: it is the same boundary a reader dragged before the
// rebuild, and a width they set then is still a width they meant. Only what stands to the
// right of it grew from the move table alone to the move table plus everything else.

export const MOVES_WIDTH_KEY = 'blunderbase.gameMovesWidth'

/**
 * The bands, and what the right column may not go under in each.
 *
 * The tracks inside the column are fixed per band by CSS on the column itself — 340/300/250
 * design pixels for the move table, the rest for the notes track — so the column's floor is
 * that track plus the least a book row can be read in beside it (a move, a game count, a
 * split bar and an average drop: ~180 design pixels, and more where there is room for it).
 * Written the way everything here is: design pixels over 16 to `rem`, which the 120 % root
 * then renders 1.2× larger. The *band* boundaries are physical pixels, because media queries
 * do not scale with the root (`index.css`).
 *
 * The board's own floor only holds from `xl` up. Below it the board yields instead: at 1280
 * physical pixels the sidebar and the right column have already spent most of the row, and a
 * floor there would buy a horizontal scrollbar rather than a bigger board.
 */
const BANDS = [
  { from: 1600, right: 35.25, board: 26.25 },
  { from: 1280, right: 31.75, board: 26.25 },
  { from: 0, right: 26.875, board: 0 },
] as const

/** Which band the window is in, as its two floors. */
function floors(): { right: number; board: number } {
  const width = typeof window === 'undefined' ? 1600 : window.innerWidth
  return BANDS.find((band) => width >= band.from) ?? BANDS[BANDS.length - 1]
}

/**
 * The width a drag falls back to when the column cannot be measured. Nothing normally uses
 * it — an untouched column is sized by CSS per band and a drag starts from what is on screen
 * — so this is only the answer for a drag that begins before layout has happened.
 */
const DEFAULT_RIGHT_REM = 36

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
    return Math.max(width, floors().right)
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
/**
 * How long one ply of "play the game through" stands on screen.
 *
 * Under a second, because this is for re-watching a game already read rather than for
 * reading one: fast enough that a twenty-move opening goes past in fifteen seconds, slow
 * enough that a capture registers before the next move lands on it.
 */
const AUTOPLAY_MS = 800

export function GamePage() {
  const { id } = useParams<{ id: string }>()
  const gameId = Number(id)
  if (!Number.isInteger(gameId) || gameId <= 0) {
    return <GameLoadError error={new Error(`“${id}” is not a game id.`)} onRetry={() => {}} />
  }
  // Keyed on the id so navigating between games starts a fresh board rather than carrying
  // the previous game's cursor and orientation over.
  return <GameStudio key={gameId} game={{ kind: 'library', id: gameId }} />
}

/**
 * Where the studio's game comes from.
 *
 * Two sources, one screen. A library game is a row the owner owns, with runs and notes and
 * an id; a reference game is a model game out of the masters or lichess book, which the
 * owner does not own and which has no row at all (`./referenceGame`). Everything the studio
 * does that is worth doing to a game it has never analysed works off the position — the live
 * search, Maia, the analysis board, the book — so both get the same screen rather than the
 * second getting a cut-down copy of the first that drifts out of step with it.
 */
export type StudioGame =
  | { kind: 'library'; id: number }
  | { kind: 'reference'; source: ReferenceSource; id: string }

/** A positive integer out of a query parameter, or null for anything else. */
function intParam(raw: string | null): number | null {
  if (raw === null) return null
  const value = Number(raw)
  return Number.isInteger(value) && value >= 0 ? value : null
}

/**
 * Whether the human column queries Maia for a position off the game line.
 *
 * OFF. Not because it does not work — it does — but because it made the two engines behave
 * by different rules on the same screen: Stockfish says nothing about an analysis position
 * until the reader switches the live search on, while Maia answered every position the
 * board landed on, unasked. One box, two contracts, and the reader is left working out
 * which of the two numbers in front of them was volunteered and which was requested.
 *
 * The open question is where a live human model belongs — under the same switch as the live
 * search, so that "analyse this position" turns both on together, or in the live panel at
 * the foot of the column beside the engine's own lines. Until that is settled the column is
 * simply quiet off the game line, which is what the engine column has always done.
 *
 * Stored Maia on the game line is untouched: it is what the run computed, and it is free.
 */
const LIVE_MAIA = false

export function GameStudio({ game: from }: { game: StudioGame }) {
  /*
   * One of the two queries runs and the other stands down, and everything below reads
   * `query` and `detail` without caring which. A reference game has no id in the library, so
   * `gameId` is null for one — and null is what turns off every request and every mutation
   * that would need one. `readOnly` is the same fact stated for the UI: nothing here can be
   * analysed, noted or pinned, because there is nothing on the server to hang any of it off.
   */
  const gameId = from.kind === 'library' ? from.id : null
  const readOnly = from.kind === 'reference'
  const library = useGame(gameId ?? 0, { notes: true }, { enabled: gameId !== null })
  const referenceGame = useReferenceGame(
    from.kind === 'reference' ? from.source : 'masters',
    from.kind === 'reference' ? from.id : '',
    { enabled: readOnly },
  )
  const query = readOnly ? referenceGame : library
  const referenceDetailValue = useMemo(
    () => (readOnly ? referenceDetail(referenceGame.data) : undefined),
    [readOnly, referenceGame.data],
  )
  const analysisRequest = useAnalysisRequest(gameId)
  const navigate = useNavigate()
  // Where the reader came from: the way back to the explorer for a game opened from there
  // (`backToExplorer`, below). The way *out* to the explorer reads only the pathname off
  // this — see `openInExplorer`, which writes its own query.
  const location = useLocation()

  /**
   * Below `md` the screen is `MobileGameView` instead of the two-column studio — a pinned
   * board over one tabbed pane. Asked as a media query rather than left to `max-md:`
   * classes because the two layouts are different *trees*, not one tree in two shapes: the
   * `ColumnSplitter` has to be unmounted rather than hidden (it binds pointer capture and
   * takes the body's selection on a drag a phone cannot make), and the panels are in a
   * different order under a different set of parents.
   */
  const mobile = useIsMobile()
  /**
   * Which panel the phone is showing. Page state, not persisted: a game is opened to look
   * at the game, and landing on the moves every time is the predictable thing. Held here
   * rather than inside `MobileGameView` because it is not only the strip that moves it —
   * writing a note switches to the Notes tab, which is where the composer lives.
   */
  const [mobileTab, setMobileTab] = useState<MobileTab>('moves')

  /**
   * The desktop move column's tab, held here rather than inside `MoveList` so `t` can move
   * it. The table still owns its own where nobody passes one — the explorer's board does —
   * and the phone's tab is `mobileTab` above, since there the strip carries four panes and
   * not two.
   */
  const [columnTab, setColumnTab] = useState<MoveTab>('moves')

  const [cursor, setCursor] = useState(-1)
  /** Whether the game is playing itself through, a ply at a time (Space). */
  const [playing, setPlaying] = useState(false)
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
  const { kept, keep, drop } = useSessionVariations(
    gameId ?? `${from.kind === 'reference' ? from.source : ''}:${from.id}`,
  )
  /**
   * The lines pinned to this game on the server, and the notes hanging off them. They are
   * the same rows as the session's own in the move list — only their staying power differs
   * — so they are folded together in `./variationRows` rather than drawn twice.
   */
  // Nothing pins a line to a game that is not in the library, so the request is not made.
  const gameLines = useGameLines(gameId ?? 0, { enabled: gameId !== null })
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
  /**
   * On the phone the composer is only mounted while the Notes tab is open, so focusing it
   * means going there first — and the focus has to wait for the tab to render, which is
   * what the counter and its effect below are for. The desktop path is unchanged and stays
   * synchronous: the composer is always on screen there, and a click straight into it
   * should not have to wait a render.
   */
  const [composerFocus, setComposerFocus] = useState(0)
  const focusComposer = useCallback(() => {
    if (mobile) {
      setMobileTab('notes')
      setComposerFocus((request) => request + 1)
      return
    }
    document.getElementById(COMPOSER_TEXT_ID)?.focus()
  }, [mobile])
  useEffect(() => {
    if (composerFocus === 0) return
    document.getElementById(COMPOSER_TEXT_ID)?.focus()
  }, [composerFocus])
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
  /** The right column itself, so a drag can start from the width it is actually drawn at. */
  const rightRef = useRef<HTMLDivElement | null>(null)
  /** The right column in `rem`; null is "the design's basis", which is also the reset. */
  const [movesWidth, setMovesWidth] = useState<number | null>(readMovesWidth)
  const widthRef = useRef(movesWidth)
  /** The width the drag started from — deltas are measured off it, not off each other, so
   * dragging past a floor and back does not leave the pointer and the line apart. */
  const dragBase = useRef(DEFAULT_RIGHT_REM)

  /**
   * A width the layout can actually hold: never under the right column's own floor for this
   * band, and never so wide that the board drops under its. A row too narrow for both floors
   * gives the right column its floor and overflows, which is what the CSS `min-w` does
   * anyway.
   */
  const clampWidth = useCallback((width: number) => {
    const row = columnsRef.current?.getBoundingClientRect().width ?? 0
    const available = row > 0 ? row / rootPx() : Number.POSITIVE_INFINITY
    const { right, board } = floors()
    const ceiling = Math.max(right, available - board)
    const clamped = Math.min(Math.max(width, right), ceiling)
    // Three decimals of a `rem` is a fifth of a pixel: enough to drag smoothly, short
    // enough to read in the DOM and in storage.
    return Math.round(clamped * 1000) / 1000
  }, [])

  /**
   * Where the drag starts: the width the column is drawn at right now, measured, rather than
   * the width state remembers. Until somebody drags it the column has no remembered width at
   * all — its basis comes from CSS and changes with the band — and a drag that began from a
   * number the screen does not show would jump on the first pointer move.
   */
  const startResize = useCallback(() => {
    const drawn = rightRef.current?.getBoundingClientRect().width ?? 0
    const from = drawn > 0 ? drawn / rootPx() : (widthRef.current ?? DEFAULT_RIGHT_REM)
    dragBase.current = clampWidth(from)
  }, [clampWidth])

  /**
   * The splitter reports raw pointer travel, rightwards positive, and the column it moves
   * is the one on its *right*: a pointer going right is the right column getting narrower
   * (and the board bigger), so the delta is subtracted rather than added.
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

  const detail = readOnly ? referenceDetailValue : library.data
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
  const analysisSummary = useMemo(() => gameAnalysisSummary(moves), [moves])

  // Where `j` and `shift+J` land, as cursors rather than as plies: one ply short of the
  // flagged move, which puts the board in the position the mistake was made *from* — where
  // the engine lines and Maia's prediction are worth reading. Held here rather than
  // computed twice because the phone layout draws the same two jumps as buttons, and the
  // key and the button must be the same jump. Null is "none that way", which is what
  // disables the button.
  const nextFlagged = useMemo(() => {
    const ply = nextFlaggedPly(moves, cursor + 1)
    return ply === null ? null : ply - 1
  }, [moves, cursor])
  const previousFlagged = useMemo(() => {
    const ply = previousFlaggedPly(moves, cursor + 1)
    return ply === null ? null : ply - 1
  }, [moves, cursor])

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

  // The board's click, once for the whole page: the phone layout and the desktop one are
  // both rendered from here, and both move the same cursor. The key is the position the
  // board stands on — a walked analysis line sounds like the game does, and a hovered engine
  // line, which scrubs the board without moving it, deliberately does not.
  useMoveSound(
    exploring && analysis ? `line:${analysis.base}:${analysis.cursor}` : `game:${cursor}`,
    exploring && analysis ? (analysis.sans[analysis.cursor - 1] ?? null) : (played?.san ?? null),
  )

  /*
   * The book for a board that has left the game line.
   *
   * The game ships its own book with it, keyed by ply, which covers stepping through the
   * game and costs no request — asking per ply while somebody holds an arrow key down is
   * the shape that took the server down once already. But the moment the reader plays a
   * move of their own, whether that is walking a book continuation or dragging a piece
   * somewhere nobody has ever been, the board stands on a position that payload cannot
   * describe. That is a deliberate act, one position at a time, so it is the one place a
   * request is the right answer — and react-query keys it by the position, so walking back
   * and forth over the same square asks once.
   */
  const exploredBook = usePositionBook(exploring ? (boardPosition?.fen ?? null) : null)
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

  /**
   * Leave the line for the game position it branched from — "Back to game", and Escape.
   *
   * One callback for both because they are one gesture: the button under the board and the
   * key are the same request, and the line goes to the kept list either way rather than
   * being thrown away for having been left.
   */
  const exitLine = useCallback(() => {
    keepBranch()
    setBranch(null)
  }, [keepBranch])

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

  /**
   * A continuation out of the book table, walked on the board — the same gesture as clicking
   * an engine line's first move, and the same machinery: one move is a line of length one.
   */
  const playBookMove = useCallback((move: BookMove) => playLine([move.uci], 0), [playLine])

  /**
   * A book row under the pointer, shown on the board without being walked into.
   *
   * It goes through the page's one `preview` state, so hovering a book move and hovering an
   * engine line cannot both be drawn at once, and the board's own preview machinery
   * (`useLinePreview`) replays it from the position on the board. `book` is the row id the
   * two panels' ids are namespaced against (`run:1`, `live:1`).
   */
  const previewBookMove = useCallback((continuation: string[] | null) => {
    setPreview(
      continuation && continuation.length > 0
        ? { line: 'book', ply: continuation.length, pv: continuation }
        : null,
    )
  }, [])

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

  /**
   * The Book tab's arrow: this exact position, opened in `/explorer`.
   *
   * `?fen=` roots the explorer's tree at a position whose move order it was never told,
   * which is precisely this case — the board may be three plies into a line nobody played.
   * The game comes along as router state rather than as a query parameter, the same way
   * `ModelGames` hands the explorer position to a game it opens: it is not part of which
   * position is being read, it is where the reader came from, and the explorer offers the
   * way back under its own board.
   *
   * THE WAY BACK IS BUILT, NOT COPIED. This page deliberately never rewrites its own URL as
   * the board moves, so `location.search` is where the reader *arrived* — by now often forty
   * plies behind them, and usually the start of the game. Handing that over would make "Back
   * to game" mean "back to the beginning". So the address is written from where the board
   * actually stands, in the vocabulary this page already reads on arrival: `?ply=` is a
   * half-move count, and a pinned line adds `&line=` with the ply counted inside it.
   *
   * A line nobody has pinned cannot be named in a URL at all, so it returns to the game
   * position the line hangs off — the position it would step back onto anyway.
   */
  const openInExplorer = useCallback(() => {
    const fen = boardPosition?.fen
    if (!fen) return
    const back = new URLSearchParams()
    if (walkedRow?.lineId != null) {
      back.set('line', String(walkedRow.lineId))
      back.set('ply', String(analysisPly))
    } else {
      back.set('ply', String(exploring && analysis ? analysis.base : boardIndex))
    }
    navigate(`/explorer?fen=${encodeURIComponent(fen)}`, {
      state: { from: `${location.pathname}?${back.toString()}` },
    })
  }, [
    analysis,
    analysisPly,
    boardIndex,
    boardPosition,
    exploring,
    location.pathname,
    navigate,
    walkedRow,
  ])

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
      if (moves.length === 0 || gameId === null) return
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
    (lineId: number) => gameId !== null && removeLine.mutate({ id: lineId, gameId }),
    [gameId, removeLine],
  )

  /**
   * What a new note would hang on: the position on the board, and off the game's own line
   * the whole walk as a variation to pin. Derived rather than chosen — see `./notesModel`.
   */
  const target = useMemo(
    () =>
      noteTarget({
        // Only ever read where a note can actually be written, which is a library game.
        gameId: gameId ?? 0,
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
      if (gameId === null) return
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
  // A game reached from the reference explorer — a model game just added to the library —
  // carries the explorer position it came from in router state (`ModelGames` puts it
  // there), and the titlebar offers the way back. Nothing else sets that state, and a
  // stale or hand-made one that is not an explorer URL is ignored rather than trusted.
  const cameFrom = (location.state as { from?: unknown } | null)?.from
  const backToExplorer =
    typeof cameFrom === 'string' && cameFrom.startsWith('/explorer') ? cameFrom : null
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
    LIVE_MAIA && exploring ? boardPosition.fen : null,
    elos,
    // Off the game line there is no game rating to fall back on, so the pick falls back to
    // the deployment's first level rather than to the middle of what came back.
    pick ?? targetElo,
  )
  const maia = exploring ? (live.view?.level ?? null) : stored
  /**
   * Whether the human column has anything to say here at all: stored data on the game line,
   * and off it only where the live query is switched on (`LIVE_MAIA`) and the deployment has
   * a Maia to ask. Otherwise the pane keeps its place and its header and stays quiet.
   */
  const humanColumn = exploring ? LIVE_MAIA && !live.unavailable : true
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

  /**
   * The note under the move table, and the one move it is ever about: the move the cursor
   * is standing on.
   *
   * It used to prefer the *upcoming* move — the one the game plays next from here — so that
   * `j`, which lands one ply short of a mistake, arrived with the verdict already written.
   * That made the note ambiguous in both directions. It hung under the pair row containing a
   * move that had not been played, which is a row below the highlighted one whenever the
   * upcoming move is White's; and stepping onto the mistake could keep the previous note on
   * screen when the next move was flagged too, so a note about White's move stood while the
   * board was a move past it. One rule now: the note describes the move at the cursor, it
   * names that move (`MoveAnnotation.san`), and standing before a mistake says nothing —
   * which is the point of landing there.
   */
  const annotation = useMemo<MoveAnnotation | null>(() => {
    if (!isFlagged(played?.classification) || !played?.classification) return null
    const best = played.best_move_uci
      ? sanVariation(line, played.ply, [played.best_move_uci], 1)[0] ?? null
      : null
    return {
      ply: played.ply,
      san: played.san ?? null,
      classification: played.classification,
      before: scoreBefore(played),
      after: scoreAfter(played),
      winLoss: played.win_loss ?? null,
      bestSan: best,
    }
  }, [line, played])

  const finishedRuns = useMemo(() => detail?.runs ?? [], [detail])
  const best = useMemo(() => bestRun(finishedRuns), [finishedRuns])
  const deepRun = useMemo(
    () => bestRun(finishedRuns.filter((run) => run.tier === 'deep')),
    [finishedRuns],
  )
  // `bestRun` drops `maia_only` rows on its own, so a Maia fill (filed under the quick
  // tier) never lights this — only an actual quick search does.
  const quickRun = useMemo(
    () => bestRun(finishedRuns.filter((run) => run.tier === 'quick')),
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
   * Every line on offer for the position the board is standing on, best first, in UCI.
   *
   * One list, because three different gestures ask the same question — ↵ plays the first of
   * them, a drag is checked against all of them, and the arrow points along the first — and
   * they must not disagree about who is speaking for this position. The live search wins
   * while one is running on exactly this FEN; short of that the stored run's lines speak,
   * and only on the game line, since that is the only position it ever looked at.
   */
  const boardPvs = useMemo(() => {
    const fen = boardPosition?.fen ?? null
    const snapshot = stream.snapshot
    if (snapshot && fen && snapshot.fen === fen) {
      return [...snapshot.lines].sort((a, b) => a.multipv - b.multipv).map((row) => row.pv)
    }
    return exploring ? [] : lines.map((row) => row.pv).filter((pv) => pv.length > 0)
  }, [boardPosition, exploring, lines, stream.snapshot])

  /**
   * The run's own lines, re-read from a board that has walked into one of them.
   *
   * Walking an engine's PV used to empty the whole box: the moment the board left the game
   * line the stored rows stopped applying, so clicking the engine's recommendation — the
   * one move on the board the engine has an opinion about — was the gesture that took the
   * evaluation, the arrow and the variation away at once, leaving the line visible in the
   * move table and nowhere else.
   *
   * But a PV *is* the engine's claim about where the line goes and what it is worth, and it
   * does not stop being that claim because the board has walked two plies into it. So while
   * the moves played from the branch's root are a prefix of one of the run's lines, the box
   * keeps that line and shortens it: the same eval, the same variation, minus the moves now
   * behind the board. Standing a move deeper shows a move less, and stepping back up the
   * line puts it back.
   *
   * A prefix, not an equality: a move that leaves every line drops the match, and the box
   * empties as it always did — the run never looked at where the reader has gone.
   *
   * `cachedReplay` does the SAN, because these moves are being read from a position the
   * game does not contain; `engineLines` can only speak for a ply of the game itself.
   */
  const alongLine = useMemo(() => {
    if (!exploring || !analysis || analysis.base !== boardIndex) return null
    const fen = boardPosition?.fen
    if (!fen) return null
    const walked = analysis.moves.slice(0, analysis.cursor)
    const matches = lines.filter(
      (row) =>
        row.pv.length >= walked.length &&
        walked.every((uci, index) => sameMove(uci, row.pv[index]!)),
    )
    const first = matches[0]
    if (!first) return null
    const rows = matches.map((row) => {
      const rest = row.pv.slice(walked.length)
      const replay = rest.length > 0 ? cachedReplay(fen, rest) : null
      const sans = replay?.moves.map((move) => move.san) ?? []
      return {
        multipv: row.multipv,
        score: row.score,
        text: sans.length > 0 ? formatVariation(analysisPly, sans) : '',
        sans,
        // Truncated to what actually replayed, so a click on the last SAN can never play a
        // move that is not there — `engineLines` holds itself to the same rule.
        pv: rest.slice(0, sans.length),
        firstUci: rest[0] ?? null,
        // Neither is true of a continuation: nothing here was "played", and the verdict on
        // the move that was belongs to the game line this branch left.
        played: false,
        classification: null,
      } satisfies EngineLineView
    })
    return { rows, score: first.score, next: first.pv[walked.length] ?? null }
  }, [analysis, analysisPly, boardIndex, boardPosition, exploring, lines])

  /**
   * What the board actually points at: the live search's top move while one is running on
   * the position on the board, the next move of the line being walked while the board is
   * inside one, and the stored run's otherwise.
   *
   * `liveBest` drops a snapshot whose FEN is not this position — the reader scrubs faster
   * than the search reopens, and a stale arrow from two plies back is worse than no live
   * arrow at all.
   *
   * The stored-run box (`MaiaPanel`) is deliberately not told any of this. It is that run's
   * own box and its header reports whose numbers those are.
   */
  const boardEngineBest =
    liveBest(stream.snapshot, boardPosition?.fen ?? null) ??
    (exploring ? (alongLine?.next ?? null) : engineBest)

  /**
   * What the eval bar and the score chip actually describe: the same rule as
   * `boardEngineBest`, because they are the same claim — a number about the position on the
   * board, not about the game. The live search wins while one is running on that exact
   * position; then the line being walked, where the board is inside one (`alongLine`);
   * then `score`/`win`, the game's own stored evals, which are only true of the game line.
   * Off all three the readouts empty rather than keep showing the game position's number
   * under a board that has left it — a stale claim is worse than an empty one.
   */
  const boardLiveScore = liveScore(stream.snapshot, boardPosition?.fen ?? null)
  const boardScore = boardLiveScore ?? (exploring ? (alongLine?.score ?? null) : score)
  const boardWin = boardLiveScore
    ? whiteWinPercent(boardLiveScore)
    : exploring
      ? alongLine
        ? whiteWinPercent(alongLine.score)
        : null
      : win
  /** Whether that number is the line's rather than this position's own — the chip says so. */
  const scoreAlongLine = boardLiveScore === null && exploring && alongLine !== null

  /**
   * Walk the engine's own move here onto the board — ↵.
   *
   * The same call a click on a line's first move makes (`playLine`), reading the panel that
   * is actually speaking for the position on the board. That is the rule `boardEngineBest`
   * already follows for the arrow, and the key must not point somewhere else than the arrow
   * does — which is why both read `boardPvs`.
   */
  const playEngineBest = useCallback(() => {
    const pv = boardPvs[0]
    if (pv && pv.length > 0) playLine(pv, 0)
  }, [boardPvs, playLine])

  /**
   * A move dragged on the board.
   *
   * A drag that plays a move an engine line offers here IS entering that line, and is
   * treated as one — the same call clicking the line's first move makes, so the rest of the
   * PV comes with it and the evaluation follows the board (`alongLine`). Playing the
   * engine's move by hand and clicking it in the panel are the same intention, and they used
   * to have opposite consequences: the click walked into the line, the drag started a bare
   * one-move branch that nothing had an opinion about, so the eval, the arrow and the rest of
   * the variation all went out at once.
   *
   * Anything else is a line of the reader's own: the walk is truncated at the cursor and
   * continues from the move dragged. The tail that is dropped is not lost with it — the line
   * as it stood goes to the kept list, like every other way of leaving one.
   *
   * It lives down here, away from the other line-walking callbacks, because it needs the
   * live search: which lines are on offer is `boardPvs`, and the session is opened above.
   */
  const playMove = useCallback(
    (orig: string, dest: string) => {
      if (!analysis) return
      const next = withBoardMove(analysis, orig, dest)
      if (!next) return
      const offered = lineStartingWith(boardPvs, next[next.length - 1]!)
      if (offered) {
        playLine(offered, 0)
        return
      }
      keepBranch()
      setHoverMove(null)
      setPreview(null)
      setBranch({ base: analysis.base, moves: next, cursor: next.length })
    },
    [analysis, boardPvs, keepBranch, playLine],
  )

  /*
   * Playing the game through, a ply at a time.
   *
   * A `setTimeout` per ply rather than one interval: the cursor is React state, so each
   * step re-runs this effect anyway, and a timeout that is booked *after* the last step
   * landed cannot pile up behind a slow render the way an interval can. Stopping at the
   * last move rather than looping — the end of the game is the end of it.
   */
  useEffect(() => {
    if (!playing || cursor >= plyCount - 1) return
    const timer = setTimeout(() => {
      // Stopped by the step that lands on the last move rather than by the render that
      // notices it has: the flag goes down inside the timeout, which keeps this effect from
      // setting state as it runs and re-rendering the page for it.
      if (cursor + 1 >= plyCount - 1) setPlaying(false)
      seek(cursor + 1)
    }, AUTOPLAY_MS)
    return () => clearTimeout(timer)
  }, [playing, cursor, plyCount, seek])

  /**
   * The run of games the library was showing when this one was opened — `[` and `]`.
   *
   * Null on a game reached any other way (the dashboard, a note, the palette, a link):
   * there is no run to step along then, and inventing one out of whatever the table last
   * held would send the reader somewhere they never asked to go.
   */
  const trail = useGameTrail(gameId)
  const goToGame = useCallback(
    (delta: number, id: number | null) => {
      if (id === null) return
      // The run follows the reader rather than being re-derived by the screen they land on:
      // the next game is one further down the same ordering, and only this call knows that.
      advanceTrail(delta, id)
      navigate(`/games/${id}`)
    },
    [navigate],
  )

  useBoardKeys(
    {
      // Taking hold of the cursor by hand stops the game playing itself: the two are the
      // same control, and a reader stepping back through a move while it plays forwards
      // would be fighting the page.
      step: (delta) => {
        setPlaying(false)
        step(delta)
      },
      seekStart: () => {
        setPlaying(false)
        seek(-1)
      },
      seekEnd: () => {
        setPlaying(false)
        seek(plyCount - 1)
      },
      // Both land one ply short of the flagged move — see the memos the buttons share.
      nextFlagged: () => {
        setPlaying(false)
        if (nextFlagged !== null) seek(nextFlagged)
      },
      previousFlagged: () => {
        setPlaying(false)
        if (previousFlagged !== null) seek(previousFlagged)
      },
      flip: () => setFlipped((value) => !value),
      toggleHints: () => setHints((value) => !value),
      // The same switch the panel's footer carries, and the same guard it draws disabled
      // under: with nothing on the board there is nothing to search.
      toggleEngine: boardPosition?.fen ? () => stream.setEnabled(!stream.enabled) : undefined,
      // A note hangs off a game row, so a model game nobody has added has none to write.
      note: readOnly ? undefined : focusComposer,
      // Only while there is a line to leave: off one, Escape is the browser's again — and,
      // more to the point, whatever is open on top of the page keeps it.
      exitLine: exploring ? exitLine : undefined,
      playBest: playEngineBest,
      // The key presses the button that owns the panel — see `BOARD_SETTINGS_ID`.
      boardSettings: () => document.getElementById(BOARD_SETTINGS_ID)?.click(),
      // Both tiers are the buttons' own calls. Quick is bound even where its button is
      // hidden (a finished deep run hides it): the button is hidden because it would add
      // nothing, not because the pass is refused.
      queueQuick: readOnly ? undefined : () => analysisRequest.request('quick'),
      queueDeep: readOnly ? undefined : () => analysisRequest.request('deep'),
      // The key presses the one PGN button on the screen rather than copying the game a
      // second time of its own — see `PGN_BUTTON_ID`.
      copyPgn: () => document.getElementById(PGN_BUTTON_ID)?.click(),
      toggleMoveTab: mobile
        ? undefined
        : () => setColumnTab((tab) => (tab === 'moves' ? 'flagged' : 'moves')),
      // At the end of the game there is nothing to play through, so Space starts nothing —
      // the same as the ⏭ beside it being spent.
      autoplay: () => setPlaying((was) => !was && cursor < plyCount - 1),
      previousGame: trail?.previous != null ? () => goToGame(-1, trail.previous) : undefined,
      nextGame: trail?.next != null ? () => goToGame(1, trail.next) : undefined,
    },
    !!detail,
  )

  if (query.isPending) return <GameViewSkeleton />
  // A masters game is fetched from the explorer host with the owner's token, so this screen
  // fails the way the explorer's table does when that token is gone or refused — and the
  // error card's "try again" would fetch the same 409 forever. The explorer's own card is
  // what answers it, because the thing to do about it is the same: paste a new token.
  const tokenReason = readOnly ? tokenTrouble(query.error) : null
  if (tokenReason) {
    return (
      <PageBody>
        <ReferenceTokenCard reason={tokenReason} />
      </PageBody>
    )
  }
  if (query.isError || !detail || !position) {
    return (
      <GameLoadError
        error={query.error ?? new Error('The game payload was empty.')}
        onRetry={() => void query.refetch()}
      />
    )
  }

  const players = `${detail.game.white ?? '?'} — ${detail.game.black ?? '?'}`

  // The box sits above the move table whether or not a deep pass has finished: the panel
  // moving as analysis lands read as a layout bug, so it keeps one place.
  //
  // `hints` empties both columns together — it is one gesture, "do not tell me the answer
  // yet", and Stockfish's ranking answers the position exactly as much as Maia's does. Both
  // panes keep their place and their header while it is off, so nothing on the page moves.
  // Off the game line the human column is a live query, dropped entirely where the
  // deployment has no Maia to ask (`live.unavailable`) rather than reporting a failure.
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
      showHuman={hints && humanColumn}
      showEngine={hints}
      run={engineRun}
      // Off the game line the column is the run's own line seen from further along it
      // (`alongLine`), or nothing at all where the board has left every line it drew.
      engine={exploring ? (alongLine?.rows ?? []) : lines}
      alongLine={scoreAlongLine}
      ply={analysisPly}
      fen={boardPosition.fen}
      live={
        LIVE_MAIA && exploring
          ? { rollout: live.view?.rollout ?? [], pending: live.pending }
          : null
      }
      orientation={orientation}
      onHoverMove={setHoverMove}
      onHoverLine={setPreview}
      onStepPreview={previewView.step}
      previewLine={previewView.line}
      previewPly={previewView.ply}
      onPlayLine={playLine}
      // On the desktop the band is the workspace's top row: two panes side by side,
      // separated by a rule and ruled off from the move table below, spanning both tracks
      // and taking no margin of its own — a pane is bounded by the rules around it, not by
      // a gap. On the phone it is one of a stack of cards, and `MobileGameView`'s pane
      // already spaces those.
      className={mobile ? undefined : 'col-span-2 border-b border-edge-strong'}
    />
  )

  const header = (
    <GameHeaderBar
      game={detail.game}
      best={best}
      active={analysisRequest.activeRun}
      trail={
        trail
          ? {
              onPrevious: trail.previous != null ? () => goToGame(-1, trail.previous) : null,
              onNext: trail.next != null ? () => goToGame(1, trail.next) : null,
            }
          : null
      }
    />
  )

  const board = (
    <BoardPanel
      position={position}
      analysis={analysis}
      onPlayMove={playMove}
      onExitAnalysis={exitLine}
      orientation={orientation}
      // The two player rows flanking the board — name, rating and the material each side is
      // up, counted off the FEN on the board rather than off the game (`lib/chess/material`).
      // Nothing else about the game: that is the header's business.
      game={detail.game}
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
      scoreAlongLine={scoreAlongLine}
      cursor={cursor}
      plyCount={plyCount}
      hints={hints}
      onHintsChange={setHints}
      readOnly={readOnly}
      onFlip={() => setFlipped((value) => !value)}
      onSeek={seek}
      nextFlagged={nextFlagged}
      previousFlagged={previousFlagged}
      onStep={stepFromBoard}
      onToggleAutoplay={() => setPlaying((was) => !was)}
      playing={playing}
      quickRun={quickRun}
      deepRun={deepRun}
      activeRun={analysisRequest.activeRun}
      progress={analysisRequest.progress}
      pending={analysisRequest.pending}
      error={analysisRequest.error}
      onRequestQuick={() => analysisRequest.request('quick')}
      onRequestDeep={() => analysisRequest.request('deep')}
      // A note hangs off a game row, so there is nothing to write one against until the
      // model game has been added to the library.
      onNote={readOnly ? undefined : focusComposer}
      // "Add to library" and "Back to explorer" ride in the control row under the board
      // rather than in the titlebar: they are decisions about the game being read, and the
      // titlebar is the one strip on this screen nobody's eye goes to.
      actions={<StudioActions game={from} backTo={backToExplorer} />}
    />
  )

  const evalGraph = (
    <EvalGraph
      points={curve}
      plyCount={plyCount}
      cursor={cursor}
      ownerSide={detail?.game.color ?? null}
      analysisSummary={best ? analysisSummary : null}
      // The header tallies name both players rather than saying You/Opp.: the curve is
      // about the game, and half of it is the opponent's.
      playerNames={{ white: detail?.game.white, black: detail?.game.black }}
      onSelectPly={selectPly}
      // Desktop: the workspace's third row, spanning both tracks, ruled off from the panes
      // above rather than floating between them, at the mockup's own height for the plot
      // (170 design pixels, 150 in the narrow band) plus the padding it now carries itself.
      // A definite height rather than a share of the row: the row above it is the one that
      // should take the slack, because a move table is a list and a curve is a shape — a
      // taller curve is the same handful of turning points drawn bigger.
      //
      // Phone: a compact box, since the rest of the Eval tab goes to `FlaggedMoments`,
      // which is the part of "the story of the game" a finger can actually hit. 8.5rem so
      // that at 812 a row or two of that list is on screen before anybody scrolls.
      className={
        mobile
          ? 'h-[8.5rem]'
          : 'col-span-2 h-[9.875rem] border-t border-edge-strong xl:h-[11.125rem]'
      }
      // A drag along the curve walks the game. Only here: see `EvalGraph`'s own note.
      scrub={mobile}
    />
  )

  // The curve's own marks, as rows. Only the phone builds it: the desktop reads them off
  // the plot with a mouse, and off the move table's Flagged tab beside it.
  const flaggedMoments = <FlaggedMoments moves={moves} cursor={cursor} onSelect={seek} />

  /*
   * The composer's slot, for a game that is not in the library.
   *
   * `NotesTrack` reserves a fixed height for whatever it is handed, so leaving the slot
   * empty would open a hole in the column rather than close it. What goes there is the one
   * sentence that explains the state — and it is deliberately not a second "Add to library"
   * button: that decision has one place, the control row under the board, and two of them
   * would be two places to look for the same thing.
   */
  const referenceComposer = (
    <div className="flex min-w-0 flex-col justify-center rounded-md border border-dashed border-edge-strong px-3 text-[0.71875rem] leading-relaxed text-dim">
      Notes hang off a game in your library. Add this one and it can be annotated like any
      other — counted in no statistic, since you did not play it.
    </div>
  )

  const composer = (
    <NoteComposer
      target={target}
      note={editedNote}
      knownTags={tagNames}
      pending={saveNote.isPending || updateNote.isPending}
      error={saveNote.error ?? updateNote.error ?? removeNote.error}
      onSave={writeNote}
      onDelete={forgetNote}
      onClose={blurComposer}
      // No height of its own on either layout: it is handed one by the slot at the foot of
      // `NotesTrack`, which is what guarantees the box cannot move when the tab above it
      // changes — see that component's `COMPOSER_SLOT`.
      className="min-w-0"
    />
  )

  /*
    The right column's second track: Book and Notes behind one tab row, with the composer
    pinned *below* the pane rather than inside it.

    `book` is keyed by the half-move count on the board, which is `cursor + 1` — the same
    number the payload was built with — and it is only asked for while the board is on the
    game: off it (`exploring`) the position is one the game never reached, so the game's own
    map has nothing true to say about it and the Book tab drops out. A missing key is not an
    empty state; `NotesTrack` renders no tab at all for it, which is the common case.
  */
  const notesTrack = (
    <NotesTrack
      book={exploring ? (exploredBook.data ?? null) : detail.book?.[String(boardIndex)]}
      bookPly={analysisPly}
      onPlayBookMove={playBookMove}
      onPreviewBookMove={previewBookMove}
      onOpenInExplorer={openInExplorer}
      notes={noteList}
      activeNoteId={editedNote?.id ?? null}
      onSelectNote={selectNote}
      composer={readOnly ? referenceComposer : composer}
      className={mobile ? 'flex-1' : undefined}
    />
  )

  // The phone's strip is Moves · Eval · Engine · Notes now: Flagged has gone from it — the
  // Eval tab already lists the curve's marks, under the curve that explains them — and Book
  // joined Notes. Only `moves` mounts the table, so the tab it is told to draw is Moves
  // unless something puts the strip back on a Flagged it can no longer reach itself.
  const movesTab: MoveTab = mobileTab === 'flagged' ? 'flagged' : 'moves'

  const moveList = (
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
      // A pin is a row on the server hanging off a game row; a model game has neither, so
      // the affordance is not offered. The lines walked here are still kept for the session.
      onPinVariation={readOnly ? undefined : pinVariation}
      onUnpinVariation={readOnly ? undefined : unpinVariation}
      onSelectPly={selectPly}
      notedMoves={notedMoves}
      // The phone promotes the table's tabs into `MobileGameView`'s strip, so the table is
      // told which one to draw and its own row is switched off — that row is also where the
      // PGN affordance lives, which is why the phone header carries one.
      tab={mobile ? movesTab : columnTab}
      onTabChange={mobile ? undefined : setColumnTab}
      showTabRow={!mobile}
      // The moves/notes rule, in the same weight as every other boundary between panes: the
      // workspace is a matrix of panes divided by rules, and a boundary that is quieter than
      // its neighbours reads as an accident rather than as a division.
      className={mobile ? 'min-h-0 flex-1' : 'min-h-0 border-r border-edge-strong'}
    />
  )

  const infinite = (
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
      // The workspace's last row, spanning both tracks — the foot of the window, on the
      // chrome surface, the way a desktop app parks a status strip. It brings its own top
      // rule; on the phone it is a card in the Engine tab's stack instead.
      className={mobile ? 'rounded-md border border-line' : 'col-span-2'}
    />
  )

  const chrome = (
    <SetPageChrome
      breadcrumb={
        readOnly
          ? [{ label: 'Explorer', to: backToExplorer ?? '/explorer' }, { label: players }]
          : [
              { label: 'Library', to: '/games' },
              { label: formatGameDate(detail.game.played_at), mono: true },
              { label: players },
            ]
      }
    />
  )

  if (mobile) {
    return (
      <>
        {chrome}
        <MobileGameView
          game={detail.game}
          best={best}
          active={analysisRequest.activeRun}
          pgn={pgn}
          cursor={cursor}
          plyCount={plyCount}
          // The same evaluation the transport row's chip carries on a desktop, which is the
          // live search's where there is one — not the stored eval for the ply.
          score={boardScore}
          flaggedCount={flaggedCount}
          noteCount={noteList.length}
          tab={mobileTab}
          onTabChange={setMobileTab}
          board={board}
          moveList={moveList}
          evalGraph={evalGraph}
          flaggedMoments={flaggedMoments}
          maiaPanel={maiaPanel}
          infinite={infinite}
          notesTrack={notesTrack}
        />
      </>
    )
  }

  return (
    <>
      {chrome}

      {/*
        The screen's own heading, across the whole workspace: what the game is, and what has
        been done to it. Everything under it is the pane matrix, and the rule this bar draws
        is that matrix's top edge.
      */}
      {header}

      <div ref={columnsRef} className="flex min-h-0 flex-1">
        {/*
          The board flush LEFT, as big as the height budget allows, and everything else in
          one column to the right of it. That is the whole arrangement, and it is the owner's
          own instruction: a centred board was proposed twice and rejected twice.

          Which column takes the spare width is what the split is for. The right column holds
          things that are *read* — a move table, a book table, a note, an engine line — and
          each of them has a width past which the extra room is whitespace, so it is the
          column that is sized (`grow-0`, a basis per band). Everything left over is the
          board's (`flex-1`), which is the one element on the page worth more the larger it
          is. Growing sideways is not free: the board is square, so width is height, and past
          a point it would push the transport row out of the viewport — which is why
          `BoardPanel` caps itself against `100vh`.

          Between the two floors the boundary is the reader's: the hairline is a
          `ColumnSplitter` and what it drags is `movesWidth`, held here in `rem` and
          remembered under `blunderbase.gameMovesWidth`. The splitter reports pointer travel
          and nothing else, so the direction is decided in `resize`: rightwards is a narrower
          right column and a bigger board. Every drag is clamped against the row's measured
          width and this band's floors (`BANDS`), and the `min-w` classes hold the same
          floors in CSS for a width no drag produced.

          Below `xl` the board column has no floor of its own: the sidebar is still 200
          design pixels there and the right column cannot go under a move row plus a book
          row, so a board floor at 1024 would buy a horizontal scrollbar rather than a
          bigger board. The board yields instead, and the two tracks survive — which is the
          trade the design asks for (see the mockup's own note at its 768 band).
        */}
        <div
          data-testid="board-column"
          // `min-h-0` and `overflow-hidden`: the row is exactly the viewport's height and
          // the board in it is sized by its width, so a column that is allowed to grow past
          // its box grows silently *below the fold* — which is where the transport row would
          // end up. Clipped, an overrun is visible.
          //
          // Untouched, this column is exactly as wide as the board it holds — the panel's
          // own `calc(100vh - 12.625rem)` plus the `px-5` on either side — and the right
          // column takes everything else. That is what puts the splitter against the board's
          // edge instead of at the end of a column padded out with slack the board declined
          // to use, and it means every pixel the board does not want goes to the moves and
          // the notes rather than to nothing. Drag the splitter once and the two swap roles:
          // the right column takes the width the reader chose and this one flexes again, so
          // an explicit choice still beats the default.
          className={cn(
            'flex min-h-0 min-w-0 flex-col overflow-hidden bg-surface px-3.5 py-2.5',
            movesWidth === null
              // `shrink grow-0` rather than `flex-none`: the width is what the board *wants*
              // — the height budget expressed sideways — and on a window that is tall for
              // how wide it is that is more than the row has, once the moves column's own
              // floor is taken off. `flex-none` refused to give any of it back and the notes
              // track was simply cut off the right edge; shrinking, the board yields exactly
              // as it does once the splitter has been dragged.
              //
              // The same floors either way, and for the same reason: a board column narrower
              // than its own transport row clips the transport row, which is the one thing in
              // this column that is not allowed to be smaller than it is. Under the floor the
              // window scrolls sideways instead — the trade the design already makes at 1280.
              ? 'w-[calc(100vh-9.5625rem)] max-w-full min-w-[24.5rem] shrink grow-0 xl:min-w-[26.25rem]'
              : 'flex-1 min-w-[24.5rem] xl:min-w-[26.25rem]',
          )}
        >
          {board}
        </div>

        <ColumnSplitter
          label="Moves column width"
          onResizeStart={startResize}
          onResize={resize}
          onResizeEnd={endResize}
          onReset={resetWidth}
        />

        {/*
          ONE grid, two tracks, four rows — not a stack of panels each arranging itself.
          That is what puts the moves/notes rule and the engine band's own gap on the same
          geometry, and it is why the column reads as a column rather than as four boxes:

            row 1  the engine band, spanning both tracks (Maia 25 % / Stockfish 75 %,
                   two cards with a gap and no rule between them)
            row 2  the move table | the notes track, the one boundary that draws a line
            row 3  the eval graph, spanning both tracks
            row 4  the continuous-analysis footer, spanning both tracks

          Row 2 is the only `1fr`: it is the row that should take the slack, because the move
          table is a list and the three panels around it are fixed things.

          The track widths are the design's, converted: 340/300/250 *design* pixels over 16
          to `rem`, which the 120 % root renders as 408/360/300 physical pixels. A literal
          `250px` track would be 208 design pixels here and a move row — number, two move
          cells, two clocks — does not fit in it. The bands themselves are physical pixels,
          because media queries do not scale with the root.

          The two tracks never fold into one. Stacking the notes under the move table costs
          the table the height it needs far sooner than a narrow track costs it width.
        */}
        <div
          ref={rightRef}
          data-testid="moves-column"
          className={cn(
            'grid min-h-0 min-w-[26.875rem] grow-0',
            'grid-cols-[15.625rem_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto_auto]',
            // The middle band starts at 1440 rather than at 1280. At exactly 1280 — a very
            // common laptop — the rail (200), the board column's floor (420) and this
            // column's 508 come to 1271, which fits; the 1280 band asked for 508 more than
            // it had and the notes track was clipped off the right edge of a window that
            // cannot scroll sideways. The bands themselves are unchanged, they just start
            // one step later.
            'min-[90rem]:min-w-[31.75rem] min-[90rem]:grid-cols-[18.75rem_minmax(0,1fr)]',
            'min-[100rem]:min-w-[35.25rem] min-[100rem]:grid-cols-[21.25rem_minmax(0,1fr)]',
            // Untouched, this column takes everything the board column does not: the board
            // is bounded by the height left after its chrome, and whatever width that leaves
            // belongs here rather than to empty padding. The `min-w-*` above are the floors
            // that keep a move row and a notes track legible; below those the board gives
            // way instead. Dragged, the reader's width wins and the board column flexes.
            movesWidth === null ? 'flex-1' : 'grow-0',
          )}
          style={movesWidth === null ? undefined : { flexBasis: `${movesWidth}rem` }}
        >
          {maiaPanel}
          {moveList}
          {/*
            Book and Notes behind one tab row, with the composer pinned below the pane: a
            note is about the position on the board, so the box it is written in must not
            move when the pane above it changes what it is showing.
          */}
          {notesTrack}
          {evalGraph}
          {/*
            The whole line, not its first move: `onHoverLine` replaces the single arrow
            `onHoverMove` drew here, and the preview it feeds is what the board shows. The
            engine band reports the same three gestures from its own rows, into the same
            state — the namespaced ids are what keeps the two apart.
          */}
          {infinite}
        </div>
      </div>
    </>
  )
}
