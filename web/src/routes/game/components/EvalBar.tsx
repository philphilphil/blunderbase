import { formatScore, type Score } from '@/lib/chess/evaluation'
import { cn } from '@/lib/utils'

/**
 * The 14px column beside the board: White fills from the bottom, the teal hairline marks
 * where the balance sits. `win` is White's win percentage, 0..100.
 */
export function EvalBar({
  win,
  score,
  className,
}: {
  win: number | null
  score: Score | null
  className?: string
}) {
  const known = win !== null && Number.isFinite(win)
  const white = known ? Math.min(100, Math.max(0, win)) : 50
  const label = known ? `${formatScore(score)} · White ${white.toFixed(0)}%` : 'not analysed'

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
        className="absolute inset-x-0 top-0 bg-eval-black transition-[height] duration-200"
        style={{ height: `${100 - white}%` }}
      />
      <div
        className="absolute inset-x-0 bottom-0 bg-eval-white transition-[height] duration-200"
        style={{ height: `${white}%`, opacity: known ? 1 : 0.25 }}
      />
      {known ? (
        <div
          className="absolute inset-x-0 h-px bg-accent-teal/80 transition-[top] duration-200"
          style={{ top: `${100 - white}%` }}
        />
      ) : null}
    </div>
  )
}
