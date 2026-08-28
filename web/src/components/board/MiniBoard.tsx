/**
 * A board at thumbnail size: no coordinates, no animation, nothing to click.
 *
 * The notes screen prints one of these per note so a note about a position reads as a
 * position rather than as a FEN, and a dozen of them share a row. It is deliberately the
 * same chessground as the big board (`./Board`) rather than a second renderer — the pieces,
 * the theme and the last-move highlight then cannot drift apart — with only the chrome the
 * full-size board carries taken off.
 */
import { cn } from '@/lib/utils'

import { Board, type BoardOrientation } from './Board'

export interface MiniBoardProps {
  fen: string
  orientation?: BoardOrientation
  /** `"e2e4"` or `["e2", "e4"]` — highlighted the way the big board highlights it. */
  lastMove?: string | [string, string] | null
  /** Any CSS width. The board is square, so this is its size. */
  size?: string
  /** Read out to a screen reader, which cannot see a board at all. */
  label?: string
  className?: string
}

export function MiniBoard({
  fen,
  orientation = 'white',
  lastMove = null,
  size = '6.75rem',
  label,
  className,
}: MiniBoardProps) {
  return (
    <div
      style={{ width: size }}
      role="img"
      aria-label={label ?? 'Chess position'}
      className={cn('flex-none overflow-hidden rounded-md border border-line', className)}
    >
      <Board
        fen={fen}
        orientation={orientation}
        lastMove={lastMove}
        viewOnly
        coordinates={false}
        animation={false}
      />
    </div>
  )
}
