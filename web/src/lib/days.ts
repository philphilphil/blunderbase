/**
 * Calendar days as the reader lives them, and the presets every date filter offers.
 *
 * A day here is `YYYY-MM-DD` on the reader's own clock, because that is what
 * `<input type="date">` speaks and what "today" means to a person. Slicing
 * `toISOString()` instead answers in UTC, which is a different day for hours of every
 * evening east of Greenwich and every night west of it — "today" would then quietly be
 * yesterday or tomorrow.
 */
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'

/** The reader's calendar day `offsetDays` back from `now` (0 is today). */
export function localDay(offsetDays = 0, now: Date = new Date()): string {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offsetDays)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** The instant a local day starts, as an ISO timestamp the server can compare. */
export function dayStart(day: string): string {
  return new Date(`${day}T00:00:00`).toISOString()
}

/** The last instant of a local day — the inclusive end of a range that names it. */
export function dayEnd(day: string): string {
  return new Date(`${day}T23:59:59.999`).toISOString()
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** A `YYYY-MM-DD` read from a URL, or null for anything else. */
export function parseDay(value: string | null | undefined): string | null {
  return value && DAY.test(value) ? value : null
}

/**
 * The quick picks under every date pair, in days back from today — each is "from that
 * day to now". The labels are as short as the buttons they sit on, so each carries a
 * comment saying what it stands for.
 */
export type DayPreset = 'today' | '7d' | '30d' | '90d' | '1y'

export const DAY_PRESETS: readonly { key: DayPreset; days: number; label: MessageDescriptor }[] =
  [
    { key: 'today', days: 0, label: msg({ message: 'Today', comment: 'Date preset button' }) },
    { key: '7d', days: 7, label: msg({ message: '7d', comment: 'Date preset: the last 7 days' }) },
    {
      key: '30d',
      days: 30,
      label: msg({ message: '30d', comment: 'Date preset: the last 30 days' }),
    },
    {
      key: '90d',
      days: 90,
      label: msg({ message: '90d', comment: 'Date preset: the last 90 days' }),
    },
    { key: '1y', days: 365, label: msg({ message: '1y', comment: 'Date preset: the last year' }) },
  ]

/** The first day a preset covers. */
export function presetStart(preset: DayPreset, now?: Date): string {
  const days = DAY_PRESETS.find((entry) => entry.key === preset)!.days
  return localDay(days, now)
}

/** `?period=30d`, or null for anything that is not a preset. */
export function parsePreset(value: string | null | undefined): DayPreset | null {
  return DAY_PRESETS.find((entry) => entry.key === value)?.key ?? null
}

/**
 * Which preset a plain `since` with no end is the same as, so a date pair filled by a
 * preset button lights that button — and stops lighting it once a date is changed by hand.
 */
export function presetOf(since: string | undefined, until: string | undefined): DayPreset | null {
  if (!since || until) return null
  return DAY_PRESETS.find((entry) => localDay(entry.days) === since)?.key ?? null
}
