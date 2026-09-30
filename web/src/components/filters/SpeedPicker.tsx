/**
 * The one Speed control, for the Dashboard, Stats and the Explorer alike: a picker that
 * reads "Speed: All" or "Speed: Blitz, Rapid" and opens a checklist.
 *
 * Speed had been a row of chips on two pages and a picker on a third, so one concept was
 * drawn two ways (the clarity pass). A picker, as Time control already is on Games, because
 * a bar of filters reads as sentences that way, and the checklist says plainly that
 * several can be on. It is lit (set) only while it narrows: every speed on is the default
 * and narrows nothing. The set is never emptied (`toggleFilter`): unticking the last speed
 * leaves it on, since a filter with nothing in it would show nothing at all. The `×` puts
 * every speed back.
 */
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react/macro'

import { Checkbox } from '@/components/ui/checkbox'
import { toggleFilter } from '@/lib/filters'
import { FilterPopover } from '@/routes/games/components/FilterPopover'

const DEFAULT_LABELS: Record<string, MessageDescriptor> = {
  bullet: msg`Bullet`,
  blitz: msg`Blitz`,
  rapid: msg`Rapid`,
  classical: msg`Classical`,
  correspondence: msg`Correspondence`,
}

export function SpeedPicker<S extends string>({
  speeds,
  value,
  onChange,
  labels,
  counts,
  align,
}: {
  /** Every speed, in the order to list them. */
  speeds: readonly S[]
  /** The speeds that are on. */
  value: readonly S[]
  onChange: (next: S[]) => void
  /** Names for speeds the defaults do not cover, or other words for those they do. */
  labels?: Partial<Record<S, MessageDescriptor | string>>
  /** A figure per speed (the Dashboard's game counts), drawn at the right of its row. */
  counts?: Partial<Record<S, number>>
  /** Which edge the panel hangs from (`FilterPopover`). */
  align?: 'start' | 'end'
}) {
  const { t, i18n } = useLingui()
  const name = (speed: S): string => {
    const given = labels?.[speed]
    if (typeof given === 'string') return given
    if (given) return i18n._(given)
    const fallback = DEFAULT_LABELS[speed]
    return fallback ? i18n._(fallback) : speed
  }
  const narrowed = speeds.some((speed) => !value.includes(speed))
  const summary = narrowed
    ? speeds
        .filter((speed) => value.includes(speed))
        .map(name)
        .join(', ')
    : null

  return (
    <FilterPopover
      label={t`Speed`}
      value={summary}
      placeholder={t`All`}
      onClear={() => onChange([...speeds])}
      width="12rem"
      align={align}
    >
      {() => (
        <div className="flex flex-col gap-1.5">
          {speeds.map((speed) => {
            const count = counts?.[speed]
            return (
              <div key={speed} className="flex items-center gap-2">
                <Checkbox
                  checked={value.includes(speed)}
                  label={name(speed)}
                  onCheckedChange={() => onChange(toggleFilter(value, speed, speeds))}
                />
                {count !== undefined ? (
                  <span className="ml-auto font-mono text-label text-dim tabular">
                    {count.toLocaleString()}
                  </span>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </FilterPopover>
  )
}
