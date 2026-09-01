/**
 * How many rows one page of the library holds, and where that choice is kept.
 *
 * `'fit'` is the default and the reason paging replaced infinite scroll at all: the table
 * measures its own body and asks for exactly as many games as are on screen, so the footer
 * — where the selection actions and the page controls are — never retreats below the fold.
 * The fixed sizes are for a window someone wants more rows in than it can show at once.
 *
 * The choice is a preference rather than part of the query, so it lives in `localStorage`
 * beside the saved filters instead of in the URL: a link to a filtered library is about
 * the filter, and it should open at whatever size the person following it reads at.
 */
export const PAGE_SIZE_KEY = 'blunderbase.gamesPageSize'

/** A number of rows, or "as many as the window has room for". */
export type PageSizeChoice = number | 'fit'

export const PAGE_SIZE_OPTIONS: readonly PageSizeChoice[] = ['fit', 25, 50, 100, 200]

export const DEFAULT_PAGE_SIZE: PageSizeChoice = 'fit'

/** Where "fit" starts, before the table has measured anything (jsdom never does). */
export const FALLBACK_FIT_ROWS = 25

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    // Storage disabled: the preference simply does not survive the reload.
    return null
  }
}

export function readPageSize(): PageSizeChoice {
  const raw = storage()?.getItem(PAGE_SIZE_KEY)
  if (raw === 'fit') return 'fit'
  const rows = Number(raw)
  return PAGE_SIZE_OPTIONS.includes(rows) ? rows : DEFAULT_PAGE_SIZE
}

export function writePageSize(size: PageSizeChoice): void {
  try {
    storage()?.setItem(PAGE_SIZE_KEY, String(size))
  } catch {
    // Quota or a private window: the choice still holds for this session.
  }
}

/** The choice as a row count: what "fit" resolves to right now, or the number itself. */
export function resolvePageSize(size: PageSizeChoice, fitRows: number): number {
  return size === 'fit' ? Math.max(1, fitRows) : size
}

/** `1–50 of 843` — which slice of the filtered library this page is. */
export function pageRange(page: number, pageSize: number, loaded: number, total: number) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1
  return { first, last: Math.min(first + Math.max(loaded - 1, 0), total) }
}
