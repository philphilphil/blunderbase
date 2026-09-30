import { useMutation, useQueryClient } from '@tanstack/react-query'
import { resetLive, selectLivePosition } from '@/lib/api/endpoints'
import { queryKeys } from '@/lib/api/keys'
import { MiniBoard } from '@/components/board/MiniBoard'
import { Button } from '@/components/ui/button'
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group'
import { Trans, useLingui } from '@lingui/react/macro'
import { ChevronLeft, ChevronRight, FlipVertical2, Radio, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { InfiniteAnalysisPanel } from '@/components/analysis/InfiniteAnalysisPanel'
import { StatusDot } from '@/components/badges/StatusDot'
import { Board } from '@/components/board/Board'
import { SetPageChrome } from '@/components/shell/PageChrome'
import { Skeleton } from '@/components/ui/skeleton'
import { useStreamSession } from '@/lib/analysis'
import { useGame, useLiveState } from '@/lib/api/queries'
import { useNotation } from '@/lib/chess/notationPrefs'
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

/**
 * The socket's state, in the bar: a status word with its dot and no box, because it is a
 * fact about the connection and a bordered pill beside the bar's buttons read as one more
 * button. Green is alive (the dot grammar every status in the app uses), amber while it
 * connects, red while it is down.
 */
function ConnectionStatus() {
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
        'inline-flex items-center gap-1.5 text-label whitespace-nowrap',
        status === 'open'
          ? 'text-soft'
          : status === 'connecting'
            ? 'text-mistake'
            : 'text-blunder',
      )}
    >
      <StatusDot
        tone={status === 'open' ? 'healthy' : status === 'connecting' ? 'degraded' : 'error'}
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
  const client = useQueryClient()
  const control = useMutation({
    mutationFn: (index: number | null) => index === null ? resetLive() : selectLivePosition(index),
    onSuccess: (data) => client.setQueryData(queryKeys.live(), data),
  })
  const [replayPly, setReplayPly] = useState(0)
  const live = useLiveState()
  const state = live.data
  useEffect(() => setReplayPly(state?.ply ?? 0), [state?.game_id, state?.ply, state?.position_index])
  const replay = state?.game_positions?.[replayPly]
  const [flipped, setFlipped] = useState(false)
  const [flash, setFlash] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { t } = useLingui()
  const notate = useNotation()

  const followed = useGame(state?.game_id ?? 0, {}, { enabled: Boolean(state?.game_id) })
  const game = followed.data?.game
  // Named so the sentence it goes in stays one message with one placeholder.
  const followedError = followed.error?.message

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
  const lastPosition = (state?.position_index ?? 0) >= (state?.position_count ?? 0) - 1
  const replayEnd = replayPly >= (state?.game_positions?.length ?? 1) - 1
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
      <SetPageChrome
        breadcrumb={[{ label: t`Live` }]}
        actions={<ConnectionStatus />}
        manual="guide/live"
      />

      {/*
        The heading wraps below `lg`: "Save this moment" and the flip control are the two
        things a phone still needs from this row, and squeezing them onto the same line as
        the session description leaves none of the three legible. A tablet or a narrow
        window with the rail open runs out of room the same way, so it wraps there too.

        The page's title is the bar's ("Live"), so this row is the session's status line
        rather than a second heading: whether the board is on air (a green dot, the app's
        "alive") and what it is following. Every control in it is a secondary face; none is
        the one primary, because nothing here is what the screen exists for — the coach
        drives the board, the owner watches it.
      */}
      <header className="flex flex-none items-end gap-3 px-5 pt-4.5 pb-3 max-lg:flex-wrap max-lg:gap-y-2 max-md:px-3">
        <div className="flex min-w-0 flex-col gap-[0.1875rem]">
          {active ? (
            <span className="inline-flex items-center gap-1.5 text-label font-medium text-ink">
              <StatusDot tone="working" />
              <Trans>on air</Trans>
            </span>
          ) : null}
          <p className="text-label text-dim">{describeSession(state, game)}</p>
        </div>
        <div className="flex-1" />
        {(state?.position_count ?? 0) > 1 ? (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={control.isPending || !state?.position_index}
              title={state?.position_index ? t`The coach's previous position` : t`Already on the coach's first position`}
              onClick={() => control.mutate((state?.position_index ?? 0) - 1)}
            >
              <ChevronLeft aria-hidden />
              <Trans>Prev</Trans>
            </Button>
            <span className="font-mono text-data text-body tabular">
              {(state?.position_index ?? 0) + 1} / {state?.position_count}
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={control.isPending || lastPosition}
              title={lastPosition ? t`Already on the coach's last position` : t`The coach's next position`}
              onClick={() => control.mutate((state?.position_index ?? 0) + 1)}
            >
              <Trans>Next</Trans>
              <ChevronRight aria-hidden />
            </Button>
          </div>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          disabled={!active || control.isPending}
          title={active ? t`Clear the board` : t`Nothing is on the board to reset`}
          onClick={() => control.mutate(null)}
        >
          <RotateCcw aria-hidden />
          <Trans>Reset</Trans>
        </Button>
        <SaveMoment active={active} />
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setFlipped((value) => !value)}
          aria-label={t`Flip the board`}
          title={t`Flip the board`}
        >
          <FlipVertical2 aria-hidden />
          <Trans>Flip</Trans>
        </Button>
      </header>

      {control.isError ? (
        <p role="alert" className="bb-error mx-5 mb-3 max-md:mx-3">
          {control.error.message}
        </p>
      ) : null}
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
              className="aspect-square w-full max-w-[min(100%,calc(100dvh-11.875rem))] max-md:max-w-full"
              data-testid="live-loading"
            />
          ) : live.isError ? (
            <div className="max-w-md rounded-xl border border-blunder/28 bg-blunder/5 px-4 py-6 text-center">
              <p className="text-data text-blunder">
                <Trans>The live session could not be read.</Trans>
              </p>
              <p className="mt-1 font-mono text-label text-blunder/80">{live.error.message}</p>
            </div>
          ) : (
            <div
              className={cn(
                // The height cap keeps the board inside a desktop viewport that never
                // scrolls; below `md` the page scrolls, so the board takes the full width.
                'relative w-full max-w-[min(100%,calc(100dvh-11.875rem))] rounded-md transition-shadow duration-300 max-md:max-w-full',
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
                    <p className="text-data text-soft">
                      <Trans>Nothing is on the board.</Trans>
                    </p>
                    <p className="text-label leading-[1.55] text-dim">
                      <Trans>
                        Ask your assistant to put a game on it —{' '}
                        <span className="font-mono text-soft-2">show_game</span> for a stored
                        game, <span className="font-mono text-soft-2">show_position</span> for a
                        FEN. It appears here the moment it does, no refresh.
                      </Trans>
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
          {/* The replay card steps through the game the board is following. Its ◀ ▶ are one
              "do one of these" group, and the move under the cursor wears the move list's
              current look (the blue fill and its ring), so it reads as the game screen's
              move list does. */}
          {active && replay ? (
            <section className="flex flex-col gap-3 rounded-xl border border-line p-3">
              <h2 className="text-data font-semibold text-ink">
                <Trans>Game replay</Trans>
              </h2>
              <MiniBoard fen={replay.fen} lastMove={replay.uci} orientation={orientation} size="100%" label={t`Referenced game position`} />
              <div className="flex items-center justify-between gap-2">
                <ButtonGroup label={t`Step through the game`}>
                  <ButtonGroupItem
                    aria-label={t`Previous game move`}
                    title={replayPly === 0 ? t`Already at the start` : t`Previous game move`}
                    disabled={replayPly === 0}
                    onClick={() => setReplayPly((ply) => ply - 1)}
                  >
                    <ChevronLeft aria-hidden />
                  </ButtonGroupItem>
                  <ButtonGroupItem
                    aria-label={t`Next game move`}
                    title={replayEnd ? t`Already at the last move` : t`Next game move`}
                    disabled={replayEnd}
                    onClick={() => setReplayPly((ply) => ply + 1)}
                  >
                    <ChevronRight aria-hidden />
                  </ButtonGroupItem>
                </ButtonGroup>
                <span className="font-mono text-data text-body tabular">
                  <Trans>Ply {replayPly}</Trans>
                </span>
              </div>
              <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto" aria-label={t`Game moves`}>
                {state?.game_positions?.map((position) => (
                  <button
                    type="button"
                    key={position.ply}
                    aria-current={position.ply === replayPly ? 'step' : undefined}
                    className={cn(
                      'rounded-sm px-1.5 py-1 font-mono text-data transition-colors',
                      position.ply === replayPly
                        ? 'bg-selected text-bright ring-1 ring-accent-teal/55 ring-inset'
                        : 'text-soft hover:bg-raised hover:text-ink',
                    )}
                    onClick={() => setReplayPly(position.ply)}
                  >
                    {position.ply === 0 ? t`Start` : `${Math.ceil(position.ply / 2)}${position.ply % 2 ? '.' : '…'} ${notate(position.san ?? '')}`}
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          <CoachComment text={state?.text} updatedAt={state?.updated_at} />
          {state && active ? <SessionMeta state={state} game={game} /> : null}
          {followed.isError ? (
            <p className="rounded-lg border border-mistake/28 bg-mistake/5 px-3 py-2.5 text-data text-mistake">
              <Trans>The followed game could not be read — {followedError}</Trans>
            </p>
          ) : null}
        </aside>
      </div>
    </div>
  )
}
