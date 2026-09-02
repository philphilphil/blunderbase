/**
 * Which lichess games count — the two questions the rated database cannot be asked
 * without: at what speed, and at what strength.
 *
 * They are chips rather than two `select`s because both are sets: "blitz and rapid" and
 * "1600 through 2000" are the ordinary answers, and a dropdown per value would make the
 * common case three interactions. Both live in the URL, so a filtered position is a link
 * (`../reference.ts` parses them), and neither can be emptied — `toggleFilter` refuses the
 * last chip, since a request with no speeds counts no games and would read as an empty
 * position rather than as an empty filter.
 *
 * Masters never sees this: that database is one book with no time control and no rating
 * band to choose, and a pair of controls that do nothing is worse than no controls.
 */
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

import { RATINGS, SPEEDS, toggleFilter, type Speed } from '../reference'

export function ReferenceFilters({
  speeds,
  ratings,
  onSpeeds,
  onRatings,
}: {
  speeds: readonly Speed[]
  ratings: readonly number[]
  onSpeeds: (next: Speed[]) => void
  onRatings: (next: number[]) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <ChipRow label="speed">
        {SPEEDS.map((speed) => (
          <Chip
            key={speed}
            label={speed}
            on={speeds.includes(speed)}
            onClick={() => onSpeeds(toggleFilter(speeds, speed, SPEEDS))}
          />
        ))}
      </ChipRow>
      <ChipRow label="rating">
        {RATINGS.map((rating) => (
          <Chip
            key={rating}
            label={rating === 2500 ? '2500+' : String(rating)}
            on={ratings.includes(rating)}
            onClick={() => onRatings(toggleFilter(ratings, rating, RATINGS))}
          />
        ))}
      </ChipRow>
    </div>
  )
}

function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-11 flex-none text-[0.65625rem] tracking-[.06em] text-dim-2 uppercase">
        {label}
      </span>
      {children}
    </div>
  )
}

function Chip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'rounded-md border px-[0.4375rem] py-[0.0625rem] font-mono text-[0.6875rem] tabular transition-colors',
        on
          ? 'border-accent-teal/35 bg-accent-teal/10 text-accent-teal'
          : 'border-edge text-dim hover:text-ink',
      )}
    >
      {label}
    </button>
  )
}
