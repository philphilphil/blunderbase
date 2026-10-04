/**
 * The owner's own tree from the position on the board — the explorer's answer, in the
 * game screen's notes track.
 *
 * It is the *same feature* as `/explorer`, so it uses the explorer's own columns, in the
 * explorer's order and vocabulary: Move, Games, the win/draw/loss split, Avg drop, Opening. It even
 * imports the explorer's `splitOf`/`formatAvgDrop`/`dropTone`/`ScoreBar` rather than
 * restating them, because a percentage that rounds differently on the two screens is how
 * one feature becomes two. The explorer's full table has seven columns and wants ~440px;
 * this track is nothing like that wide, so it is cut to five — the three that say how often
 * and how well, the move they belong to, and the opening that move enters. `Score%` and
 * `Blund` are the ones that go: the split bar already draws the score, and blunders are a
 * stronger claim than a handful of games can support. The bar is a fixed short width so
 * the opening name gets what is left; a split reads just as well at half the length.
 *
 * DRESSED LIKE THE MOVE TABLE, NOT LIKE A CARD. No border, no radius, no panel background —
 * it sits flat on the column's own ground, with rows the height, radius and hover of a move
 * row across the divider. The rounded-card treatment on this screen belongs to the two
 * engine panels, which are objects floating on that ground; a table you read and click
 * through is the ground.
 *
 * An empty position says so rather than rendering nothing. The Book tab is always on the
 * strip now (`NotesTrack`), so a position the library has never reached has to be a visible
 * answer — "no games from here" is information, and a tab that appeared and disappeared as
 * the board moved was a moving target to click at.
 */
import { Trans, useLingui } from '@lingui/react/macro'

import { useNotation } from '@/lib/chess/notationPrefs'
import { cn } from '@/lib/utils'
import { ScoreBar } from '@/routes/explorer/components/ScoreBar'
import { dropTone, formatAvgDrop, splitOf } from '@/routes/explorer/stats'

import { usePlyLabel } from '../plyNumbering'

/**
 * One continuation, as the explorer reports it.
 *
 * A structural subset of `ExplorerMove` on purpose: whatever shape the game payload's
 * `book` arrives in, a row carrying these field names under these names is assignable here,
 * and this component never has to be edited when the endpoint grows a field.
 */
export interface BookMove {
  uci: string
  san?: string | null
  games?: number
  wins?: number
  draws?: number
  losses?: number
  /** Win percentage the owner gave away playing this move, averaged. Null until analysed. */
  avg_win_loss?: number | null
  /** The opening this move enters, where the book names the position it reaches. */
  name?: string | null
}

/**
 * One position's worth of book — `GameDetail.book[ply]`, whose `games` counts every game of
 * the owner's that reached the position and not merely those that continued from it.
 */
export interface BookEntry {
  games?: number
  moves?: readonly BookMove[]
}

export interface BookPanelProps {
  /** The continuations the owner's games played from here, in the service's own order. */
  moves: readonly BookMove[]
  /**
   * The half-move count on the board — the number `GameDetail.book` is keyed by, which is
   * also the index of the move each continuation stands in for, so it labels them.
   */
  ply: number
  /** Walk a continuation on the board. Rows are inert — plain rows, not buttons — without it. */
  onPlay?: (move: BookMove) => void
  /**
   * Show a continuation on the board without selecting it; `null` restores the real
   * position. One move rides in as a one-element array, matching the explorer's own
   * `onPreview` and `lib/board/linePreview`, which take whole lines.
   */
  onPreview?: (continuation: string[] | null) => void
  className?: string
}

/**
 * Move, Games, Score, Avg drop, Opening — sized to the track it is in (`@container` on the
 * table). The notes track runs from under 15rem to well over 30, and one fixed set of widths
 * had left the score bar a stub and the opening a few letters wide in all but the widest.
 * So the bar takes what the fixed columns leave, up to a length that still reads; below
 * 20rem the Opening column steps aside (the name is over the table anyway), and below 15rem
 * Avg drop does too, leaving the three that say how often and how well.
 */
const GRID = cn(
  'grid items-center gap-2',
  'grid-cols-[3.625rem_2.25rem_minmax(3rem,7rem)_3.25rem_minmax(0,1fr)]',
  '@max-[20rem]:grid-cols-[3.625rem_2.25rem_minmax(3rem,1fr)_3.25rem]',
  '@max-[15rem]:grid-cols-[3.625rem_2.25rem_minmax(3rem,1fr)]',
)
const OPENING = '@max-[20rem]:hidden'
const DROP = '@max-[15rem]:hidden'

/** A move row's own metrics, so the two tables either side of the divider stay in step. */
const ROW = cn(GRID, 'h-[1.625rem] rounded-md px-1.5 font-mono text-data')

export function BookPanel({ moves, ply, onPlay, onPreview, className }: BookPanelProps) {
  const { t } = useLingui()
  const notate = useNotation()
  const plyLabel = usePlyLabel()

  if (moves.length === 0) {
    return (
      <p
        data-testid="book-panel-empty"
        className={cn('px-3 py-6 text-center text-data text-dim', className)}
      >
        <Trans>None of your games reached this position.</Trans>
      </p>
    )
  }

  return (
    <div
      role="table"
      aria-label={t`Your games from this position`}
      data-testid="book-panel"
      className={cn('@container flex flex-none flex-col px-1.5 pb-2', className)}
    >
      <div
        role="row"
        className={cn(
          GRID,
          'h-5 border-b border-hairline px-1.5 text-meta tracking-[.06em] text-dim uppercase',
        )}
      >
        <span>
          <Trans>Move</Trans>
        </span>
        <span className="text-right">
          <Trans>Games</Trans>
        </span>
        <span>
          <Trans>Score</Trans>
        </span>
        <span className={cn('text-right', DROP)}>
          <Trans>Avg drop</Trans>
        </span>
        <span className={OPENING}>
          <Trans>Opening</Trans>
        </span>
      </div>

      {moves.map((move) => {
        const split = splitOf(move)
        const cells = (
          <>
            <span className="text-ink">
              {plyLabel(ply)}
              {/* SAN is optional on the payload; the UCI is never missing and is still a
                  move somebody can read, which beats a blank cell. */}
              {move.san ? notate(move.san) : move.uci}
            </span>
            <span className="text-right text-body">{move.games ?? 0}</span>
            <ScoreBar split={split} className="w-full" />
            <span className={cn('text-right', dropTone(move.avg_win_loss), DROP)}>
              {formatAvgDrop(move.avg_win_loss)}
            </span>
            {/* Last, as on the explorer, and the column that truncates: most rows past the
                first few plies have no name, and those that do are long. */}
            <span
              title={move.name ?? undefined}
              data-testid="book-move-opening"
              className={cn('truncate font-sans text-data font-semibold text-ink', OPENING)}
            >
              {move.name}
            </span>
          </>
        )
        return onPlay ? (
          <button
            key={move.uci}
            type="button"
            role="row"
            onClick={() => onPlay(move)}
            // Focus previews as well as hover, so the keyboard reader sees the same board
            // the mouse does — the explorer's rows behave this way and so do these.
            onPointerEnter={() => onPreview?.([move.uci])}
            onPointerLeave={() => onPreview?.(null)}
            onFocus={() => onPreview?.([move.uci])}
            onBlur={() => onPreview?.(null)}
            className={cn(ROW, 'text-left transition-colors hover:bg-raised')}
          >
            {cells}
          </button>
        ) : (
          <div key={move.uci} role="row" className={ROW}>
            {cells}
          </div>
        )
      })}
    </div>
  )
}
