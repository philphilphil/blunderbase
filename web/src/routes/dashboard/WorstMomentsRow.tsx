/**
 * Design 2a, "Your worst recent moments" — a grid of positions over `/stats/worst-moments`.
 *
 * Each tile is the position the blunder was played from, the move that was played in its
 * classification's colour (a blunder's red), what it cost, and the move the engine wanted, drawn as a blue arrow and named under the
 * board. Clicking one opens the game *on that position* (`?ply=`), not at move one: the
 * tile is a question and the game page is where it is answered.
 *
 * SIX MOMENTS, BIG ENOUGH TO READ. Six, because three is not enough to be a list of things
 * to work on — a single bad game could fill it (the service keeps one moment per game,
 * which is the other half of that fix). They used to be six hundred-odd-pixel thumbnails
 * in one row, which said *which* position but not what was on it: a board that size is a
 * picture of a board. On an overview whose job is review, these are the positions to
 * look at, so they are now three to a row on a laptop (a board of roughly 190 to 300
 * pixels) and six across only on a screen wide enough to keep them that size. They sit
 * right under Resume, above the rating charts, so the page opens on them.
 *
 * No border box: a tile is the board and three short lines under it, lit on hover like a
 * list row. The lines say what the board cannot: the move and what it cost, the move the
 * engine wanted (in words as well as the arrow) with the phase it fell in, and who it was
 * against and when. There is no `??` badge — the move is already in its classification's
 * own colour, and six badges saying "blunder" was the same word six times.
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
import type { I18n, MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import { Board, type BoardArrow, type BoardSquare } from '@/components/board/Board'
import { SectionHead } from '@/components/shell/Section'
import { useWorstMoments } from '@/lib/api/queries'
import type { MomentResponse } from '@/lib/api/types'
import { glyphStyle } from '@/lib/chess/classification'
import { formatWinLoss } from '@/lib/chess/evaluation'
import { useNotation } from '@/lib/chess/notationPrefs'
import type { Notate } from '@/lib/chess/notation'
import { cn } from '@/lib/utils'

import { Bar, EmptyBlock, ErrorBlock } from '@/routes/stats/kit/states'
import { shortDate } from '@/routes/stats/kit/analytics'

/** Six: two rows of three on a laptop, one row on a wide screen. */
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
function moveLabel(moment: MomentResponse, notate: Notate): string {
  const number = moment.move_number ?? Math.floor(moment.ply / 2) + 1
  const suffix = moment.ply % 2 === 0 ? '.' : '…'
  return `${number}${suffix}${moment.san ? notate(moment.san) : ''}`
}

/**
 * The backend's `phase_of`, in words. The same messages as the stats page's phase card, so
 * a translator sees each phase once.
 */
const PHASE_LABELS: Record<string, MessageDescriptor> = {
  opening: msg`Opening`,
  middlegame: msg`Middlegame`,
  endgame: msg`Endgame`,
}

function phaseLabel(phase: string | null | undefined, i18n: I18n): string | null {
  if (!phase) return null
  const label = PHASE_LABELS[phase]
  return label ? i18n._(label) : phase
}

/** The tile's own metrics, shared with the skeleton so the grid never changes shape. */
const CARD = 'flex flex-col gap-1.5 rounded-md p-1.5'

function MomentCard({ moment }: { moment: MomentResponse }) {
  const { t, i18n } = useLingui()
  // Stable identities, so the board reconfigures only when the moment itself changes.
  const squares = useMemo(() => squaresOf(moment.uci), [moment.uci])
  const arrows = useMemo(() => arrowsOf(moment.best_move_uci), [moment.best_move_uci])

  const notate = useNotation()
  const move = moveLabel(moment, notate)
  const opponent = moment.game.opponent ?? t`unknown`
  const cost = formatWinLoss(moment.win_loss)
  const better = moment.best_move_san ? notate(moment.best_move_san) : null
  const phase = phaseLabel(moment.phase, i18n)
  const tone = glyphStyle(moment.classification)?.textClass ?? 'text-blunder'
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
      // The whole reading in one sentence, for a pointer resting on the tile; the lines
      // under the board say the same in pieces.
      title={title}
      className={cn(CARD, 'transition-colors hover:bg-raised')}
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
      <div className="flex flex-col gap-0.5 px-0.5">
        <div className="flex items-baseline gap-2 font-mono text-data">
          <span className={cn('min-w-0 truncate font-semibold', tone)}>{move}</span>
          <span className="flex-1" />
          <span className="flex-none tabular text-soft">{cost}</span>
        </div>
        {better || phase ? (
          <div className="flex items-baseline gap-2">
            {better ? (
              <span className="min-w-0 truncate font-mono text-label text-body">
                {t`Best: ${better}`}
              </span>
            ) : null}
            <span className="flex-1" />
            {phase ? <span className="flex-none text-label text-dim">{phase}</span> : null}
          </div>
        ) : null}
        <div className="truncate text-label text-dim-2">
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
      <div className="flex flex-col gap-1 px-0.5">
        <Bar className="h-3 w-2/3" />
        <Bar className="h-2.5 w-1/2" />
        <Bar className="h-2.5 w-3/5" />
      </div>
    </div>
  )
}

/**
 * Three across from a laptop up, so a board is 190 to 300 pixels wide and readable as a
 * position; six across only from 1760 pixels, where six still get that size. Two across on
 * a phone, which keeps a board about as wide as the laptop's smallest.
 */
const GRID = 'grid grid-cols-3 gap-4 min-[110rem]:grid-cols-6 max-md:grid-cols-2 max-md:gap-3'

export function WorstMomentsRow({ className }: { className?: string }) {
  const { t } = useLingui()
  const recent = useWorstMoments({ amount: COUNT, days: RECENT_DAYS })
  // Nothing in the window is a real answer for a library that is being read rather than
  // played into, so the whole thing is asked for instead — and only then, which is why this
  // is a second query rather than a wider first one.
  const nothingRecent = recent.isSuccess && recent.data.length === 0
  const everything = useWorstMoments({ amount: COUNT }, { enabled: nothingRecent })
  const query = nothingRecent ? everything : recent
  // A moment *is* the engine's verdict, so one from a game that is still holding its own
  // back (`engine_hidden`) would say here exactly what that game refuses to say. ⇧E is not
  // consulted here: `DashboardPage` does not render this row at all while it is on.
  const moments = (query.data ?? []).filter((moment) => moment.game.engine_hidden !== true)
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
            className="text-label text-accent-teal hover:text-accent-link"
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
