/**
 * Which lichess games count — the two questions the rated database cannot be asked
 * without: at what speed, and at what strength.
 *
 * They are chips rather than two `select`s because both are sets: "blitz and rapid" and
 * "1600 through 2000" are the ordinary answers, and a dropdown per value would make the
 * common case three interactions. Both live in the URL, so a filtered position is a link
 * (`../reference.ts` parses them), and neither can be emptied — `toggleFilter` refuses the
 * last chip, since a request with no speeds counts no games and would read as an empty
 * position rather than as an empty filter. The chips themselves are `@/components/ui/chip`,
 * shared with the Stats page's time controls.
 *
 * Masters never sees this: that database is one book with no time control and no rating
 * band to choose, and a pair of controls that do nothing is worse than no controls.
 */
import { ChipRow, FilterChip } from '@/components/ui/chip'
import { toggleFilter } from '@/lib/filters'

import { RATINGS, SPEEDS, type Speed } from '../reference'

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
          <FilterChip
            key={speed}
            label={speed}
            on={speeds.includes(speed)}
            onClick={() => onSpeeds(toggleFilter(speeds, speed, SPEEDS))}
          />
        ))}
      </ChipRow>
      <ChipRow label="rating">
        {RATINGS.map((rating) => (
          <FilterChip
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
