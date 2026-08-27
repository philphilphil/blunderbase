import { useCallback, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

import { InfiniteAnalysisPanel } from '@/components/analysis/InfiniteAnalysisPanel'
import { SetPageChrome } from '@/components/shell/PageChrome'
import { useStreamSession } from '@/lib/analysis'
import { useGame, useMaiaTargetElo } from '@/lib/api/queries'
import type { MoveRow } from '@/lib/api/types'
import { isFlagged } from '@/lib/chess/classification'

import { buildAnalysisLine, withBoardMove } from './analysisLine'
import { BoardPanel } from './components/BoardPanel'
import { EvalGraph } from './components/EvalGraph'
import { GameHeaderBar } from './components/GameHeaderBar'
import { GameLoadError, GameViewSkeleton } from './components/GameStates'
import { MaiaPanel } from './components/MaiaPanel'
import { MoveList, type MoveAnnotation } from './components/MoveList'
import {
  bestRun,
  buildGameLine,
  collapsedThroughMove,
  engineLines,
  evalAtCursor,
  evalCurve,
  formatGameDate,
  humanMoves,
  maiaLevels,
  nextFlaggedPly,
  pairMoves,
  preferredLevel,
  previousFlaggedPly,
  runFor,
  sanVariation,
  scoreAfter,
  scoreBefore,
  sortNotes,
  type GameNote,
  type Side,
} from './gameModel'
import { buildPgn } from './pgn'
import { isPrefix, useSessionVariations } from './sessionVariations'
import { useBoardKeys } from './useBoardKeys'
import { useDeepAnalysis } from './useDeepAnalysis'
import { useLiveMaia } from './useLiveMaia'

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

function GameStudio({ gameId }: { gameId: number }) {
  const game = useGame(gameId, { notes: true })
  const deepAnalysis = useDeepAnalysis(gameId)

  const [cursor, setCursor] = useState(-1)
  const [flipped, setFlipped] = useState(false)
  const [hints, setHints] = useState(true)
  /** The first move of the engine line being pointed at, previewed on the board. */
  const [hoverMove, setHoverMove] = useState<string | null>(null)
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
  const { kept, keep } = useSessionVariations(gameId)

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
  const notedPlies = useMemo(
    () =>
      notes
        .map((note) => note.ply)
        .filter((ply): ply is number => typeof ply === 'number'),
    [notes],
  )
  const collapsedThrough = useMemo(
    () => collapsedThroughMove(moves, notedPlies),
    [moves, notedPlies],
  )
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
   * Walk into one of the stored engine lines. Those lines describe the position the branch
   * hangs off — not wherever the board stands mid-walk — so entering one replaces the line
   * being walked from the head, rather than splicing a head-measured line onto a position
   * it was never about. On the game line the two readings coincide.
   */
  const playEngineLine = useCallback(
    (ucis: string[], index: number) => {
      if (ucis.length === 0 || !analysis) return
      // The line standing here is being replaced by another; it stays in the move list.
      keepBranch()
      setHoverMove(null)
      setBranch({ base: analysis.base, moves: [...ucis], cursor: index + 1 })
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
      setBranch({ base: analysis.base, moves: next, cursor: next.length })
    },
    [analysis, keepBranch],
  )

  /** Put the board after the `index`-th move of the line the reader is walking. */
  const seekVariation = useCallback(
    (index: number) => {
      if (!analysis) return
      setHoverMove(null)
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
   * The kept lines as the move list draws them: SAN, replayed against *this* game, so a
   * stored line can never disagree with the position it hangs off (one that no longer
   * replays at all simply drops out).
   *
   * The line the board is standing in is drawn by `variation` already, so the kept copy of
   * it is held back while it is active — the two are the same walk whichever of them is the
   * longer, and the reader should see one row, not the same row twice.
   */
  const keptLines = useMemo(
    () =>
      kept
        .filter(
          (entry) =>
            !(
              branch &&
              analysis &&
              entry.base === analysis.base &&
              (isPrefix(entry.moves, analysis.moves) || isPrefix(analysis.moves, entry.moves))
            ),
        )
        .map((entry) => ({
          id: entry.id,
          base: entry.base,
          sans: sanVariation(line, entry.base, entry.moves, entry.moves.length),
        }))
        .filter((entry) => entry.sans.length > 0),
    [analysis, branch, kept, line],
  )

  // --- Maia -----------------------------------------------------------------
  //
  // One configured target elo drives everything: the batch pass pins the stored blob to it,
  // and the live endpoint is asked at the same level, so the two columns never speak for
  // two different humans. A deployment with none falls back to the game's own rating.
  const targetElo = useMaiaTargetElo()
  const stored = useMemo(
    () => preferredLevel(maiaLevels(upcoming?.maia), detail?.game.rating, targetElo),
    [upcoming, detail, targetElo],
  )
  // Positions on the game line are stored data, instant and free; only an analysis position
  // is worth a query.
  const live = useLiveMaia(exploring ? boardPosition.fen : null, targetElo)
  const maia = exploring ? (live.view?.level ?? null) : stored
  const human = useMemo(
    () => humanMoves(maia, exploring ? [] : lines, exploring ? undefined : upcoming),
    [maia, exploring, lines, upcoming],
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

  // Once a deep pass has finished, the multi-PV half of this box is the thing worth reading
  // first about the position on the board, so it goes above the move table. Before that it
  // has little to say, and the table keeps the top of the column.
  //
  // The human column beside the engine's own is what `hints` turns off; the run's own
  // findings are not a hint and stay either way. Off the game line the human column is a
  // live query, dropped entirely where the deployment has no Maia to ask
  // (`live.unavailable`) rather than reporting a failure.
  const maiaPanel = (
    <MaiaPanel
      rating={maia?.rating ?? null}
      human={human}
      showHuman={hints && !(exploring && live.unavailable)}
      run={engineRun}
      // The stored lines describe the position the branch hangs off, and the game cursor
      // stays there while a line is walked — so they stay up, the map the reader is
      // navigating by, rather than emptying the moment a line is entered.
      engine={lines}
      ply={analysisPly}
      enginePly={analysis?.base ?? analysisPly}
      live={exploring ? { rollout: live.view?.rollout ?? [], pending: live.pending } : null}
      onHoverMove={setHoverMove}
      onPlayLine={playLine}
      onPlayEngineLine={playEngineLine}
      className={deepRun ? 'border-b border-t-0 border-hairline' : undefined}
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

      <div className="flex min-h-0 flex-1">
        {/*
          Column floors are in `rem`, so at the app's scale the board never drops below
          504 physical pixels and the move table never below 384 — both clear of the
          420/280 the design set at 100 % for these two columns, now that there is no
          third. 1440 − 240 (rail) leaves 1200 for the pair, and with the notes column
          gone the ~379px it used to take is free: the board's basis grows from
          32.75rem to 35rem and its floor from 24rem to the design's own 26.25rem, and
          the move table's floor grows from 16rem to 20rem.
        */}
        <div className="flex min-w-[26.25rem] shrink-[2] grow-0 basis-[35rem] flex-col gap-3.5 border-r border-hairline px-5 py-[1.125rem]">
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
            // (live) arrow is left.
            upcoming={exploring ? undefined : upcoming}
            engineBest={exploring ? null : engineBest}
            hoverMove={hoverMove}
            maia={maia}
            win={win}
            score={score}
            cursor={cursor}
            plyCount={plyCount}
            hints={hints}
            onHintsChange={setHints}
            onFlip={() => setFlipped((value) => !value)}
            onSeek={seek}
            onStep={step}
            deepRun={deepRun}
            deepActiveRun={deepAnalysis.activeRun}
            deepProgress={deepAnalysis.progress}
            deepPending={deepAnalysis.pending}
            deepError={deepAnalysis.error}
            onRequestDeep={deepAnalysis.request}
          />
          <EvalGraph
            points={curve}
            plyCount={plyCount}
            cursor={cursor}
            onSelectPly={selectPly}
            className="flex-1"
          />
        </div>

        <div className="flex min-w-[20rem] flex-1 flex-col">
          {deepRun ? maiaPanel : null}
          <MoveList
            pairs={pairs}
            cursor={cursor}
            collapsedThrough={collapsedThrough}
            annotation={annotation}
            flaggedCount={flaggedCount}
            plyCount={plyCount}
            pgn={pgn}
            // The line the reader is walking, drawn under the move it hangs off, and every
            // line they walked earlier this session under theirs.
            variation={
              branch && analysis && analysis.sans.length > 0
                ? { base: analysis.base, sans: analysis.sans, cursor: analysis.cursor }
                : null
            }
            onSelectVariationMove={seekVariation}
            kept={keptLines}
            onSelectKeptMove={enterKeptVariation}
            onSelectPly={selectPly}
            className="min-h-0 flex-1"
          />
          <InfiniteAnalysisPanel
            stream={stream}
            fen={boardPosition.fen}
            ply={analysisPly}
            onHoverMove={setHoverMove}
          />
          {/*
            Two panels, two different claims about the same position: the live search says
            what an engine is finding right now, and the box above (or below) it says what
            the stored run concluded and what a human of this rating would play. The
            deep-analysis trigger lives in the board's transport row now, rather than here.
          */}
          {deepRun ? null : maiaPanel}
        </div>
      </div>
    </>
  )
}
