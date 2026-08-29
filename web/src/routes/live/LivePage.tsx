import { FlipVertical2, Radio } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { InfiniteAnalysisPanel } from '@/components/analysis/InfiniteAnalysisPanel'
import { Board } from '@/components/board/Board'
import { SetPageChrome } from '@/components/shell/PageChrome'
import { Skeleton } from '@/components/ui/skeleton'
import { useStreamSession } from '@/lib/analysis'
import { useGame, useLiveState } from '@/lib/api/queries'
import type { BoardOrientation } from '@/components/board/Board'
import { useEvents, useLiveUpdates } from '@/lib/events/EventsProvider'
import { cn } from '@/lib/utils'

import { CoachComment } from './CoachComment'
import { SaveMoment } from './SaveMoment'
import { SessionMeta } from './SessionMeta'
import { boardArrows, boardSquares, describeSession, orientationFor } from './live'

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
/** How long the board keeps its ring after an update, so a move is felt as well as seen. */
const FLASH_MS = 700

function ConnectionPill() {
  const { status, reconnects } = useEvents()
  const label =
    status === 'open'
      ? reconnects > 0
        ? `live · reconnected ${reconnects}×`
        : 'live'
      : status === 'connecting'
        ? 'connecting'
        : 'offline — retrying'
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
 * Live mode: the one board the coach is driving.
 *
 * `/live` is fetched once — on load and after a reconnect — and every change after that
 * arrives as a whole `live.updated` payload the events provider writes straight into the
 * cache. So this page never polls, and a move slides in because chessground is
 * reconfigured rather than rebuilt.
 */
export function LivePage() {
  const live = useLiveState()
  const state = live.data
  const [flipped, setFlipped] = useState(false)
  const [flash, setFlash] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const followed = useGame(state?.game_id ?? 0, {}, { enabled: Boolean(state?.game_id) })
  const game = followed.data?.game

  useLiveUpdates(() => {
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

  // `fen: null` while nothing is on the board keeps the session shut and the toggle
  // disabled — there is no position to search, and the coach may put one up at any moment.
  const boardFen = active && state?.fen ? state.fen : null
  const stream = useStreamSession({
    surface: 'live',
    fen: boardFen,
    gameId: state?.game_id ?? null,
    ply: state?.ply ?? null,
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SetPageChrome breadcrumb={[{ label: 'Live' }]} actions={<ConnectionPill />} />

      {/*
        The heading wraps below `md`: "Save this moment" and the flip control are the two
        things a phone still needs from this row, and squeezing them onto the same line as
        the session description leaves none of the three legible.
      */}
      <header className="flex flex-none items-end gap-3 px-5 pt-4.5 pb-3 max-md:flex-wrap max-md:px-3">
        <div className="flex flex-col gap-[0.1875rem] max-md:min-w-0">
          <h1 className="flex items-center gap-2.5 text-[1.1875rem] font-semibold tracking-[-0.01em] text-ink">
            Live
            {active ? (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-accent-teal/30 bg-accent-teal/10 px-2 py-px text-[0.6875rem] font-normal text-accent-teal">
                <Radio className="size-3" aria-hidden />
                on air
              </span>
            ) : null}
          </h1>
          <p className="text-[0.78125rem] text-dim">{describeSession(state, game)}</p>
        </div>
        <div className="flex-1" />
        <SaveMoment active={active} />
        <button
          type="button"
          onClick={() => setFlipped((value) => !value)}
          aria-label="Flip the board"
          className="inline-flex items-center gap-2 rounded-md border border-edge px-2.5 py-[0.3125rem] text-[0.6875rem] text-soft transition-colors hover:border-edge-hover hover:text-ink"
        >
          <FlipVertical2 className="size-3.5" aria-hidden />
          {orientation === 'white' ? 'White' : 'Black'}
        </button>
      </header>

      {/*
        Board over rail below `md`, in one scroller. The desktop shape is a board sized to
        the viewport height beside a rail that scrolls on its own; on a phone the height
        cap makes the board a stamp and two independent scrollers make the analysis
        unreachable, so the row becomes a column and the page takes the scrolling.
      */}
      <div className="flex min-h-0 flex-1 gap-4 px-5 pb-4.5 max-md:flex-col max-md:gap-3 max-md:overflow-y-auto max-md:px-3">
        <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center max-md:flex-none">
          {live.isPending ? (
            <Skeleton
              className="aspect-square w-full max-w-[min(100%,calc(100vh-11.875rem))] max-md:max-w-full"
              data-testid="live-loading"
            />
          ) : live.isError ? (
            <div className="max-w-md rounded-xl border border-blunder/28 bg-blunder/5 px-4 py-6 text-center">
              <p className="text-[0.78125rem] text-blunder">The live session could not be read.</p>
              <p className="mt-1 font-mono text-[0.6875rem] text-blunder/80">{live.error.message}</p>
            </div>
          ) : (
            <div
              className={cn(
                // The height cap keeps the board inside a desktop viewport that never
                // scrolls; below `md` the page scrolls, so the board takes the full width.
                'relative w-full max-w-[min(100%,calc(100vh-11.875rem))] rounded-md transition-shadow duration-300 max-md:max-w-full',
                flash && 'shadow-[0_0_0_0.125rem_color-mix(in_srgb,var(--bb-accent)_55%,transparent)]',
              )}
            >
              <Board
                fen={active && state?.fen ? state.fen : START_FEN}
                orientation={orientation}
                lastMove={active ? state?.last_move : null}
                arrows={boardArrows(state)}
                squares={boardSquares(state)}
                turnColor={state?.turn === 'black' ? 'black' : 'white'}
                animationDuration={260}
                className={cn('transition-opacity', active ? 'opacity-100' : 'opacity-20')}
              />
              {active ? null : (
                <div className="absolute inset-0 flex items-center justify-center p-6">
                  <div className="flex max-w-sm flex-col items-center gap-2 rounded-xl border border-line bg-panel/95 px-5 py-6 text-center">
                    <Radio className="size-5 text-faint" aria-hidden />
                    <p className="text-[0.78125rem] text-soft">Nothing is on the board.</p>
                    <p className="text-[0.71875rem] leading-[1.55] text-dim">
                      Ask your assistant to put a game on it —{' '}
                      <span className="font-mono text-soft-2">show_game</span> for a stored
                      game, <span className="font-mono text-soft-2">show_position</span> for a
                      FEN. It appears here the moment it does, no refresh.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="flex w-[21.25rem] flex-none flex-col gap-4 overflow-y-auto max-md:w-full max-md:overflow-visible">
          <InfiniteAnalysisPanel
            stream={stream}
            fen={boardFen}
            ply={state?.ply ?? null}
            // In the rail it is a card like the ones under it, rather than the hairline
            // strip it is when it hangs off the bottom of the game page's move list.
            className="rounded-xl border border-line"
          />
          <CoachComment text={state?.text} updatedAt={state?.updated_at} />
          {state && active ? <SessionMeta state={state} game={game} /> : null}
          {followed.isError ? (
            <p className="rounded-lg border border-mistake/28 bg-mistake/5 px-3 py-2.5 text-[0.71875rem] text-mistake">
              The followed game could not be read — {followed.error.message}
            </p>
          ) : null}
        </aside>
      </div>
    </div>
  )
}
