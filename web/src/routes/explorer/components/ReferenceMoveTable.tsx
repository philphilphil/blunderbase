/**
 * What everybody else plays here — the same table as `MoveTreeTable`, over a database the
 * owner has nothing to do with.
 *
 * It is a sibling rather than a mode of the owner's table because the two answer different
 * questions with different columns and must never be able to blend: `MoveTreeTable`'s
 * `Score%`, `Avg drop` and `Blund` are the owner's own play, and there is no such thing as
 * "your accuracy" in the masters database. What survives is the shape — a fixed-width
 * column list, rows that are buttons, the hover preview — so walking a reference book feels
 * exactly like walking your own tree, which is the whole point of putting it on this page
 * rather than on a new one.
 *
 * The columns are the five facts a reference book has: how often the move is played
 * (a count and its share of the position, because 40k games means nothing without the
 * total), how the games went for the two *sides* (see `SidesBar` — never green-and-red,
 * which would claim a result was good news for a reader who is not in the game), the
 * average rating of the players who chose it, which is how a move that is popular and a
 * move that is respected are told apart, and what the book calls the position the move
 * enters — named under the same rule as the owner's table, so the two never disagree.
 *
 * Nothing here is ever written down. A row plays its move into the line the same way the
 * owner's own table does, and that line is a URL; the counts behind it stay upstream.
 *
 * Header, rows and the narrow-table rule are `MoveTreeTable`'s: a plain ruled row of
 * column caps, `ROW` rows, and the one text column (`Opening`) drawn only once the table
 * has room to give it a readable width, with the row's `title` naming it otherwise.
 */
import type { MessageDescriptor } from '@lingui/core'
import { msg, plural } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'

import { COLUMN_HEAD, ROW } from '@/components/ui/row'
import { Skeleton } from '@/components/ui/skeleton'
import type { ReferenceExplorerResponse, ReferenceMove } from '@/lib/api/types'
import { useNotation } from '@/lib/chess/notationPrefs'
import { FADE_RIGHT, useMoreRight } from '@/lib/ui/useMoreRight'
import { cn } from '@/lib/utils'

import { plyLabel } from '../line'
import { formatCount, sharePercent } from '../reference'
import { SPLIT_WIDTH, SidesBar } from './ScoreBar'

const COLUMNS: {
  id: string
  label: MessageDescriptor
  width: number | 'flex'
  align?: 'right'
  optional?: boolean
}[] = [
  { id: 'move', label: msg`Move`, width: 64 },
  { id: 'games', label: msg`Games`, width: 62, align: 'right' },
  { id: 'share', label: msg`Share`, width: 40, align: 'right' },
  { id: 'split', label: msg`White / draw / black`, width: SPLIT_WIDTH },
  { id: 'rating', label: msg`Avg elo`, width: 56, align: 'right' },
  { id: 'opening', label: msg`Opening`, width: 'flex', optional: true },
]

function style(width: number | 'flex') {
  return width === 'flex' ? { flex: 1, minWidth: 0 } : { width, flex: 'none' as const }
}

/**
 * `Opening` appears once the table can give it 6rem: 22.5rem of fixed columns, gaps and
 * padding (at the app's 120% root size), one more gap and 6rem ≈ 29rem. The 530px pane of a
 * 1440 screen is just short of that, so there the row's `title` names the opening.
 */
const OPTIONAL = 'hidden @min-[29rem]:block'

/**
 * The same arithmetic `MoveTreeTable` does: fifteen rows plus the gaps between them, and used
 * as a height rather than a cap for the same reason — the page switches between that table
 * and this one in place, and the two must be the same size whatever each has to show.
 */
const ROW_HEIGHT_REM = 1.5
const ROW_GAP_REM = 0.125
const VISIBLE_ROWS = 15
const ROWS_HEIGHT = `${VISIBLE_ROWS * ROW_HEIGHT_REM + (VISIBLE_ROWS - 1) * ROW_GAP_REM}rem`

/**
 * 362px of fixed columns — the bar's among them, at the shared `SPLIT_WIDTH` — plus four
 * `gap-2`s and the `px-3` padding: about 430px, 22.5rem at the app's 120% root size.
 * Narrower than that (a phone) it scrolls sideways rather than dropping a number.
 */
const MIN_TABLE = 'min-w-[22.5rem]'

export function ReferenceMoveTable({
  data,
  ply,
  loading,
  onPlay,
  onPreview,
}: {
  data: ReferenceExplorerResponse | undefined
  /** The ply the continuations occupy, for the `5…Nb6` labels. */
  ply: number
  loading: boolean
  onPlay: (move: ReferenceMove) => void
  /** Play a continuation on the board without selecting it — see `MoveTreeTable`. */
  onPreview?: (continuation: string[] | null) => void
}) {
  const moves = data?.moves ?? []
  const total = data?.totals.games ?? 0
  const { i18n, t } = useLingui()
  const notate = useNotation()
  // At 1280 the pane is narrower than the table: the Games table's fade says there is more.
  const { ref: frame, onScroll, moreRight } = useMoreRight<HTMLDivElement>(moves.length)

  return (
    <div
      ref={frame}
      onScroll={onScroll}
      className={cn('@container flex flex-col gap-1 overflow-x-auto', moreRight && FADE_RIGHT)}
      role="table"
      aria-label={t`Reference continuations`}
    >
      <div
        role="row"
        className={cn(
          'flex h-7 flex-none items-center gap-2 border-b border-line px-3 whitespace-nowrap',
          COLUMN_HEAD,
          MIN_TABLE,
        )}
      >
        {COLUMNS.map((column) => (
          <span
            key={column.id}
            style={style(column.width)}
            className={cn(column.align === 'right' && 'text-right', column.optional && OPTIONAL)}
          >
            {i18n._(column.label)}
          </span>
        ))}
      </div>

      {loading ? (
        <div
          style={{ height: ROWS_HEIGHT }}
          className={cn('flex flex-col gap-0.5 overflow-hidden', MIN_TABLE)}
          data-testid="reference-loading"
        >
          {Array.from({ length: 5 }, (_, index) => (
            <div
              key={index}
              style={{ opacity: 1 - index * 0.15 }}
              className="flex h-[1.5rem] flex-none items-center gap-2 px-3"
            >
              {COLUMNS.map((column) => (
                <span
                  key={column.id}
                  style={style(column.width)}
                  className={cn(column.optional && OPTIONAL)}
                >
                  <Skeleton className="h-2.5" />
                </span>
              ))}
            </div>
          ))}
        </div>
      ) : moves.length === 0 ? (
        <div
          style={{ height: ROWS_HEIGHT }}
          className="flex items-center justify-center rounded-[0.5625rem] border border-dashed border-edge-strong bg-panel/60 px-3 text-center"
        >
          <p className="text-data text-dim">
            <Trans>No game in this database goes any further than this position.</Trans>
          </p>
        </div>
      ) : (
        <div
          style={{ height: ROWS_HEIGHT }}
          className={cn(
            'flex flex-col gap-0.5 overflow-y-auto font-mono text-data tabular',
            MIN_TABLE,
          )}
        >
          {moves.map((move) => {
            const share = sharePercent(move.games, total)
            // The exact count, unrounded and ungrouped — the cell beside it is the rounded
            // one, so a thousands separator here would read as a second, different figure.
            const count = move.games
            return (
              <button
                key={move.uci}
                type="button"
                onClick={() => onPlay(move)}
                onPointerEnter={() => onPreview?.([move.uci])}
                onPointerLeave={() => onPreview?.(null)}
                onFocus={() => onPreview?.([move.uci])}
                onBlur={() => onPreview?.(null)}
                role="row"
                title={move.name ?? undefined}
                className={cn(
                  ROW,
                  'flex h-[1.5rem] flex-none items-center gap-2 rounded-sm px-3 text-left',
                )}
              >
                <span style={style(64)} className="truncate text-lead text-body">
                  {plyLabel(ply)}
                  {notate(move.san)}
                </span>
                <span
                  style={style(62)}
                  className="text-right text-body"
                  title={t`${plural(count, { one: `${count} game`, other: `${count} games` })}`}
                >
                  {formatCount(move.games)}
                </span>
                <span style={style(40)} className="text-right text-dim">
                  {share === null ? '—' : `${share}%`}
                </span>
                <span style={style(SPLIT_WIDTH)}>
                  <SidesBar
                    white={move.white}
                    draws={move.draws}
                    black={move.black}
                    className="w-full"
                  />
                </span>
                <span style={style(56)} className="text-right text-soft-2">
                  {move.average_rating ?? '—'}
                </span>
                <span
                  style={style('flex')}
                  className={cn('truncate font-sans text-data text-soft-2', OPTIONAL)}
                  title={move.name ?? undefined}
                >
                  {move.name}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
