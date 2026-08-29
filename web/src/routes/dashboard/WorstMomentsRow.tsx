/**
 * Design 2a, "Your worst recent moments" — three cards over `/stats/worst-moments`.
 *
 * Each card is the position the blunder was played from, the move that was played in red,
 * the eval either side of it, and the move the engine wanted, drawn as a teal arrow.
 *
 * `MomentResponse` carries the FEN, the move and the win percentage it cost, but not the
 * evaluation before and after; that lives on the move row, so each card asks `/games/{id}`
 * for its single ply. Five small cached requests, invalidated by the same socket events as
 * everything else.
 */
import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import { ClassificationBadge } from '@/components/badges/ClassificationBadge'
import { Board, type BoardArrow, type BoardSquare } from '@/components/board/Board'
import { useGame, useWorstMoments } from '@/lib/api/queries'
import type { MomentResponse } from '@/lib/api/types'
import { formatScore, formatWinLoss } from '@/lib/chess/evaluation'
import { scoreAfter, scoreBefore } from '@/routes/game/gameModel'
import { cn } from '@/lib/utils'

import { Bar, EmptyBlock, ErrorBlock } from '@/routes/stats/kit/states'
import { shortDate } from '@/routes/stats/kit/analytics'

const COUNT = 3

/** The side to move in a FEN is the side that played the blunder. */
function moverOf(fen: string | null | undefined): 'white' | 'black' {
  return fen?.split(' ')[1] === 'b' ? 'black' : 'white'
}

const SQUARE = /^[a-h][1-8]$/

function squaresOf(uci: string | null | undefined): BoardSquare[] {
  if (!uci || uci.length < 4) return []
  const from = uci.slice(0, 2)
  const to = uci.slice(2, 4)
  if (!SQUARE.test(from) || !SQUARE.test(to)) return []
  return [
    { square: from, className: 'bb-blunder' },
    { square: to, className: 'bb-blunder' },
  ]
}

function arrowsOf(uci: string | null | undefined): BoardArrow[] {
  if (!uci || uci.length < 4) return []
  return [{ from: uci.slice(0, 2), to: uci.slice(2, 4), color: 'accent' }]
}

/** `96` + `49` -> `49…`, the way the design labels the move. */
function moveLabel(moment: MomentResponse): string {
  const number = moment.move_number ?? Math.floor(moment.ply / 2) + 1
  const suffix = moment.ply % 2 === 0 ? '.' : '…'
  return `${number}${suffix}${moment.san ?? ''}`
}

function MomentCard({ moment }: { moment: MomentResponse }) {
  // One ply of one game: the eval either side of the move the moment is about.
  const detail = useGame(moment.game.id, {
    ply_start: moment.ply,
    ply_end: moment.ply,
    notes: false,
  })
  // Stable identities, so the board reconfigures only when the moment itself changes.
  const squares = useMemo(() => squaresOf(moment.uci), [moment.uci])
  const arrows = useMemo(() => arrowsOf(moment.best_move_uci), [moment.best_move_uci])

  // The stored evals are mover-relative (`services/analysis.py: _move_row`), so they are
  // flipped into White's frame here exactly as the game view does it — otherwise the same
  // blunder reads "+0.85 → −2.10" on this card and "−0.85 → +2.10" on the game page.
  const row = detail.data?.moves?.[0]
  const beforeScore = scoreBefore(row)
  const afterScore = scoreAfter(row)
  const before = beforeScore ? formatScore(beforeScore) : null
  const after = afterScore ? formatScore(afterScore) : null

  return (
    <Link
      to={`/games/${moment.game.id}`}
      // `flex-1` is what splits the row into equal thirds; stacked, it would be asking the
      // card to share out a height nobody has decided yet, so the phone drops it and the
      // card is just its own 134px tall.
      className="flex h-[8.375rem] flex-1 gap-[0.6875rem] rounded-xl border border-line bg-panel p-[0.6875rem] transition-colors hover:border-edge-strong max-md:flex-none"
    >
      {/* A little smaller on a phone, where the card is full width but the prose beside the
          board is the half that has nowhere else to go. */}
      <div className="w-28 flex-none overflow-hidden rounded-sm max-md:w-24">
        {moment.fen ? (
          <Board
            fen={moment.fen}
            orientation={moverOf(moment.fen)}
            coordinates={false}
            animation={false}
            squares={squares}
            arrows={arrows}
          />
        ) : (
          <Bar className="aspect-square w-full" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-[0.4375rem] font-mono">
          <span className="truncate text-[0.8125rem] font-medium text-blunder">{moveLabel(moment)}</span>
          <ClassificationBadge classification={moment.classification} size="md" />
        </div>
        <div className="font-mono text-[0.6875rem] tabular text-soft-2">
          {before && after ? (
            <>
              {before} <span className="text-faint-2">→</span> {after}
            </>
          ) : detail.isPending ? (
            <span className="text-faint">…</span>
          ) : (
            <span title="win percentage given away">
              {formatWinLoss(moment.win_loss)} win chance
            </span>
          )}
        </div>
        <div className="truncate text-[0.6875rem] text-dim">
          vs {moment.game.opponent ?? 'unknown'} · {shortDate(moment.game.played_at)}
        </div>
        <div className="flex-1" />
        <div className="truncate text-[0.6875rem] leading-snug text-dim-2">
          {moment.best_move_san ? (
            <>
              Better: <span className="font-mono text-accent-teal">{moment.best_move_san}</span>
            </>
          ) : (
            `${moment.piece ?? 'A piece'} move, ${moment.phase ?? 'unknown phase'}`
          )}
        </div>
      </div>
    </Link>
  )
}

function MomentSkeleton() {
  return (
    <div className="flex h-[8.375rem] flex-1 gap-[0.6875rem] rounded-xl border border-line bg-panel p-[0.6875rem] max-md:flex-none">
      <Bar className="size-28 flex-none max-md:size-24" />
      <div className="flex flex-1 flex-col gap-2">
        <Bar className="h-3.5 w-2/3" />
        <Bar className="h-2.5 w-1/2" />
        <Bar className="h-2.5 w-3/4" />
      </div>
    </div>
  )
}

export function WorstMomentsRow({ className }: { className?: string }) {
  const query = useWorstMoments({ amount: COUNT })
  const moments = query.data ?? []

  return (
    <section className={cn('flex min-h-0 flex-col gap-[0.5625rem]', className)}>
      <div className="flex items-baseline gap-2 max-md:flex-wrap max-md:gap-y-0.5">
        <h2 className="text-xs font-semibold text-ink">Your worst recent moments</h2>
        <span className="text-[0.6875rem] text-dim-2">by the win percentage they gave away</span>
        <div className="flex-1" />
        <Link
          to="/games?has_blunders=true"
          className="text-[0.6875rem] text-accent-teal hover:text-accent-link"
        >
          all blunders
        </Link>
      </div>
      {query.isPending ? (
        <div className="flex gap-2.5 max-md:flex-col" data-testid="loading">
          {Array.from({ length: COUNT }, (_, index) => (
            <MomentSkeleton key={index} />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorBlock
          error={query.error}
          onRetry={() => void query.refetch()}
          className="flex-none"
        />
      ) : moments.length === 0 ? (
        <EmptyBlock className="flex-none">
          Nothing analysed has gone badly wrong yet. Either the engine has not been over your games,
          or — less likely — you have not blundered.
        </EmptyBlock>
      ) : (
        // Three across is the design; on a phone three across is three 100px cards, so
        // they stack — a moment is a board and four lines of prose, and neither survives
        // a third of 375px.
        <div className="flex gap-2.5 max-md:flex-col">
          {moments.map((moment) => (
            <MomentCard key={`${moment.game.id}-${moment.ply}`} moment={moment} />
          ))}
        </div>
      )}
    </section>
  )
}
