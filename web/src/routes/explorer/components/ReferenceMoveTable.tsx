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
 */
import { Skeleton } from '@/components/ui/skeleton'
import type { ReferenceExplorerResponse, ReferenceMove } from '@/lib/api/types'
import { cn } from '@/lib/utils'

import { plyLabel } from '../line'
import { formatCount, sharePercent } from '../reference'
import { SidesBar } from './ScoreBar'

const COLUMNS = [
  { id: 'move', label: 'Move', width: 78 },
  { id: 'games', label: 'Games', width: 62, align: 'right' as const },
  { id: 'share', label: 'Share', width: 44, align: 'right' as const },
  { id: 'split', label: 'White / draw / black', width: 'flex' as const },
  { id: 'rating', label: 'Avg elo', width: 56, align: 'right' as const },
  { id: 'opening', label: 'Opening', width: 'flex' as const },
]

function style(width: number | 'flex') {
  return width === 'flex' ? { flex: 1, minWidth: 0 } : { width, flex: 'none' as const }
}

/** The same arithmetic `MoveTreeTable` does: a cap of ten rows plus the gaps between them. */
const ROW_HEIGHT_REM = 2.375
const ROW_GAP_REM = 0.125
const VISIBLE_ROWS = 10
const ROWS_MAX_HEIGHT = `${VISIBLE_ROWS * ROW_HEIGHT_REM + (VISIBLE_ROWS - 1) * ROW_GAP_REM}rem`

/**
 * 240px of fixed columns plus the gaps, the padding and a readable minimum for the two
 * flex columns — the sides bar and the opening name split what is left, so the floor has
 * to hold both. It still scrolls sideways rather than crushing the bar to a smear on a
 * phone.
 */
const MIN_TABLE = 'max-md:min-w-[38rem]'

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

  return (
    <div
      className="flex flex-col gap-3.5 max-md:overflow-x-auto"
      role="table"
      aria-label="Reference continuations"
    >
      <div
        role="row"
        className={cn(
          'flex h-[1.875rem] flex-none items-center gap-3 rounded-[0.4375rem] border border-line bg-panel px-3 text-[0.65625rem] tracking-[.06em] text-dim-2 uppercase',
          MIN_TABLE,
        )}
      >
        {COLUMNS.map((column) => (
          <span
            key={column.id}
            style={style(column.width)}
            className={cn(column.align === 'right' && 'text-right')}
          >
            {column.label}
          </span>
        ))}
      </div>

      {loading ? (
        <div
          className={cn('flex flex-col gap-0.5', MIN_TABLE)}
          data-testid="reference-loading"
        >
          {Array.from({ length: 5 }, (_, index) => (
            <div
              key={index}
              style={{ opacity: 1 - index * 0.15 }}
              className="flex h-[2.375rem] items-center gap-3 px-3"
            >
              {COLUMNS.map((column) => (
                <span key={column.id} style={style(column.width)}>
                  <Skeleton className="h-2.5" />
                </span>
              ))}
            </div>
          ))}
        </div>
      ) : moves.length === 0 ? (
        <div className="rounded-[0.5625rem] border border-dashed border-edge-strong bg-panel/60 px-3 py-8 text-center">
          <p className="text-[0.78125rem] text-dim">
            No game in this database goes any further than this position.
          </p>
        </div>
      ) : (
        <div
          style={{ maxHeight: ROWS_MAX_HEIGHT }}
          className={cn(
            'flex flex-col gap-0.5 overflow-y-auto font-mono text-[0.78125rem] tabular',
            MIN_TABLE,
          )}
        >
          {moves.map((move) => {
            const share = sharePercent(move.games, total)
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
                className="flex h-[2.375rem] items-center gap-3 rounded-[0.4375rem] px-3 text-left transition-colors hover:bg-elevated-2"
              >
                <span style={style(78)} className="text-[0.84375rem] text-body">
                  {plyLabel(ply)}
                  {move.san}
                </span>
                <span
                  style={style(62)}
                  className="text-right text-body"
                  title={`${move.games} games`}
                >
                  {formatCount(move.games)}
                </span>
                <span style={style(44)} className="text-right text-dim">
                  {share === null ? '—' : `${share}%`}
                </span>
                <span style={style('flex')}>
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
                  className="truncate font-sans text-[0.71875rem] text-soft-2"
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
