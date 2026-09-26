/**
 * Which of the owner's own games the tree counts — at what speed, and how recently.
 *
 * The owner's half of what `ReferenceFilters` is for lichess, shaped by the questions a
 * personal tree is asked: "what do I play in blitz" and "what have I been playing lately".
 * A rating band has no place here — every game is the owner's, at the owner's rating — and
 * the speeds include correspondence, which the lichess database does not have.
 *
 * Speeds are chips because they are a set; the period is a segmented control because it is
 * one of four, and the two shapes say which is which (`@/components/ui/chip`). The periods
 * are the Stats page's own windows, so "90d" means the same thing on both screens — with one
 * difference worth knowing: here the window ends today, not at the newest game, because a
 * tree of "lately" that quietly reached back to last year's games would answer a different
 * question. Neither control can be emptied, and both live in the URL.
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
import { toggleFilter } from '@/lib/filters'
import { cn } from '@/lib/utils'
import { WINDOW_LABELS, type WindowKey } from '@/routes/stats/kit/analytics'
import { Segmented } from '@/routes/stats/kit/states'

import { PERIODS } from '../reference'

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
  collections = [],
  collection = null,
  onCollection,
}: {
  speeds: readonly Speed[]
  period: WindowKey
  onSpeeds: (next: Speed[]) => void
  onPeriod: (next: WindowKey) => void
  /** The owner's collections; none draws no collection row. */
  collections?: readonly Collection[]
  /** The collection the tree is scoped to, or null for every game. */
  collection?: number | null
  onCollection?: (next: number | null) => void
}) {
  const { i18n, t } = useLingui()
  const chosen = collections.find((entry) => entry.id === collection) ?? null
  return (
    <div className="flex flex-col gap-1.5">
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
      <ChipRow label={t`played`}>
        <Segmented
          label={t`Played within`}
          value={period}
          onChange={onPeriod}
          options={PERIODS.map((key) => ({ value: key, label: WINDOW_LABELS[key] }))}
        />
      </ChipRow>
      {collections.length > 0 && onCollection ? (
        <ChipRow label={t`in`}>
          {chosen ? <CollectionSwatch color={chosen.color} /> : null}
          <select
            aria-label={t`Collection`}
            value={chosen ? String(chosen.id) : ''}
            onChange={(event) =>
              onCollection(event.target.value === '' ? null : Number(event.target.value))
            }
            className={cn(
              'h-[1.625rem] max-w-[14rem] rounded-md border bg-elevated px-1.5 text-[0.6875rem] outline-none transition-colors focus-visible:border-accent-teal/50',
              chosen ? 'border-accent-teal/30 text-ink' : 'border-edge text-dim hover:text-ink',
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
  )
}
