/**
 * Which of the owner's own games the tree counts — at what speed, and how recently.
 *
 * The owner's half of what `ReferenceFilters` is for lichess, shaped by the questions a
 * personal tree is asked: "what do I play in blitz" and "what have I been playing lately".
 * A rating band has no place here — every game is the owner's, at the owner's rating — and
 * the speeds include correspondence, which the lichess database does not have.
 *
 * All three are pickers that name themselves ("Speed: All", "Date: All games",
 * "Collection: League"), because they sit in the explorer's filter form beside two labelled
 * segments and a picker is the one control that carries its own label. Speed is the app's
 * one `SpeedPicker`, the same on Stats and the Dashboard. When the games were played is the
 * library's own date picker — the same popover, the same fields, the same quick picks
 * (`DateRangePanel`) — because "which days" is one question wherever it is asked, and a
 * screen that asked it differently was the one people tripped over. Today is among the
 * picks for "what did I face today, and where did I go wrong in the opening", which no
 * rolling window answers. A pick is kept in the URL as the pick, so a link to "the last 30
 * days" still means that next month; typed dates are kept as dates. Every pick runs to now.
 *
 * The third lens is a collection — "what do I play in the league" — and it is a native
 * select under the picker's face (`PickerSelect`) because the list is the owner's own, of
 * any length and any names. It is only drawn once there is a collection to pick, and it
 * lives in the URL too.
 *
 * The pickers stand side by side and wrap; once the filter form's container is wide
 * enough for two columns (`ExplorerPage`, `@min-[25.5rem]`) they stack into the second
 * column, one beside each labelled segment.
 */
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react/macro'

import { CollectionSwatch } from '@/components/collections/CollectionChip'
import { SpeedPicker } from '@/components/filters/SpeedPicker'
import { PickerSelect } from '@/components/ui/native-select'
import { SPEEDS } from '@/lib/api/types'
import type { Collection, Speed } from '@/lib/api/types'
import type { DayPreset } from '@/lib/days'
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
    // On a phone the popovers anchor to the whole filter form (`max-md:relative` there),
    // as the library's filter bar does for its pickers (`FilterPopover`). From `md` up the
    // tree pane is the window's right-hand column, so the panels hang from the picker's
    // right edge (`align="end"`): opened rightwards, they ran off the pane and the window.
    <div className="flex min-w-0 flex-wrap items-start gap-1.5 @min-[25.5rem]:flex-col">
      <SpeedPicker speeds={SPEEDS} value={speeds} onChange={onSpeeds} align="end" />
      {/* "Date" is the library's own name for the same picker. */}
      <FilterPopover
        label={t`Date`}
        placeholder={t`All games`}
        value={summary}
        onClear={() => onPeriod(null)}
        width={DATE_PANEL_WIDTH}
        align="end"
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
      {collections.length > 0 && onCollection ? (
        <PickerSelect
          label={t`Collection`}
          value={chosen ? String(chosen.id) : ''}
          set={chosen !== null}
          leading={chosen ? <CollectionSwatch color={chosen.color} /> : undefined}
          onChange={(next) => onCollection(next === '' ? null : Number(next))}
          options={[
            { value: '', label: t`All games` },
            ...collections.map((entry) => ({ value: String(entry.id), label: entry.name })),
          ]}
          // A long collection name is cut at the pane's edge rather than widening the form.
          className="max-w-full overflow-hidden"
        />
      ) : null}
    </div>
  )
}
