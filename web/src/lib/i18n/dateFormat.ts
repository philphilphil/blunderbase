/**
 * How the app writes a date: in figures, in the reader's order — `08.10.2026`,
 * `10/08/2026`, `08/10/2026` or `2026-10-08` — or in words, `8 Oct 2026`.
 *
 * Automatic asks the browser, the way numbers and clock times already do: a date in figures
 * has no word in it to translate, so it follows where the reader is rather than
 * the language the page speaks, and a German reading the app in English still gets
 * `08.10.2026`. What the browser says is its own language, though, not the computer's
 * region — Chrome in English on a German Mac says `en-US` — and no browser lets a page read
 * the system's date settings. So the four orders can also be chosen outright, and so can
 * words, for a reader who would rather see the month named; those follow the page's
 * language, since a month name is a word to translate.
 *
 * A setting of the browser, like the language and the theme, and for the same reason: the
 * guess it corrects is that browser's. Kept in `localStorage` (`viewPreference`); anything
 * unreadable is Automatic.
 *
 * Every day the app writes follows it — lists, the game's header, Stats, the import log,
 * correspondence — with the whole year wherever the year is not already plain from around
 * it (`writeDayMonth` for those few). A month on its own (a chart tick over years, a group
 * of notes) stays a word, `Oct 2026`: it names a month, not a day, and `10/2026` reads as a
 * fraction before it reads as a date.
 */
import { currentLocale } from '@/lib/i18n/locale'
import { viewPreference } from '@/lib/ui/viewPreference'

export const DATE_FORMATS = ['auto', 'dmy-dot', 'mdy-slash', 'dmy-slash', 'iso', 'words'] as const

export type DateFormat = (typeof DATE_FORMATS)[number]

const preference = viewPreference<DateFormat>('blunderbase.dateFormat', DATE_FORMATS, 'auto')

/** The chosen format, followed: a component that writes dates re-renders when it changes. */
export const useDateFormat = preference.use
/** The chosen format now, for code outside React. */
export const getDateFormat = preference.get
export const setDateFormat = preference.set
/** Test seam: forget the cached choice. */
export const resetDateFormat = preference.reset

/**
 * The browser's own formatters for Automatic, made on first use: building one per row is
 * not free. The clock is always the browser's — the setting is about the order of a date,
 * and 24-hour or a.m./p.m. is a separate habit the browser already knows.
 */
const browser = new Map<string, Intl.DateTimeFormat>()

function browserFormat(key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return cached(`browser:${key}`, navigator.languages ?? [navigator.language], options)
}

/**
 * Words follow the page's language, not the browser's: a month name is a word, and words are
 * the UI's (`8 Oct 2026`, `8. Okt. 2026`). English is British, which is the day-month-year
 * order every game site prints.
 */
function wordFormat(key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const locale = currentLocale() === 'de' ? 'de-DE' : 'en-GB'
  return cached(`words:${locale}:${key}`, locale, options)
}

function cached(
  key: string,
  locales: string | readonly string[],
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  let found = browser.get(key)
  if (!found) {
    found = new Intl.DateTimeFormat(locales as string | string[], options)
    browser.set(key, found)
  }
  return found
}

function parts(date: Date) {
  return {
    day: String(date.getDate()).padStart(2, '0'),
    month: String(date.getMonth() + 1).padStart(2, '0'),
    year: String(date.getFullYear()),
  }
}

/**
 * `date` in `format`, on the reader's own calendar day (local time, as every list here).
 * Every date the app writes as a day goes through this or `writeDayMonth`, so none of them
 * can disagree with the setting.
 */
export function writeDate(date: Date, format: DateFormat): string {
  if (format === 'auto') {
    return browserFormat('date', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)
  }
  if (format === 'words') {
    return wordFormat('date', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
  }
  const { day, month, year } = parts(date)
  switch (format) {
    case 'dmy-dot':
      return `${day}.${month}.${year}`
    case 'mdy-slash':
      return `${month}/${day}/${year}`
    case 'dmy-slash':
      return `${day}/${month}/${year}`
    case 'iso':
      return `${year}-${month}-${day}`
  }
}

/**
 * The day and month alone, in the same order — `06.10.`, `10/06`, `06/10`, `10-06` — for a
 * place whose year is already said around it: a chart's ticks over the last 90 days, a
 * reply due this week.
 */
export function writeDayMonth(date: Date, format: DateFormat): string {
  if (format === 'auto') return browserFormat('day', { day: '2-digit', month: '2-digit' }).format(date)
  if (format === 'words') return wordFormat('day', { day: 'numeric', month: 'short' }).format(date)
  const { day, month } = parts(date)
  switch (format) {
    case 'dmy-dot':
      return `${day}.${month}.`
    case 'mdy-slash':
      return `${month}/${day}`
    case 'dmy-slash':
      return `${day}/${month}`
    case 'iso':
      return `${month}-${day}`
  }
}

/**
 * A month on its own, `Oct 2026` / `Okt. 2026`, for a chart tick over years: a word in the
 * page's language whatever the format, with the whole year — `Okt. 26` beside dates in
 * figures reads as the 26th of October.
 */
export function writeMonth(date: Date): string {
  return wordFormat('month', { month: 'short', year: 'numeric' }).format(date)
}

/** The date in `format` and the browser's clock time: `06.10.2026 09:31`, for a log or a stamp. */
export function writeDateTime(date: Date, format: DateFormat): string {
  const time = browserFormat('time', { hour: '2-digit', minute: '2-digit' }).format(date)
  return `${writeDate(date, format)} ${time}`
}
