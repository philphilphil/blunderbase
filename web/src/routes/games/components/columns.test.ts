import { describe, expect, it } from 'vitest'

import { cellClass, cellStyle, COLUMNS, columnsFor } from './columns'

function column(id: string) {
  const found = COLUMNS.find((entry) => entry.id === id)
  if (!found) throw new Error(`unknown column ${id}`)
  return found
}

describe('cell geometry', () => {
  it('hands a fixed width over as a custom property rather than setting it', () => {
    // An inline `width` outranks every class, so a cell that set one could not be re-laid
    // by the phone card — which is exactly the bug this shape exists to prevent.
    const style = cellStyle(column('white'))
    expect(style).not.toHaveProperty('width')
    expect(style).toMatchObject({ '--cell-width': '7.375rem' })
    expect(cellClass(column('white'))).toContain('md:w-[var(--cell-width)]')
  })

  it('leaves the last column flexible, which a grid item ignores anyway', () => {
    expect(cellStyle(column('collections'))).toEqual({ flex: 1 })
    expect(cellClass(column('collections'))).not.toContain('--cell-width')
  })

  it('gives the last column a floor from md up only, as a class the phone card is free of', () => {
    // The table scrolls sideways instead of squeezing Collections (and the row's delete) away.
    expect(cellClass(column('collections'))).toContain('md:min-w-28')
    expect(cellClass(column('collections'))).not.toMatch(/(^|\s)min-w-28/)
  })

  it('makes Flags the flexible last column when there are no collections', () => {
    const columns = columnsFor(false, false)
    expect(columns.at(-1)).toMatchObject({ id: 'flags', width: 'flex' })
    expect(columnsFor(false, true).find((each) => each.id === 'flags')?.width).toBe(120)
  })

  it('drops Worst and Flags with the engine hidden, and hands the phone slot to Analysis', () => {
    const hidden = columnsFor(true, true)
    expect(hidden.map((each) => each.id)).not.toContain('worst')
    expect(hidden.map((each) => each.id)).not.toContain('flags')
    expect(hidden.find((each) => each.id === 'tier')?.phone).toBe(column('flags').phone)
    // With no collections either, Analysis is last and takes the rest of the width.
    expect(columnsFor(true, false).at(-1)).toMatchObject({ id: 'tier', width: 'flex' })
  })
})
