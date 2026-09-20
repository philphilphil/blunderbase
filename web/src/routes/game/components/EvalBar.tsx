import { useRef } from 'react'

import { formatScore, type Score } from '@/lib/chess/evaluation'
import { cn } from '@/lib/utils'

export interface EvalBarProps {
  /** White's win percentage, 0..100. Null where nothing has evaluated the position. */
  win: number | null
  score: Score | null
  /**
   * A live search is opening or running on the position and has not answered yet. The bar
   * then holds the last number it drew instead of falling to the middle — see below.
   */
  pending?: boolean
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
 *
 * **Why it waits.** Stepping onto a position the live search has not reached yet empties
 * `win` for the fraction of a second it takes the search to reopen, and an empty bar is
 * drawn half-and-half: the column swung to dead level and back on every move, which reads
 * as "equal now" — a claim nothing made. So while `pending` is set the bar keeps the last
 * number it was given and dims it, which reads as "not caught up yet". The held number is
 * the previous position's, so it is not spoken: the label says the bar is waiting rather
 * than repeating a score that is no longer about the board. Nothing is held when the
 * search is off — there a null `win` really does mean nobody has looked, and the bar goes
 * level as it always did.
 */
export function EvalBar({
  win,
  score,
  pending = false,
  orientation = 'white',
  className,
}: EvalBarProps) {
  const live = win !== null && Number.isFinite(win)
  // A render cache, not state: it never decides what to draw on its own, it only survives
  // the frames between one answer and the next, and writing it must not schedule a render.
  const held = useRef<number | null>(null)
  if (live) held.current = win
  const waiting = !live && pending && held.current !== null
  const known = live || waiting
  const white = live ? clamp(win) : waiting ? clamp(held.current!) : 50
  const label = live
    ? `${formatScore(score)} · White ${white.toFixed(0)}%`
    : waiting
      ? 'waiting for the engine'
      : 'not analysed'
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
          'absolute inset-x-0 bg-side-black transition-[height,opacity] duration-200',
          flipped ? 'bottom-0' : 'top-0',
        )}
        style={{ height: `${100 - white}%`, opacity: waiting ? 0.6 : 1 }}
      />
      <div
        className={cn(
          'absolute inset-x-0 bg-side-white transition-[height,opacity] duration-200',
          flipped ? 'top-0' : 'bottom-0',
        )}
        style={{ height: `${white}%`, opacity: live ? 1 : waiting ? 0.6 : 0.25 }}
      />
      {known ? (
        <div
          className="absolute inset-x-0 h-px bg-accent-teal/80 transition-[top,opacity] duration-200"
          style={{ top: `${flipped ? white : 100 - white}%`, opacity: waiting ? 0.5 : 1 }}
        />
      ) : null}
    </div>
  )
}

/** Into the 0..100 the fills are drawn in; a win percentage should never leave it anyway. */
function clamp(win: number): number {
  return Math.min(100, Math.max(0, win))
}
