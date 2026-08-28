import { formatScore, type Score } from '@/lib/chess/evaluation'
import { cn } from '@/lib/utils'

export interface EvalBarProps {
  /** White's win percentage, 0..100. Null where nothing has evaluated the position. */
  win: number | null
  score: Score | null
  /** The side at the bottom of the board, exactly as `Board` reads the same prop. */
  orientation?: 'white' | 'black'
  className?: string
}

/**
 * The 14px column beside the board: the side sitting at the bottom of the board fills from
 * the bottom of the bar, and the teal hairline marks where the balance sits.
 *
 * Only the *geometry* follows the orientation, because that is about where the reader is
 * sitting. The number is about the position: `win` stays White's win percentage whichever
 * way up the bar is drawn, and the `title`/`aria-label` name it as White's — which is true
 * either way and is why they are not flipped with the fills.
 */
export function EvalBar({ win, score, orientation = 'white', className }: EvalBarProps) {
  const known = win !== null && Number.isFinite(win)
  const white = known ? Math.min(100, Math.max(0, win)) : 50
  const label = known ? `${formatScore(score)} · White ${white.toFixed(0)}%` : 'not analysed'
  // Playing Black, Black's fill starts at the bottom and White's comes down from the top.
  const flipped = orientation === 'black'

  return (
    <div
      className={cn(
        'relative w-3.5 flex-none overflow-hidden rounded-[0.1875rem] bg-eval-track',
        className,
      )}
      title={label}
      aria-label={`Evaluation: ${label}`}
      role="img"
    >
      <div
        className={cn(
          'absolute inset-x-0 bg-side-black transition-[height] duration-200',
          flipped ? 'bottom-0' : 'top-0',
        )}
        style={{ height: `${100 - white}%` }}
      />
      <div
        className={cn(
          'absolute inset-x-0 bg-side-white transition-[height] duration-200',
          flipped ? 'top-0' : 'bottom-0',
        )}
        style={{ height: `${white}%`, opacity: known ? 1 : 0.25 }}
      />
      {known ? (
        <div
          className="absolute inset-x-0 h-px bg-accent-teal/80 transition-[top] duration-200"
          style={{ top: `${flipped ? white : 100 - white}%` }}
        />
      ) : null}
    </div>
  )
}
