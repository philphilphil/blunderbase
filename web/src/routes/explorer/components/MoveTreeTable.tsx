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
 * They are drawn only when the table's own width has room for them (a container query,
 * `OPTIONAL`): the tree pane is 530px on a 1440 screen, and two text columns squeezed into
 * nothing had pushed the header off the pane at "AVG DRO…". Where they are hidden, the
 * row's `title` still carries the opening and the note.
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
 *
 * The header is a plain ruled row of column caps (`COLUMN_HEAD`), not a rounded box: a box
 * read as one more control above the rows. Rows are the shared `ROW` (hover `raised`, never
 * the selected blue: hover must not preview "chosen"). No row is ever drawn selected — a
 * click plays the move and the table moves on to the next position — so the main line,
 * which used to wear a tinted outline before anything was chosen, is data: its move is
 * bold, and nothing else about the row changes.
 */
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'

import { COLUMN_HEAD, ROW } from '@/components/ui/row'
import { Skeleton } from '@/components/ui/skeleton'
import type { ExplorerMove, ExplorerResponse } from '@/lib/api/types'
import { useNotation } from '@/lib/chess/notationPrefs'
import { FADE_RIGHT, useMoreRight } from '@/lib/ui/useMoreRight'
import { cn } from '@/lib/utils'

import { plyLabel } from '../line'
import { sharePercent } from '../reference'
import { dropTone, formatAvgDrop, scorePercent, scoreTone, splitOf } from '../stats'
import { SPLIT_WIDTH, ScoreBar } from './ScoreBar'

const COLUMNS: {
  id: string
  label: MessageDescriptor
  width: number | 'flex'
  align?: 'right'
  optional?: boolean
}[] = [
  { id: 'move', label: msg`Move`, width: 64 },
  { id: 'games', label: msg`Games`, width: 46, align: 'right' },
  { id: 'share', label: msg`Share`, width: 40, align: 'right' },
  { id: 'split', label: msg`Score`, width: SPLIT_WIDTH },
  { id: 'score', label: msg`Score%`, width: 50, align: 'right' },
  { id: 'drop', label: msg`Avg drop`, width: 62, align: 'right' },
  {
    id: 'blunders',
    label: msg({ message: 'Blund', comment: 'Column heading, short for “blunders”.' }),
    width: 40,
    align: 'right',
  },
  { id: 'opening', label: msg`Opening`, width: 'flex', optional: true },
  { id: 'note', label: msg`Note`, width: 'flex', optional: true },
]

function style(width: number | 'flex') {
  return width === 'flex' ? { flex: 1, minWidth: 0 } : { width, flex: 'none' as const }
}

/**
 * The two text columns appear once the table is wide enough to give each a readable share:
 * the fixed columns' 27.5rem (442px of columns, six `gap-2`s and the `px-3` padding, at the
 * app's 120% root size) plus two more gaps and 8rem apiece ≈ 44.5rem. Measured on the
 * table (`@container` on its root), not on the window, because the pane's width depends on
 * the rail and the board as well.
 */
const OPTIONAL = 'hidden @min-[44.5rem]:block'

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
 * Seven of the nine columns are fixed widths — 27.5rem with their gaps and padding, which
 * the 530px pane of a 1440 screen just holds — and the numbers are what the screen exists
 * to compare, so a table narrower than that (a phone, the 370px pane of a 1280 screen)
 * scrolls sideways inside itself rather than dropping one. The minimum is on the header
 * and on the rows so the two stay in step, and the horizontal scroll is on the element
 * wrapping both, so the header travels with the rows.
 */
const MIN_TABLE = 'min-w-[27.5rem]'

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
  const notate = useNotation()
  // At 1280 the pane is narrower than the table: the Games table's fade says there is more.
  const { ref: frame, onScroll, moreRight } = useMoreRight<HTMLDivElement>(moves.length)

  return (
    <div
      ref={frame}
      onScroll={onScroll}
      className={cn('@container flex flex-col gap-1 overflow-x-auto', moreRight && FADE_RIGHT)}
      role="table"
      aria-label={t`Continuations`}
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
          data-testid="tree-loading"
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
            'flex flex-col gap-0.5 overflow-y-auto font-mono text-data tabular',
            MIN_TABLE,
          )}
        >
          {moves.map((move) => {
            const split = splitOf(move)
            const share = sharePercent(move.games, total)
            const percent = scorePercent(move.score)
            const main = move.uci === mainLine
            const note = move.note?.text ?? null
            // What the two optional columns say, for when the table is too narrow to show them.
            const words = [move.name, note].filter(Boolean).join(' — ')
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
                title={words || undefined}
                data-main={main ? '' : undefined}
                className={cn(
                  ROW,
                  'flex h-[1.5rem] flex-none items-center gap-2 rounded-sm px-3 text-left',
                )}
              >
                <span
                  style={style(64)}
                  className={cn(
                    'truncate text-lead',
                    main ? 'font-semibold text-bright' : 'text-body',
                  )}
                >
                  {plyLabel(ply)}
                  {notate(move.san)}
                </span>
                <span style={style(46)} className="text-right text-body">
                  {move.games}
                </span>
                <span style={style(40)} className="text-right text-dim">
                  {share === null ? '—' : `${share}%`}
                </span>
                <span style={style(SPLIT_WIDTH)}>
                  <ScoreBar split={split} className="w-full" />
                </span>
                <span style={style(50)} className={cn('text-right', scoreTone(move.score))}>
                  {percent === null ? '—' : percent.toFixed(1)}
                </span>
                <span
                  style={style(62)}
                  className={cn('text-right', dropTone(move.avg_win_loss))}
                >
                  {formatAvgDrop(move.avg_win_loss)}
                </span>
                <span
                  style={style(40)}
                  className={cn(
                    'text-right',
                    (move.blunders ?? 0) > 0 ? 'text-blunder' : 'text-dim-2',
                  )}
                >
                  {(move.owner_moves ?? 0) === 0 ? '—' : (move.blunders ?? 0)}
                </span>
                <span
                  style={style('flex')}
                  className={cn('truncate font-sans text-data text-soft-2', OPTIONAL)}
                  title={move.name ?? undefined}
                >
                  {move.name}
                </span>
                <span
                  style={style('flex')}
                  className={cn('truncate font-sans text-data text-dim-2', OPTIONAL)}
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
