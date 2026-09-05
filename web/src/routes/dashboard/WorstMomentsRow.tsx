/**
 * Design 2a, "Your worst recent moments" — a grid of positions over `/stats/worst-moments`.
 *
 * Each card is the position the blunder was played from, the move that was played in red,
 * what it cost, and the move the engine wanted, drawn as a teal arrow. Clicking one opens
 * the game *on that position* (`?ply=`), not at move one: the card is a question and the
 * game page is where it is answered.
 *
 * A ROW OF SMALL SQUARE TILES, NOT THREE WIDE CARDS. The old row fitted three, and three is
 * not enough to be a list of things to work on — a single bad game could fill it (the
 * service now keeps one moment per game, which is the other half of that fix). Six tiles in
 * the width of the old three cost no more height than they did: the shape is the board's
 * own, so dropping the prose beside each board is what pays for twice the moments.
 *
 * They are deliberately small — a hundred-odd pixels, a quarter of the area a card that
 * size would want. This is a panel on a dashboard, not the stats page: the tile has to say
 * *which* position and roughly how bad, and anything more precise is a click away. At that
 * size the `??` badge goes too — every moment here is a blunder, so it was a badge saying
 * the same word six times, and the move is already drawn in the blunder's own red.
 *
 * WHAT "RECENT" MEANS: the last thirty days, said out loud in the heading. It used to mean
 * "ever", which on a library with an imported archive is a dashboard permanently showing
 * the same six moments from 2019. Where the window holds nothing — an owner who has not
 * played in a month, or has just imported and not analysed — the card falls back to the
 * whole library rather than showing an empty panel, and the heading says which of the two
 * you are looking at.
 *
 * The number on the card is the win percentage the move gave away, which is what the
 * ranking is by. It used to be the evaluation either side of the move, which meant a
 * request per card for a single ply — six of them now — to show a figure the heading was
 * not about. The eval swing is on the game page, one click away.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import { Board, type BoardArrow, type BoardSquare } from '@/components/board/Board'
import { SectionHead } from '@/components/shell/Section'
import { useWorstMoments } from '@/lib/api/queries'
import type { MomentResponse } from '@/lib/api/types'
import { formatWinLoss } from '@/lib/chess/evaluation'
import { cn } from '@/lib/utils'

import { Bar, EmptyBlock, ErrorBlock } from '@/routes/stats/kit/states'
import { shortDate } from '@/routes/stats/kit/analytics'

/** Six: one row of six tiles, in the height the old three wide cards took. */
const COUNT = 6
/** What "recent" means. Long enough to hold a quiet fortnight, short enough to be current. */
const RECENT_DAYS = 30

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

/** The tile's own metrics, shared with the skeleton so the grid never changes shape. */
const CARD = 'flex flex-col gap-[0.3125rem] rounded-md border border-line bg-panel p-[0.3125rem]'

function MomentCard({ moment }: { moment: MomentResponse }) {
  const { t } = useLingui()
  // Stable identities, so the board reconfigures only when the moment itself changes.
  const squares = useMemo(() => squaresOf(moment.uci), [moment.uci])
  const arrows = useMemo(() => arrowsOf(moment.best_move_uci), [moment.best_move_uci])

  const move = moveLabel(moment)
  const opponent = moment.game.opponent ?? t`unknown`
  const cost = formatWinLoss(moment.win_loss)
  const better = moment.best_move_san
  // Two whole sentences rather than one with a clause bolted on: the engine's move is only
  // there when there is one, and a translator needs to see either line entire.
  const title = better
    ? t`${move} vs ${opponent} — ${cost} win chance, better: ${better}`
    : t`${move} vs ${opponent} — ${cost} win chance`

  return (
    <Link
      // `?ply=` is a half-move count, and the moment's ply is the number of half-moves
      // before the blunder — so this is exactly the position on the card, with the move
      // that ruined it still to come.
      to={`/games/${moment.game.id}?ply=${moment.ply}`}
      // What a tile this size cannot spell out: the whole label, who it was against, and
      // what the engine wanted instead — which is drawn on the board as a teal arrow.
      title={title}
      className={cn(CARD, 'transition-colors hover:border-edge-strong')}
    >
      <div className="overflow-hidden rounded-sm">
        {moment.fen ? (
          <Board
            fen={moment.fen}
            orientation={moverOf(moment.fen)}
            coordinates={false}
            animation={false}
            squares={squares}
            arrows={arrows}
            className="w-full"
          />
        ) : (
          <Bar className="aspect-square w-full" />
        )}
      </div>
      <div className="flex flex-col gap-px px-px">
        <div className="flex items-baseline gap-1 font-mono text-[0.625rem]">
          <span className="min-w-0 truncate font-medium text-blunder">{move}</span>
          <span className="flex-1" />
          <span className="flex-none tabular text-dim">{cost}</span>
        </div>
        <div className="truncate text-[0.5625rem] text-faint">
          {opponent} · {shortDate(moment.game.played_at)}
        </div>
      </div>
    </Link>
  )
}

function MomentSkeleton() {
  return (
    <div className={CARD}>
      <Bar className="aspect-square w-full rounded-sm" />
      <div className="flex flex-col gap-px px-px">
        <Bar className="h-2.5 w-2/3" />
        <Bar className="h-2 w-1/2" />
      </div>
    </div>
  )
}

/**
 * All six in one row, three across on a phone. The tile is ~110px wide on a laptop and ~115
 * on a phone at three across, so the board is the same readable size on both and it is the
 * number of columns that gives way rather than the position.
 */
const GRID = 'grid grid-cols-6 gap-1.5 max-md:grid-cols-3 max-md:gap-2'

export function WorstMomentsRow({ className }: { className?: string }) {
  const { t } = useLingui()
  const recent = useWorstMoments({ amount: COUNT, days: RECENT_DAYS })
  // Nothing in the window is a real answer for a library that is being read rather than
  // played into, so the whole thing is asked for instead — and only then, which is why this
  // is a second query rather than a wider first one.
  const nothingRecent = recent.isSuccess && recent.data.length === 0
  const everything = useWorstMoments({ amount: COUNT }, { enabled: nothingRecent })
  const query = nothingRecent ? everything : recent
  const moments = query.data ?? []
  const days = RECENT_DAYS

  return (
    <section className={cn('flex min-h-0 flex-col gap-3', className)}>
      <SectionHead
        title={t`Worst recent moments`}
        detail={
          nothingRecent
            ? t`nothing in the last ${days} days — showing all time`
            : t`the last ${days} days, by the win percentage they gave away`
        }
        className="max-md:flex-wrap max-md:gap-y-0.5"
        end={
          <Link
            to="/games?has_blunders=true"
            className="text-[0.6875rem] text-accent-teal hover:text-accent-link"
          >
            <Trans>All blunders</Trans>
          </Link>
        }
      />
      {query.isPending ? (
        <div className={GRID} data-testid="loading">
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
          <Trans>
            Nothing analysed has gone badly wrong yet. Either the engine has not been over your
            games, or — less likely — you have not blundered.
          </Trans>
        </EmptyBlock>
      ) : (
        <div className={GRID}>
          {moments.map((moment) => (
            <MomentCard key={`${moment.game.id}-${moment.ply}`} moment={moment} />
          ))}
        </div>
      )}
    </section>
  )
}
