import { describe, expect, it } from 'vitest'

import {
  arrangeColumns,
  cellClass,
  COLUMNS,
  columnsFor,
  defaultArrangement,
  isDefaultArrangement,
  known,
  dropColumn,
  moveColumn,
  setColumnHidden,
  sortHidden,
  toColumnPref,
  tracksFor,
  type LaidColumn,
} from './columns'

function column(id: string) {
  const found = COLUMNS.find((entry) => entry.id === id)
  if (!found) throw new Error(`unknown column ${id}`)
  return found
}

/** A shown column as `columnsFor` lays it out, last or not. */
function laid(id: string, last = false): LaidColumn {
  return { ...column(id), wide: true, last }
}

/** The table's columns with the owner's choice left at the default. */
function standard(engineHidden: boolean, collections = true): LaidColumn[] {
  return columnsFor(defaultArrangement(), engineHidden, collections)
}

/** The columns for a stored choice. */
function chosen(order: string[], hidden: string[] = [], engineHidden = false, collections = true) {
  return columnsFor(arrangeColumns({ order, hidden }), engineHidden, collections)
}

const ids = (columns: readonly LaidColumn[]) => columns.map((each) => each.id)

/** Every id in the default order, the checkbox aside. */
const ALL = COLUMNS.filter((each) => each.id !== 'select').map((each) => each.id as string)

/** The full table cut after `id`, which is then last, as a column choice will make it. */
function lastIs(id: string): LaidColumn[] {
  const all = standard(false, true)
  const cut = all.slice(0, all.findIndex((each) => each.id === id) + 1)
  return cut.map((each, index) => ({ ...each, last: index === cut.length - 1 }))
}

/** A Tailwind spacing step (`md:min-w-30`) as rem; a step is 0.25rem. */
function stepRem(classes: string, utility: 'min-w' | 'max-w'): number | null {
  const match = classes.match(new RegExp(`(?:^|\\s)md:${utility}-(\\d+(?:\\.\\d+)?)(?:\\s|$)`))
  return match ? Number(match[1]) * 0.25 : null
}

describe('which columns a reading of the table has', () => {
  it('makes exactly one column last, the rightmost', () => {
    for (const columns of [standard(false, true), standard(true, false)]) {
      expect(columns.filter((each) => each.last)).toEqual([columns.at(-1)])
    }
    expect(standard(false, true).at(-1)).toMatchObject({ id: 'collections', last: true })
  })

  it('makes Notes the last column when there are no collections', () => {
    const columns = standard(false, false)
    expect(columns.map((each) => each.id)).not.toContain('collections')
    expect(columns.at(-1)).toMatchObject({ id: 'notes', last: true })
    expect(standard(false, true).find((each) => each.id === 'notes')?.last).toBe(false)
  })

  it('keeps Notes with the engine hidden: they are the owner’s, not the engine’s', () => {
    expect(standard(true, true).map((each) => each.id)).toContain('notes')
  })

  it('drops Worst and Flags with the engine hidden, and hands the phone slot to Analysis', () => {
    const hidden = standard(true, true)
    expect(hidden.map((each) => each.id)).not.toContain('worst')
    expect(hidden.map((each) => each.id)).not.toContain('flags')
    expect(hidden.find((each) => each.id === 'tier')?.phone).toBe(column('flags').phone)
    // With no collections either, Notes is last and takes the rest of the width.
    expect(standard(true, false).at(-1)).toMatchObject({ id: 'notes', last: true })
  })
})

describe('tracksFor', () => {
  it('sizes every column to its content and gives the last the spare width', () => {
    const columns = standard(false, true)
    // One `auto` per column but the last, which is the flexible track with a floor.
    expect(tracksFor(columns)).toBe(
      `${Array(columns.length - 1).fill('auto').join(' ')} minmax(8.25rem, 1fr)`,
    )
  })

  it('floors the last track at 7rem or the column’s own floor, plus the row’s padding', () => {
    // Notes' own floor is a few characters, so it gets the 7rem; Opening and White keep
    // theirs (11.75rem, 7.5rem), so making them last never narrows them.
    expect(tracksFor(standard(false, false))).toMatch(/ minmax\(8\.25rem, 1fr\)$/)
    expect(tracksFor(lastIs('opening'))).toMatch(/ minmax\(13rem, 1fr\)$/)
    expect(tracksFor(lastIs('white'))).toMatch(/ minmax\(8\.75rem, 1fr\)$/)
    expect(tracksFor(lastIs('flags'))).toMatch(/ minmax\(8\.25rem, 1fr\)$/)
  })

  it('has one track per column, so the header, rows and skeleton fill them alike', () => {
    for (const columns of [standard(false, true), standard(true, false), lastIs('opening')]) {
      expect(tracksFor(columns).match(/auto|minmax\([^)]*\)/g)).toHaveLength(columns.length)
    }
  })
})

describe('cell geometry', () => {
  it('sets no width at all: the cell sizes its track rather than being told a width', () => {
    // An inline width outranked every class and left the phone card no say over the cell;
    // the old `--cell-width` custom property is gone with the fixed widths.
    for (const each of COLUMNS) {
      expect(cellClass({ ...each, wide: true, last: false })).not.toMatch(/(^|\s)(md:)?w-|--cell-width|flex-none/)
    }
  })

  it('keeps floors and caps from md up, so the phone card is free of them', () => {
    for (const each of COLUMNS) {
      for (const classes of [each.size, each.cap ?? '']) {
        for (const name of classes.split(/\s+/).filter(Boolean)) {
          expect(name, `${each.id}: ${name}`).toMatch(/^md:(min|max)-w-/)
        }
      }
    }
  })

  it('places a cell in the phone card, or hides it there', () => {
    expect(cellClass(laid('white'))).toContain('max-md:col-start-2')
    expect(cellClass(laid('opening'))).toContain('max-md:hidden')
  })

  it('drops the cap on the last column, which takes the spare width instead', () => {
    expect(cellClass(laid('opening'))).toContain('md:max-w-68')
    expect(cellClass(laid('opening', true))).not.toContain('md:max-w')
    // The floor stays.
    expect(cellClass(laid('opening', true))).toContain('md:min-w-47')
  })

  it('gives every clipping column a floor, or the grid squeezes it to nothing', () => {
    // These cells truncate or hide their overflow (`GameRow`), and a grid item that does
    // has an automatic minimum of zero.
    for (const id of ['white', 'black', 'opening', 'time', 'flags', 'collections']) {
      expect(column(id).size, id).toMatch(/(^|\s)md:min-w-/)
    }
  })

  it('never makes a text column narrower than its old fixed width', () => {
    // The widths design 2b gave them, before the table sized to its content.
    const old = { white: 7.375, black: 7.375, opening: 11.625 }
    for (const [id, rem] of Object.entries(old)) {
      expect(stepRem(column(id).size, 'min-w'), id).toBeGreaterThanOrEqual(rem)
    }
  })

  it('states each wide floor once: the class and `floorRem` agree', () => {
    for (const each of COLUMNS.filter((entry) => entry.floorRem !== undefined)) {
      expect(stepRem(each.size, 'min-w'), each.id).toBe(each.floorRem)
    }
    // Every column whose floor is wider than the last column's 7rem says so in `floorRem`,
    // or it would lose that floor on becoming last.
    for (const each of COLUMNS) {
      const floor = stepRem(each.size, 'min-w')
      if (floor !== null && floor > 7) expect(each.floorRem, each.id).toBe(floor)
    }
  })

  it('stands a skeleton bar in every column but the checkbox', () => {
    for (const each of COLUMNS) {
      if (each.id === 'select') expect(each.bar).toBe(0)
      else expect(each.bar, each.id).toBeGreaterThan(0)
    }
  })
})

describe('arrangeColumns', () => {
  it('reads nothing stored as the default: every column, in order, none hidden', () => {
    for (const pref of [null, undefined, { order: [], hidden: [] }]) {
      const arrangement = arrangeColumns(pref)
      expect(arrangement.order).toEqual(ALL)
      expect(arrangement.hidden.size).toBe(0)
      expect(isDefaultArrangement(arrangement)).toBe(true)
    }
  })

  it('keeps an id this build does not know in its slot, with its hidden flag, through a save', () => {
    const stored = { order: ALL.toSpliced(3, 0, 'later_column'), hidden: ['later_column', 'source'] }
    const arrangement = arrangeColumns(stored)
    expect(arrangement.order).toEqual(stored.order)
    // The menu and the table read only what this build knows.
    expect(known(arrangement)).toEqual(ALL)
    // Show Source again and save: the unknown column is still where it was, still hidden.
    const saved = toColumnPref(setColumnHidden(arrangement, 'source', false))
    expect(saved).toEqual({ order: stored.order, hidden: ['later_column'] })
    // And it is not the default, so Reset has something to do.
    expect(isDefaultArrangement(arrangeColumns(saved))).toBe(false)
  })

  it('slots a column new since the choice was made in after its predecessor', () => {
    // A choice made before Notes and Collections existed, with Opening moved first.
    const before = ALL.filter((id) => id !== 'notes' && id !== 'collections' && id !== 'opening')
    const arrangement = arrangeColumns({ order: ['opening', ...before], hidden: [] })
    expect(arrangement.order.slice(-3)).toEqual(['flags', 'notes', 'collections'])
    expect(arrangement.order[0]).toBe('opening')
    // With no predecessor in the choice, a new column goes first.
    expect(arrangeColumns({ order: ['white'], hidden: [] }).order[0]).toBe('date')
  })

  it('hides a column that says so only when it is new to the choice', () => {
    const source = column('source')
    source.defaultHidden = true
    try {
      expect(defaultArrangement().hidden).toEqual(new Set(['source']))
      expect(arrangeColumns({ order: ALL.filter((id) => id !== 'source'), hidden: [] }).hidden).toEqual(
        new Set(['source']),
      )
      // Already in the choice and shown: the owner decided, and stays decided.
      expect(arrangeColumns({ order: ALL, hidden: [] }).hidden.size).toBe(0)
    } finally {
      delete source.defaultHidden
    }
  })

  it('drops the checkbox, badly formed ids, repeats, and hidden ids not in the order', () => {
    const arrangement = arrangeColumns({
      order: ['select', 'White!', '', ...ALL, 'white', 7 as unknown as string],
      hidden: ['date', 'nowhere'],
    })
    expect(arrangement.order).toEqual(ALL)
    expect([...arrangement.hidden]).toEqual(['date'])
  })

  it('reads a choice naming no column this build has as the default', () => {
    expect(arrangeColumns({ order: ['later_column'], hidden: [] }).order).toEqual(ALL)
  })
})

describe('columnsFor with the owner’s choice', () => {
  it('pins the checkbox first and follows the chosen order', () => {
    const columns = chosen(['opening', 'white', 'date'])
    expect(columns[0]!.id).toBe('select')
    // The columns the choice does not name are new to it, and slot in after theirs.
    const named = ['select', 'opening', 'white', 'date']
    expect(ids(columns).filter((id) => named.includes(id))).toEqual(named)
  })

  it('drops Worst and Flags under ⇧E even when the choice shows them', () => {
    const columns = chosen(['worst', 'flags', 'date'], [], true)
    expect(ids(columns)).not.toContain('worst')
    expect(ids(columns)).not.toContain('flags')
    expect(columns.find((each) => each.id === 'tier')?.phone).toBe(column('flags').phone)
  })

  it('leaves Collections out without collections, wherever the choice put it', () => {
    expect(ids(chosen(['collections', 'date']))).toContain('collections')
    expect(ids(chosen(['collections', 'date'], [], false, false))).not.toContain('collections')
  })

  it('keeps a hidden card field for the phone, hidden from md up', () => {
    const white = chosen(ALL, ['white']).find((each) => each.id === 'white')!
    expect(white).toMatchObject({ wide: false, last: false })
    expect(cellClass(white)).toContain('md:hidden')
    expect(cellClass(white)).toContain('max-md:col-start-2')
  })

  it('leaves a hidden column with no card slot out altogether', () => {
    expect(ids(chosen(ALL, ['opening', 'source']))).not.toContain('opening')
    expect(ids(chosen(ALL, ['opening', 'source']))).not.toContain('source')
  })

  it('keeps the card’s Analysis slot under ⇧E when Analysis is hidden', () => {
    const tier = chosen(ALL, ['tier'], true).find((each) => each.id === 'tier')!
    expect(tier.wide).toBe(false)
    expect(tier.phone).toBe(column('flags').phone)
  })

  it('makes the last shown column last, past hidden card fields after it', () => {
    // Worst and Flags have card slots, so they stay in the list hidden — but not last.
    const columns = chosen(ALL, ['worst', 'flags', 'notes', 'collections'])
    const last = columns.filter((each) => each.last)
    expect(last).toHaveLength(1)
    expect(last[0]!.wide).toBe(true)
    expect(last[0]!.id).toBe('tier')
    expect(columns.at(-1)!.id).toBe('flags')
    // The tracks are the shown columns' only, the last flexible.
    const wide = columns.filter((each) => each.wide)
    expect(tracksFor(columns).match(/auto|minmax\([^)]*\)/g)).toHaveLength(wide.length)
    expect(tracksFor(columns)).toMatch(/ minmax\(8\.25rem, 1fr\)$/)
  })

  it('falls back to the default when nothing but the checkbox would be shown', () => {
    // Everything hidden.
    expect(ids(chosen(ALL, ALL).filter((each) => each.wide))).toEqual(ids(standard(false)))
    // Only what ⇧E and the Collections rule take away is shown.
    const droppable = chosen(ALL, ALL.filter((id) => !['worst', 'flags', 'collections'].includes(id)), true, false)
    expect(ids(droppable)).toEqual(ids(standard(true, false)))
  })
})

describe('sortHidden', () => {
  it('is true for a sort whose column is gone, or hidden', () => {
    expect(sortHidden(standard(true), 'worst')).toBe(true)
    expect(sortHidden(chosen(ALL, ['opening']), 'opening')).toBe(true)
    // Hidden but still drawn in the phone card: the sort follows the choice at every size.
    expect(sortHidden(chosen(ALL, ['white']), 'white')).toBe(true)
  })

  it('is false for a shown column, and for a sort no column owns', () => {
    expect(sortHidden(standard(false), 'worst')).toBe(false)
    expect(sortHidden(standard(false), 'played_at')).toBe(false)
    expect(sortHidden(chosen(ALL, ['opening']), 'opponent')).toBe(false)
  })
})

describe('moveColumn', () => {
  const arrangement = arrangeColumns({ order: ['date', 'later_column', 'white', 'opening'], hidden: [] })
  const listed = known(arrangement)

  it('swaps with the nearest listed neighbour, leaving unlisted ids in their slots', () => {
    const moved = moveColumn(arrangement, 'white', 'up', listed)
    expect(moved.order.slice(0, 3)).toEqual(['white', 'later_column', 'date'])
    expect(moveColumn(moved, 'white', 'down', listed).order.slice(0, 3)).toEqual([
      'date',
      'later_column',
      'white',
    ])
  })

  it('leaves the arrangement as it is at either end', () => {
    expect(moveColumn(arrangement, 'date', 'up', listed)).toBe(arrangement)
    const lastListed = listed.at(-1)!
    expect(moveColumn(arrangement, lastListed, 'down', listed)).toBe(arrangement)
  })

  it('keeps the hidden set', () => {
    const hidden = setColumnHidden(arrangement, 'opening', true)
    expect(moveColumn(hidden, 'opening', 'up', listed).hidden).toEqual(new Set(['opening']))
  })
})

describe('dropColumn', () => {
  const arrangement = arrangeColumns({ order: ['date', 'later_column', 'white', 'opening'], hidden: [] })
  const listed = known(arrangement)

  it('carries a column past several others, leaving unlisted ids in their slots', () => {
    const dropped = dropColumn(arrangement, 'opening', 'date', listed)
    expect(dropped.order.slice(0, 4)).toEqual(['opening', 'later_column', 'date', 'white'])
    // Down again, onto White: it lands where White was, and White moves up past the unlisted id.
    expect(dropColumn(dropped, 'opening', 'white', listed).order.slice(0, 4)).toEqual([
      'date',
      'later_column',
      'white',
      'opening',
    ])
  })

  it('agrees with moveColumn for one step', () => {
    expect(dropColumn(arrangement, 'white', 'date', listed).order).toEqual(
      moveColumn(arrangement, 'white', 'up', listed).order,
    )
  })

  it('leaves the arrangement as it is onto itself or an unlisted id', () => {
    expect(dropColumn(arrangement, 'white', 'white', listed)).toBe(arrangement)
    expect(dropColumn(arrangement, 'white', 'later_column', listed)).toBe(arrangement)
  })

  it('keeps the hidden set', () => {
    const hidden = setColumnHidden(arrangement, 'opening', true)
    expect(dropColumn(hidden, 'opening', 'date', listed).hidden).toEqual(new Set(['opening']))
  })
})
