/**
 * A practice game on the game page: the state, and the computer's side of it.
 *
 * The rules are `./practice.ts`; this is the part with a clock and a network. It holds the
 * game (whose side, which opponent, whether the answers are shown), watches the line the
 * page is walking, and when the computer is to move at the end of it, asks — the practice
 * endpoint for an engine, the live policy for Maia — and hands the move back to the page to
 * append. The page owns the line; this hook never writes it except through `append` and
 * `truncate`, which is what keeps a practice move and a dragged move the same kind of move.
 *
 * Three things it guards against:
 *
 * - **An answer for a position the board has left.** A take-back, a step back through the
 *   line or a stop can land while a reply is in flight. The effect is keyed on the position
 *   and cancelled on the way out, and `append` is told which FEN the move is for, so a late
 *   answer is dropped rather than played onto the wrong board.
 * - **A game the line no longer holds.** Leaving the line (a seek, "Back to game", another
 *   game) ends practice: there is no board left for the reader's side to be on.
 * - **A Maia reply that flickers.** Maia answers in milliseconds, and a reply that lands in
 *   the same frame as the reader's own move reads as the board jumping rather than as an
 *   opponent moving. It waits a beat first.
 */
import { useLingui } from '@lingui/react/macro'
import type { Chess } from 'chessops/chess'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import * as api from '@/lib/api/endpoints'

import type { AnalysisLine } from './analysisLine'
import {
  canTakeBack,
  policyFor,
  practicePhase,
  practiceResult,
  sampleMove,
  takeBackLength,
  type PracticeGame,
  type PracticeOpponent,
  type PracticePhase,
  type PracticeResult,
  type PracticeSide,
} from './practice'

/** How long Maia's reply waits, so it reads as a move rather than a flicker. */
export const MAIA_REPLY_DELAY_MS = 450

export interface PracticeSetup {
  side: PracticeSide
  opponent: PracticeOpponent
}

export interface UsePracticeArgs {
  /** The line the page is walking; null off every line. */
  analysis: AnalysisLine | null
  /** The game position the line branches from. */
  start: Chess | null
  /** Put the computer's move at the end of the line, if the board is still on `fen`. */
  append: (fen: string, uci: string) => void
  /** Cut the line to `length` moves and stand the board at its end. */
  truncate: (length: number) => void
  /** Test seam: the draw Maia's reply is made with. */
  random?: () => number
}

export interface Practice {
  game: PracticeGame | null
  phase: PracticePhase | null
  result: PracticeResult | null
  /** A reply is being asked for. */
  thinking: boolean
  /** Why the last reply could not be had, in the backend's words. */
  error: string | null
  canTakeBack: boolean
  /** Start from the line as it stands: `base` and `from` are where it begins. */
  begin: (setup: PracticeSetup, base: number, from: number) => void
  stop: () => void
  takeBack: () => void
  retry: () => void
  toggleReveal: () => void
}

export function usePractice({
  analysis,
  start,
  append,
  truncate,
  random = Math.random,
}: UsePracticeArgs): Practice {
  const { t } = useLingui()
  const noMove = t`No move came back for this position.`
  const [game, setGame] = useState<PracticeGame | null>(null)
  // A failure belongs to the question it answered — this position, this attempt — so a
  // take-back or a retry is a new question with no failure yet, and nothing has to clear it.
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null)
  const [attempt, setAttempt] = useState(0)

  // The latest page callbacks, so an answer that lands after a render appends through the
  // page as it is now rather than the one the request was made from.
  const appendRef = useRef(append)
  const randomRef = useRef(random)
  const noMoveRef = useRef(noMove)
  useEffect(() => {
    appendRef.current = append
    randomRef.current = random
    noMoveRef.current = noMove
  })

  const moves = useMemo(() => analysis?.moves ?? [], [analysis])
  const cursor = analysis?.cursor ?? 0
  const onThisLine = game !== null && analysis !== null && analysis.base === game.base

  const phase = useMemo(
    () => (game && onThisLine && start ? practicePhase(game, start, moves, cursor) : null),
    [game, onThisLine, start, moves, cursor],
  )
  const result = useMemo(
    () => (game && onThisLine && start ? practiceResult(start, moves) : null),
    [game, onThisLine, start, moves],
  )

  // The line went away under the game — the page seeked, went back to the game, or opened
  // another one. Adjusted as the render sees it, the way React adjusts one state to another.
  if (game !== null && !onThisLine) setGame(null)

  const fen = analysis?.position.fen ?? null
  const opponent = game?.opponent ?? null
  const question = `${fen}:${attempt}`
  const error = failure?.key === question ? failure.message : null
  const thinking = phase === 'thinking' && error === null

  useEffect(() => {
    if (phase !== 'thinking' || fen === null || opponent === null) return
    let cancelled = false
    const key = `${fen}:${attempt}`
    const ask: Promise<string | null> =
      opponent.kind === 'engine'
        ? api
            .practiceMove({
              fen,
              engine_id: opponent.engineId,
              elo: opponent.elo,
              movetime_ms: opponent.movetimeMs,
            })
            .then((answer) => answer.uci)
        : Promise.all([
            api.maiaPolicy({ fen, elo: opponent.level ?? undefined, moves: 10 }),
            new Promise((resolve) => setTimeout(resolve, MAIA_REPLY_DELAY_MS)),
          ]).then(([answer]) => sampleMove(policyFor(answer, opponent.level), randomRef.current))
    ask
      .then((uci) => {
        if (cancelled) return
        if (uci === null) setFailure({ key, message: noMoveRef.current })
        else appendRef.current(fen, uci)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setFailure({ key, message: cause instanceof Error ? cause.message : String(cause) })
      })
    return () => {
      cancelled = true
    }
  }, [phase, fen, opponent, attempt])

  const begin = useCallback((setup: PracticeSetup, base: number, from: number) => {
    setFailure(null)
    setGame({ side: setup.side, opponent: setup.opponent, base, from, reveal: false })
  }, [])

  const stop = useCallback(() => setGame(null), [])

  const takeBack = useCallback(() => {
    if (!game || !start) return
    truncate(takeBackLength(game, start, moves))
  }, [game, start, moves, truncate])

  const retry = useCallback(() => setAttempt((value) => value + 1), [])

  const toggleReveal = useCallback(
    () => setGame((current) => (current ? { ...current, reveal: !current.reveal } : current)),
    [],
  )

  return {
    game,
    phase,
    result,
    thinking,
    error,
    canTakeBack: game !== null && canTakeBack(game, moves),
    begin,
    stop,
    takeBack,
    retry,
    toggleReveal,
  }
}
