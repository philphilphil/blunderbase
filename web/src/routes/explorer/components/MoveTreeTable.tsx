/**
 * Design 2c's "your move tree from here": one row per continuation, with the frequency
 * (a count and its share of the games through this position, the same pair the reference
 * table shows), the win/draw/loss split, the score and the average win percentage the
 * mover gave away.
 *
 * The design's `Acc` column is per-move accuracy, which no endpoint computes; it is replaced
 * by `Blunders` — how many of the games through this move had the move classified as one,
 * which `/explorer` does report. `Avg drop` keeps the design's column but not its unit: the
 * mock's `−0.19` is pawns, and the only per-move loss the backend stores is win percentage
 * (`avg_win_loss`), so the column reads `−4.2%` (see `formatAvgDrop` in `../stats`).
 *
 * Both of those columns are about the owner and nobody else. `Games` and the score bar
 * count every game through the move whoever played it, but a blunder is only the owner's
 * when they were the one to move, so the service counts these two on their moves alone.
 * That makes `owner_moves === 0` — a continuation the opponent always played here — a row
 * with nothing to say about accuracy, and it says so with an em dash in both: a `0` there
 * would read as a move they played faultlessly rather than one they never played. `Avg
 * drop` gets there on its own, since `avg_win_loss` is null with no owner moves to average
 * and `formatAvgDrop` already renders null as a dash; `Blund` is a plain count and needs
 * the check spelled out.
 *
 * The last two columns are the two things a move leads *into*, and they are two columns
 * rather than two lines of one because they answer different questions and neither is a
 * footnote to the other: `Opening` is what the vendored book calls the position the move
 * reaches, `Note` is what the owner wrote about that same position. Both are flex columns
 * sharing what the fixed ones leave, and both truncate with the whole text in `title`.
 *
 * A name is reported only when the position the move reaches is itself named in the
 * vendored book, never inherited from the parent's name, so it reads as "this move enters
 * the Najdorf" and blank means "still in whatever you were in". The book stops naming
 * positions three to five plies in, so this is blank on most rows past the opening's first
 * few moves; that is expected, not a bug.
 *
 * The note used to be derived here — "played once", "3 games, thin sample" — from numbers
 * the row already shows in its own columns, which is why it read as arbitrary. It is now
 * the owner's own words and nothing else, the newest note on the position the move reaches
 * (`services.explorer._annotate_continuations`). Read-only here: a row is one button that
 * walks the tree and nothing inside it may be a second target, so notes are written in the
 * card beside the board, where the whole text is.
 *
 * The list is exactly `VISIBLE_ROWS` tall and scrolls inside itself. What it buys is not
 * space but a fixed place for everything under this table: without it a position with four
 * continuations and one with twenty-four move the cards below by hundreds of pixels, and
 * walking a line is exactly the act of going between such positions. It is a height and
 * not a maximum — four continuations draw four rows and empty space under them — because a
 * maximum only stopped the growth: the pane still shrank on a thin position, and switching
 * the source to a reference book with fewer rows visibly changed its size. The loading and
 * empty states take the same height for the same reason. `ReferenceMoveTable` shares the
 * numbers so the two sources are the same size to the pixel.
 *
 * Every row is `flex-none`, and that is not decoration: a flex item may shrink below its
 * own height, so without it a position with more continuations than fit did not scroll —
 * the rows squeezed to fit the box and quietly changed height from one position to the
 * next. The row height itself is the dense one that squeeze produced at the start position,
 * which read better than the design's 38px rows; the cap is fifteen of them, so the table
 * takes about the space it did before.
 */
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'

import { Skeleton } from '@/components/ui/skeleton'
import type { ExplorerMove, ExplorerResponse } from '@/lib/api/types'
import { cn } from '@/lib/utils'

import { plyLabel } from '../line'
import { sharePercent } from '../reference'
import { dropTone, formatAvgDrop, scorePercent, scoreTone, splitOf } from '../stats'
import { SPLIT_WIDTH, ScoreBar } from './ScoreBar'

const COLUMNS: { id: string; label: MessageDescriptor; width: number | 'flex'; align?: 'right' }[] =
  [
    { id: 'move', label: msg`Move`, width: 78 },
    { id: 'games', label: msg`Games`, width: 46, align: 'right' },
    { id: 'share', label: msg`Share`, width: 44, align: 'right' },
    { id: 'split', label: msg`Score`, width: SPLIT_WIDTH },
    { id: 'score', label: msg`Score%`, width: 52, align: 'right' },
    { id: 'drop', label: msg`Avg drop`, width: 66, align: 'right' },
    {
      id: 'blunders',
      label: msg({ message: 'Blund', comment: 'Column heading, short for “blunders”.' }),
      width: 44,
      align: 'right',
    },
    { id: 'opening', label: msg`Opening`, width: 'flex' },
    { id: 'note', label: msg`Note`, width: 'flex' },
  ]

function style(width: number | 'flex') {
  return width === 'flex' ? { flex: 1, minWidth: 0 } : { width, flex: 'none' as const }
}

/**
 * How tall the rows are and how many of them are on screen at once, in the one place the
 * arithmetic can be done: the cap is `VISIBLE_ROWS` rows plus the gaps between them, so it
 * follows a change to either rather than being a number somebody has to remember to redo.
 */
const ROW_HEIGHT_REM = 1.5
const ROW_GAP_REM = 0.125
const VISIBLE_ROWS = 15
const ROWS_HEIGHT = `${VISIBLE_ROWS * ROW_HEIGHT_REM + (VISIBLE_ROWS - 1) * ROW_GAP_REM}rem`

/**
 * Seven of the nine columns are fixed pixel widths — 500px of them — and the last two are
 * flexible, so below `md` the table scrolls sideways inside itself rather than shrinking.
 * Dropping columns instead would take away the numbers the screen exists to compare.
 *
 * The minimum is what the fixed columns need plus a readable share for the two flexible
 * ones, since flex alone would let `Opening` and `Note` crush each other to nothing on a
 * phone: 500px fixed + 8 gaps of 12px + 24px of padding + 2 × 8rem of text = 876px ≈ 55rem.
 * It is on the header and on the rows so the two stay in step, and the horizontal scroll is
 * on the element wrapping both, so the header travels with the rows.
 */
const MIN_TABLE = 'max-md:min-w-[55rem]'

export function MoveTreeTable({
  tree,
  ply,
  loading,
  onPlay,
  onPreview,
}: {
  tree: ExplorerResponse | undefined
  /** The ply the continuations occupy, for the `5…Nb6` labels. */
  ply: number
  loading: boolean
  onPlay: (move: ExplorerMove) => void
  /**
   * Play a continuation on the board as a preview without selecting it — `null` restores
   * the real position. Shared with the page's book line, whose preview is several plies
   * rather than one, so a single move rides in as a one-element array. Rows are buttons,
   * so this mirrors on focus/blur as well as pointer enter/leave, giving keyboard users
   * the same preview as a hover.
   */
  onPreview?: (continuation: string[] | null) => void
}) {
  const moves = tree?.moves ?? []
  const total = tree?.totals?.games ?? 0
  const mainLine = tree?.main_line?.[0]?.uci
  const { i18n, t } = useLingui()

  return (
    <div
      className="flex flex-col gap-3.5 max-md:overflow-x-auto"
      role="table"
      aria-label={t`Continuations`}
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
            {i18n._(column.label)}
          </span>
        ))}
      </div>

      {loading ? (
        <div
          style={{ height: ROWS_HEIGHT }}
          className={cn('flex flex-col gap-0.5 overflow-hidden', MIN_TABLE)}
          data-testid="tree-loading"
        >
          {Array.from({ length: 5 }, (_, index) => (
            <div
              key={index}
              style={{ opacity: 1 - index * 0.15 }}
              className="flex h-[1.5rem] flex-none items-center gap-3 px-3"
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
        <div
          style={{ height: ROWS_HEIGHT }}
          className="flex items-center justify-center rounded-[0.5625rem] border border-dashed border-edge-strong bg-panel/60 px-3 text-center"
        >
          <p className="text-[0.78125rem] text-dim">
            <Trans>No game of yours goes any further than this position.</Trans>
          </p>
        </div>
      ) : (
        <div
          // A height, not a max-height: the pane is the same size whether the position has
          // two continuations or twenty, and whether the source is the owner's tree or a
          // reference book, so switching between them moves nothing on the page. The
          // vertical scroll is inside the horizontal one rather than beside it, so below
          // `md` the whole table still slides sideways under its own header.
          style={{ height: ROWS_HEIGHT }}
          className={cn(
            'flex flex-col gap-0.5 overflow-y-auto font-mono text-[0.78125rem] tabular',
            MIN_TABLE,
          )}
        >
          {moves.map((move) => {
            const split = splitOf(move)
            const share = sharePercent(move.games, total)
            const percent = scorePercent(move.score)
            const main = move.uci === mainLine
            const note = move.note?.text ?? null
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
                className={cn(
                  'flex h-[1.5rem] flex-none items-center gap-3 rounded-[0.4375rem] px-3 text-left transition-colors',
                  main
                    ? 'bg-accent-teal/7 shadow-[inset_0_0_0_0.0625rem_color-mix(in_srgb,var(--bb-accent)_28%,transparent)]'
                    : 'hover:bg-elevated-2',
                )}
              >
                <span
                  style={style(78)}
                  className={cn('text-[0.84375rem]', main ? 'text-bright' : 'text-body')}
                >
                  {plyLabel(ply)}
                  {move.san}
                </span>
                <span style={style(46)} className="text-right text-body">
                  {move.games}
                </span>
                <span style={style(44)} className="text-right text-dim">
                  {share === null ? '—' : `${share}%`}
                </span>
                <span style={style(SPLIT_WIDTH)}>
                  <ScoreBar split={split} className="w-full" />
                </span>
                <span style={style(52)} className={cn('text-right', scoreTone(move.score))}>
                  {percent === null ? '—' : percent.toFixed(1)}
                </span>
                <span
                  style={style(66)}
                  className={cn('text-right', dropTone(move.avg_win_loss))}
                >
                  {formatAvgDrop(move.avg_win_loss)}
                </span>
                <span
                  style={style(44)}
                  className={cn(
                    'text-right',
                    (move.blunders ?? 0) > 0 ? 'text-blunder' : 'text-dim-2',
                  )}
                >
                  {(move.owner_moves ?? 0) === 0 ? '—' : (move.blunders ?? 0)}
                </span>
                <span
                  style={style('flex')}
                  className="truncate font-sans text-[0.71875rem] text-soft-2"
                  title={move.name ?? undefined}
                >
                  {move.name}
                </span>
                <span
                  style={style('flex')}
                  className="truncate font-sans text-[0.71875rem] text-dim-2"
                  title={note ?? undefined}
                >
                  {note}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
