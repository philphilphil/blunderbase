/**
 * The game screen's Book when it reads one of Lichess's books — the masters database or the
 * rated Lichess games — rather than the owner's own tree.
 *
 * The explorer's reference source in the notes track's width: the continuations (move, how
 * many games, White's score against Black's, the opening the move enters) and under them a
 * few of the games played from the position, each opening read-only at
 * `/reference/:source/:id` the way the explorer's model games do. Same request as the
 * explorer (`useReferenceExplorer`), so a position looked at on either screen is answered
 * from the same cache.
 *
 * Narrow on purpose. The track can be under 20rem wide, so the Opening column steps aside
 * below that (`@container`), and the games list is one line per game — the two names, the
 * result, the year — rather than the explorer's seven columns.
 *
 * The rows are the BookPanel's: a move row's height, radius and hover, flat on the column's
 * ground, and a row plays its move on the board, previewing it on hover and on focus.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import { useLocation, useNavigate } from 'react-router-dom'

import { LichessConnectCard } from '@/components/lichess/ConnectLichess'
import { COLUMN_HEAD, ROW } from '@/components/ui/row'
import { Skeleton } from '@/components/ui/skeleton'
import type { ReferenceMove, ReferenceSource } from '@/lib/api/types'
import { useNotation } from '@/lib/chess/notationPrefs'
import { cn } from '@/lib/utils'
import { SidesBar } from '@/routes/explorer/components/ScoreBar'
import { formatCount, resultOf, tokenTrouble } from '@/routes/explorer/reference'
import { formatResult } from '@/routes/games/format'

import { REFERENCE_GAME_LIMIT, useReferenceBook } from '../bookSource'
import { usePlyLabel } from '../plyNumbering'


/** Move, Games, the split, then the opening — which steps aside in a narrow track. */
const GRID =
  'grid grid-cols-[3.625rem_3rem_minmax(4.5rem,7rem)_minmax(0,1fr)] items-center gap-2 @max-[20rem]:grid-cols-[3.625rem_3rem_minmax(0,1fr)]'
const OPENING = '@max-[20rem]:hidden'

export interface ReferenceBookProps {
  source: ReferenceSource
  /** The position on the board. */
  fen: string
  /** The half-move count on the board, which labels the continuations. */
  ply: number
  /** Lichess only: `blitz,rapid,classical` and `1600,1800,2000`. */
  speeds?: readonly string[]
  ratings?: readonly number[]
  onPlay?: (move: ReferenceMove) => void
  onPreview?: (continuation: string[] | null) => void
}

export function ReferenceBook({
  source,
  fen,
  ply,
  speeds = [],
  ratings = [],
  onPlay,
  onPreview,
}: ReferenceBookProps) {
  const { t } = useLingui()
  const notate = useNotation()
  const plyLabel = usePlyLabel()
  const navigate = useNavigate()
  const location = useLocation()
  // Where the reader came from, so the game it opens offers the way back to this position.
  const from = `${location.pathname}${location.search}`

  // The same query the tab's count reads (`../bookSource`), so the two never disagree.
  const book = useReferenceBook(source, fen, speeds, ratings)

  const token = tokenTrouble(book.error)
  if (token) {
    return (
      <div className="p-2">
        <LichessConnectCard reason={token} />
      </div>
    )
  }
  if (book.isError) {
    return (
      <p className="px-3 py-6 text-center text-data text-dim">
        <Trans>Lichess did not answer. Try again in a moment.</Trans>
      </p>
    )
  }
  if (book.isPending) {
    return (
      <div className="flex flex-col gap-1 px-3 py-2" data-testid="reference-book-loading">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-[1.375rem] rounded-md" />
        ))}
      </div>
    )
  }

  const moves = book.data.moves
  const games = book.data.top_games.slice(0, REFERENCE_GAME_LIMIT)
  if (moves.length === 0 && games.length === 0) {
    return (
      <p data-testid="reference-book-empty" className="px-3 py-6 text-center text-data text-dim">
        {source === 'masters' ? (
          <Trans>No masters game reached this position.</Trans>
        ) : (
          <Trans>No rated Lichess game with these filters reached this position.</Trans>
        )}
      </p>
    )
  }

  return (
    <div className="@container flex flex-col px-1.5 pb-2" data-testid="reference-book">
      {moves.length > 0 ? (
        <div
          role="table"
          aria-label={source === 'masters' ? t`Masters games from this position` : t`Lichess games from this position`}
        >
          <div role="row" className={cn(GRID, COLUMN_HEAD, 'h-5 border-b border-hairline px-1.5')}>
            <span role="columnheader">
              <Trans>Move</Trans>
            </span>
            <span role="columnheader" className="text-right">
              <Trans>Games</Trans>
            </span>
            {/* "Score", as on the owner's book: the bar's own label says it is White's wins,
                the draws and Black's, and a three-part heading wrapped in a narrow track. */}
            <span role="columnheader" className="truncate">
              <Trans>Score</Trans>
            </span>
            <span role="columnheader" className={OPENING}>
              <Trans>Opening</Trans>
            </span>
          </div>
          {moves.map((move) => {
            const cells = (
              <>
                <span role="cell" className="text-ink">
                  {plyLabel(ply)}
                  {notate(move.san)}
                </span>
                <span role="cell" className="text-right text-body">
                  {formatCount(move.games)}
                </span>
                <span role="cell">
                  <SidesBar white={move.white} draws={move.draws} black={move.black} className="w-full" />
                </span>
                <span
                  role="cell"
                  title={move.name ?? undefined}
                  className={cn('truncate font-sans text-data font-semibold text-ink', OPENING)}
                >
                  {move.name}
                </span>
              </>
            )
            const row = cn(GRID, 'h-[1.625rem] rounded-md px-1.5 font-mono text-data')
            return onPlay ? (
              <button
                key={move.uci}
                type="button"
                role="row"
                onClick={() => onPlay(move)}
                onPointerEnter={() => onPreview?.([move.uci])}
                onPointerLeave={() => onPreview?.(null)}
                onFocus={() => onPreview?.([move.uci])}
                onBlur={() => onPreview?.(null)}
                className={cn(row, ROW, 'w-full text-left')}
              >
                {cells}
              </button>
            ) : (
              <div key={move.uci} role="row" className={row}>
                {cells}
              </div>
            )
          })}
        </div>
      ) : null}

      {games.length > 0 ? (
        <div className="mt-3 flex flex-col">
          <span className={cn(COLUMN_HEAD, 'border-b border-hairline px-1.5 pb-0.5')}>
            {source === 'masters' ? <Trans>Masters games</Trans> : <Trans>Lichess games</Trans>}
          </span>
          {games.map((game) => (
            <button
              key={game.id}
              type="button"
              onClick={() => navigate(`/reference/${source}/${game.id}`, { state: { from } })}
              className={cn(
                ROW,
                'flex h-[1.625rem] items-center gap-2 rounded-md px-1.5 text-left font-mono text-data whitespace-nowrap',
              )}
            >
              <span className="min-w-0 flex-1 truncate font-sans text-body">
                {game.white.name}
                <span className="text-dim"> – </span>
                {game.black.name}
              </span>
              <span className="flex-none text-soft">{formatResult(resultOf(game.winner))}</span>
              <span className="w-9 flex-none text-right text-faint">{game.year ?? '—'}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
