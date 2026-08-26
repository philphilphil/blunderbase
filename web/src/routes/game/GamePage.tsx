import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

import { InfiniteAnalysisPanel } from '@/components/analysis/InfiniteAnalysisPanel'
import { SetPageChrome } from '@/components/shell/PageChrome'
import { useStreamSession } from '@/lib/analysis'
import { useGame, useRequestAnalysis, useRuns, useWorstMoments } from '@/lib/api/queries'
import type { MoveRow, RunResponse, Tier } from '@/lib/api/types'
import { isFlagged } from '@/lib/chess/classification'
import { useEventListener } from '@/lib/events/EventsProvider'
import type { AnalysisProgressEvent, AnalysisRunEvent } from '@/lib/events/types'

import { BoardPanel } from './components/BoardPanel'
import { DeepAnalysisCard, type RunProgress } from './components/DeepAnalysisCard'
import { EnginePanel } from './components/EnginePanel'
import { EvalGraph } from './components/EvalGraph'
import { GameHeaderBar } from './components/GameHeaderBar'
import { GameLoadError, GameViewSkeleton } from './components/GameStates'
import { MaiaPanel } from './components/MaiaPanel'
import { MoveList, type MoveAnnotation } from './components/MoveList'
import { NotesColumn } from './components/NotesColumn'
import {
  bestRun,
  buildGameLine,
  collapsedThroughMove,
  engineLines,
  evalAtCursor,
  evalCurve,
  formatGameDate,
  maiaLevels,
  nextFlaggedPly,
  pairMoves,
  preferredLevel,
  previousFlaggedPly,
  recurringMistake,
  runFor,
  sanVariation,
  scoreAfter,
  scoreBefore,
  sortNotes,
  type GameNote,
  type Side,
} from './gameModel'
import { buildPgn } from './pgn'
import { useBoardKeys } from './useBoardKeys'

/** The window `/stats/worst-moments` is asked about for the recurring-mistake card. */
const RECURRING_DAYS = 30
const RECURRING_SAMPLE = 100

/**
 * Design 1a "Studio": board with its eval bar and a short eval curve on the left; the
 * paired move table with everything said about the position on the board stacked under it
 * — the run's multi-PV lines, the deep-analysis trigger, the live search, Maia — in the
 * middle; the coach's notes and the recurring-mistake card on the right.
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
  const runs = useRuns(gameId)
  const moments = useWorstMoments({ days: RECURRING_DAYS, amount: RECURRING_SAMPLE })
  const analysis = useRequestAnalysis()

  const [cursor, setCursor] = useState(-1)
  const [flipped, setFlipped] = useState(false)
  const [hints, setHints] = useState(true)
  /** The first move of the engine line being pointed at, previewed on the board. */
  const [hoverMove, setHoverMove] = useState<string | null>(null)
  /** The last `analysis.progress` frame, tagged with the run it belongs to. */
  const [progress, setProgress] = useState<(RunProgress & { runId: number }) | null>(null)
  /** The run `POST /analysis` just returned, until `useRuns` reports it. See `activeRun`. */
  const [requested, setRequested] = useState<RunResponse | null>(null)

  const detail = game.data
  const moves = useMemo<MoveRow[]>(() => detail?.moves ?? [], [detail])
  const plyCount = moves.length

  const requestAnalysis = useCallback(
    (tier: Tier) => {
      analysis.mutate({ game_id: gameId, tier }, { onSuccess: (run) => setRequested(run) })
    },
    [analysis, gameId],
  )

  const seek = useCallback(
    (next: number) => {
      setCursor(Math.max(-1, Math.min(plyCount - 1, next)))
      // A hovered line belongs to the position it was read in: leaving that position drops
      // the preview, even where the pointer never left the row it was drawn from.
      setHoverMove(null)
    },
    [plyCount],
  )
  /** Selecting a move puts the board *after* it, which is what a move list click means. */
  const selectPly = useCallback((ply: number) => seek(ply), [seek])

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
  const maia = useMemo(
    () => preferredLevel(maiaLevels(upcoming?.maia), detail?.game.rating),
    [upcoming, detail],
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

  const listedRun = useMemo<RunResponse | null>(
    () => runs.data?.find((run) => run.status === 'queued' || run.status === 'running') ?? null,
    [runs.data],
  )
  // `POST /analysis` never dedupes ("re-analysis is always a new run"), and the run list
  // only catches up a refetch later — the socket invalidation is debounced on top of that.
  // The run the mutation just returned stands in until the list has it, so the button
  // cannot be pressed twice into two full passes over the same game.
  useEffect(() => {
    if (requested && runs.data?.some((run) => run.id === requested.id)) setRequested(null)
  }, [requested, runs.data])
  const activeRun = listedRun ?? requested
  const activeRunId = activeRun?.id ?? null

  // Live run status. `analysis.progress` is not a cache invalidation — it arrives once per
  // analysed ply — so the counter is read straight off the socket.
  //
  // Guarded on the run, not only the game: two runs over one game are ordinary (an import
  // auto-queues a quick pass, and the deep button can be pressed while that is still
  // going), and a listener that checked `game_id` alone would interleave two counters into
  // one bar and let whichever run finished first clear the other one's progress.
  const tracksRun = (frame: AnalysisRunEvent | AnalysisProgressEvent) =>
    frame.game_id === gameId && activeRunId !== null && frame.run_id === activeRunId

  useEventListener('analysis.progress', (event) => {
    const frame = event as AnalysisProgressEvent
    if (!tracksRun(frame)) return
    setProgress({ runId: frame.run_id, done: frame.done, total: frame.total })
  })
  useEventListener('analysis.done', (event) => {
    if (!tracksRun(event as AnalysisRunEvent)) return
    setProgress(null)
  })
  useEventListener('analysis.failed', (event) => {
    if (!tracksRun(event as AnalysisRunEvent)) return
    setProgress(null)
  })
  // The counter belongs to one run, so a different run taking the card over starts empty
  // rather than inheriting the last frame of the one before it.
  const runProgress: RunProgress | null =
    progress && progress.runId === activeRunId
      ? { done: progress.done, total: progress.total }
      : null

  const finishedRuns = useMemo(() => detail?.runs ?? [], [detail])
  const best = useMemo(() => bestRun(finishedRuns), [finishedRuns])
  const deepRun = useMemo(
    () => bestRun(finishedRuns.filter((run) => run.tier === 'deep')),
    [finishedRuns],
  )
  const engineRun = useMemo(() => runFor(finishedRuns, upcoming), [finishedRuns, upcoming])
  const recurring = useMemo(
    () => recurringMistake(moments.data ?? [], gameId, RECURRING_DAYS),
    [moments.data, gameId],
  )

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
    fen: position?.fen ?? null,
    gameId,
    ply: boardIndex,
  })

  useBoardKeys(
    {
      step: (delta) => seek(cursor + delta),
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

  // Once a deep pass has finished, the multi-PV box is the thing worth reading first about
  // the position on the board, so it goes above the move table. Before that it has little
  // to say, and the table keeps the top of the column.
  const enginePanel = (
    <EnginePanel
      run={engineRun}
      lines={lines}
      ply={boardIndex}
      onHoverMove={setHoverMove}
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
          461 physical pixels and the move table never below 307 — both wider than the
          420/280 the design set at 100 %. They are 24rem/16rem rather than the design's
          26.25rem/17.5rem because 1440 − 240 (rail) leaves 1200 for the three columns and
          the notes column takes 379 of it; the design's floors would have overflowed by
          ~20px at the new scale.
        */}
        <div className="flex min-w-[24rem] shrink-[2] grow-0 basis-[32.75rem] flex-col gap-3.5 border-r border-hairline px-5 py-[1.125rem]">
          <GameHeaderBar game={detail.game} best={best} active={activeRun} />
          <BoardPanel
            position={position}
            orientation={orientation}
            lastMove={played}
            upcoming={upcoming}
            engineBest={engineBest}
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
          />
          <EvalGraph
            points={curve}
            plyCount={plyCount}
            cursor={cursor}
            onSelectPly={selectPly}
            className="flex-1"
          />
        </div>

        <div className="flex min-w-[16rem] flex-1 flex-col border-r border-hairline">
          {deepRun ? enginePanel : null}
          <MoveList
            pairs={pairs}
            cursor={cursor}
            collapsedThrough={collapsedThrough}
            annotation={annotation}
            flaggedCount={flaggedCount}
            plyCount={plyCount}
            pgn={pgn}
            onSelectPly={selectPly}
            className="min-h-0 flex-1"
          />
          {/*
            Three panels, three different claims about the same position: the stored run
            says what an analysis pass concluded about the move that was played, the live
            search says what an engine is finding right now, and Maia says what a human of
            this rating would play. Stacked, never merged — and the deep-analysis trigger
            sits with them, next to the lines it would deepen, rather than in the notes.
          */}
          {deepRun ? null : enginePanel}
          <div className="flex-none border-t border-hairline bg-panel p-3">
            <DeepAnalysisCard
              deepRun={deepRun}
              activeRun={activeRun}
              progress={runProgress}
              pending={analysis.isPending}
              error={analysis.error}
              onRequestDeep={() => requestAnalysis('deep')}
              onRequestQuick={() => requestAnalysis('quick')}
            />
          </div>
          <InfiniteAnalysisPanel
            stream={stream}
            fen={position.fen}
            ply={boardIndex}
            onHoverMove={setHoverMove}
          />
          {hints && maia ? <MaiaPanel level={maia} played={upcoming} /> : null}
        </div>

        <NotesColumn
          notes={notes}
          moves={moves}
          recurring={recurring}
          recurringPending={moments.isPending}
          onSelectPly={selectPly}
          className="w-[19.75rem] flex-none"
        />
      </div>
    </>
  )
}
