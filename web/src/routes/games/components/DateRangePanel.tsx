/**
 * The inside of every date filter's popover: a from → to pair and the quick picks under it.
 *
 * One component for the library, the notes and the explorer, because the three used to be
 * three copies that drifted — one had a Today and the others did not, one filled its fields
 * from a pick and one did not. Here a pick always shows up in the fields as the dates it
 * means, and the pick stays lit only while the fields still say exactly that; change a
 * date by hand and it is a range of your own. Whether a pick is stored as those dates or as
 * the pick itself ("the last 30 days", wherever the link is opened) is the caller's
 * business, which is why picking and typing are two callbacks.
 *
 * A pick and Clear are finished gestures, so they close the popover; typing a date is not
 * — the other end may be next — so the fields leave it open. Clear is in here as well as
 * on the chip's small ×, because the panel is where the hand already is.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DAY_PRESETS, localDay, type DayPreset } from '@/lib/days'

import { OptionButton, PopoverLabel } from './FilterPopover'

/**
 * The popover width this panel needs: its own. A native date field is as wide as the
 * browser's date format for the reader's locale, and those differ — `02.09.2026` in one,
 * `02 / 09 / 2026` in another — so any fixed width is too narrow somewhere, and there the
 * calendar button sits on top of the year. The fields keep their natural width (`w-auto`)
 * and the panel wraps around them.
 */
export const DATE_PANEL_WIDTH = 'max-content'

export function DateRangePanel({
  heading,
  from,
  to,
  preset,
  onRange,
  onPreset,
  onClear,
  close,
  fromLabel,
  toLabel,
}: {
  heading: ReactNode
  /** What the fields show, `YYYY-MM-DD` or empty. */
  from: string | undefined
  to: string | undefined
  /** The pick the fields currently mean, lit; null when they are a range typed by hand. */
  preset: DayPreset | null
  /** A date typed by hand; both emptied is no filter. */
  onRange: (from: string | undefined, to: string | undefined) => void
  onPreset: (preset: DayPreset) => void
  /** No date filter at all. */
  onClear: () => void
  /** Closes the popover this panel is in (`FilterPopover`'s render argument). */
  close: () => void
  fromLabel: string
  toLabel: string
}) {
  const { i18n } = useLingui()
  const today = localDay()
  return (
    <>
      <PopoverLabel>{heading}</PopoverLabel>
      {/* Wraps only on a phone, where the panel spans the bar rather than its content. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Input
          type="date"
          aria-label={fromLabel}
          value={from ?? ''}
          max={today}
          onChange={(event) => onRange(event.target.value || undefined, to)}
          className="h-7 w-auto px-2 text-data"
        />
        <span className="text-faint">→</span>
        <Input
          type="date"
          aria-label={toLabel}
          value={to ?? ''}
          max={today}
          onChange={(event) => onRange(from, event.target.value || undefined)}
          className="h-7 w-auto px-2 text-data"
        />
      </div>
      <div className="flex gap-1">
        {DAY_PRESETS.map((entry) => (
          <OptionButton
            key={entry.key}
            selected={preset === entry.key}
            onClick={() => {
              onPreset(entry.key)
              close()
            }}
            className="flex-1 px-1"
          >
            {i18n._(entry.label)}
          </OptionButton>
        ))}
      </div>
      <div className="flex justify-end">
        <Button
          variant="secondary"
          size="sm"
          disabled={!from && !to}
          onClick={() => {
            onClear()
            close()
          }}
        >
          <Trans>Clear</Trans>
        </Button>
      </div>
    </>
  )
}
