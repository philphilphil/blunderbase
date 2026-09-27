/**
 * Which of the owner's own games the tree counts — at what speed, and how recently.
 *
 * The owner's half of what `ReferenceFilters` is for lichess, shaped by the questions a
 * personal tree is asked: "what do I play in blitz" and "what have I been playing lately".
 * A rating band has no place here — every game is the owner's, at the owner's rating — and
 * the speeds include correspondence, which the lichess database does not have.
 *
 * Speeds are chips because they are a set (`@/components/ui/chip`). When the games were
 * played is the library's own date chip — the same popover, the same fields, the same quick
 * picks (`DateRangePanel`) — because "which days" is one question wherever it is asked, and
 * a screen that asked it differently was the one people tripped over. Today is among the
 * picks for "what did I face today, and where did I go wrong in the opening", which no
 * rolling window answers. A pick is kept in the URL as the pick, so a link to "the last 30
 * days" still means that next month; typed dates are kept as dates. Every pick runs to now.
 *
 * The third lens is a collection — "what do I play in the league" — and it is a native
 * select rather than chips because the list is the owner's own, of any length and any
 * names. It is only drawn once there is a collection to pick, and it lives in the URL too.
 */
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react/macro'

import { CollectionSwatch } from '@/components/collections/CollectionChip'
import { ChipRow, FilterChip } from '@/components/ui/chip'
import { SPEEDS } from '@/lib/api/types'
import type { Collection, Speed } from '@/lib/api/types'
import type { DayPreset } from '@/lib/days'
import { toggleFilter } from '@/lib/filters'
import { cn } from '@/lib/utils'
import { DATE_PANEL_WIDTH, DateRangePanel } from '@/routes/games/components/DateRangePanel'
import { FilterPopover } from '@/routes/games/components/FilterPopover'

import { playedDays, type DayRange } from '../reference'

/** How the chip names a pick — in words, since it stands alone with no fields beside it. */
const PERIOD_SUMMARY: Record<DayPreset, MessageDescriptor> = {
  today: msg`Today`,
  '7d': msg`Last 7 days`,
  '30d': msg`Last 30 days`,
  '90d': msg`Last 90 days`,
  '1y': msg`Last year`,
}

const SPEED_LABELS: Record<Speed, MessageDescriptor> = {
  bullet: msg`bullet`,
  blitz: msg`blitz`,
  rapid: msg`rapid`,
  classical: msg`classical`,
  correspondence: msg({
    message: 'corr.',
    comment: 'Short for "correspondence", the speed of a game played over days',
  }),
}

export function OwnFilters({
  speeds,
  period,
  onSpeeds,
  onPeriod,
  range = null,
  onRange,
  collections = [],
  collection = null,
  onCollection,
}: {
  speeds: readonly Speed[]
  /** The quick pick in force, or null for none. */
  period: DayPreset | null
  onSpeeds: (next: Speed[]) => void
  /** A pick, or null for every game; either way it replaces a typed range. */
  onPeriod: (next: DayPreset | null) => void
  /** Days typed into the fields, which win over `period`; null for none. */
  range?: DayRange | null
  /** A typed range; it replaces the pick. */
  onRange: (next: DayRange | null) => void
  /** The owner's collections; none draws no collection row. */
  collections?: readonly Collection[]
  /** The collection the tree is scoped to, or null for every game. */
  collection?: number | null
  onCollection?: (next: number | null) => void
}) {
  const { i18n, t } = useLingui()
  const chosen = collections.find((entry) => entry.id === collection) ?? null
  const shown = playedDays(period, range)
  // Worded as the library's date chip words it, so the two read the same.
  const since = range?.from
  const until = range?.to
  const summary = range
    ? since && until
      ? `${since} → ${until}`
      : since
        ? t`from ${since}`
        : t`until ${until}`
    : period
      ? i18n._(PERIOD_SUMMARY[period])
      : null
  return (
    // `max-md:relative` anchors the date popover to these rows on a phone, as the library's
    // filter bar does for its chips (`FilterPopover`).
    <div className="flex flex-col gap-1.5 max-md:relative">
      <ChipRow label={t`speed`}>
        {SPEEDS.map((speed) => (
          <FilterChip
            key={speed}
            label={i18n._(SPEED_LABELS[speed])}
            name={speed === 'correspondence' ? t`correspondence` : undefined}
            on={speeds.includes(speed)}
            onClick={() => onSpeeds(toggleFilter(speeds, speed, SPEEDS))}
          />
        ))}
      </ChipRow>
      {/* Date and collection share a line: each is one control, and two short rows of one
          control apiece read as more filtering than there is. "Date" and "Collection" are
          the library's own names for the same two chips. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <ChipRow label={t`Date`}>
          <FilterPopover
            label={t`Date`}
            placeholder={t`All games`}
            value={summary}
            onClear={() => onPeriod(null)}
            width={DATE_PANEL_WIDTH}
          >
            {(close) => (
              <DateRangePanel
                close={close}
                onClear={() => onPeriod(null)}
                heading={t`Played between`}
                from={shown?.from}
                to={shown?.to}
                preset={range ? null : period}
                // Editing a field starts from what it showed, so nudging a pick's first day
                // keeps the rest of it; both emptied is no range, which is every game again.
                onRange={(from, to) => onRange(from || to ? { from, to } : null)}
                onPreset={onPeriod}
                fromLabel={t`Played from`}
                toLabel={t`Played until`}
              />
            )}
          </FilterPopover>
        </ChipRow>
        {collections.length > 0 && onCollection ? (
          <ChipRow label={t`Collection`} trailing>
            {chosen ? <CollectionSwatch color={chosen.color} /> : null}
            <select
              aria-label={t`Collection`}
              value={chosen ? String(chosen.id) : ''}
              onChange={(event) =>
                onCollection(event.target.value === '' ? null : Number(event.target.value))
              }
              className={cn(
                'h-[1.625rem] max-w-[14rem] rounded-md border bg-elevated px-1.5 text-label outline-none transition-colors focus-visible:border-accent-teal/50',
                chosen ? 'border-accent-teal/30 text-ink' : 'border-edge text-soft hover:text-ink',
              )}
            >
              <option value="">{t`All games`}</option>
              {collections.map((entry) => (
                <option key={entry.id} value={String(entry.id)}>
                  {entry.name}
                </option>
              ))}
            </select>
          </ChipRow>
        ) : null}
      </div>
    </div>
  )
}
