/**
 * Which lichess games count — the two questions the rated database cannot be asked
 * without: at what speed, and at what strength.
 *
 * Speed is the app's one `SpeedPicker` ("Speed: Blitz, Rapid, Classical"), the same
 * control as the owner's own filters beside it and as Stats. The rating bands stay chips:
 * "1600 through 2000" is a set whose members are few and short enough to all be on
 * screen, and a menu would hide the answer. Both live in the URL, so a filtered position
 * is a link (`../reference.ts` parses them), and neither can be emptied — `toggleFilter`
 * refuses the last one, since a request with no speeds counts no games and would read as
 * an empty position rather than as an empty filter.
 *
 * Two grid items rather than one box, so they land in the explorer's filter form: each a
 * row under both of its columns, the picker first and then the bands on a labelled row,
 * where eight chips have the room. Both start at the x the segments above them start at.
 *
 * Masters never sees this: that database is one book with no time control and no rating
 * band to choose, and a pair of controls that do nothing is worse than no controls.
 */
import { useLingui } from '@lingui/react/macro'

import { SpeedPicker } from '@/components/filters/SpeedPicker'
import { FilterChip } from '@/components/ui/chip'
import { toggleFilter } from '@/lib/filters'

import { RATINGS, SPEEDS, type Speed } from '../reference'
import { FilterField } from './FilterField'

/** A row of the filter form that runs under both of its columns (see the JSX). */
const SPAN_ROW = '@min-[25.5rem]:col-span-2 @min-[25.5rem]:[contain:inline-size]'

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
  const { t } = useLingui()
  // Every band on narrows nothing, so the chips stay neutral until one is off.
  const narrowed = RATINGS.some((rating) => !ratings.includes(rating))
  return (
    <>
      {/* Under the segments rather than beside them: lichess's default is three speeds
          of four, and "Speed: Blitz, Rapid, Classical" does not fit the second column.
          An empty label so it starts where the segments and the chips do.
          `contain: inline-size` keeps these rows' unwrapped width out of the grid's column
          sizing, so they wrap under both columns instead of pushing them apart. */}
      <div className={SPAN_ROW}>
        <FilterField label="">
          <SpeedPicker speeds={SPEEDS} value={speeds} onChange={onSpeeds} />
        </FilterField>
      </div>
      <div className={SPAN_ROW}>
        <FilterField label={t`Rating`}>
          <div
            role="group"
            aria-label={t`Rating`}
            className="flex flex-wrap items-center gap-1.5 py-0.5"
          >
            {RATINGS.map((rating) => (
              <FilterChip
                key={rating}
                label={rating === 2500 ? '2500+' : String(rating)}
                on={ratings.includes(rating)}
                narrowed={narrowed}
                onClick={() => onRatings(toggleFilter(ratings, rating, RATINGS))}
              />
            ))}
          </div>
        </FilterField>
      </div>
    </>
  )
}
