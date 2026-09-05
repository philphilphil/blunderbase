import { Trans } from '@lingui/react/macro'

import { ClassificationBadge } from '@/components/badges/ClassificationBadge'
import type { MoveRow } from '@/lib/api/types'
import { isFlagged } from '@/lib/chess/classification'
import { formatWinLoss } from '@/lib/chess/evaluation'
import { cn } from '@/lib/utils'

import { plyLabel } from '../gameModel'

/**
 * Every move the engine flagged, as a list: what it was, what it cost, and a tap to stand
 * in front of it.
 *
 * This is the eval curve's own marks written out. The curve above it says *that* the game
 * turned and roughly where; the list says which move it was and how much it gave away, and
 * a phone can hit a row where it cannot hit a 3-pixel dot on a plot. The two are one panel
 * — the curve is the shape of the game, this is its index.
 *
 * Not the same thing as the move table's Flagged tab, which is that same table with the
 * quiet pairs filtered out: this is one row per mistake rather than per move pair, with the
 * cost on it, and it does not carry variations or notes. The table is for reading the game;
 * this is for choosing which mistake to look at next.
 */
export function FlaggedMoments({
  moves,
  cursor,
  onSelect,
  className,
}: {
  moves: readonly MoveRow[]
  /** The ply last played; `-1` for the starting position. Lights the row standing at it. */
  cursor: number
  /**
   * Where a row wants the board. This is the cursor to seek, already the ply *before* the
   * flagged move — see the note on the rows themselves.
   */
  onSelect: (cursor: number) => void
  className?: string
}) {
  const flagged = moves.filter((move) => isFlagged(move.classification))

  if (flagged.length === 0) {
    return (
      <div className={cn('flex items-start justify-center px-3 py-6', className)}>
        <p className="text-center text-[0.71875rem] text-dim">
          <Trans>Nothing flagged in this game.</Trans>
        </p>
      </div>
    )
  }

  return (
    <div data-testid="flagged-moments" className={cn('flex flex-col', className)}>
      {flagged.map((move) => {
        // A row hands the board the position the mistake was made *from*, one ply short of
        // the move itself — the same landing as `j` and the flagged-jump buttons, and the
        // only one worth having: there the board marks the blunder's two squares and the
        // engine draws what it would have played instead. Standing *after* it would show
        // the position the mistake already produced, which explains nothing.
        const target = move.ply - 1
        return (
          <button
            key={move.ply}
            type="button"
            onClick={() => onSelect(target)}
            className={cn(
              'flex items-center gap-2 border-b border-hairline px-3 py-2 text-left last:border-b-0',
              cursor === target ? 'bg-selected' : 'hover:bg-raised',
            )}
          >
            <span className="w-9 flex-none font-mono text-[0.6875rem] tabular text-faint">
              {plyLabel(move.ply)}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-[0.78125rem] text-ink">
              {move.san}
            </span>
            {/*
              What it cost, which is the number that orders these by how much they matter.
              The engine's own move is deliberately not here: it is two more columns on a
              375px row, and it is the first thing the board draws once the row is tapped.
            */}
            <span className="flex-none font-mono text-[0.6875rem] tabular text-blunder">
              {formatWinLoss(move.win_loss)}
            </span>
            <ClassificationBadge classification={move.classification} size="sm" />
          </button>
        )
      })}
    </div>
  )
}
