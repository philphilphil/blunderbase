/**
 * Design 2c's "your move tree from here": one row per continuation, with the frequency, the
 * win/draw/loss split, the score and the average win percentage the mover gave away.
 *
 * The design's `Acc` column is per-move accuracy, which no endpoint computes; it is replaced
 * by `Blunders` — how many of the games through this move had the move classified as one,
 * which `/explorer` does report. `Avg drop` keeps the design's column but not its unit: the
 * mock's `−0.19` is pawns, and the only per-move loss the backend stores is win percentage
 * (`avg_win_loss`), so the column reads `−4.2%` (see `formatAvgDrop` in `../stats`).
 * The `Note` column is the design's, filled from what is actually true about the
 * continuation rather than from prose nobody wrote (`moveNote`).
 */
import { Skeleton } from '@/components/ui/skeleton'
import type { ExplorerMove, ExplorerResponse } from '@/lib/api/types'
import { cn } from '@/lib/utils'

import { plyLabel } from '../line'
import {
  dropTone,
  formatAvgDrop,
  moveNote,
  scorePercent,
  scoreTone,
  splitOf,
} from '../stats'
import { ScoreBar } from './ScoreBar'

const COLUMNS = [
  { id: 'move', label: 'Move', width: 78 },
  { id: 'games', label: 'Games', width: 46, align: 'right' as const },
  { id: 'split', label: 'Score', width: 150 },
  { id: 'score', label: 'Score%', width: 52, align: 'right' as const },
  { id: 'drop', label: 'Avg drop', width: 66, align: 'right' as const },
  { id: 'blunders', label: 'Blund', width: 44, align: 'right' as const },
  { id: 'note', label: 'Note', width: 'flex' as const },
]

function style(width: number | 'flex') {
  return width === 'flex' ? { flex: 1, minWidth: 0 } : { width, flex: 'none' as const }
}

export function MoveTreeTable({
  tree,
  ply,
  loading,
  onPlay,
}: {
  tree: ExplorerResponse | undefined
  /** The ply the continuations occupy, for the `5…Nb6` labels. */
  ply: number
  loading: boolean
  onPlay: (move: ExplorerMove) => void
}) {
  const moves = tree?.moves ?? []
  const mainLine = tree?.main_line?.[0]?.uci

  return (
    <div className="flex flex-col gap-3.5" role="table" aria-label="Continuations">
      <div
        role="row"
        className="flex h-[1.875rem] flex-none items-center gap-3 rounded-[0.4375rem] border border-line bg-panel px-3 text-[0.65625rem] tracking-[.06em] text-dim-2 uppercase"
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
        <div className="flex flex-col gap-0.5" data-testid="tree-loading">
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
            No game of yours goes any further than this position.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-0.5 font-mono text-[0.78125rem] tabular">
          {moves.map((move) => {
            const split = splitOf(move)
            const percent = scorePercent(move.score)
            const main = move.uci === mainLine
            const note = tree ? moveNote(move, tree) : null
            return (
              <button
                key={move.uci}
                type="button"
                onClick={() => onPlay(move)}
                role="row"
                className={cn(
                  'flex h-[2.375rem] items-center gap-3 rounded-[0.4375rem] px-3 text-left transition-colors',
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
                <span style={style(150)}>
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
                  {move.blunders ?? 0}
                </span>
                <span
                  style={style('flex')}
                  className="truncate font-sans text-[0.71875rem] text-soft-2"
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
