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
 * The same idea for a position in one of the reference books, drawn in the two sides'
 * colours rather than in green and red — and labelled, because the colours alone were
 * not readable.
 *
 * `ScoreBar`'s green-draw-red is the *owner's* result, and it means "this went well for
 * you". A masters or lichess position has no owner in it: the split is White's score
 * against Black's, and painting White's half green would tell the reader that half the
 * games in the database went well for them. So the reference table gets its own bar in
 * `side-white` / `faint` / `side-black` — the colours the eval bar and the side dots
 * already use for "White" and "Black".
 *
 * The percentages are printed inside their own segments, the way Lichess draws this bar.
 * A thin unlabelled strip failed in both themes: one of the two side colours always sits
 * near the panel it is drawn on (white-on-light, black-on-dark), so one half of every bar
 * dissolved. The text fixes that without a legend, and each number wears the *opposite*
 * side's colour — those two tokens keep their luminance across themes, so the contrast is
 * theme-proof by construction. A segment too narrow to hold its number (under ~12%) stays
 * a silent sliver rather than clipping digits; the title still carries all three counts.
 *
 * Counts rather than percentages in the props, because that is what the endpoint sends;
 * the shares are worked out here so no caller has to.
 */
export function SidesBar({
  white,
  draws,
  black,
  className,
  height = '1.0625rem',
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
  const segments = [
    { share: share(white), className: 'bg-side-white text-side-black' },
    { share: share(draws), className: 'bg-faint text-side-black' },
    { share: share(black), className: 'bg-side-black text-side-white' },
  ]
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={{ height }}
      className={cn(
        // The border and the dividers are what keep the bar legible on every panel: the
        // black half otherwise dissolves into a dark theme and the white half into a
        // light one the moment it touches the edge of its row.
        'flex overflow-hidden rounded-[0.25rem] border border-edge-strong bg-raised font-mono text-[0.625rem] tabular divide-x divide-edge-strong',
        className,
      )}
    >
      {segments.map((segment, index) => (
        <span
          key={index}
          style={{ width: `${segment.share}%` }}
          className={cn(
            'flex items-center justify-center overflow-hidden',
            segment.className,
          )}
        >
          {segment.share >= 12 ? `${Math.round(segment.share)}%` : null}
        </span>
      ))}
    </span>
  )
}
