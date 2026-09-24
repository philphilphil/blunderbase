import { Button } from '@/components/ui/button'
import { Trans, useLingui } from '@lingui/react/macro'
import { ClipboardPaste, FlipVertical2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { InfiniteAnalysisPanel } from '@/components/analysis/InfiniteAnalysisPanel'
import { Board } from '@/components/board/Board'
import { SetPageChrome } from '@/components/shell/PageChrome'
import { Skeleton } from '@/components/ui/skeleton'
import { useStreamSession } from '@/lib/analysis'
import { useGame } from '@/lib/api/queries'
import type { BoardArrow, BoardOrientation } from '@/components/board/Board'
import { useEvents, useLiveUpdates } from '@/lib/events/EventsProvider'
import { useRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { isTyping } from '@/lib/ui/shortcuts'
import { cn } from '@/lib/utils'

import { BoardMoves } from './BoardMoves'
import { CoachComment } from './CoachComment'
import { LoadPositionDialog } from './LoadPosition'
import { SaveMoment } from './SaveMoment'
import { SessionMeta } from './SessionMeta'
import { boardArrows, boardSquares, describeSession, fenPly, orientationFor } from './live'
import {
  boardDests,
  detectInput,
  dragToUci,
  EMPTY_BOARD,
  START_FEN,
  stepAction,
  type BoardAction,
} from './localBoard'
import { useBoard } from './useBoard'

/** How long the board keeps its ring after an update, so a move is felt as well as seen. */
const FLASH_MS = 700
/**
 * How long after the owner's own action an update is taken to be its answer. The ring is
 * for a move that arrives from somewhere else — the coach, another tab — and ringing the
 * board for every drag would make it mean nothing.
 */
const OWN_ACTION_MS = 1500

function ConnectionPill() {
  const { status, reconnects } = useEvents()
  const { t } = useLingui()
  const label =
    status === 'open'
      ? reconnects > 0
        ? t`live · reconnected ${reconnects}×`
        : t`live`
      : status === 'connecting'
        ? t`connecting`
        : t`offline — retrying`
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-[0.1875rem] text-[0.6875rem]',
        status === 'open'
          ? 'border-edge bg-elevated text-soft'
          : status === 'connecting'
            ? 'border-mistake/28 bg-mistake/5 text-mistake'
            : 'border-blunder/28 bg-blunder/5 text-blunder',
      )}
    >
      <span
        className={cn(
          'size-[0.3125rem] rounded-full',
          status === 'open'
            ? 'bg-accent-teal'
            : status === 'connecting'
              ? 'bg-mistake'
              : 'bg-blunder',
        )}
      />
      {label}
    </span>
  )
}

/**
 * The Board: one board the owner analyses on and the coach can show things on.
 *
 * The owner loads a FEN or a PGN, drags pieces and walks the move list; the coach puts up
 * games and positions over MCP and plays and draws on them. Both land in the same state
 * (`services/live.py`), so each always sees what the other is looking at. `/live` is
 * fetched once — on load and after a reconnect — and every change after that arrives as a
 * whole `live.updated` payload the events provider writes straight into the cache. So this
 * page never polls, and a move slides in because chessground is reconfigured rather than
 * rebuilt. On the read-only demo the board is kept in the tab instead (`useBoard`).
 *
 * The engine panel is the reason the page exists as an analysis board: it searches the
 * position on the board with whichever engine is picked, a remote runner's included.
 *
 * An empty board is the starting position, ready to be played on — the first drag starts
 * a board rather than asking for one to be loaded.
 */
export function LivePage() {
  const board = useBoard()
  const { act } = board
  const state = board.state
  const { mcp } = useRuntimeCapabilities()
  const [flipped, setFlipped] = useState(false)
  const [flash, setFlash] = useState(false)
  const [loading, setLoading] = useState(false)
  const [hovered, setHovered] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ownAt = useRef(0)
  const { t } = useLingui()

  const followed = useGame(state?.game_id ?? 0, {}, { enabled: Boolean(state?.game_id) })
  const game = followed.data?.game
  // Named so the sentence it goes in stays one message with one placeholder.
  const followedError = followed.error?.message

  const perform = useCallback(
    (action: BoardAction, onSuccess?: () => void) => {
      ownAt.current = Date.now()
      act(action, { onSuccess })
    },
    [act],
  )

  useLiveUpdates(() => {
    if (Date.now() - ownAt.current < OWN_ACTION_MS) return
    setFlash(true)
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => setFlash(false), FLASH_MS)
  })
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  const active = state?.active === true
  const orientation: BoardOrientation = orientationFor(game, flipped)
  const boardFen = active && state?.fen ? state.fen : START_FEN
  const dests = useMemo(() => boardDests(boardFen), [boardFen])

  const stream = useStreamSession({
    surface: 'live',
    fen: boardFen,
    gameId: state?.game_id ?? null,
    ply: state?.ply ?? null,
  })

  // ← / → walk the move list. A dialog open over the page keeps its own keys.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      if (isTyping(event.target) || document.querySelector('[role="dialog"]')) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const step = state ? stepAction(state, event.key === 'ArrowLeft' ? -1 : 1) : null
      if (!step) return
      event.preventDefault()
      perform(step)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [state, perform])

  // A FEN or a PGN pasted anywhere on the page — outside a text box — is loaded as if it
  // had gone through the dialog.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (isTyping(event.target) || document.querySelector('[role="dialog"]')) return
      const input = detectInput(event.clipboardData?.getData('text/plain') ?? '')
      if (!input) return
      event.preventDefault()
      perform({ kind: 'load', input })
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [perform])

  const arrows = useMemo<BoardArrow[]>(() => {
    const drawn = boardArrows(state)
    if (!hovered) return drawn
    return [...drawn, { from: hovered.slice(0, 2), to: hovered.slice(2, 4), color: 'blue' }]
  }, [state, hovered])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SetPageChrome
        breadcrumb={[{ label: t`Board` }]}
        actions={board.local ? null : <ConnectionPill />}
        manual="guide/board"
      />

      {/*
        The heading wraps below `lg`: "Save this moment" and the flip control are the two
        things a phone still needs from this row, and squeezing them onto the same line as
        the session description leaves none of the three legible. A tablet or a narrow
        window with the rail open runs out of room the same way, so it wraps there too.
      */}
      <header className="flex flex-none items-end gap-3 px-5 pt-4.5 pb-3 max-lg:flex-wrap max-lg:gap-y-2 max-md:px-3">
        <div className="flex min-w-0 flex-col gap-[0.1875rem]">
          <h1 className="text-[1.1875rem] font-semibold tracking-[-0.01em] text-ink">
            <Trans>Board</Trans>
          </h1>
          <p className="text-[0.78125rem] text-dim">{describeSession(state, game)}</p>
        </div>
        <div className="flex-1" />
        {(state?.position_count ?? 0) > 1 ? <div className="flex items-center gap-2">
          <Button size="sm" disabled={board.pending || !state?.position_index} onClick={() => perform({ kind: 'select', index: (state?.position_index ?? 0) - 1 })}><Trans>Prev</Trans></Button>
          <span className="text-xs tabular-nums">{(state?.position_index ?? 0) + 1} / {state?.position_count}</span>
          <Button size="sm" disabled={board.pending || (state?.position_index ?? 0) >= (state?.position_count ?? 0) - 1} onClick={() => perform({ kind: 'select', index: (state?.position_index ?? 0) + 1 })}><Trans>Next</Trans></Button>
        </div> : null}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            board.clearFailure()
            setLoading(true)
          }}
        >
          <ClipboardPaste aria-hidden />
          <Trans>Load…</Trans>
        </Button>
        <Button size="sm" disabled={!active || board.pending} onClick={() => perform({ kind: 'reset' })}><Trans>Reset</Trans></Button>
        {board.local ? null : <SaveMoment active={active} />}
        <button
          type="button"
          onClick={() => setFlipped((value) => !value)}
          aria-label={t`Flip the board`}
          className="inline-flex items-center gap-2 rounded-md border border-edge px-2.5 py-[0.3125rem] text-[0.6875rem] text-soft transition-colors hover:border-edge-hover hover:text-ink"
        >
          <FlipVertical2 className="size-3.5" aria-hidden />
          {orientation === 'white' ? t`White` : t`Black`}
        </button>
      </header>

      {board.failure && !loading ? <p role="alert" className="px-5 text-sm text-blunder">{board.failure.message}</p> : null}
      {loading ? (
        <LoadPositionDialog
          pending={board.pending}
          error={board.failure?.message ?? null}
          onLoad={(input) => perform({ kind: 'load', input }, () => setLoading(false))}
          onNew={() => perform({ kind: 'new' }, () => setLoading(false))}
          onClose={() => setLoading(false)}
        />
      ) : null}
      {/*
        Board over rail below `md`, in one scroller. The desktop shape is a board sized to
        the viewport height beside a rail that scrolls on its own; on a phone the height
        cap makes the board a stamp and two independent scrollers make the analysis
        unreachable, so the row becomes a column and the page takes the scrolling.
      */}
      <div className="flex min-h-0 flex-1 gap-4 px-5 pb-4.5 max-md:flex-col max-md:gap-3 max-md:overflow-y-auto max-md:px-3">
        <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center max-md:flex-none">
          {board.loading ? (
            <Skeleton
              className="aspect-square w-full max-w-[min(100%,calc(100vh-11.875rem))] max-md:max-w-full"
              data-testid="live-loading"
            />
          ) : board.loadError ? (
            <div className="max-w-md rounded-xl border border-blunder/28 bg-blunder/5 px-4 py-6 text-center">
              <p className="text-[0.78125rem] text-blunder">
                <Trans>The board could not be read.</Trans>
              </p>
              <p className="mt-1 font-mono text-[0.6875rem] text-blunder/80">{board.loadError.message}</p>
            </div>
          ) : (
            <div className="flex w-full max-w-[min(100%,calc(100vh-11.875rem))] flex-col gap-2 max-md:max-w-full">
              <div
                className={cn(
                  // The height cap keeps the board inside a desktop viewport that never
                  // scrolls; below `md` the page scrolls, so the board takes the full width.
                  'relative w-full rounded-md transition-shadow duration-300',
                  flash && 'shadow-[0_0_0_0.125rem_color-mix(in_srgb,var(--bb-accent)_55%,transparent)]',
                )}
              >
                <Board
                  fen={boardFen}
                  orientation={orientation}
                  lastMove={active ? state?.last_move : null}
                  arrows={arrows}
                  squares={boardSquares(state)}
                  turnColor={state?.turn === 'black' ? 'black' : 'white'}
                  viewOnly={false}
                  dests={dests}
                  onMove={(orig, dest) => perform({ kind: 'play', ucis: [dragToUci(boardFen, orig, dest)] })}
                  animationDuration={260}
                />
              </div>
              {mcp && !board.local ? (
                <p className="text-[0.6875rem] leading-[1.55] text-faint">
                  <Trans>
                    Your assistant can put games and positions here too, with{' '}
                    <span className="font-mono text-dim">show_game</span> and{' '}
                    <span className="font-mono text-dim">show_position</span>, and read back
                    what you are looking at.
                  </Trans>
                </p>
              ) : null}
            </div>
          )}
        </div>

        <aside className="flex w-[21.25rem] flex-none flex-col gap-4 overflow-y-auto max-md:w-full max-md:overflow-visible">
          <InfiniteAnalysisPanel
            stream={stream}
            fen={boardFen}
            ply={fenPly(boardFen)}
            onHoverMove={setHovered}
            onPlayLine={(ucis, index) => perform({ kind: 'play', ucis: ucis.slice(0, index + 1) })}
            orientation={orientation}
            // In the rail it is a card like the ones under it, rather than the hairline
            // strip it is when it hangs off the bottom of the game page's move list.
            className="rounded-xl border border-line"
          />
          <section className="flex flex-col gap-2 rounded-xl border border-line p-3">
            <h2 className="text-[0.78125rem] font-semibold text-ink">
              <Trans>Moves</Trans>
            </h2>
            <BoardMoves
              state={state ?? EMPTY_BOARD}
              onGoto={(ply, cursor) => perform({ kind: 'goto', ply, cursor })}
              className="max-h-64 overflow-y-auto"
            />
          </section>
          <CoachComment text={state?.text} updatedAt={state?.updated_at} />
          {state && active ? <SessionMeta state={state} game={game} /> : null}
          {followed.isError ? (
            <p className="rounded-lg border border-mistake/28 bg-mistake/5 px-3 py-2.5 text-[0.71875rem] text-mistake">
              <Trans>The followed game could not be read — {followedError}</Trans>
            </p>
          ) : null}
        </aside>
      </div>
    </div>
  )
}
