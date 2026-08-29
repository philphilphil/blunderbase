import { describe, expect, it } from 'vitest'

import { cellClass, cellStyle, COLUMNS, ROW_HEIGHT } from './columns'

function column(id: string) {
  const found = COLUMNS.find((entry) => entry.id === id)
  if (!found) throw new Error(`unknown column ${id}`)
  return found
}

describe('cell geometry', () => {
  it('hands a fixed width over as a custom property rather than setting it', () => {
    // An inline `width` outranks every class, so a cell that set one could not be re-laid
    // by the phone card — which is exactly the bug this shape exists to prevent.
    const style = cellStyle(column('opponent'))
    expect(style).not.toHaveProperty('width')
    expect(style).toMatchObject({ '--cell-width': '8.5rem' })
    expect(cellClass(column('opponent'))).toContain('md:w-[var(--cell-width)]')
  })

  it('leaves the last column flexible, which a grid item ignores anyway', () => {
    expect(cellStyle(column('flags'))).toEqual({ flex: 1, minWidth: 0 })
    expect(cellClass(column('flags'))).not.toContain('--cell-width')
  })

  it('keeps the row height a class, so the phone card can size itself', () => {
    expect(ROW_HEIGHT.startsWith('md:')).toBe(true)
  })
})

describe('the phone card', () => {
  it('hides every column it has no room for', () => {
    for (const dropped of ['opening', 'time', 'moves', 'source', 'tier']) {
      expect(column(dropped).phone).toBeNull()
      expect(cellClass(column(dropped))).toContain('max-md:hidden')
    }
  })

  it('never hides a column it does place', () => {
    for (const col of COLUMNS.filter((entry) => entry.phone !== null)) {
      expect(cellClass(col)).not.toContain('max-md:hidden')
    }
  })

  it('gives every placed cell a square of its own', () => {
    const squares = COLUMNS.filter((col) => col.phone !== null).map((col) => {
      const cols = /max-md:col-start-(\d)/.exec(col.phone!)?.[1]
      const rows = /max-md:row-start-(\d)/.exec(col.phone!)?.[1]
      expect(cols, `${col.id} has no column`).toBeDefined()
      expect(rows, `${col.id} has no row`).toBeDefined()
      return `${cols}:${rows}`
    })
    expect(new Set(squares).size).toBe(squares.length)
  })

  it('spans with an end line, never with a span utility', () => {
    // `col-span-2` sets the `grid-column` shorthand, which resets the start line the very
    // next class tried to set. The two cells that span are the checkbox and the date.
    for (const col of COLUMNS) {
      expect(col.phone ?? '', col.id).not.toMatch(/max-md:(col|row)-span-/)
    }
    expect(column('select').phone).toContain('max-md:row-end-3')
    expect(column('date').phone).toContain('max-md:col-end-4')
  })

  it('sorts by exactly the columns it shows', () => {
    // The header below `md` drops a column with the cell it belongs to, so what a phone
    // can order the library by is what it can read off a row.
    const sortable = COLUMNS.filter((col) => col.phone !== null && col.sort).map((col) => col.id)
    expect(sortable).toEqual(['date', 'opponent', 'rating', 'color', 'result', 'worst'])
  })
})
