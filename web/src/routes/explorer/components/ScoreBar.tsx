/** The win / draw / loss bar and its reference twin, one skeleton at one size.
 *  Heights are `rem` so the bars grow with the app's scale. */
import { useLingui } from '@lingui/react/macro'

import { cn } from '@/lib/utils'

import type { Split } from '../stats'

/**
 * The split column's width in both explorer tables, owned by the bar the column exists
 * for. One number rather than one per table because the two tables sit in the same spot
 * on the same page, and bars of two widths would make the same 60% read as two amounts.
 */
export const SPLIT_WIDTH = 170

/**
 * The skeleton both bars share: bordered, divided, and labelled inside its own segments.
 *
 * The border and the dividers are what keep a bar legible on every panel — a fill near
 * the panel's own luminance (white or good on light, black or blunder's ink on dark)
 * otherwise dissolves into the row it sits in. The percentages are printed inside their
 * segments, the way Lichess draws this bar, so the split can be *read* and not only
 * compared; a segment too narrow to hold its number (under ~12%) stays a silent sliver
 * rather than clipping digits, and the title still carries the exact counts.
 */
function LabeledBar({
  label,
  segments,
  className,
  height,
}: {
  label: string
  segments: { share: number; className: string }[]
  className?: string
  height: string
}) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={{ height }}
      className={cn(
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

/**
 * The owner's own results: green is "went well for you", red is "did not", exactly the
 * judgment the reference bar below must never make. Same skeleton, so the two tables on
 * the explorer page read as one instrument.
 */
export function ScoreBar({
  split,
  className,
  height = '1.0625rem',
}: {
  split: Split
  className?: string
  height?: string
}) {
  const { t } = useLingui()
  const { wins, draws, losses } = split
  return (
    <LabeledBar
      label={t`${wins} wins, ${draws} draws, ${losses} losses`}
      segments={[
        { share: split.winPercent, className: 'bg-good text-good-ink' },
        { share: split.drawPercent, className: 'bg-faint text-side-black' },
        { share: split.lossPercent, className: 'bg-blunder text-blunder-ink' },
      ]}
      className={className}
      height={height}
    />
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
 * Each number wears the *opposite* side's colour — those two tokens keep their luminance
 * across themes, so the contrast is theme-proof by construction.
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
  const { t } = useLingui()
  const total = white + draws + black
  const share = (value: number) => (total > 0 ? (value / total) * 100 : 0)
  return (
    <LabeledBar
      label={t`${white} white wins, ${draws} draws, ${black} black wins`}
      segments={[
        { share: share(white), className: 'bg-side-white text-side-black' },
        { share: share(draws), className: 'bg-faint text-side-black' },
        { share: share(black), className: 'bg-side-black text-side-white' },
      ]}
      className={className}
      height={height}
    />
  )
}
