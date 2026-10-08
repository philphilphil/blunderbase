/**
 * The 16 columns of the library table: design 2b's, with two departures from the design and
 * two additions (`Notes`, `Collections`).
 *
 * Each column is as wide as what it holds on the page, not the fixed width the design drew.
 * The table is a CSS grid whose rows are subgrids of it (`GamesTable`), so a column is one
 * track, sized by its widest cell, header included, and a column of two-digit move counts
 * no longer keeps the 40px the design gave it for three. Content sizing needs two limits:
 *
 * - **A floor** (`size`) on every cell that clips, and on the figure columns. A grid item
 *   that hides its overflow has an automatic minimum of zero, so while the grid squeezes
 *   its tracks to fit the pane, a truncating name would go to nothing first. The text
 *   floors are no narrower than the old fixed widths (`white` and `black` 7.375rem,
 *   `opening` 11.625rem), so no column reads worse than it did; the figure floors are in
 *   `ch` of the cell's own mono face, the few characters the column always shows, which
 *   also keeps a page of shorter figures from making the column jump narrower.
 * - **A cap** (`cap`) on the columns whose text has no natural end — names, openings, long
 *   clocks, a list of collections — so one long opening does not take the page; it ends
 *   in "…", with the whole text in the cell's title. The last column has no cap: it takes
 *   whatever width is left (`tracksFor`).
 *
 * Two of the design's columns — per-game accuracy and ACPL — have no backend behind them:
 * `/games?cards=true` carries the eval curve and the three worst moments, not a per-game
 * accuracy aggregate, and nothing in `/stats` computes one per game either. They are
 * replaced by one honest column, `Worst` (the largest win percentage the owner gave away
 * in that game), which comes straight off `worst_moments[0]`.
 *
 * And the design's `Opponent`, `Elo` and `Col` are now `White`, `Elo`, `Black`, `Elo`. An
 * opponent presumes a "you" in every game, and since the reference explorer can add other
 * people's games to the library that is no longer so: such a row has two players and no
 * opponent. Naming both sides reads the same for every row, and the owner's side is said
 * by which name is set bold (`GameRow`) rather than by a disc in a column of its own.
 *
 * Which of the fifteen are shown, and in what order, is the owner's (#42), stored with the
 * library (`GET /settings/game-columns`, `useGameColumns`). This file is the one list of
 * column ids: the backend only checks that a stored id is shaped like one, and
 * `arrangeColumns` reads what was stored against this build's list. The checkbox column is
 * not part of the choice — it is always first, and the selection depends on it.
 */
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'

import type { GameColumns } from '@/lib/api/types'
import { cn } from '@/lib/utils'

import type { SortKey } from '../sorting'

/** The columns the owner can show, hide and move: every column but the checkbox. */
export type ColumnId =
  | 'date'
  | 'white'
  | 'white_rating'
  | 'black'
  | 'black_rating'
  | 'opening'
  | 'result'
  | 'time'
  | 'moves'
  | 'worst'
  | 'source'
  | 'tier'
  | 'flags'
  | 'notes'
  | 'collections'

export interface Column {
  id: ColumnId | 'select'
  /** Resolved where the header is drawn (`GamesTable`); `null` for the checkbox column. */
  label: MessageDescriptor | null
  /**
   * The column's whole name, where `label` is cut short to fit its header (`Elo`, `Res`,
   * `Mv`): the column menu lists the columns by name with nothing around them, and two rows
   * both called "Elo" do not say which side's rating each one is (`ColumnsMenu`).
   */
  name?: MessageDescriptor
  /**
   * The cell's floor from `md` up (see the module doc): every cell that clips has one, or
   * the grid would squeeze it to nothing. Empty for a column whose content cannot shrink.
   */
  size: string
  /** The cell's widest from `md` up, for text with no natural end; dropped when last. */
  cap?: string
  /**
   * The floor in `size`, in rem, for the columns whose floor is wider than the last
   * column's own (7rem): whichever of them is last holds it as its track's minimum too,
   * since the last track's width is otherwise the space left over (`tracksFor`).
   */
  floorRem?: number
  /** The skeleton bar standing in for the cell while the page loads, in rem; 0 draws none. */
  bar: number
  align?: 'left' | 'right' | 'center'
  sort?: SortKey
  /** Set in mono, tabular — dates, ratings, counts. */
  mono?: boolean
  /**
   * Where the cell lands in the two-line card a row folds into below `md`, as the grid
   * placement classes for it — `null` for a column the phone drops. See `PHONE_CARD`.
   */
  phone: string | null
  /**
   * Hidden until the owner shows it. For a column added after the owner first arranged
   * theirs, so a new column can arrive switched off; it never hides a column they already
   * chose about (`arrangeColumns`). Unset on all fifteen today.
   */
  defaultHidden?: boolean
}

/** A column as this reading of the table lays it out (`columnsFor`). */
export interface LaidColumn extends Column {
  /**
   * Shown from `md` up, with a header cell and a track of its own. A column the owner hid
   * is not wide, but stays in the list when the phone card has a slot for it: the card's
   * fields are fixed (`columnsFor`), so its cell is drawn and hidden from `md` up.
   */
  wide: boolean
  /**
   * The rightmost wide column: it takes the width the others leave (`tracksFor`) and
   * carries the row's delete (`GameRow`).
   */
  last: boolean
}

/**
 * Sixteen columns do not fit on a 375px screen, so below `md` a row stops being a line of
 * a table and becomes a two-line card laid out on this grid:
 *
 * ```
 *   ┌───┬────────────┬─────┬────────────┬─────┬───────┐
 *   │ ☑ │ white      │ Elo │ black      │ Elo │   Res │   <- row 1
 *   │   ├────────────┴─────┴────────────┼─────┼───────┤
 *   │   │ date                          │worst│ flags │   <- row 2
 *   └───┴───────────────────────────────┴─────┴───────┘
 * ```
 *
 * The opening, the clock, the move count, the source, the analysis and the notes are the
 * six that go: they are the ones a phone can look up by opening the game, and dropping them
 * is what buys the two names a readable width. The header drops their sort with them, so a
 * phone sorts only by what it can see (and not by a column the owner hid; see `columnsFor`).
 */
export const PHONE_CARD =
  'max-md:grid max-md:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_auto]'

/**
 * One body row's height from `md` up. A class rather than the inline style it used to be:
 * below `md` the card sizes itself to its two lines, and an inline height would win over
 * every variant that tried to say so. Shared by the rows and the skeleton standing in for
 * them (`h-10` is the design's 40px at the app's scale).
 */
export const ROW_HEIGHT = 'md:h-10'

/**
 * A row from `md` up, and every wrapper between the table's body and its rows: a subgrid
 * spanning all of the table's tracks, so each cell lands in its column's track and the
 * header, the rows and the skeleton line up by construction (`GamesTable`). No gap of its
 * own — a subgrid inherits the table's. Below `md` a row is its card (`PHONE_CARD`).
 */
export const ROW_SUBGRID = 'md:col-span-full md:grid md:grid-cols-subgrid'

/**
 * The six cells of the card's first line and the three of its second, in grid terms.
 * Spans are written as an end line rather than as `col-span-2` / `row-span-2`: those set
 * the `grid-column` / `grid-row` shorthand, which would throw the start line away again.
 */
const CARD = {
  select: 'max-md:col-start-1 max-md:row-start-1 max-md:row-end-3',
  white: 'max-md:col-start-2 max-md:row-start-1',
  white_rating: 'max-md:col-start-3 max-md:row-start-1',
  black: 'max-md:col-start-4 max-md:row-start-1',
  black_rating: 'max-md:col-start-5 max-md:row-start-1',
  result: 'max-md:col-start-6 max-md:row-start-1',
  date: 'max-md:col-start-2 max-md:col-end-5 max-md:row-start-2',
  worst: 'max-md:col-start-5 max-md:row-start-2',
  flags: 'max-md:col-start-6 max-md:row-start-2 max-md:justify-end',
} as const

/**
 * The header words. Three of them are cut to fit a narrow column rather than written out,
 * so they carry a comment saying what they are short for — a translator handed `Mv` with
 * nothing around it has no way to know.
 */
const ELO = msg({ message: 'Elo', comment: 'The rating, named after Arpad Elo — left as it is in most languages' })
const RES = msg({
  message: 'Res',
  comment: 'Column header, short for "Result" — kept short so the figure column stays narrow',
})
const MV = msg({
  message: 'Mv',
  comment: 'Column header, short for "Moves" — kept short so the figure column stays narrow',
})

/*
 * The floors and caps are Tailwind's spacing steps (a step is 0.25rem: `min-w-30` is
 * 7.5rem) or `ch` of the cell's mono face, written out whole so Tailwind's scanner sees them.
 */
export const COLUMNS: Column[] = [
  { id: 'select', label: null, size: '', bar: 0, phone: CARD.select },
  // "28 Sep 25".
  { id: 'date', label: msg`Date`, size: 'md:min-w-[9ch]', bar: 3.5, sort: 'played_at', mono: true, phone: CARD.date },
  { id: 'white', label: msg`White`, size: 'md:min-w-30', cap: 'md:max-w-40', floorRem: 7.5, bar: 5, sort: 'white', phone: CARD.white },
  { id: 'white_rating', label: ELO, name: msg`White's rating`, size: 'md:min-w-[4ch]', bar: 2, align: 'right', sort: 'white_rating', mono: true, phone: CARD.white_rating },
  { id: 'black', label: msg`Black`, size: 'md:min-w-30', cap: 'md:max-w-40', floorRem: 7.5, bar: 5, sort: 'black', phone: CARD.black },
  { id: 'black_rating', label: ELO, name: msg`Black's rating`, size: 'md:min-w-[4ch]', bar: 2, align: 'right', sort: 'black_rating', mono: true, phone: CARD.black_rating },
  // The ECO rides after the name, inside the same cap.
  { id: 'opening', label: msg`Opening`, size: 'md:min-w-47', cap: 'md:max-w-68', floorRem: 11.75, bar: 8, sort: 'opening', phone: null },
  { id: 'result', label: RES, name: msg`Result`, size: 'md:min-w-[3ch]', bar: 1.5, align: 'center', sort: 'result', mono: true, phone: CARD.result },
  // Capped at "OTB 90+30"; a longer correspondence clock ends in "…", whole in the title.
  // The floor holds a five-character clock ("15+10") with a hair to spare: at exactly
  // 5ch the text's subpixel width tipped it into an ellipsis.
  { id: 'time', label: msg`Time`, size: 'md:min-w-[6ch]', cap: 'md:max-w-[9ch]', bar: 2.5, sort: 'time_control', mono: true, phone: null },
  { id: 'moves', label: MV, name: msg`Moves`, size: 'md:min-w-[3ch]', bar: 1.5, align: 'right', sort: 'ply_count', mono: true, phone: null },
  // "−100%".
  { id: 'worst', label: msg`Worst`, size: 'md:min-w-[5ch]', bar: 2.5, align: 'right', sort: 'worst', mono: true, phone: CARD.worst },
  // A handful of fixed names, so the floor is the widest of them (the dot and "Chess.com",
  // 102px at the app's scale): sized to the page, the column grew by 21px whenever a page
  // held a Chess.com game and pushed every column after it along while paging.
  { id: 'source', label: msg`Source`, size: 'md:min-w-22', floorRem: 5.5, bar: 4, sort: 'source', phone: null },
  // Still `tier` inside, so nothing keyed on the column id moves; no sort, because with one
  // pass "analysed or not" is all there is to rank, and the Analysed filter already says it.
  { id: 'tier', label: msg`Analysis`, size: '', bar: 4, phone: null },
  // Three badges at most (a card carries three worst moments), or the Analyse button; the
  // floor is the three badges, so a page with fewer does not narrow the column under them.
  { id: 'flags', label: msg`Flags`, size: 'md:min-w-22', floorRem: 5.5, bar: 4, phone: CARD.flags },
  // How many notes were written on the game (#45), beside the collections: both are the
  // owner's own work on it rather than the engine's. Only that game's notes — one written
  // in another game on a shared position is not counted. The phone drops it.
  { id: 'notes', label: msg`Notes`, size: 'md:min-w-[2ch]', bar: 1.5, align: 'right', sort: 'notes', mono: true, phone: null },
  // A game's collections, apart from its flags: flags are the engine's verdict, a
  // collection is the owner's filing, and one cell holding both read as one kind of thing.
  // Plain names, last by default (whichever column is last takes the spare width,
  // `tracksFor`). The phone drops it and carries the chips on the date's line instead
  // (`GameRow`).
  { id: 'collections', label: msg`Collections`, size: 'md:min-w-24', cap: 'md:max-w-56', floorRem: 6, bar: 6, phone: null },
]

const BY_ID = new Map(COLUMNS.map((column) => [column.id, column]))

/** The ids the owner arranges, in this build's default order. */
const CHOOSABLE = COLUMNS.flatMap((column) => (column.id === 'select' ? [] : [column.id]))

/** What a column id looks like, known to this build or not; the backend checks the same. */
const ID_SHAPE = /^[a-z][a-z0-9_]{0,31}$/

/** A column this build has: one of `COLUMNS`, the checkbox aside. */
export function isColumnId(id: string): id is ColumnId {
  return id !== 'select' && BY_ID.has(id as ColumnId)
}

/**
 * The owner's arrangement of the columns, read against this build (`arrangeColumns`).
 *
 * `order` is every id, left to right, hidden ones included — those this build knows and any
 * it does not, in the places they were stored in. `hidden` is the ids not shown. A save
 * writes both back whole (`toColumnPref`), so an id this build does not know, and whether it
 * was hidden, survives a save made here.
 */
export interface Arrangement {
  order: readonly string[]
  hidden: ReadonlySet<string>
}

/** This build's default: every column in `COLUMNS` order, the `defaultHidden` ones off. */
export function defaultArrangement(): Arrangement {
  return {
    order: CHOOSABLE,
    hidden: new Set(CHOOSABLE.filter((id) => BY_ID.get(id)?.defaultHidden)),
  }
}

/**
 * The stored choice (`GameColumns`), read against this build's columns. Pure; it never
 * writes anything back.
 *
 * - The checkbox column and anything not shaped like an id are dropped, and a repeat after
 *   its first place. An id this build does not know is kept where it is: it was written
 *   by a newer build, and an older tab left open across an upgrade must not drop it on its
 *   next save.
 * - A column this build has that the choice does not name is new since the choice was
 *   made. It goes in right after the nearest column before it in `COLUMNS` that the choice
 *   has, or first when there is none, and is hidden only if it says so (`defaultHidden`).
 * - Nothing stored, or nothing this build knows, is the default.
 */
export function arrangeColumns(pref: GameColumns | null | undefined): Arrangement {
  const order: string[] = []
  for (const id of pref?.order ?? []) {
    if (typeof id !== 'string' || id === 'select' || !ID_SHAPE.test(id) || order.includes(id)) continue
    order.push(id)
  }
  if (!order.some(isColumnId)) return defaultArrangement()
  const hidden = new Set((pref?.hidden ?? []).filter((id) => order.includes(id)))
  // In `COLUMNS` order, so two new neighbours keep theirs: the second finds the first.
  CHOOSABLE.forEach((id, index) => {
    if (order.includes(id)) return
    const before = CHOOSABLE.slice(0, index).findLast((earlier) => order.includes(earlier))
    order.splice(before === undefined ? 0 : order.indexOf(before) + 1, 0, id)
    if (BY_ID.get(id)?.defaultHidden) hidden.add(id)
  })
  return { order, hidden }
}

/** The arrangement's columns this build has, left to right: what the column menu lists. */
export function known(arrangement: Arrangement): ColumnId[] {
  return arrangement.order.filter(isColumnId)
}

/** Whether the arrangement is this build's default, so there is nothing to reset. */
export function isDefaultArrangement(arrangement: Arrangement): boolean {
  const base = defaultArrangement()
  return (
    arrangement.order.length === base.order.length &&
    arrangement.order.every((id, index) => id === base.order[index]) &&
    arrangement.hidden.size === base.hidden.size &&
    [...arrangement.hidden].every((id) => base.hidden.has(id))
  )
}

/** The arrangement with one column shown or hidden; every other id, known or not, as it was. */
export function setColumnHidden(arrangement: Arrangement, id: string, hidden: boolean): Arrangement {
  const next = new Set(arrangement.hidden)
  if (hidden) next.add(id)
  else next.delete(id)
  return { order: arrangement.order, hidden: next }
}

/**
 * The arrangement with `id` swapped with its neighbour in the column menu: the nearest id
 * above or below it that the menu lists (`listed`). Ids the menu leaves out — one this build
 * does not know, Collections while there are none — keep their places in `order`, so moving
 * a listed column past them never moves them. Unchanged when there is no such neighbour.
 */
export function moveColumn(
  arrangement: Arrangement,
  id: string,
  direction: 'up' | 'down',
  listed: readonly string[],
): Arrangement {
  const order = [...arrangement.order]
  const from = order.indexOf(id)
  if (from === -1) return arrangement
  const step = direction === 'up' ? -1 : 1
  let to = from + step
  while (to >= 0 && to < order.length && !listed.includes(order[to]!)) to += step
  if (to < 0 || to >= order.length) return arrangement
  ;[order[from], order[to]] = [order[to]!, order[from]!]
  return { order, hidden: arrangement.hidden }
}

/**
 * The arrangement with `id` dragged to where `onto` is in the column menu: the listed ids
 * are reordered among themselves and poured back into the slots they held in `order`, so an
 * id the menu leaves out keeps its place however far a column travels past it — the same
 * rule `moveColumn` keeps for one step. Unchanged when either id is not listed.
 */
export function dropColumn(
  arrangement: Arrangement,
  id: string,
  onto: string,
  listed: readonly string[],
): Arrangement {
  const slots = arrangement.order.flatMap((each, index) => (listed.includes(each) ? [index] : []))
  const sequence = slots.map((index) => arrangement.order[index]!)
  const from = sequence.indexOf(id)
  const to = sequence.indexOf(onto)
  if (from === -1 || to === -1 || from === to) return arrangement
  sequence.splice(to, 0, ...sequence.splice(from, 1))
  const order = [...arrangement.order]
  slots.forEach((slot, index) => {
    order[slot] = sequence[index]!
  })
  return { order, hidden: arrangement.hidden }
}

/** The arrangement as it is stored: the whole order, and the hidden ids in it in that order. */
export function toColumnPref(arrangement: Arrangement): GameColumns {
  return {
    order: [...arrangement.order],
    hidden: arrangement.order.filter((id) => arrangement.hidden.has(id)),
  }
}

/** The columns ⇧E takes away, whatever the owner chose: they are the engine's verdict. */
const ENGINE_COLUMNS: ReadonlySet<string> = new Set(['worst', 'flags'])

function layOut(
  arrangement: Arrangement,
  engineHidden: boolean,
  collections: boolean,
): Omit<LaidColumn, 'last'>[] {
  const select = BY_ID.get('select')!
  return [select, ...known(arrangement).map((id) => BY_ID.get(id)!)]
    .filter(
      (column) =>
        !(engineHidden && ENGINE_COLUMNS.has(column.id)) &&
        !(!collections && column.id === 'collections'),
    )
    .map((column) => (engineHidden && column.id === 'tier' ? { ...column, phone: CARD.flags } : column))
    .map((column) => ({ ...column, wide: column.id === 'select' || !arrangement.hidden.has(column.id) }))
    .filter((column) => column.wide || column.phone !== null)
}

/**
 * The columns this reading of the table has: the checkbox, then the owner's arrangement.
 *
 * With the engine hidden (⇧E, `lib/ui/engineVisibility`) `Worst` and `Flags` go, at every
 * size and whatever the owner chose: they are the engine's verdict on the game, and a
 * column of blanks is not hidden — it is a column advertising what it will not tell you.
 * `Collections` goes while there are none to be in, for the same reason.
 *
 * A column the owner hid is not `wide`: from `md` up it has no header cell and no track. The
 * phone card does not follow the choice, though — its fields are a fixed layout, and the
 * Analyse copy in its Flags slot and the chips on its date line live in cells the owner may
 * well have hidden on the desktop. So a hidden column with a card slot stays, drawn in the
 * card and hidden from `md` up (`cellClass`); one without a slot is left out. What the card
 * does follow is the sort: a hidden column's sort chip goes from the phone's strip too,
 * because the sort falls back to the default (`sortHidden`).
 *
 * An arrangement that leaves nothing shown but the checkbox — every column hidden, or only
 * the ones ⇧E and the Collections rule take away — is read as the default instead, so the
 * table always has a column to read. Whichever wide column is left last takes the rest of
 * the width (`tracksFor`), and the row puts its delete button there (`GameRow`). The header,
 * the rows and the loading skeleton all lay themselves out from this one list, so they
 * cannot disagree about how many cells a row has.
 *
 * On a phone the card's Flags slot also carries the "analyse" affordance, so while Flags is
 * gone the Analysis cell takes that slot: the card keeps a way to queue a game.
 */
export function columnsFor(
  arrangement: Arrangement,
  engineHidden: boolean,
  collections = true,
): LaidColumn[] {
  let laid = layOut(arrangement, engineHidden, collections)
  if (!laid.some((column) => column.wide && column.id !== 'select')) {
    laid = layOut(defaultArrangement(), engineHidden, collections)
  }
  const last = laid.findLastIndex((column) => column.wide)
  return laid.map((column, index) => ({ ...column, last: index === last }))
}

/** Whether a column sorts by `key`, so that hiding it could change the order the list is read in. */
export function hasSortColumn(key: SortKey): boolean {
  return COLUMNS.some((column) => column.sort === key)
}

/**
 * Whether the table cannot show what `key` sorts by: the column that owns the sort is gone
 * (⇧E, no collections) or the owner hid it. The library is then read in the default order
 * (`GamesPage`) — a list ordered by something with nothing on screen saying so, and no
 * header left to change it back, is a list that looks unsorted. Breakpoint-free on purpose:
 * the same at every width, so dragging a window across `md` never re-sorts the list. A key
 * no column owns (the opponent, the colour, which a link can still ask for) is never hidden.
 */
export function sortHidden(columns: readonly LaidColumn[], key: SortKey): boolean {
  const owner = COLUMNS.find((column) => column.sort === key)
  if (!owner) return false
  return !columns.some((column) => column.id === owner.id && column.wide)
}

/** The last column's floor when its own is narrower: room for a word and the row's delete. */
const LAST_FLOOR_REM = 7

/**
 * The row's `px-5`, in rem. A subgrid adds its own padding to its edge tracks, so the last
 * track has to hold the row's right padding on top of the cell's floor.
 */
const ROW_PADDING_REM = 1.25

/**
 * The grid's track list from `md` up (`grid-template-columns`), one track per wide column:
 * a column the owner hid is `md:hidden` there and takes no track.
 *
 * Every column but the last is `auto`: as wide as its widest cell on the page, header
 * included, down to its floor while the pane is short of room (the cells' `size`), and no
 * wider than its cap. The last is `minmax(floor, 1fr)`: it takes whatever the others leave,
 * so the row reaches the pane's right edge, and below its floor the table scrolls sideways
 * rather than squeezing it — and the row's delete with it — to nothing. Its floor is its
 * own (`floorRem`) or 7rem, whichever is wider, plus the row's padding.
 */
export function tracksFor(columns: readonly LaidColumn[]): string {
  return columns
    .filter((column) => column.wide)
    .map((column) =>
      column.last
        ? `minmax(${Math.max(LAST_FLOOR_REM, column.floorRem ?? 0) + ROW_PADDING_REM}rem, 1fr)`
        : 'auto',
    )
    .join(' ')
}

/**
 * One cell's classes for its column, in the header, the rows and the skeleton alike: from
 * `md` up its floor, and its cap unless it is last (the last column takes the spare width,
 * which a cap would only leave empty); below `md` either the cell's place in the phone card
 * or nothing at all. A column the owner hid that the card still draws is hidden from `md`
 * up (`columnsFor`). Every part is a class rather than an inline style, which would outrank
 * the breakpoint and leave the phone card's grid no say over the cell.
 */
export function cellClass(column: LaidColumn): string {
  return cn(
    column.size,
    !column.last && column.cap,
    column.phone ?? 'max-md:hidden',
    !column.wide && 'md:hidden',
  )
}
