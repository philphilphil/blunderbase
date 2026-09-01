/** The win / draw / loss bar design 2c uses at two sizes: 8px in the summary, 7px in a row.
 *  Heights are `rem` so the bar grows with the app's scale. */
import { cn } from '@/lib/utils'

import type { Split } from '../stats'

export function ScoreBar({
  split,
  className,
  height = '0.4375rem',
}: {
  split: Split
  className?: string
  height?: string
}) {
  const label = `${split.wins} wins, ${split.draws} draws, ${split.losses} losses`
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={{ height }}
      className={cn('flex overflow-hidden rounded-[0.25rem] bg-raised', className)}
    >
      <span style={{ width: `${split.winPercent}%` }} className="bg-good" />
      <span style={{ width: `${split.drawPercent}%` }} className="bg-faint" />
      <span style={{ width: `${split.lossPercent}%` }} className="bg-blunder" />
    </span>
  )
}

/**
 * The same bar for a position in one of the reference books, drawn in the two sides'
 * colours rather than in green and red.
 *
 * `ScoreBar`'s green-draw-red is the *owner's* result, and it means "this went well for
 * you". A masters or lichess position has no owner in it: the split is White's score
 * against Black's, and painting White's half green would tell the reader that half the
 * games in the database went well for them. So the reference table gets its own bar, in
 * `side-white` / `faint` / `side-black` — the colours the eval bar and the side dots
 * already use for "White" and "Black" — and says so in its label.
 *
 * Counts rather than percentages, because that is what the endpoint sends; the shares are
 * worked out here so no caller has to.
 */
export function SidesBar({
  white,
  draws,
  black,
  className,
  height = '0.4375rem',
}: {
  white: number
  draws: number
  black: number
  className?: string
  height?: string
}) {
  const total = white + draws + black
  const share = (value: number) => (total > 0 ? (value / total) * 100 : 0)
  const label = `${white} white wins, ${draws} draws, ${black} black wins`
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={{ height }}
      className={cn('flex overflow-hidden rounded-[0.25rem] bg-raised', className)}
    >
      <span style={{ width: `${share(white)}%` }} className="bg-side-white" />
      <span style={{ width: `${share(draws)}%` }} className="bg-faint" />
      <span style={{ width: `${share(black)}%` }} className="bg-side-black" />
    </span>
  )
}
